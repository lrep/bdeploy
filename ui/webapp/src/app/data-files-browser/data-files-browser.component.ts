import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { Location } from '@angular/common';
import { Component, OnInit, TemplateRef, ViewContainerRef } from '@angular/core';
import { PageEvent, Sort } from '@angular/material';
import { ActivatedRoute } from '@angular/router';
import { Observable, of } from 'rxjs';
import { InstanceConfiguration, InstanceDirectory, InstanceDirectoryEntry, StringEntryChunkDto } from '../models/gen.dtos';
import { DownloadService } from '../services/download.service';
import { InstanceService } from '../services/instance.service';
import { Logger, LoggingService } from '../services/logging.service';

@Component({
  selector: 'app-data-files-browser',
  templateUrl: './data-files-browser.component.html',
  styleUrls: ['./data-files-browser.component.css']
})
export class DataFilesBrowserComponent implements OnInit {

  private log: Logger = this.loggingService.getLogger('DataFilesBrowserComponent');

  public INITIAL_PAGE_SIZE = 10;
  public INITIAL_PAGE_INDEX = 0;
  public INITIAL_SORT_COLUMN = 'lastModified';
  public INITIAL_SORT_DIRECTION = 'desc';

  groupParam: string = this.route.snapshot.paramMap.get('group');
  uuidParam: string = this.route.snapshot.paramMap.get('uuid');
  versionParam: string = this.route.snapshot.paramMap.get('version');

  public displayedColumns: string[] = ['icon', 'path', 'size', 'lastModified', 'download'];

  public pageEvents: Map<string, PageEvent> = new Map<string, PageEvent>();
  public sortEvents: Map<string, Sort> = new Map<string, Sort>();

  public instanceVersion: InstanceConfiguration;

  public instanceDirectories: InstanceDirectory[];
  public activeInstanceDirectory: InstanceDirectory = null;
  public activeInstanceDirectoryEntry: InstanceDirectoryEntry = null;

  public get instanceDirectoryNames(): string[] {
    return this.instanceDirectories ? this.instanceDirectories.map(id => id.minion) : [];
  }
  private overlayRef: OverlayRef;

  constructor(private overlay: Overlay,
    private viewContainerRef: ViewContainerRef,
    private route: ActivatedRoute,
    private instanceService: InstanceService,
    private loggingService: LoggingService,
    public location: Location,
    private dlService: DownloadService,
  ) {}


  public ngOnInit(): void {
    this.instanceService.getInstanceVersion(this.groupParam, this.uuidParam, this.versionParam).subscribe(
      instanceVersion => {this.instanceVersion = instanceVersion; }
    );

    this.reload();
  }

  public reload() {
    this.instanceService.listDataDirSnapshot(this.groupParam, this.uuidParam).subscribe(
      instanceDirectories =>  {
        this.instanceDirectories = instanceDirectories.sort((a, b) => {
          if (a.minion === 'master') {
            return -1;
          } else if (b.minion === 'master') {
            return 1;
          } else {
            return a.minion.toLocaleLowerCase().localeCompare(b.minion.toLocaleLowerCase());
          }
        });
    });
  }

  public getCurrentPage(instanceDirectory: InstanceDirectory) {
    const pageEvent = this.pageEvents.get(instanceDirectory.minion);
    const pageIndex = pageEvent ? pageEvent.pageIndex : this.INITIAL_PAGE_INDEX;
    const pageSize = pageEvent ? pageEvent.pageSize : this.INITIAL_PAGE_SIZE;
    const firstIdx = pageIndex * pageSize;

    const sortEvent = this.sortEvents.get(instanceDirectory.minion);
    const sortColumn = sortEvent ? sortEvent.active : this.INITIAL_SORT_COLUMN;
    const sortDirection = sortEvent ? sortEvent.direction : this.INITIAL_SORT_DIRECTION;

    const all = instanceDirectory.entries.slice(); // use copy for sorting -- keep original array
    if (sortColumn && sortDirection) {
      all.sort((a, b) => {
        let v1 = a[sortColumn];
        let v2 = b[sortColumn];
        if (typeof(v1) === 'string' && typeof(v2) === 'string') {
          v1 = v1.toLocaleLowerCase();
          v2 = v2.toLocaleLowerCase();
        }
        const res = v1 < v2 ? -1 : (v1 > v2 ? 1 : 0);
        return res * (sortDirection === 'asc' ? 1 : -1);
      });
    }

    return all.slice(firstIdx, firstIdx + pageSize);
  }

  public sortFiles(instanceDirectory: InstanceDirectory, event: Sort) {
    this.sortEvents.set(instanceDirectory.minion, event);
  }


  public formatSize(size: number): string {
    const i: number = size === 0 ? 0 : Math.min(4, Math.floor(Math.log(size) / Math.log(1024)));
    return (i === 0 ? size : ((size / Math.pow(1024, i)).toFixed(2))) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
  }

  public formatLastModified(lastModified: number): string {
    return new Date(lastModified).toLocaleString();
  }

  public download(instanceDirectory: InstanceDirectory, instanceDirectoryEntry: InstanceDirectoryEntry) {
    this.instanceService.getContentChunk(this.groupParam, this.uuidParam, instanceDirectory, instanceDirectoryEntry, 0, 0, true).subscribe(
      dto => {
        this.downloadFile(instanceDirectoryEntry.path, dto.content);
      }
    );
  }

  private downloadFile(filename: string, data: string): void {
    const blob = new Blob([data], { type: 'text/plain' });
    this.dlService.downloadBlob(filename, blob);
  }

  getCurrentOutputEntryFetcher(): () => Observable<InstanceDirectoryEntry> {
    return () => of(this.activeInstanceDirectoryEntry ? this.activeInstanceDirectoryEntry : null);
  }

  getOutputContentFetcher(): (offset: number, limit: number) => Observable<StringEntryChunkDto> {
    return (offset, limit) => {
      return this.instanceService.getContentChunk(this.groupParam, this.uuidParam, this.activeInstanceDirectory, this.activeInstanceDirectoryEntry, offset, limit, true);
    };
  }

  openOutputOverlay(instanceDirectory: InstanceDirectory, instanceDirectoryEntry: InstanceDirectoryEntry, template: TemplateRef<any>) {
    this.activeInstanceDirectory = instanceDirectory;
    this.activeInstanceDirectoryEntry = instanceDirectoryEntry;

    this.closeOutputOverlay();

    this.overlayRef = this.overlay.create({
      height: '90%',
      width: '90%',
      positionStrategy: this.overlay.position().global().centerHorizontally().centerVertically(),
      hasBackdrop: true
    });
    this.overlayRef.backdropClick().subscribe(() => this.closeOutputOverlay());

    const portal = new TemplatePortal(template, this.viewContainerRef);
    this.overlayRef.attach(portal);
  }

  closeOutputOverlay() {
    if (this.overlayRef) {
      this.activeInstanceDirectory = null;
      this.activeInstanceDirectoryEntry = null;
      this.overlayRef.detach();
      this.overlayRef.dispose();
      this.overlayRef = null;
    }
  }

}
