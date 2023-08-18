import { Component } from '@angular/core';
import { Sort } from '@angular/material/sort';
import { combineLatest, map } from 'rxjs';
import { BdDataColumn, BdDataGroupingDefinition } from 'src/app/models/data';
import { UserGroupInfo } from 'src/app/models/gen.dtos';
import { BdDataIconCellComponent } from 'src/app/modules/core/components/bd-data-icon-cell/bd-data-icon-cell.component';
import { BdDataPermissionLevelCellComponent } from 'src/app/modules/core/components/bd-data-permission-level-cell/bd-data-permission-level-cell.component';
import { SettingsService } from 'src/app/modules/core/services/settings.service';
import { UserGroupsColumnsService } from 'src/app/modules/core/services/user-groups-columns.service';
import { getGlobalPermission } from 'src/app/modules/panels/admin/utils/permission.utils';
import { AuthAdminService } from '../../services/auth-admin.service';

@Component({
  selector: 'app-user-groups-browser',
  templateUrl: './user-groups-browser.component.html',
  styleUrls: ['./user-groups-browser.component.css'],
})
export class UserGroupsBrowserComponent {
  colPermLevel: BdDataColumn<UserGroupInfo> = {
    id: 'permLevel',
    name: 'Global Permission',
    data: (r) => getGlobalPermission(r.permissions),
    component: BdDataPermissionLevelCellComponent,
  };

  colInact: BdDataColumn<UserGroupInfo> = {
    id: 'inactive',
    name: 'Inact.',
    data: (r) => (r.inactive ? 'check_box' : 'check_box_outline_blank'),
    component: BdDataIconCellComponent,
    width: '40px',
  };

  /* template */ columns: BdDataColumn<UserGroupInfo>[] = [
    this.colInact,
    ...this.groupCols.defaultColumns,
    this.colPermLevel,
  ];

  /* template */ loading$ = combineLatest([
    this.settings.loading$,
    this.authAdmin.loadingUsers$,
  ]).pipe(map(([s, a]) => s || a));

  /* template */ getRecordRoute = (row: UserGroupInfo) => {
    return [
      '',
      {
        outlets: { panel: ['panels', 'admin', 'user-group-detail', row.id] },
      },
    ];
  };

  /* template */ sort: Sort = { active: 'name', direction: 'asc' };

  /* template */ grouping: BdDataGroupingDefinition<UserGroupInfo>[] = [];

  constructor(
    public authAdmin: AuthAdminService,
    public settings: SettingsService,
    private groupCols: UserGroupsColumnsService
  ) {}
}