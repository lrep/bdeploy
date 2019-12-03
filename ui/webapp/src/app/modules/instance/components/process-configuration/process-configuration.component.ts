import { Location } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { format } from 'date-fns';
import { cloneDeep, isEqual } from 'lodash';
import { EventSourcePolyfill } from 'ng-event-source';
import { DragulaService } from 'ng2-dragula';
import { forkJoin, Observable, of, Subscription } from 'rxjs';
import { catchError, finalize, mergeMap } from 'rxjs/operators';
import { isUpdateFailed, isUpdateInProgress, isUpdateSuccess, UpdateStatus } from 'src/app/models/update.model';
import { ApplicationGroup } from '../../../../models/application.model';
import { CLIENT_NODE_NAME, EMPTY_DEPLOYMENT_STATE } from '../../../../models/consts';
import { EventWithCallback } from '../../../../models/event';
import { ApplicationConfiguration, ApplicationDto, InstanceNodeConfiguration, InstanceNodeConfigurationDto, InstanceStateRecord, InstanceUpdateEventDto, InstanceUpdateEventType, ManagedMasterDto, ManifestKey, MinionDto, MinionMode, MinionStatusDto, MinionUpdateDto, ProductDto } from '../../../../models/gen.dtos';
import { EditAppConfigContext, ProcessConfigDto } from '../../../../models/process.model';
import { ConfigService } from '../../../core/services/config.service';
import { HeaderTitleService } from '../../../core/services/header-title.service';
import { Logger, LoggingService } from '../../../core/services/logging.service';
import { SystemService } from '../../../core/services/system.service';
import { ProductService } from '../../../instance-group/services/product.service';
import { ManagedServersService } from '../../../servers/services/managed-servers.service';
import { FileUploadComponent } from '../../../shared/components/file-upload/file-upload.component';
import { MessageBoxMode } from '../../../shared/components/messagebox/messagebox.component';
import { DownloadService } from '../../../shared/services/download.service';
import { LauncherService } from '../../../shared/services/launcher.service';
import { MessageboxService } from '../../../shared/services/messagebox.service';
import { RemoteEventsService } from '../../../shared/services/remote-events.service';
import { compareTags, sortByTags } from '../../../shared/utils/manifest.utils';
import { ApplicationService } from '../../services/application.service';
import { InstanceService } from '../../services/instance.service';
import { ProcessService } from '../../services/process.service';
import { ApplicationEditComponent } from '../application-edit/application-edit.component';
import { InstanceVersionCardComponent } from '../instance-version-card/instance-version-card.component';
import { ProcessDetailsComponent } from '../process-details/process-details.component';

export enum SidenavMode {
  Applications,
  Versions,
  Products,
  ProcessStatus,
  ClientInfo,
}

@Component({
  selector: 'app-process-configuration',
  templateUrl: './process-configuration.component.html',
  styleUrls: ['./process-configuration.component.css'],
  providers: [ApplicationService, LauncherService],
})
export class ProcessConfigurationComponent implements OnInit, OnDestroy {
  public static readonly DROPLIST_APPLICATIONS = 'APPLICATIONS';
  private readonly log: Logger = this.loggingService.getLogger('ProcessConfigurationComponent');

  @ViewChild(ApplicationEditComponent, { static: false })
  private editComponent: ApplicationEditComponent;

  @ViewChild(ProcessDetailsComponent, { static: false })
  private processDetails: ProcessDetailsComponent;

  public groupParam: string;
  public uuidParam: string;
  public pageTitle: string;

  // the controlling managed server in central mode.
  public controllingServer: ManagedMasterDto;

  public selectedConfig: ProcessConfigDto;
  public processConfigs: ProcessConfigDto[] = [];
  public selectedProcess: ApplicationConfiguration;

  public sidenavMode: SidenavMode = SidenavMode.Versions;

  public minionConfigs: { [ minionName: string ]: MinionDto } = {};
  public minionStates: { [ minionName: string ]: MinionStatusDto } = {};

  public deploymentState: InstanceStateRecord = EMPTY_DEPLOYMENT_STATE;
  public productTags: ProductDto[];

  public editMode = false;
  public editAppConfigContext: EditAppConfigContext;
  public activeNodeConfig: InstanceNodeConfiguration;

  public cancelEnabled = true;
  public saveEnabled = false;
  public discardEnabled = false;
  public applyEnabled = false;

  public loading = true;
  public productsLoading = false;
  public isRunningOutOfSync = false;

  // Refresh timer and configuration
  public readonly AUTO_REFRESH_INTERVAL_SEC = 10;
  public lastAutoRefresh = Date.now();
  public autoRefresh = false;
  public autoRefreshHandle: any;
  public nextAutoRefreshSec: number;

  private subscriptions = new Subscription();
  private updateEvents: EventSourcePolyfill;
  private lastStateReload = 0;

  public isCentralSynced = false;
  public updateDto: MinionUpdateDto;
  public updateStatus: UpdateStatus;

  constructor(
    private route: ActivatedRoute,
    private loggingService: LoggingService,
    private instanceService: InstanceService,
    private applicationService: ApplicationService,
    private messageBoxService: MessageboxService,
    private productService: ProductService,
    private processService: ProcessService,
    public location: Location,
    public downloadService: DownloadService,
    private dialog: MatDialog,
    private titleService: HeaderTitleService,
    private clientApps: LauncherService,
    private eventService: RemoteEventsService,
    private systemService: SystemService,
    private dragulaService: DragulaService,
    private configService: ConfigService,
    private managedServers: ManagedServersService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.subscriptions = new Subscription();
    this.subscriptions.add(
      this.route.params.subscribe((p: Params) => {
        this.groupParam = p['group'];
        this.uuidParam = p['uuid'];
        this.loadVersions(false);
        this.enableAutoRefresh();
        if (!this.isCentral()) {
          this.doTriggerProcessStatusUpdate();
        }

        this.updateEvents = this.eventService.getUpdateEventSource();
        this.updateEvents.onerror = err => {
          this.systemService.backendUnreachable();
        };
        this.updateEvents.addEventListener(this.uuidParam, e => this.onRemoteInstanceUpdate(e as MessageEvent));
      }),
    );
    this.subscriptions.add(this.processService.subscribe(() => this.onProcessStatusChanged()));

    this.dragulaService.createGroup('APPS', {
      // Prevent re-ordering of elements in the sidebar
      copySortSource: false,

      // Append at the end
      direction: 'horizontal',

      // Prevent moving until we are in edit mode
      moves: () => {
        return this.isSidenavApplications();
      },

      // Create a copy of the elements in the sidebar
      copy: (el: Element, container: Element) => {
        return container.className.includes('dragula-nodeType-template');
      },

      // Just clone the element when needed
      copyItem: (item: any) => {
        return cloneDeep(item);
      },

      // Limit which elements can be dragged to which nodes
      accepts: (el: Element, target: Element) => {
        return this.applicationService.isAppCompatibleWithNode(el, target);
      },
    });
  }

  ngOnDestroy(): void {
    this.dragulaService.destroy('APPS');
    this.subscriptions.unsubscribe();

    if (this.autoRefreshHandle) {
      clearInterval(this.autoRefreshHandle);
    }

    if (this.updateEvents) {
      this.updateEvents.close();
      this.updateEvents = null;
    }
  }

  private onRemoteInstanceUpdate(event: MessageEvent) {
    const dto = JSON.parse(event.data) as InstanceUpdateEventDto;

    // we need to wait a little here before checking as the event may be fired even before we
    // finished our remote call in case /we/ are updating the instance, let along the loading
    // of the new instance version after updating. So the timeout is generous.
    if (dto.type === InstanceUpdateEventType.CREATE) {
      setTimeout(() => this.onRemoteInstanceUpdateDirect(dto.key), 500);
    } else if (dto.type === InstanceUpdateEventType.STATE_CHANGE) {
      setTimeout(() => {
        // avoid reload if we did it ourselves. still delay a little as the event may arrive
        // before the actual call returned and a reload was initiated by the instance version card.
        if (new Date().getTime() - this.lastStateReload >= 150) {
          this.loadDeploymentStates(() => {});
        }
      }, 100);
    }
  }

  private onRemoteInstanceUpdateDirect(newKey: ManifestKey) {
    if (this.loading) {
      // we'll check again a little later, seems we're still loading a new state.
      setTimeout(() => this.onRemoteInstanceUpdateDirect(newKey), 50);
      return;
    }

    for (const cfg of this.processConfigs) {
      const key = cfg.version.key;
      if (key.name !== newKey.name) {
        this.log.warn(
          `Received update event for wrong version, or wrong version loaded in dialog: loaded: ${key}, received: ${newKey}`,
        );
        continue;
      }
      if (key.tag === newKey.tag) {
        // we have it already. fine!
        return;
      }
    }

    // if we reach here, we received an event about a new instance version which we do not yet have.
    // for now this will result in a hardcore messagebox :)
    this.messageBoxService
      .open({
        title: 'Change on server detected',
        message: 'The instance has been modified by somebody else. Pressing OK will reload instance versions.',
        mode: MessageBoxMode.CONFIRM,
      })
      .subscribe(r => {
        if (r) {
          this.loadVersions(true);
          if (this.editMode) {
            this.setEditMode(false);
          }
        }
      });
  }

  private loadVersions(selectLatest: boolean): void {
    this.instanceService.listInstanceVersions(this.groupParam, this.uuidParam).subscribe(versions => {
      this.log.debug('got ' + versions.length + ' instance versions');

      if (!versions.length) {
        this.messageBoxService.open({title: 'Instance no longer available', message: 'The current instance is no longer available on the server', mode: MessageBoxMode.ERROR}).subscribe((r) => {
          this.router.navigate(['instance', 'browser', this.groupParam]);
        });

        return;
      }

      versions.sort((a, b) => {
        return +b.key.tag - +a.key.tag;
      });

      // Create new config DTO for all versions
      this.processConfigs.splice(0, this.processConfigs.length);
      versions.forEach(v => {
        this.processConfigs.push(new ProcessConfigDto(v, true));
      });

      // Add specialized entry that is shown in case we have local modifications
      this.processConfigs.unshift(new ProcessConfigDto(this.processConfigs[0].version, false));

      // get deployment states
      this.instanceService.getDeploymentStates(this.groupParam, this.uuidParam).subscribe(deploymentState => {
        this.deploymentState = deploymentState;

        if (!selectLatest) {
          // selectLatest overrides all
          if (this.selectedConfig) {
            // restore last selection if available
            this.loadInstance(this.selectedConfig);
            return;
          } else if (this.deploymentState.activeTag) {
            // look for activated version
            const initialConfig = this.processConfigs.find(
              cfg => cfg.version.key.tag === this.deploymentState.activeTag,
            );
            if (initialConfig) {
              this.loadInstance(initialConfig);
              return;
            }
          }
        }
        // default or selectLatest
        this.loadInstance(this.processConfigs[0]);
      });
    });
  }

  private loadInstance(newSelectedConfig: ProcessConfigDto) {
    this.loading = true;
    // Check if we already loaded this version
    if (newSelectedConfig.instance) {
      this.loading = false;
      this.selectedConfig = newSelectedConfig;
      this.updateDirtyStateAndValidate();
      return;
    }

    const selectedVersion = newSelectedConfig.version;

    const call1 = this.instanceService
      .getInstanceVersion(this.groupParam, this.uuidParam, selectedVersion.key.tag)
      .pipe(
        mergeMap(instance => {
          newSelectedConfig.setInstance(instance);
          return this.applicationService
            .listApplications(this.groupParam, newSelectedConfig.instance.product, true)
            .pipe(catchError(e => of([]))); // => results[0]
        }),
      );
    const call2 = this.instanceService.getNodeConfiguration(this.groupParam, this.uuidParam, selectedVersion.key.tag); // => results[1]
    const call3 = this.productService.getProducts(this.groupParam); // => result[2];
    let call4 = of(null);
    if (this.isCentral()) {
      call4 = this.managedServers.getServerForInstance(this.groupParam, this.uuidParam, selectedVersion.key.tag); // results[3]
    }

    // Gather node state only in managed / standalone mode
    let call5 = of({});
    if (!this.isCentral() || this.isCentralSynced) {
      call5 = this.instanceService.getMinionState(this.groupParam, this.uuidParam, selectedVersion.key.tag); // results[4]
    }
    const call6 = this.instanceService.getMinionConfiguration(this.groupParam, this.uuidParam, selectedVersion.key.tag); // results[5]

    forkJoin([call1, call2, call3, call4, call5, call6]).subscribe(results => {
      newSelectedConfig.setNodeList(results[1], results[5]);
      newSelectedConfig.setApplications(results[0]);
      this.selectedConfig = newSelectedConfig;

      const filtered = results[2].filter(x => x.key.name === this.selectedConfig.version.product.name);
      this.productTags = sortByTags(filtered, p => p.key.tag, false);

      this.controllingServer = results[3];
      this.minionStates = results[4];
      this.minionConfigs = results[5];

      this.loading = false;
      this.updateDirtyStateAndValidate();
      this.onProcessStatusChanged();
      this.createStickyHeader();
    });
  }

  isCentral() {
    return this.configService.config.mode === MinionMode.CENTRAL;
  }

  getProductOfInstance(pcd: ProcessConfigDto): ProductDto {
    return this.productTags.find(
      p => p.key.name === pcd.instance.product.name && p.key.tag === pcd.instance.product.tag,
    );
  }

  loadDeploymentStates(finalizer: () => void) {
    this.lastStateReload = new Date().getTime();
    this.instanceService
      .getDeploymentStates(this.groupParam, this.uuidParam)
      .pipe(finalize(finalizer))
      .subscribe(r => {
        this.deploymentState = r;
        this.doTriggerProcessStatusUpdate();
      });
  }

  createStickyHeader() {
    const document = window.document;
    const header = document.getElementById('page-header');
    const content = document.getElementById('app-content');
    content.onscroll = function() {
      const sticky = header.offsetTop;
      if (content.scrollTop > sticky) {
        header.classList.add('sticky-header');
        header.classList.add('mat-elevation-z1');
      } else {
        header.classList.remove('sticky-header');
        header.classList.remove('mat-elevation-z1');
      }
    };
  }

  canDeactivate(): Observable<boolean> {
    if (!this.isDirty()) {
      return of(true);
    }
    return this.messageBoxService.open({
      title: 'Unsaved changes',
      message: 'Instance was modified. Close without saving?',
      mode: MessageBoxMode.CONFIRM_WARNING,
    });
  }

  isSidenavApplications(): boolean {
    return this.sidenavMode === SidenavMode.Applications;
  }

  isSidenavVersions(): boolean {
    return this.sidenavMode === SidenavMode.Versions;
  }

  isSidenavProducts(): boolean {
    return this.sidenavMode === SidenavMode.Products;
  }

  isSidenavProcessStatus(): boolean {
    return this.sidenavMode === SidenavMode.ProcessStatus;
  }

  isSidenavClientInfo() {
    return this.sidenavMode === SidenavMode.ClientInfo;
  }

  setSidenavVersions(): void {
    this.sidenavMode = SidenavMode.Versions;
    this.enableAutoRefresh();
  }

  setSidenavApplications(): void {
    this.sidenavMode = SidenavMode.Applications;
    this.disableAutoRefresh();
  }

  setSidenavProcessStatus(process: ApplicationConfiguration): void {
    const callRefresh = this.selectedProcess === process;
    this.sidenavMode = SidenavMode.ProcessStatus;
    this.selectedProcess = process;
    if (callRefresh && this.processDetails) {
      this.processDetails.reLoadStatus();
    }
  }

  setSideNavClientInfo(process: ApplicationConfiguration) {
    this.sidenavMode = SidenavMode.ClientInfo;
    this.selectedProcess = process;
  }

  setSidenavProducts(): void {
    this.sidenavMode = SidenavMode.Products;
    this.disableAutoRefresh();
  }

  public hasClientApplications(): boolean {
    return this.selectedConfig.hasClientApplications();
  }

  public hasServerApplications(): boolean {
    return this.selectedConfig.hasServerApplications();
  }

  onDownloadClickAndStart(app: ApplicationConfiguration) {
    this.instanceService.createClickAndStartDescriptor(this.groupParam, this.uuidParam, app.uid).subscribe(data => {
      this.downloadService.downloadJson(app.name + '.bdeploy', data);
    });
  }

  onDownloadInstaller(event: EventWithCallback<ApplicationConfiguration>) {
    const app = event.data;
    this.instanceService
      .createClientInstaller(this.groupParam, this.uuidParam, app.uid)
      .pipe(finalize(() => event.done()))
      .subscribe(token => {
        this.instanceService.downloadClientInstaller(token);
      });
  }

  public isProductAvailable(config: ProcessConfigDto): boolean {
    return this.productTags.find(p => isEqual(p.key, config.version.product)) !== undefined;
  }

  public isProductUpgradeAvailable(): boolean {
    if (this.processConfigs && this.processConfigs.length > 0 && this.productTags && this.productTags.length > 0) {
      return this.processConfigs[0].version.product.tag !== this.productTags[0].key.tag;
    }
    return false;
  }

  /**
   * Called when the user clicks on the hint that a newer product version is available.
   */
  onNewerProductVersionAvailable() {
    // Switch versions so that the one allowing modifications is selected
    const virtualConfig = this.processConfigs[0];
    this.onSelectConfig(virtualConfig);

    // Open sidebar to change product tag
    this.setSidenavProducts();
  }

  /**
   * Called to switch the active configuration. Needs some special treatment as we have
   * a virtual configuration in our list that is only shown if we have local changes.
   */
  onSelectConfig(config: ProcessConfigDto): void {
    if (this.loading) {
      return;
    }

    // This is the node shown if we have local changes
    const virtualConfig = this.processConfigs[0];

    // If we show the virtual node we can simply switch to whatever node the user selected.
    if (virtualConfig.dirty) {
      this.loadInstance(config);
      return;
    }

    // We do not show the node indicating that we have local changes.
    // If the user clicks on the latest node we need to internally switch to
    // the virtual node. Only this one can be modified
    const latestConfig = this.processConfigs[1];
    if (latestConfig === config) {
      this.loadInstance(virtualConfig);
      return;
    }

    // User clicked at any other node -> just load it
    this.loadInstance(config);
  }

  /**
   * Called when the user clicks the SAVE button in the process configuration
   */
  onSave(): void {
    this.loading = true;

    let server = null;
    if (this.isCentral()) {
      server = this.controllingServer.hostName;
    }

    const nodePromise = this.instanceService.updateInstance(
      this.groupParam,
      this.uuidParam,
      this.selectedConfig.instance,
      this.selectedConfig.nodeList,
      server,
      this.processConfigs[0].version.key.tag,
    );
    nodePromise.subscribe(
      x => {
        this.loadVersions(true);
      },
      () => {
        this.loading = false;
      },
    );
  }

  /**
   * Called when the user clicks the DISCARD button in the process configuration
   */
  async onDiscardChanges(): Promise<void> {
    const result = await this.messageBoxService.openAsync({
      title: 'Discard changes',
      message: 'Are you sure you want to discard all local changes?',
      mode: MessageBoxMode.QUESTION,
    });

    // Revert changes done in the virtual node
    if (!result) {
      return;
    }
    const virtualConfig = this.processConfigs[0];
    virtualConfig.discardChanges();

    // Update enabled state of buttons
    this.applicationService.clearState();
    this.updateDirtyStateAndValidate();
  }

  public onSelectApp(node: InstanceNodeConfigurationDto, process: ApplicationConfiguration) {
    // if we're central && !synced prevent switching
    if (this.isCentral() && !this.isCentralSynced) {
      return;
    }

    // Prevent switching if we edit applications or products
    const disallowed = [SidenavMode.Applications, SidenavMode.Products];
    if (disallowed.includes(this.sidenavMode)) {
      return;
    }
    if (node.nodeName === CLIENT_NODE_NAME) {
      this.setSideNavClientInfo(process);
    } else {
      this.setSidenavProcessStatus(process);
    }
  }

  public onEditApp(nodeConfig: InstanceNodeConfiguration, context: EditAppConfigContext) {
    this.activeNodeConfig = nodeConfig;
    this.editAppConfigContext = cloneDeep(context);
    this.setEditMode(true);
  }

  public onApplyAppChanges() {
    const updated = this.editComponent.appConfigContext.applicationConfiguration;
    const appDesc = this.editComponent.appDesc;
    const appIdx = this.activeNodeConfig.applications.findIndex(app => app.uid === updated.uid);
    this.activeNodeConfig.applications[appIdx] = updated;

    // Update global parameters of all apps
    this.applicationService.updateGlobalParameters(appDesc, updated, this.selectedConfig);

    // Remove all resolved unknown parameters
    this.applicationService.setUnknownParameters(updated.uid, this.editComponent.unknownParameters);

    // Exit edit mode and validate all
    this.setEditMode(false);
  }

  public onDiscardAppChanges(askUser: boolean) {
    if (askUser) {
      const resultPromise = this.editComponent.canDeactivate();
      resultPromise.subscribe(result => {
        if (result) {
          this.setEditMode(false);
        }
      });
    } else {
      this.setEditMode(false);
    }
  }

  isVersionSelected(config: ProcessConfigDto) {
    if (this.loading) {
      return false;
    }

    const versionMatch = isEqual(config.version.key, this.selectedConfig.version.key);

    // If we have local changes we show a specialized card
    // It has the same version but an immutable flag
    const hasModifications = this.processConfigs[0].dirty;
    if (versionMatch && hasModifications) {
      return config.readonly === this.selectedConfig.readonly;
    }

    // When we do not have local changes the version must match
    return versionMatch;
  }

  public shouldShowNode(node: InstanceNodeConfigurationDto) {
    const isClientNode = node.nodeName === CLIENT_NODE_NAME;
    const productHasClientApps = this.hasClientApplications();
    const hasConfiguredClientApp =
      node.nodeConfiguration && node.nodeConfiguration.applications && node.nodeConfiguration.applications.length > 0;
    return !isClientNode || (isClientNode && productHasClientApps) || hasConfiguredClientApp;
  }

  shouldShowVersion(toggle: MatSlideToggle, config: ProcessConfigDto): boolean {
    const virtualConfig = this.processConfigs[0];

    // Show virtual config only if we have local changes
    if (virtualConfig === config) {
      return virtualConfig.dirty;
    }

    // Show all versions
    if (toggle.checked) {
      return true;
    }

    // fail while not initialized
    if (!this.selectedConfig) {
      return false;
    }

    const version = config.version;
    const newestVersion = this.processConfigs[1].version;
    const selectedVersion = this.selectedConfig.version;

    // newest version
    const v: number = +version.key.tag;
    if (v >= +newestVersion.key.tag) {
      return true;
    }
    // activated version
    if (this.deploymentState && this.deploymentState.activeTag && v >= +this.deploymentState.activeTag) {
      return true;
    }
    // selected version
    if (selectedVersion && v >= +selectedVersion.key.tag) {
      return true;
    }
    // App is running in this version
    return this.isRunningOrScheduledVersion(version.key.tag);
  }

  public isRunningOrScheduledVersion(instanceTag: string): boolean {
    return this.processService.isRunningOrScheduledInVersion(instanceTag);
  }

  public isValid() {
    if (this.editMode && this.editComponent) {
      return this.editComponent.isValid();
    }
    return this.selectedConfig.valid;
  }

  public isDirty() {
    if (this.editMode && this.editComponent) {
      return this.editComponent.isDirty();
    }
    // We always check the dirty flag of the virtual configuration
    // to alert the user when there are unsaved changes and he wants to leaves the page
    const virtualConfig = this.processConfigs[0];
    if (!virtualConfig) {
      return false;
    }

    return virtualConfig.dirty;
  }

  public isDirtySelected() {
    if (this.editMode && this.editComponent) {
      return this.editComponent.isDirty();
    }
    // We always check the dirty flag of the virtual configuration
    // to alert the user when there are unsaved changes and he wants to leaves the page
    const virtualConfig = this.processConfigs[0];
    if (!virtualConfig) {
      return false;
    }

    return virtualConfig.dirty && virtualConfig === this.selectedConfig;
  }

  /**
   * Called whenever an application on a node is added, removed or updated.
   */
  onUpdateNodeApps() {
    this.updateDirtyStateAndValidate();
  }

  /**
   * Validates all applications of all nodes and calculates the dirty state.
   */
  updateDirtyStateAndValidate() {
    // Validation and dirty handling is only done if the configuration can be modified
    if (!this.selectedConfig.readonly) {
      // Validate all apps of all nodes
      this.applicationService.validate(this.selectedConfig);

      // Recalculate dirty state of applications
      this.applicationService.calculateDirtyState(this.selectedConfig);

      // Track dirty and validation issues
      this.selectedConfig.dirty = this.applicationService.isOneDirty();
      this.selectedConfig.valid = this.applicationService.isAllValid();
    } else {
      this.applicationService.clearState();
      if (!this.isProductAvailable(this.selectedConfig)) {
        this.applicationService.setProductMissing(this.selectedConfig);
      }
    }

    // Cancel is always enabled if we are finished with loading
    this.cancelEnabled = !this.loading;

    // Save is only enabled if we have local changes that are valid
    if (this.editMode && this.editComponent) {
      this.saveEnabled = this.editComponent.isDirty() && this.editComponent.isValid();
      this.discardEnabled = false;
    } else {
      // Bind save button state to the virtual configuration
      // Thus save is enabled if there are changes regardless of the selection
      // Use this.selectedConfig.dirty to bind enabled state to selection
      const virtualConfig = this.processConfigs[0];
      this.discardEnabled = virtualConfig.dirty;
      this.saveEnabled = virtualConfig.dirty && virtualConfig.valid;
    }
  }

  doInstallVersion(manifest: ManifestKey, card: InstanceVersionCardComponent) {
    card.isLoading = true;
    const resultPromise = this.instanceService.install(this.groupParam, this.uuidParam, manifest);
    resultPromise
      .pipe(
        finalize(() => {
          this.loadDeploymentStates(() => (card.isLoading = false));
        }),
      )
      .subscribe(_ => {});
  }

  doUninstallVersion(manifest: ManifestKey, card: InstanceVersionCardComponent) {
    card.isLoading = true;
    const resultPromise = this.instanceService.uninstall(this.groupParam, this.uuidParam, manifest);
    resultPromise
      .pipe(
        finalize(() => {
          this.loadDeploymentStates(() => (card.isLoading = false));
        }),
      )
      .subscribe(_ => {});
  }

  doActivateVersion(manifest: ManifestKey, card: InstanceVersionCardComponent) {
    card.isLoading = true;

    const resultPromise = this.instanceService.activate(this.groupParam, this.uuidParam, manifest);
    resultPromise
      .pipe(
        finalize(() => {
          this.loadDeploymentStates(() => (card.isLoading = false));
          const newSelectedConfig = this.processConfigs.find(cfg => cfg.version.key.tag === manifest.tag);
          if (newSelectedConfig) {
            this.loadInstance(newSelectedConfig);
          }
        }),
      )
      .subscribe(_ => {});
  }

  shouldShowProduct(toggle: MatSlideToggle, tag: ProductDto): boolean {
    if (toggle.checked) {
      return true;
    }
    return compareTags(tag.key.tag, this.selectedConfig.version.product.tag) >= 0;
  }

  /**
   * Returns whether or not the currently selected configuration is editable.
   */
  isEditable() {
    return this.selectedConfig && !this.isReadonly();
  }

  async updateProduct(product: ProductDto): Promise<void> {
    const oldProduct = this.selectedConfig.instance.product;
    this.productsLoading = true;
    this.productService.updateProduct(this.selectedConfig, product);

    // Fetch applications of the new product and old product
    const newAppsPromise = this.applicationService.listApplications(this.groupParam, product.key, false).toPromise();
    const oldAppsPromise = this.applicationService
      .listApplications(this.groupParam, oldProduct, true)
      .pipe(catchError(e => of([])))
      .toPromise();

    // Update application based on the new product
    const newApps = await Promise.resolve(newAppsPromise);
    const oldApps = await Promise.resolve(oldAppsPromise);
    this.updateApplications(newApps, oldApps);
    this.productsLoading = false;
  }

  updateApplications(newApps: ApplicationDto[], oldApps: ApplicationDto[]) {
    this.applicationService.updateApplications(this.selectedConfig, newApps, oldApps);
    this.updateDirtyStateAndValidate();
    this.setSidenavVersions();
  }

  startInstance() {
    this.processService.startAll(this.groupParam, this.uuidParam).subscribe(r => {
      this.doTriggerProcessStatusUpdate();
      if (this.processDetails) {
        this.processDetails.reLoadStatus();
      }
    });
  }

  stopInstance() {
    this.processService.stopAll(this.groupParam, this.uuidParam).subscribe(r => {
      this.doTriggerProcessStatusUpdate();
      if (this.processDetails) {
        this.processDetails.reLoadStatus();
      }
    });
  }

  restartInstance() {
    this.processService.restartAll(this.groupParam, this.uuidParam).subscribe(r => {
      this.doTriggerProcessStatusUpdate();
      if (this.processDetails) {
        this.processDetails.reLoadStatus();
      }
    });
  }

  /** Switches the edit to the desired state */
  setEditMode(editMode: boolean) {
    this.editMode = editMode;
    if (editMode) {
      this.disableAutoRefresh();
      this.pageTitle = this.titleService.getHeaderTitle();
      this.titleService.setHeaderTitle('Process Settings');
    } else {
      this.enableAutoRefresh();
      this.updateDirtyStateAndValidate();
      this.titleService.setHeaderTitle(this.pageTitle);
    }
  }

  /** Toggles the state of the auto-refresh */
  toggleAutoRefresh() {
    if (this.autoRefresh) {
      this.disableAutoRefresh();
    } else {
      this.enableAutoRefresh();
    }
  }

  /** Enables auto-refresh mechanism */
  enableAutoRefresh() {
    if (this.autoRefresh || (this.isCentral() && !this.isCentralSynced)) {
      return;
    }

    // Enable timer to execute regular updates
    this.autoRefresh = true;
    this.autoRefreshHandle = setInterval(() => this.doUpdateAutoRefreshProgress(), 1000);

    // Execute refresh immediately
    this.doTriggerProcessStatusUpdate();
    this.doUpdateAutoRefreshProgress();
  }

  /** Disables the auto-refresh mechanism */
  disableAutoRefresh() {
    if (!this.autoRefresh) {
      return;
    }
    this.autoRefresh = false;
    clearInterval(this.autoRefreshHandle);
  }

  /** Called when the process state has been refreshed */
  onProcessStatusChanged() {
    const activatedTag = this.deploymentState.activeTag;
    if (!activatedTag) {
      this.isRunningOutOfSync = false;
    } else {
      this.isRunningOutOfSync = this.processService.isRunningOutOfSync(activatedTag);
    }
  }

  /** Triggers the refreshing of the process status */
  doTriggerProcessStatusUpdate() {
    this.lastAutoRefresh = Date.now();
    this.processService.refreshStatus(this.groupParam, this.uuidParam);
  }

  /** Executes the status refresh operation or updates the remaining seconds */
  doUpdateAutoRefreshProgress() {
    const nextRefreshMs = this.lastAutoRefresh + this.AUTO_REFRESH_INTERVAL_SEC * 1000;
    const diff = nextRefreshMs - Date.now();
    this.nextAutoRefreshSec = Math.round(diff / 1000);
    if (this.nextAutoRefreshSec <= 0) {
      this.doTriggerProcessStatusUpdate();
    }
  }

  /** Return a formatted string for this.nextAutoRefreshSec (assumes times less than 10:00 min) */
  public getAutoRefreshSecFormatted(): string {
    const date = new Date(null);
    date.setSeconds(this.nextAutoRefreshSec);
    return date.toISOString().substr(15, 4);
  }

  /** Returns whether or not the auto-refresh UI is visible */
  isAutoRefreshVisible() {
    if (this.editMode) {
      return false;
    }
    return this.sidenavMode === SidenavMode.ProcessStatus || this.sidenavMode === SidenavMode.Versions;
  }

  isReadonly() {
    if (this.isCentral() && !this.isCentralSynced) {
      return true;
    }
    if (this.isUpdateInProgress() || this.isUpdateFailed()) {
      return true;
    }
    if (this.selectedConfig && this.selectedConfig.readonly) {
      return true;
    }
    return false;
  }

  async syncCentral() {
    if (!this.isCentral()) {
      return;
    }
    this.updateDto = null;
    this.updateStatus = null;
    await this.doSyncCentral();
    if (this.isCentralSynced) {
      this.loadVersions(true);
    }
  }

  async doSyncCentral() {
    try {
      await this.managedServers.synchronize(this.groupParam, this.controllingServer.hostName).toPromise();
      this.updateDto = await this.managedServers.getUpdatesFor(this.groupParam, this.controllingServer.hostName).toPromise();
      this.isCentralSynced = true;
    } catch (e) {
      this.messageBoxService.open({
        title: 'Synchronization Error',
        message: 'Synchronization failed. The remote master server might be offline.',
        mode: MessageBoxMode.ERROR});
      this.minionStates = {};
      this.isCentralSynced = false;
    }
  }

  importInstanceVersion() {
    const config = new MatDialogConfig();
    config.width = '80%';
    config.height = '60%';
    config.data = {
      title: 'Import Instance Version',
      headerMessage: `Import a new instance version from a previously exported instance version. The target server of the imported version is ignored.`,
      url: this.instanceService.getImportUrl(this.groupParam, this.uuidParam),
      mimeTypes: ['application/x-zip-compressed', 'application/zip'],
      mimeTypeErrorMessage: 'Only ZIP files can be uploaded.',
    };
    this.dialog
      .open(FileUploadComponent, config)
      .afterClosed()
      .subscribe(e => {
        this.loadVersions(true);
      });
  }

  exportInstanceVersion(key: ManifestKey) {
    this.downloadService.download(this.instanceService.getExportUrl(this.groupParam, this.uuidParam, key.tag));
  }

  /**
   * Returns the drag&drop specific classes assigned to the template.
   */
  getDragulaClasses(group: ApplicationGroup): string[] {
    const classes: string[] = [];

    // Append type of template
    classes.push('dragula-appType-' + group.appType.toLowerCase());

    // Append OS of template
    for (const groupOs of group.operatingSystems) {
      classes.push('dragula-appOs-' + groupOs.toLowerCase());
    }
    return classes;
  }

  getDate(x: number) {
    return format(new Date(x), 'dd.MM.yyyy HH:mm');
  }

  showUpdateComponent() {
    if (this.updateDto && this.updateDto.updateAvailable) {
      return true;
    }
    if (this.updateStatus) {
      return true;
    }
    return false;
  }

  onUpdateEvent(updateState: UpdateStatus) {
    this.updateStatus = updateState;
    if (this.isUpdateSuccess()) {
      this.doSyncCentral();
    }
    if (this.isUpdateFailed()) {
      this.isCentralSynced = false;
      this.messageBoxService.open({
        title: 'Update Error',
        message: 'Failed to await server to come back online. Please check server logs.',
        mode: MessageBoxMode.ERROR,
      });
    }
  }

  isUpdateInProgress() {
    return this.updateStatus && isUpdateInProgress(this.updateStatus);
  }

  isUpdateSuccess() {
    return this.updateStatus && isUpdateSuccess(this.updateStatus);
  }

  isUpdateFailed() {
    return this.updateStatus && isUpdateFailed(this.updateStatus);
  }


}