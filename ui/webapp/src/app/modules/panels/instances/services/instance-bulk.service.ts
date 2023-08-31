import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, switchMap, take, tap } from 'rxjs/operators';
import { InstanceDto } from 'src/app/models/gen.dtos';
import { ConfigService } from 'src/app/modules/core/services/config.service';
import { NavAreasService } from 'src/app/modules/core/services/nav-areas.service';
import { GroupsService } from 'src/app/modules/primary/groups/services/groups.service';
import { InstancesService } from 'src/app/modules/primary/instances/services/instances.service';
import { BulkOperationResultDto } from './../../../../models/gen.dtos';

@Injectable({
  providedIn: 'root',
})
export class InstanceBulkService {
  public selection$ = new BehaviorSubject<InstanceDto[]>([]);
  public frozen$ = new BehaviorSubject<boolean>(false);

  private bulkApiPath = (group) =>
    `${this.cfg.config.api}/group/${group}/instance/bulk`;

  constructor(
    private cfg: ConfigService,
    private http: HttpClient,
    private groups: GroupsService,
    private instance: InstancesService,
    areas: NavAreasService
  ) {
    // clear selection when the primary route changes
    areas.primaryRoute$.subscribe(() => this.selection$.next([]));

    // find matching selected instances if possible once instances change.
    instance.instances$.subscribe((i) => {
      const newSelection: InstanceDto[] = [];
      this.selection$.value.forEach((inst) => {
        const found = i.find(
          (c) => c.instanceConfiguration.id === inst.instanceConfiguration.id
        );
        if (found) {
          newSelection.push(found);
        }
      });
      this.selection$.next(newSelection);
    });
  }

  private logResult(id: string, result: BulkOperationResultDto): void {
    if (result && result?.results?.length) {
      for (const r of result.results) {
        console.log(`${r.target}: ${r.type}: ${r.message}`);
      }
    }
  }

  public start(): Observable<BulkOperationResultDto> {
    return this.selection$.pipe(
      take(1),
      map((i) => i.map((dto) => dto.instanceConfiguration.id)),
      switchMap((i) => {
        return this.http.post<BulkOperationResultDto>(
          `${this.bulkApiPath(this.groups.current$.value.name)}/bulkStart`,
          i
        );
      }),
      tap((r) => this.logResult('Start', r))
    );
  }

  public stop() {
    return this.selection$.pipe(
      take(1),
      map((i) => i.map((dto) => dto.instanceConfiguration.id)),
      switchMap((i) => {
        return this.http.post<BulkOperationResultDto>(
          `${this.bulkApiPath(this.groups.current$.value.name)}/bulkStop`,
          i
        );
      }),
      tap((r) => this.logResult('Stop', r))
    );
  }

  public update(targetVersion: string) {
    return this.selection$.pipe(
      take(1),
      map((i) => i.map((dto) => dto.instance)),
      switchMap((i) => {
        return this.http.post<BulkOperationResultDto>(
          `${this.bulkApiPath(
            this.groups.current$.value.name
          )}/bulkUpdate/${targetVersion}`,
          i
        );
      }),
      tap((r) => this.logResult('Update', r))
    );
  }

  public delete() {
    return this.selection$.pipe(
      take(1),
      map((i) => i.map((dto) => dto.instanceConfiguration.id)),
      switchMap((i) => {
        return this.http.post<BulkOperationResultDto>(
          `${this.bulkApiPath(this.groups.current$.value.name)}/bulkDelete`,
          i
        );
      }),
      tap((r) => this.logResult('Delete', r))
    );
  }

  public install(): Observable<any> {
    return this.selection$.pipe(
      take(1),
      map((i) => i.map((dto) => dto.instanceConfiguration.id)),
      switchMap((i) => {
        return this.http.post<BulkOperationResultDto>(
          `${this.bulkApiPath(this.groups.current$.value.name)}/bulkInstall`,
          i
        );
      }),
      tap((r) => this.logResult('Install', r))
    );
  }

  public activate(): Observable<any> {
    return this.selection$.pipe(
      take(1),
      map((i) => i.map((dto) => dto.instanceConfiguration.id)),
      switchMap((i) => {
        return this.http.post<BulkOperationResultDto>(
          `${this.bulkApiPath(this.groups.current$.value.name)}/bulkActivate`,
          i
        );
      }),
      tap((r) => this.logResult('Activate', r))
    );
  }

  public fetchStates(): void {
    this.instance.syncAndFetchState(
      this.selection$.value?.map((i) => i.instance)
    );
  }
}
