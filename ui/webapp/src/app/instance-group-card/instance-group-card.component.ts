import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { InstanceGroupDeleteDialogComponent } from '../instance-group-delete-dialog/instance-group-delete-dialog.component';
import { InstanceGroupConfiguration } from '../models/gen.dtos';
import { InstanceGroupService } from '../services/instance-group.service';
import { LoggingService } from '../services/logging.service';

@Component({
  selector: 'app-instance-group-card',
  templateUrl: './instance-group-card.component.html',
  styleUrls: ['./instance-group-card.component.css']
})
export class InstanceGroupCardComponent implements OnInit {

  private EMPTY_GROUP: InstanceGroupConfiguration = {
    name: 'Loading...',
    description: 'Loading...',
    logo: null,
  };

  private log = this.loggingService.getLogger('InstanceGroupCardComponent');

  @Input() instanceGroup: InstanceGroupConfiguration;
  @Input() instanceGroupId: string;
  @Output() removeEvent = new EventEmitter<boolean>();

  public currentGroup = this.EMPTY_GROUP;

  constructor(
    private loggingService: LoggingService,
    private instanceGroupService: InstanceGroupService,
    private dialog: MatDialog) { }

  ngOnInit() {
    if (this.instanceGroup === undefined) {
      // either of the two inputs must be set.
      if (this.instanceGroupId === undefined) {
        this.log.error('Neither instance group nor instance group id set');
        return;
      }

      // tell the user we're loading this group
      this.currentGroup = {
        name: this.instanceGroupId,
        description: this.EMPTY_GROUP.description,
        logo: this.EMPTY_GROUP.logo
      };

      // load the group and set once available.
      this.instanceGroupService.getInstanceGroup(this.instanceGroupId).subscribe(value => {
        this.currentGroup = value;
      }, error => {
        this.log.warn(`Cannot load instance group ${this.instanceGroupId}`);
        this.removeEvent.emit(true);
      });
    } else {
      // use the group passed from the outside.
      this.currentGroup = this.instanceGroup;
    }
  }

  delete(): void {
    const dialogRef = this.dialog.open(InstanceGroupDeleteDialogComponent, {
      minWidth: '300px',
      maxWidth: '90%',
      data: { name: this.currentGroup.name, confirmation: '' }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === false || result === undefined) {
        return;
      }
      if (this.currentGroup.name === result) {
        this.instanceGroupService.deleteInstanceGroup(result).subscribe(r => {
          this.removeEvent.emit(true);
        });
      } else {
        this.log.warn('Instance group name does not match');
      }
    });
  }

}
