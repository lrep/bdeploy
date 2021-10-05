import { NgModule } from '@angular/core';
import { Route, RouterModule } from '@angular/router';
import { ScopedReadGuard } from '../../core/guards/scoped-read.guard';
import { ScopedWriteGuard } from '../../core/guards/scoped-write.guard';
import { ServerCentralGuard } from '../../core/guards/server-central.guard';
import { ProductBulkComponent } from './components/product-bulk/product-bulk.component';
import { LabelsComponent } from './components/product-details/labels/labels.component';
import { PluginsComponent } from './components/product-details/plugins/plugins.component';
import { ProductDetailsComponent } from './components/product-details/product-details.component';
import { ApplicationComponent } from './components/product-details/templates/application/application.component';
import { InstanceComponent } from './components/product-details/templates/instance/instance.component';
import { ManagedTransferComponent } from './components/product-sync/managed-transfer/managed-transfer.component';
import { ProductSyncComponent } from './components/product-sync/product-sync.component';
import { SelectManagedServerComponent } from './components/product-sync/select-managed-server/select-managed-server.component';
import { ProductUploadComponent } from './components/product-upload/product-upload.component';

const PPRODUCTS_ROUTES: Route[] = [
  { path: 'upload', component: ProductUploadComponent, canActivate: [ScopedWriteGuard] },
  { path: 'details/:key/:tag', component: ProductDetailsComponent, canActivate: [ScopedReadGuard] },
  { path: 'details/:key/:tag/labels', component: LabelsComponent, canActivate: [ScopedReadGuard] },
  { path: 'details/:key/:tag/templates/application', component: ApplicationComponent, canActivate: [ScopedReadGuard] },
  { path: 'details/:key/:tag/templates/instance', component: InstanceComponent, canActivate: [ScopedReadGuard] },
  { path: 'details/:key/:tag/plugins', component: PluginsComponent, canActivate: [ScopedReadGuard] },
  { path: 'sync', component: ProductSyncComponent, canActivate: [ScopedWriteGuard, ServerCentralGuard] },
  { path: 'sync/:target/select', component: SelectManagedServerComponent, canActivate: [ScopedWriteGuard, ServerCentralGuard] },
  { path: 'sync/:target/:server', component: ManagedTransferComponent, canActivate: [ScopedWriteGuard, ServerCentralGuard] },
  { path: 'bulk-manip', component: ProductBulkComponent, canActivate: [ScopedWriteGuard] },
];

@NgModule({
  imports: [RouterModule.forChild(PPRODUCTS_ROUTES)],
  exports: [RouterModule],
})
export class ProductsRoutingModule {}
