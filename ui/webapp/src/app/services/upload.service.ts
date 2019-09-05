import { HttpClient, HttpEventType, HttpHeaders, HttpRequest, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { suppressGlobalErrorHandling } from '../utils/server.utils';
import { Logger, LoggingService } from './logging.service';

/** Enumeration of the possible states of an upload */
export enum UploadState {

  /** Files are transferred to the server */
  UPLOADING,

  /** Server side processing in progress */
  PROCESSING,

  /** Upload finished. No errors reported  */
  FINISHED,

  /** Upload failed. */
  FAILED,
}

/** Status of each file upload */
export class UploadStatus {
  file: File;

  /** The upload progress in percent (0-100)  */
  progressObservable: Observable<number>;

  /** Current state */
  state: UploadState;

  /** Notification when the state changes */
  stateObservable: Observable<UploadState>;

  /** The error message if failed. Or the response body if OK */
  detail: any;

  /** Activity scope ID */
  scope: string;

  /** Progress Hint */
  processingHint: string;
}

@Injectable({
  providedIn: 'root',
})
export class UploadService {
  private readonly log: Logger = this.loggingService.getLogger('UploadService');

  constructor(private http: HttpClient, private loggingService: LoggingService) {}

  /**
   * Uploads the given files to the given URL and returns an observable result to track the upload status. For
   * each file a separate HTTP-POST request will be created.
   *
   *  @param url the target URL to post the files to
   *  @param files the files to upload
   *  @returns a map containing the upload status for each file
   */
  public upload(url: string, files: File[]): Map<String, UploadStatus> {
    const result: Map<String, UploadStatus> = new Map();

    files.forEach(file => {
      // create a new progress-subject for every file
      const uploadStatus = new UploadStatus();
      const progressSubject = new Subject<number>();
      const stateSubject = new Subject<UploadState>();
      uploadStatus.file = file;
      uploadStatus.progressObservable = progressSubject.asObservable();
      uploadStatus.stateObservable = stateSubject.asObservable();
      uploadStatus.stateObservable.subscribe( state => {
        uploadStatus.state = state;
      });
      uploadStatus.scope = this.uuidv4();
      result.set(file.name, uploadStatus);
      stateSubject.next(UploadState.UPLOADING);

      // create a new multipart-form for every file
      const formData: FormData = new FormData();
      formData.append('file', file, file.name);

      // Suppress global error handling and enable progress reporting
      const options = {
        reportProgress: true,
        headers: suppressGlobalErrorHandling(new HttpHeaders({ 'X-Proxy-Activity-Scope': uploadStatus.scope })),
      };

      // create a http-post request and pass the form
      const req = new HttpRequest('POST', url, formData, options);
      this.http.request(req).subscribe(
        event => {
          if (event.type === HttpEventType.UploadProgress) {
            const percentDone = Math.round((100 * event.loaded) / event.total);
            progressSubject.next(percentDone);

            // Notify that upload is done and that server-side processing begins
            if(percentDone === 100) {
              progressSubject.complete();
              stateSubject.next(UploadState.PROCESSING);
            }
          } else if (event instanceof HttpResponse) {
            uploadStatus.detail = event.body;
            stateSubject.next(UploadState.FINISHED);
            stateSubject.complete();
          }
        },
        error => {
          uploadStatus.detail = error.statusText + ' (Status ' + error.status + ')';
          stateSubject.next(UploadState.FAILED);
          progressSubject.complete();
          stateSubject.complete();
        },
      );
    });
    return result;
  }

  uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      // tslint:disable-next-line:no-bitwise
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}
