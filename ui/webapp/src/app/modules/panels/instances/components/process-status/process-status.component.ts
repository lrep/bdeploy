import { Component, NgZone, OnDestroy, OnInit, ViewChild, ViewEncapsulation, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Subscription, combineLatest, iif, of } from 'rxjs';
import { delay, distinctUntilChanged, finalize, map, switchMap } from 'rxjs/operators';
import { BdDataColumn } from 'src/app/models/data';
import {
  Actions,
  ApplicationConfiguration,
  ApplicationStartType,
  HttpEndpoint,
  HttpEndpointType,
  InstanceNodeConfigurationDto,
  ParameterType,
  ProcessDetailDto,
  ProcessProbeResultDto,
  ProcessState,
} from 'src/app/models/gen.dtos';
import {
  ACTION_CANCEL,
  ACTION_OK,
} from 'src/app/modules/core/components/bd-dialog-message/bd-dialog-message.component';
import { BdDialogComponent } from 'src/app/modules/core/components/bd-dialog/bd-dialog.component';
import { ActionsService } from 'src/app/modules/core/services/actions.service';
import { AuthenticationService } from 'src/app/modules/core/services/authentication.service';
import { ConfigService } from 'src/app/modules/core/services/config.service';
import { ConfirmationService } from 'src/app/modules/core/services/confirmation.service';
import { NavAreasService } from 'src/app/modules/core/services/nav-areas.service';
import { getRenderPreview } from 'src/app/modules/core/utils/linked-values.utils';
import { GroupsService } from 'src/app/modules/primary/groups/services/groups.service';
import { InstancesService } from 'src/app/modules/primary/instances/services/instances.service';
import { ProcessesService } from 'src/app/modules/primary/instances/services/processes.service';
import { ServersService } from 'src/app/modules/primary/servers/services/servers.service';
import { SystemsService } from 'src/app/modules/primary/systems/services/systems.service';
import { ProcessDetailsService } from '../../services/process-details.service';
import { VerifyResultComponent } from '../verify-result/verify-result.component';
import { PinnedParameterValueComponent } from './pinned-parameter-value/pinned-parameter-value.component';

export interface PinnedParameter {
  appId: string;
  paramId: string;
  name: string;
  value: string;
  type: ParameterType;
}

const colPinnedName: BdDataColumn<PinnedParameter> = {
  id: 'name',
  name: 'Name',
  data: (r) => r.name,
};

const colPinnedValue: BdDataColumn<PinnedParameter> = {
  id: 'value',
  name: 'Value',
  data: (r) => r.value,
  component: PinnedParameterValueComponent,
};

@Component({
  selector: 'app-process-status',
  templateUrl: './process-status.component.html',
  styleUrls: ['./process-status.component.css'],
  encapsulation: ViewEncapsulation.None,
})
export class ProcessStatusComponent implements OnInit, OnDestroy {
  private cfg = inject(ConfigService);
  private route = inject(ActivatedRoute);
  private systems = inject(SystemsService);
  private zone = inject(NgZone);
  private actions = inject(ActionsService);

  protected auth = inject(AuthenticationService);
  protected groups = inject(GroupsService);
  protected details = inject(ProcessDetailsService);
  protected processes = inject(ProcessesService);
  protected instances = inject(InstancesService);
  protected servers = inject(ServersService);
  protected areas = inject(NavAreasService);
  protected confirmationService = inject(ConfirmationService);

  protected uptime$ = new BehaviorSubject<string>(null);
  protected restartProgress$ = new BehaviorSubject<number>(0);
  protected restartProgressText$ = new BehaviorSubject<string>(null);
  protected outdated$ = new BehaviorSubject<boolean>(false);

  private starting$ = new BehaviorSubject<boolean>(false);
  private stopping$ = new BehaviorSubject<boolean>(false);
  private restarting$ = new BehaviorSubject<boolean>(false);
  protected verifying$ = new BehaviorSubject<boolean>(false);

  protected isCrashedWaiting: boolean;
  protected isStopping: boolean;
  protected isRunning: boolean;
  protected isStartPlanned: boolean;

  protected processDetail: ProcessDetailDto;
  protected processConfig: ApplicationConfiguration;
  protected nodeCfg: InstanceNodeConfigurationDto;
  protected startType: 'Instance' | 'Manual' | 'Confirmed Manual';
  protected pinnedParameters: PinnedParameter[] = [];
  protected pinnedColumns: BdDataColumn<PinnedParameter>[] = [colPinnedName, colPinnedValue];
  protected uiEndpoints: HttpEndpoint[] = [];

  // we only show a loading spinner if loading takes longer than 200ms.
  protected loading$ = this.details.loading$.pipe(switchMap((l) => iif(() => l, of(l).pipe(delay(200)), of(l))));

  protected pid$ = this.details.processConfig$.pipe(map((x) => x.id));

  protected mappedStart$ = this.actions.action([Actions.START_PROCESS], this.starting$, null, null, this.pid$);
  protected mappedStop$ = this.actions.action([Actions.STOP_PROCESS], this.stopping$, null, null, this.pid$);
  protected mappedRestart$ = this.actions.action(
    [Actions.START_PROCESS, Actions.STOP_PROCESS],
    this.restarting$,
    null,
    null,
    this.pid$
  );

  protected performing$ = combineLatest([this.mappedStart$, this.mappedStop$, this.mappedRestart$]).pipe(
    map(([a, b, c]) => a || b || c)
  );

  // legacy warning. isRunning, etc. is available through trigger outdated$
  private disabledBase = combineLatest([this.auth.isCurrentScopeWrite$, this.performing$, this.outdated$]);
  protected startDisabled$ = this.disabledBase.pipe(
    map(([perm, perform, outdated]) => !perm || perform || outdated || this.isRunning || this.isStopping)
  );
  protected stopDisabled$ = this.disabledBase.pipe(
    map(
      ([perm, perform]) =>
        !perm || perform || this.isStopping || !(this.isRunning || this.isCrashedWaiting || this.isStartPlanned)
    )
  );
  protected restartDisabled$ = this.disabledBase.pipe(
    map(([perm, perform, outdated]) => !perm || perform || outdated || !(this.isRunning || this.isCrashedWaiting))
  );
  protected verifyDisabled$ = combineLatest([
    this.auth.isCurrentScopeWrite$,
    this.verifying$,
    this.startDisabled$,
  ]).pipe(map(([perm, verifying, startDisabled]) => !perm || verifying || startDisabled));

  private restartProgressHandle: any;
  private uptimeCalculateHandle: any;

  private subscription: Subscription;

  @ViewChild(BdDialogComponent) private dialog: BdDialogComponent;

  ngOnInit(): void {
    this.subscription = combineLatest([
      this.details.processDetail$,
      this.details.processConfig$,
      this.instances.active$,
      this.instances.activeNodeCfgs$,
      this.systems.systems$,
    ]).subscribe(([detail, config, active, nodes, systems]) => {
      this.clearIntervals();
      this.outdated$.next(false);
      this.processConfig = config;
      this.startType = this.formatStartType(this.processConfig?.processControl.startType);
      this.nodeCfg = nodes?.nodeConfigDtos?.find(
        (n) => n.nodeConfiguration.applications.findIndex((a) => a.id === config?.id) !== -1
      );

      const app = nodes?.applications?.find(
        (a) => a.key.name === config?.application?.name && a.key.tag === config?.application?.tag
      );

      const system = systems?.find((s) => s.key.name === active?.instanceConfiguration?.system?.name);
      if (app) {
        this.pinnedParameters = config.start.parameters
          .filter((p) => p.pinned)
          .map((p) => {
            const desc = app?.descriptor?.startCommand?.parameters?.find((x) => x.id === p.id);
            return {
              appId: config.id,
              paramId: p.id,
              name: desc.name,
              value: getRenderPreview(
                p.value,
                config,
                {
                  config: active.instanceConfiguration,
                  nodeDtos: nodes?.nodeConfigDtos,
                },
                system?.config
              ),
              type: desc.type,
            };
          });
      }

      // figure out if we have UI endpoints configured.
      this.uiEndpoints = config?.endpoints.http
        .filter((e) => e.type === HttpEndpointType.UI)
        .filter((e) => {
          const preview = getRenderPreview(
            e.enabled,
            config,
            {
              config: active?.instanceConfiguration,
              nodeDtos: nodes?.nodeConfigDtos,
            },
            system?.config
          );
          const enabled = !!preview && preview !== 'false' && !preview.match(/{{([^}]+)}}/g);
          return enabled;
        });

      // when switching to another process, we *need* to forget those, even if we cannot restore them later on.
      this.starting$.next(false);
      this.stopping$.next(false);
      this.restarting$.next(false);

      if (!detail || detail?.status?.appId !== config?.id) {
        this.processDetail = null;
        this.isCrashedWaiting = false;
        this.isRunning = false;
        this.isStartPlanned = false;
        this.isStopping = false;
        this.outdated$.next(false);
        return;
      }
      this.processDetail = detail;
      this.isCrashedWaiting = detail.status.processState === ProcessState.CRASHED_WAITING;
      this.isRunning = ProcessesService.isRunning(detail.status.processState);
      this.isStartPlanned = detail.status.processState === ProcessState.STOPPED_START_PLANNED;
      this.isStopping = detail.status.processState === ProcessState.RUNNING_STOP_PLANNED;

      this.outdated$.next(detail.status.instanceTag !== active.activeVersion.tag);

      if (this.isCrashedWaiting) {
        this.zone.runOutsideAngular(() => {
          this.restartProgressHandle = setInterval(() => this.doUpdateRestartProgress(detail), 1000);
        });
      }

      if (this.isRunning) {
        this.zone.runOutsideAngular(() => {
          this.uptimeCalculateHandle = setTimeout(() => this.doCalculateUptimeString(detail), 1);
        });
      }
    });

    // when processConfig$ emits value with new id, confirmation dialog must be closed
    this.subscription.add(
      this.details.processConfig$
        .pipe(
          map((config) => config?.id),
          distinctUntilChanged()
        )
        .subscribe(() => {
          this.dialog?.messageComp.reset();
        })
    );
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    this.clearIntervals();
  }

  private clearIntervals() {
    if (this.restartProgressHandle) {
      clearInterval(this.restartProgressHandle);
    }
    if (this.uptimeCalculateHandle) {
      clearTimeout(this.uptimeCalculateHandle);
    }
  }

  private formatStartType(type: ApplicationStartType) {
    switch (type) {
      case ApplicationStartType.INSTANCE:
        return 'Instance';
      case ApplicationStartType.MANUAL:
        return 'Manual';
      case ApplicationStartType.MANUAL_CONFIRM:
        return 'Confirmed Manual';
    }
  }

  protected trackProbe(index: number, probe: ProcessProbeResultDto) {
    return probe.type;
  }

  protected start() {
    this.starting$.next(true);
    let confirmation = of(true);

    // rather die than "mistakingly" start a manual confirm application.
    if (!this.processConfig) {
      throw new Error('Process config not available?!');
    }

    if (this.processConfig.processControl.startType === ApplicationStartType.MANUAL_CONFIRM) {
      confirmation = this.dialog.message({
        header: 'Confirm Process Start',
        message: `Please confirm the start of <strong>${this.processConfig.name}</strong>.`,
        icon: 'play_arrow',
        confirmation: this.processConfig.name,
        confirmationHint: 'Confirm using process name',
        actions: [ACTION_CANCEL, ACTION_OK],
      });
    }

    confirmation.subscribe((b) => {
      if (!b) {
        this.starting$.next(false);
        return;
      }
      this.processes
        .start([this.processDetail.status.appId])
        .pipe(finalize(() => this.starting$.next(false)))
        .subscribe();
    });
  }

  protected stop() {
    this.stopping$.next(true);
    this.processes
      .stop([this.processDetail.status.appId])
      .pipe(finalize(() => this.stopping$.next(false)))
      .subscribe();
  }

  protected restart() {
    this.restarting$.next(true);
    this.processes
      .restart([this.processDetail.status.appId])
      .pipe(finalize(() => this.restarting$.next(false)))
      .subscribe();
  }

  protected verify() {
    this.verifying$.next(true);
    this.processes
      .verify(this.processDetail.status.appId)
      .pipe(switchMap((r) => this.confirmationService.prompt(VerifyResultComponent, r)))
      .subscribe((reinstall) => {
        this.verifying$.next(false);
        if (reinstall) {
          this.reinstall();
        }
      });
  }

  private reinstall() {
    this.verifying$.next(true);
    this.processes.reinstall(this.processDetail.status.appId).subscribe(() => {
      this.verifying$.next(false);
      this.verify();
    });
  }

  protected getRouterLink(r: HttpEndpoint) {
    const returnUrl = this.route.snapshot.pathFromRoot.map((s) => s.url.map((u) => u.toString()).join('/')).join('/');
    return [
      '',
      {
        outlets: {
          panel: [
            'panels',
            'groups',
            'endpoint',
            this.processConfig.id,
            r.id,
            {
              returnPanel: returnUrl,
            },
          ],
        },
      },
    ];
  }

  private doCalculateUptimeString(detail) {
    this.uptimeCalculateHandle = null;
    if (this.isRunning) {
      const now = this.cfg.getCorrectedNow(); // server's 'now'
      const ms = now - detail.handle.startTime; // this comes from the node. node and master are assumed to have the same time.
      const sec = Math.floor(ms / 1000) % 60;
      const min = Math.floor(ms / 60000) % 60;
      const hours = Math.floor(ms / 3600000) % 24;
      const days = Math.floor(ms / 86400000);

      let s = '';
      if (days > 0) {
        s = s + days + (days === 1 ? ' day ' : ' days ');
      }
      if (hours > 0 || days > 0) {
        s = s + hours + (hours === 1 ? ' hour ' : ' hours ');
      }
      if (min > 0 || hours > 0 || days > 0) {
        s = s + min + (min === 1 ? ' minute' : ' minutes');
      }
      let delay = 0;
      if (days === 0 && hours === 0 && min === 0) {
        s = s + sec + (sec === 1 ? ' second' : ' seconds');
        // calculate reschedule for next second
        delay = 1000 - (ms - Math.floor(ms / 1000) * 1000);
      } else {
        // calculate reschedule for next minute
        delay = 60000 - (ms - Math.floor(ms / 60000) * 60000);
      }

      this.zone.run(() => {
        this.uptime$.next(s);
        this.uptimeCalculateHandle = setTimeout(() => this.doCalculateUptimeString(detail), delay);
      });
    } else {
      this.zone.run(() => {
        this.uptime$.next(null);
      });
    }
  }

  private doUpdateRestartProgress(detail: ProcessDetailDto) {
    const diff = detail.recoverAt - this.cfg.getCorrectedNow();
    if (diff < 50) {
      // trigger immediate reload as we know that something is about to happen.
      this.processes.reload();
    } else {
      const totalSeconds = detail.recoverDelay + 2;
      const remainingSeconds = Math.round(diff / 1000);
      const restartProgress = 100 - 100 * (remainingSeconds / totalSeconds);
      const remainingHint = remainingSeconds + ' seconds';

      if (restartProgress != this.restartProgress$.value || remainingHint != this.restartProgressText$.value) {
        this.zone.run(() => {
          this.restartProgress$.next(restartProgress);
          this.restartProgressText$.next(remainingHint);
        });
      }
    }
  }
}
