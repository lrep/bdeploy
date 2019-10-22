import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { InstanceClientAppsDto, InstanceGroupConfiguration, OperatingSystem } from '../models/gen.dtos';
import { suppressGlobalErrorHandling } from '../utils/server.utils';
import { ConfigService } from './config.service';
import { Logger, LoggingService } from './logging.service';

@Injectable({
  providedIn: 'root',
})
export class InstanceGroupService {
  public static BASEPATH = '/group';

  private readonly log: Logger = this.loggingService.getLogger('InstanceGroupService');

  constructor(private cfg: ConfigService, private http: HttpClient, private loggingService: LoggingService) {}

  public listInstanceGroups(): Observable<InstanceGroupConfiguration[]> {
    const url: string = this.cfg.config.api + InstanceGroupService.BASEPATH;
    this.log.debug('listInstanceGroups: ' + url);
    return this.http.get<InstanceGroupConfiguration[]>(url);
  }

  public listClientApps(name: string, os: OperatingSystem): Observable<InstanceClientAppsDto[]> {
    const url: string = this.cfg.config.api + InstanceGroupService.BASEPATH + '/' + name + '/client-apps';
    const options = {
      params: new HttpParams().set('os', os.toUpperCase())
    };
    this.log.debug('listClientApps: ' + url);
    return this.http.get<InstanceClientAppsDto[]>(url, options);
  }

  public createInstanceGroup(group: InstanceGroupConfiguration) {
    const url: string = this.cfg.config.api + InstanceGroupService.BASEPATH;
    this.log.debug('createInstanceGroup: ' + url);
    return this.http.put(url, group);
  }

  /**
   * load an instance group.
   * <p>
   * Does NOT handle errors globally to allow custom handling.
   */
  public getInstanceGroup(name: string): Observable<InstanceGroupConfiguration> {
    const url: string = this.cfg.config.api + InstanceGroupService.BASEPATH + '/' + name;
    this.log.debug('getInstanceGroup: ' + url);
    return this.http.get<InstanceGroupConfiguration>(url, {
      headers: suppressGlobalErrorHandling(new HttpHeaders()),
    });
  }

  public updateInstanceGroup(name: string, group: InstanceGroupConfiguration) {
    const url: string = this.cfg.config.api + InstanceGroupService.BASEPATH + '/' + name;
    this.log.debug('updateInstanceGroup: ' + url);
    return this.http.post(url, group);
  }

  public deleteInstanceGroup(name: string) {
    const url: string = this.cfg.config.api + InstanceGroupService.BASEPATH + '/' + name;
    this.log.debug('deleteInstanceGroup: ' + url);
    return this.http.delete(url);
  }

  public createUuid(name: string): Observable<string> {
    const url: string = this.cfg.config.api + InstanceGroupService.BASEPATH + '/' + name + '/new-uuid';
    this.log.debug('createUuid: ' + url);
    return this.http.get(url, { responseType: 'text' });
  }

  public getInstanceGroupImage(name: string) {
    const url: string = this.getInstanceGroupImageUrl(name);
    this.log.debug('getInstanceGroupImage: ' + url);
    return this.http.get(url, { responseType: 'blob' });
  }

  public getInstanceGroupImageUrl(name: string) {
    return this.cfg.config.api + InstanceGroupService.BASEPATH + '/' + name + '/image';
  }

  public updateInstanceGroupImage(name: string, file: File): Observable<Response> {
    const url: string = this.cfg.config.api + InstanceGroupService.BASEPATH + '/' + name + '/image';
    this.log.debug('updateInstanceGroupImage: ' + url);
    const formData = new FormData();
    formData.append('image', file, file.name);
    return this.http.post<Response>(url, formData);
  }
}
