import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { Component, Input, OnInit, TemplateRef, ViewContainerRef } from '@angular/core';
import { MatButton } from '@angular/material';
import { format } from 'date-fns';
import { finalize } from 'rxjs/operators';
import { InstanceManifestHistoryDto, InstanceVersionDto } from '../models/gen.dtos';
import { InstanceService } from '../services/instance.service';

@Component({
  selector: 'app-instance-version-history-card',
  templateUrl: './instance-version-history-card.component.html',
  styleUrls: ['./instance-version-history-card.component.css']
})
export class InstanceVersionHistoryCardComponent implements OnInit {

  @Input() instanceGroup: string;
  @Input() instanceUuid: string;
  @Input() instanceVersionDto: InstanceVersionDto;

  history: InstanceManifestHistoryDto;
  loading: boolean;

  private overlayRef: OverlayRef;

  constructor(
    private overlay: Overlay,
    private viewContainerRef: ViewContainerRef,
    private instanceService: InstanceService
  ) { }

  ngOnInit() {
  }

  reload() {
    this.loading = true;
    this.instanceService.getHistory(this.instanceGroup, this.instanceUuid, this.instanceVersionDto.key).pipe(finalize(() => this.loading = false)).subscribe(r => this.history = r);
  }

  formatTime(time: number): string {
    return format(new Date(time), 'DD.MM.YYYY HH:mm:ss');
  }

  openOverlay(relative: MatButton, template: TemplateRef<any>) {
    this.reload();
    this.closeOverlay();

    this.overlayRef = this.overlay.create({
      positionStrategy: this.overlay.position().flexibleConnectedTo(relative._elementRef)
        .withPositions([{
            overlayX: 'end',
            overlayY: 'bottom',
            originX: 'center',
            originY: 'top',
            offsetX: 35,
            offsetY: -10,
            panelClass: 'info-card'
        }, {
          overlayX: 'end',
          overlayY: 'top',
          originX: 'center',
          originY: 'bottom',
          offsetX: 35,
          offsetY: 10,
          panelClass: 'info-card-below'
        }])
        .withPush(),
      scrollStrategy: this.overlay.scrollStrategies.close(),
      hasBackdrop: true,
      backdropClass: 'info-backdrop',
    });
    this.overlayRef.backdropClick().subscribe(() => this.closeOverlay());

    const portal = new TemplatePortal(template, this.viewContainerRef);
    this.overlayRef.attach(portal);
  }

  closeOverlay() {
    if (this.overlayRef) {
      this.overlayRef.detach();
      this.overlayRef.dispose();
      this.overlayRef = null;
    }
  }

}
