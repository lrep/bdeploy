import { Component, ElementRef, Inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatTable } from '@angular/material/table';
import { EventSourcePolyfill } from 'ng-event-source';
import { forkJoin } from 'rxjs';
import { ManifestKey } from '../../../../models/gen.dtos';
import { ErrorMessage, LoggingService } from '../../../core/services/logging.service';
import { MessageboxService } from '../../services/messagebox.service';
import { ActivitySnapshotTreeNode, RemoteEventsService } from '../../services/remote-events.service';
import { UploadService, UploadState, UploadStatus } from '../../services/upload.service';
import { MessageBoxMode } from '../messagebox/messagebox.component';

export interface UploadData {
  title: string;
  headerMessage: string;
  url: string;
  mimeTypes: string[];
  mimeTypeErrorMessage: string;
}

@Component({
  selector: 'app-file-upload',
  templateUrl: './file-upload.component.html',
  styleUrls: ['./file-upload.component.css']
})
export class FileUploadComponent implements OnInit, OnDestroy {
  @ViewChild('file', { static: true })
  public fileRef: ElementRef;

  @ViewChild(MatTable, { static: true })
  public table: MatTable<any>;
  public columnsToDisplay = ['status', 'fileName', 'progress', 'action'];

  /** The files to be uploaded */
  public files: File[] = [];

  /** Files to be uploaded */
  public uploads: Map<String, UploadStatus>;

  /** Internal state handling */
  public buttonText = 'Upload';
  public cancelEnabled = true;
  public uploadEnabled = false;
  public showCancelButton = true;
  public uploading = false;
  public dropZoneActive = false;
  public uploadFinished = true;

  private eventSource: EventSourcePolyfill;
  private log = this.loggingService.getLogger('FileUploadComponent');

  constructor(
    @Inject(MAT_DIALOG_DATA) public uploadData: UploadData,
    public dialogRef: MatDialogRef<FileUploadComponent>,
    public uploadService: UploadService,
    public messageBoxService: MessageboxService,
    private eventService: RemoteEventsService,
    private loggingService: LoggingService,
    ) {}

  ngOnInit(): void {
    // start event source
    this.eventSource = this.eventService.getGlobalEventSource();
    this.eventSource.onerror = err => {
      this.log.error(new ErrorMessage('Error while processing events', err));
    };
    this.eventSource.addEventListener('activities', e => this.onEventReceived(e as MessageEvent));
  }

  ngOnDestroy(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  addFiles() {
    this.fileRef.nativeElement.click();
  }

  onFilesAdded() {
    this.doAddFiles(this.fileRef.nativeElement.files);
    this.fileRef.nativeElement.value = '';
  }

  dropZoneState($event: boolean) {
    this.dropZoneActive = $event;
  }

  handleDrop(fileList: FileList) {
    this.doAddFiles(fileList);
  }

  removeFile(file: File) {
    const idx = this.files.indexOf(file);
    this.files.splice(idx, 1);
    this.uploadEnabled = this.files.length > 0;
    this.dialogRef.disableClose = this.files.length > 0;
    this.table.renderRows();
  }

  doAddFiles(fileList: FileList) {
    // Clear all finished files when adding a new one
    if (this.uploads !== undefined) {
      this.uploads.forEach(us => {
        if (us.state === UploadState.FINISHED) {
          return;
        }
        const idx = this.files.indexOf(us.file);
        this.files.splice(idx, 1);
        this.uploads.delete(us.file.name);
      });
    }
    // Reset internal upload state
    this.uploads = undefined;

    // Append newly selected files to the queue
    for (let i = 0; i < fileList.length; i++) {
      const file: File = fileList[i];
      const type: string = file.type;
      if (!this.isValidFileType(type)) {
        this.messageBoxService.open({
          title: 'Unsupported File Type',
          message: this.uploadData.mimeTypeErrorMessage,
          mode: MessageBoxMode.ERROR,
        });
        return;
      }
      this.files.push(file);
    }

    // Update dialog state
    this.buttonText = 'Upload';
    this.uploadFinished = false;
    this.uploadEnabled = this.files.length > 0;
    this.dialogRef.disableClose = this.files.length > 0;
    this.table.renderRows();
  }

  isValidFileType(fileType: string): boolean {
    if (!this.uploadData.mimeTypes) {
      return true;
    }
    return this.uploadData.mimeTypes.includes(fileType);
  }

  isInQueue(file: File) {
    if (this.isFinished(file)) {
      return false;
    }
    if (this.isInProgress(file)) {
      return false;
    }
    if (this.isFailed(file)) {
      return false;
    }
    return this.files.indexOf(file) !== -1;
  }

  isInProgress(file: File) {
    if (this.isFinished(file) || this.isFailed(file)) {
      return false;
    }
    return true;
  }

  isFinished(file: File) {
    return this.hasState(file, UploadState.FINISHED);
  }

  isFailed(file: File) {
    return this.hasState(file, UploadState.FAILED);
  }

  isUploading(file: File) {
    return this.hasState(file, UploadState.UPLOADING);
  }

  isProcessing(file: File) {
    return this.hasState(file, UploadState.PROCESSING);
  }

  hasState(file: File, state: UploadState) {
    const status = this.getUploadStatus(file);
    if (!status) {
      return false;
    }
    return status.state === state;
  }

  getResultDetails(file: File): string {
    const status = this.getUploadStatus(file);
    if (status === null) {
      return '';
    }
    if (this.isFailed(file)) {
      return 'Upload failed. ' + status.detail;
    }
    if (this.isFinished(file)) {
      if (status.detail.length === 0) {
        return 'Software version already exists. Nothing to do.';
      }
      const softwares: ManifestKey[] = status.detail;
      return 'Upload successful. New software package(s): ' + softwares.map(key => key.name + ' ' + key.tag).join(',');
    }
  }

  onEventReceived(e: MessageEvent) {
    // we accept all events as we don't know the scope we're looking for beforehand.
    const rootEvents = this.eventService.parseEvent(e, []);

    // each received event's root scope must match a scope of an UploadStatus object.
    // discard all events where this is not true.
    let needUpdate = false;
    for (const event of rootEvents) {
      if (!event.snapshot || !event.snapshot.scope || event.snapshot.scope.length < 1) {
        continue;
      }

      const status = this.getUploadStatusByUUID(event.snapshot.scope[0]);
      if (!status) {
        continue; // discard, not ours.
      }

      // if we do have a match, extract the most relevant message, set it, and then flag a table repaint.
      status.processingHint = this.extractMostRelevantMessage(event);
      needUpdate = true;
    }

    if (needUpdate) {
      this.table.renderRows();
    }
  }

  extractMostRelevantMessage(node: ActivitySnapshotTreeNode): string {
    // recurse down, always pick the /last/ child.
    if (node.children && node.children.length > 0) {
      return this.extractMostRelevantMessage(node.children[node.children.length - 1]);
    }

    if (!node.snapshot) {
      return null;
    }

    if (node.snapshot.max <= 0) {
      if (node.snapshot.current > 0) {
        return `${node.snapshot.name} (${node.snapshot.current})`;
      } else {
        return node.snapshot.name;
      }
    } else {
      return `${node.snapshot.name} (${node.snapshot.current}/${node.snapshot.max})`;
    }
  }

  getUploadStatusByUUID(uuid: string): UploadStatus {
    if (this.uploads === undefined) {
      return null;
    }
    for (const s of Array.from(this.uploads.values())) {
      if (s.scope === uuid) {
        return s;
      }
    }
    return null;
  }

  onOkButtonPressed() {
    // Close dialog if all files are uploaded
    if (this.uploadFinished) {
      this.dialogRef.close();
      return;
    }

    this.uploading = true;
    this.uploadEnabled = false;
    this.showCancelButton = false;

    // start the upload and save the progress map
    this.uploads = this.uploadService.upload(this.uploadData.url, this.files);

    //    this.uploads = this.softwareService.uploadSoftware(this.uploadData.softwareRepositoryName, this.files);
    const allObservables = [];
    this.uploads.forEach(e => {
      allObservables.push(e.progressObservable);
    });

    // Update state when we are finished
    forkJoin(allObservables).subscribe(
      next => {
        this.fileUploaded();
      },
      error => {},
      () => {
        this.allFilesUploaded();
      },
    );
  }

  allFilesUploaded() {
    const oneFailed = Array.from(this.uploads.values()).some(us => us.state === UploadState.FAILED);
    if (oneFailed) {
      this.buttonText = 'Retry Upload';
      this.uploadFinished = false;
      this.dialogRef.disableClose = true;
    } else {
      this.buttonText = 'Close';
      this.uploadFinished = true;
      this.dialogRef.disableClose = false;
    }
    this.uploadEnabled = true;
    this.uploading = false;
    this.table.renderRows();
  }

  fileUploaded() {
    this.table.renderRows();
  }

  getUploadStatus(file: File): UploadStatus {
    if (this.uploads === undefined) {
      return null;
    }
    return this.uploads.get(file.name);
  }

  getUploadProgress(file: File) {
    return this.getUploadStatus(file).progressObservable;
  }

}
