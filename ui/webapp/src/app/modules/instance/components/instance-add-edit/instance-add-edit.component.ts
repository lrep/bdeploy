import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { Location } from '@angular/common';
import { Component, OnInit, TemplateRef, ViewContainerRef } from '@angular/core';
import { FormBuilder, FormControl, Validators } from '@angular/forms';
import { MatButton } from '@angular/material';
import { ActivatedRoute } from '@angular/router';
import { cloneDeep, isEqual } from 'lodash';
import { Observable, of } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { EMPTY_INSTANCE } from '../../../../models/consts';
import { InstanceConfiguration, InstancePurpose, InstanceVersionDto, ManagedMasterDto, MinionMode, ProductDto } from '../../../../models/gen.dtos';
import { ConfigService } from '../../../core/services/config.service';
import { Logger, LoggingService } from '../../../core/services/logging.service';
import { InstanceGroupService } from '../../../instance-group/services/instance-group.service';
import { ProductService } from '../../../instance-group/services/product.service';
import { ManagedServersService } from '../../../servers/services/managed-servers.service';
import { MessageBoxMode } from '../../../shared/components/messagebox/messagebox.component';
import { MessageboxService } from '../../../shared/services/messagebox.service';
import { sortByTags } from '../../../shared/utils/manifest.utils';
import { InstanceService } from '../../services/instance.service';

@Component({
  selector: 'app-instance-add-edit',
  templateUrl: './instance-add-edit.component.html',
  styleUrls: ['./instance-add-edit.component.css'],
})
export class InstanceAddEditComponent implements OnInit {
  private log: Logger = this.loggingService.getLogger('InstanceAddEditComponent');

  public groupParam: string;
  public uuidParam: string;

  public purposes: InstancePurpose[];
  public products: ProductDto[] = [];
  public servers: ManagedMasterDto[] = [];

  public loading = false;

  public clonedInstance: InstanceConfiguration;
  private expectedVersion: InstanceVersionDto;

  public instanceFormGroup = this.formBuilder.group({
    uuid: ['', Validators.required],
    name: ['', Validators.required],
    description: [''],
    autoStart: [''],
    configTree: [''],
    purpose: ['', Validators.required],
    product: this.formBuilder.group({
      name: ['', Validators.required],
      tag: ['', Validators.required],
    }),
    autoUninstall: ['']
  });

  public formGroup = this.formBuilder.group({
    managedServer: this.formBuilder.group({
      name: ['']
    })
  });

  private overlayRef: OverlayRef;

  constructor(
    private formBuilder: FormBuilder,
    private instanceGroupService: InstanceGroupService,
    private productService: ProductService,
    private instanceService: InstanceService,
    private route: ActivatedRoute,
    private loggingService: LoggingService,
    private messageBoxService: MessageboxService,
    public location: Location,
    private viewContainerRef: ViewContainerRef,
    private overlay: Overlay,
    private config: ConfigService,
    private managedServers: ManagedServersService
  ) {}

  ngOnInit() {
    this.groupParam = this.route.snapshot.paramMap.get('group');
    this.uuidParam = this.route.snapshot.paramMap.get('uuid');
    this.log.debug('groupParam = ' + this.groupParam + ', nameParam = ' + this.uuidParam);

    if (this.isCreate()) {
      this.instanceGroupService.createUuid(this.groupParam).subscribe((uuid: string) => {
        this.log.debug('got uuid ' + uuid);
        const instance = cloneDeep(EMPTY_INSTANCE);
        instance.autoUninstall = true;
        instance.uuid = uuid;
        this.instanceFormGroup.patchValue(instance);
        this.clonedInstance = cloneDeep(instance);
      });
    } else {
      this.instanceService.getInstance(this.groupParam, this.uuidParam).subscribe(instance => {
        this.log.debug('got instance ' + this.uuidParam);
        this.instanceFormGroup.patchValue(instance);
        this.clonedInstance = cloneDeep(instance);
      });
      // TODO: this could be better (group with above request)
      this.instanceService.listInstanceVersions(this.groupParam, this.uuidParam).subscribe(vs => {
        vs.sort((a, b) => {
          return +b.key.tag - +a.key.tag;
        });
        this.expectedVersion = vs[0];
      });
      this.managedServers.getServerForInstance(this.groupParam, this.uuidParam, null).subscribe(r => {
        if (r) {
          this.managedServerControl.setValue(r.hostName);
        }
      });
    }

    this.instanceService.listPurpose(this.groupParam).subscribe(purposes => {
      this.purposes = purposes;
      this.log.debug('got purposes ' + this.purposes);
    });

    this.productService.getProducts(this.groupParam).subscribe(products => {
      this.products = products;
      this.log.debug('got ' + products.length + ' products');
    });

    // Clear tag if product changed
    this.productNameControl.valueChanges.subscribe(input => this.productTagControl.reset());

    // Changing product and tag is not allowed after instance has been created
    // User needs to change that in the process config dialog as all validation and update logic is located there
    if (!this.isCreate()) {
      this.productNameControl.disable();
      this.productTagControl.disable();
      this.managedServerControl.disable();
    }

    if (this.isCentral()) {
      this.managedServerControl.setValidators([Validators.required]);
      this.managedServers.getManagedServers(this.groupParam).subscribe(r => {
        this.servers = r.sort((a, b) => a.hostName.localeCompare(b.hostName));
      });
    }
  }

  isModified(): boolean {
    const instance: InstanceConfiguration = this.instanceFormGroup.getRawValue();
    return !isEqual(instance, this.clonedInstance);
  }

  canDeactivate(): Observable<boolean> {
    if (!this.isModified()) {
      return of(true);
    }
    return this.messageBoxService.open({
      title: 'Unsaved changes',
      message: 'Instance was modified. Close without saving?',
      mode: MessageBoxMode.CONFIRM_WARNING,
    });
  }

  public getErrorMessage(ctrl: FormControl): string {
    if (ctrl.hasError('required')) {
      return 'Required';
    }
    return 'Unknown error';
  }

  public isCreate(): boolean {
    return this.uuidParam == null;
  }

  public getProductNames(): string[] {
    const pNames = Array.from(this.products, p => p.key.name);
    return pNames.filter((value, index, array) => array.indexOf(value) === index).sort();
  }

  public getProductDisplayName(pName: string): string {
    const product: ProductDto = this.products.find(e => e.key.name === pName);
    return product.name + (product.vendor ? ' (' + product.vendor + ')' : '');
  }

  public getTagsForProduct(): string[] {
    const selectedProduct = this.productNameControl.value;
    const productVersions = this.products.filter((value, index, array) => value.key.name === selectedProduct);
    return sortByTags(Array.from(productVersions, p => p.key.tag), p => p, false);
  }

  public onSubmit(): void {
    this.loading = true;
    const instance: InstanceConfiguration = this.instanceFormGroup.getRawValue();

    if (this.isCreate()) {
      this.instanceService
        .createInstance(this.groupParam, instance, this.managedServerControl.value)
        .pipe(finalize(() => (this.loading = false)))
        .subscribe(result => {
          this.clonedInstance = instance;
          this.log.info('created new instance ' + this.uuidParam);
          this.location.back();
        });
    } else {
      this.instanceService
        .updateInstance(this.groupParam, this.uuidParam, instance, null, this.managedServerControl.value, this.expectedVersion.key.tag)
        .pipe(finalize(() => (this.loading = false)))
        .subscribe(result => {
          this.clonedInstance = instance;
          this.log.info('updated instance ' + this.uuidParam);
          this.location.back();
        });
    }
  }

  get uuidControl() {
    return this.instanceFormGroup.get('uuid');
  }
  get nameControl() {
    return this.instanceFormGroup.get('name');
  }
  get descriptionControl() {
    return this.instanceFormGroup.get('description');
  }
  get purposeControl() {
    return this.instanceFormGroup.get('purpose');
  }

  get productNameControl() {
    return this.instanceFormGroup.get('product.name');
  }
  get productTagControl() {
    return this.instanceFormGroup.get('product.tag');
  }

  get managedServerControl() {
    return this.formGroup.get('managedServer.name');
  }

  openOverlay(relative: MatButton, template: TemplateRef<any>) {
    this.closeOverlay();

    this.overlayRef = this.overlay.create({
      positionStrategy: this.overlay
        .position()
        .flexibleConnectedTo(relative._elementRef)
        .withPositions([
          {
            overlayX: 'end',
            overlayY: 'bottom',
            originX: 'center',
            originY: 'top',
          },
        ])
        .withPush()
        .withViewportMargin(0)
        .withDefaultOffsetX(35)
        .withDefaultOffsetY(-10),
      scrollStrategy: this.overlay.scrollStrategies.close(),
      hasBackdrop: true,
      backdropClass: 'info-backdrop',
    });
    this.overlayRef.backdropClick().subscribe(() => this.closeOverlay());

    const portal = new TemplatePortal(template, this.viewContainerRef);
    this.overlayRef.attach(portal);
  }

  /** Closes the overlay if present */
  closeOverlay() {
    if (this.overlayRef) {
      this.overlayRef.detach();
      this.overlayRef.dispose();
      this.overlayRef = null;
    }
  }

  isCentral() {
    return this.config.config.mode === MinionMode.CENTRAL;
  }

}