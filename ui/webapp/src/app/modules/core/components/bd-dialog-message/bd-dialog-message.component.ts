import { Component, HostListener, OnDestroy, OnInit, TemplateRef, inject } from '@angular/core';
import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { delayedFadeIn } from '../../animations/fades';
import { PopupService } from '../../services/popup.service';

export interface BdDialogMessageAction<T> {
  /** The name of the action is usually rendered as button text */
  name: string;

  /** The value emitted as dialog result in case this action is chosen */
  result: T;

  /**
   * Whether the action is a confirmation action, meaning it must be disabled if a confirmation value is given
   * until the user correctly entered it. Additionally this action can be triggered using the Enter key if (and
   * only if) this action is the sole confirmation action given.
   */
  confirm: boolean;

  /** Whether the action is currently disabled or not */
  disabled?: () => boolean;
}

export interface BdDialogMessage<T> {
  /** Header shown at the top of the message */
  header: string;

  /** Descriptive message */
  message?: string;

  /** Template for the message used *instead* of the message. */
  template?: TemplateRef<any>;

  /** Icon shown in the message, defaults to 'info' */
  icon?: string;

  /** An optional string which needs to be */
  confirmation?: string;

  /** A hint which tells the user which confirmation value needs to be matched. */
  confirmationHint?: string;

  /** A custom call */
  validation?: () => boolean;

  /** The actions which should be shown on the message */
  actions?: BdDialogMessageAction<T>[];

  /** If set, the message can be dismissed (using an 'X'). This will be the result in this case. */
  dismissResult?: T;
}

export const ACTION_CONFIRM: BdDialogMessageAction<boolean> = {
  name: 'Confirm',
  result: true,
  confirm: true,
};
export const ACTION_APPLY: BdDialogMessageAction<boolean> = {
  name: 'Apply',
  result: true,
  confirm: true,
};

export const ACTION_OK: BdDialogMessageAction<boolean> = {
  name: 'OK',
  result: true,
  confirm: true,
};
export const ACTION_DISCARD: BdDialogMessageAction<boolean> = {
  name: 'Discard',
  result: true,
  confirm: true,
};
export const ACTION_CANCEL: BdDialogMessageAction<boolean> = {
  name: 'Cancel',
  result: false,
  confirm: false,
};
export const ACTION_CLOSE: BdDialogMessageAction<boolean> = {
  name: 'Close',
  result: false,
  confirm: false,
};

export const ACTION_YES: BdDialogMessageAction<boolean> = {
  name: 'Yes',
  result: true,
  confirm: true,
};
export const ACTION_NO: BdDialogMessageAction<boolean> = {
  name: 'No',
  result: false,
  confirm: false,
};

@Component({
  selector: 'app-bd-dialog-message',
  templateUrl: './bd-dialog-message.component.html',
  animations: [delayedFadeIn],
})
export class BdDialogMessageComponent implements OnInit, OnDestroy {
  private popupService = inject(PopupService);

  public message$ = new BehaviorSubject<BdDialogMessage<any>>(null);
  public result$ = new Subject<any>();
  public confirmed$ = new BehaviorSubject<boolean>(true);

  private subscription: Subscription;

  private _userConfirmation;
  set userConfirmation(val: string) {
    if (val === this.message$.value.confirmation) {
      this.confirmed$.next(true);
    } else {
      this.confirmed$.next(false);
    }
    this._userConfirmation = val;
  }

  get userConfirmation(): string {
    return this._userConfirmation;
  }

  ngOnInit(): void {
    // reset confirmation state whenever a new message arrives which requires confirmation.
    this.subscription = this.message$.pipe(filter((v) => !!v)).subscribe((r) => this.confirmed$.next(!r.confirmation));
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  public reset(): void {
    if (this.message$.value) {
      this.result$.error('Dialog Message Reset');
      this.message$.next(null);
      this._userConfirmation = '';
    }
  }

  @HostListener('body:keydown.Enter', ['$event'])
  private onEnterPress(event: KeyboardEvent): void {
    // in case a content-assist is currently active, we do not want to trigger the default button;
    if (event.defaultPrevented) {
      return;
    }

    // find single confirm action.
    const x = this.message$.value?.actions?.filter((a) => a.confirm);
    if (x?.length !== 1 || !this.confirmed$.value) {
      return; // do nothing, none or multiple confirming actions, don't know which to press :)
    }

    // check if valid!
    if (
      (this.message$.value?.validation && !this.message$.value?.validation()) ||
      (!!x[0].disabled && x[0].disabled())
    ) {
      return; // not valid or enabled!
    }

    this.complete(x[0].result);
  }

  public complete(result: any) {
    this.message$.next(null);
    this.result$.next(result);
    this._userConfirmation = '';
  }

  protected onConfirmationUpdate(value) {
    if (this.message$.value.confirmation === value) {
      this.confirmed$.next(true);
    }
  }
}
