import { Location } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MediaChange, MediaObserver } from '@angular/flex-layout';
import { MatDialog, MatDialogConfig, MatDrawer } from '@angular/material';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { FileUploadComponent } from '../file-upload/file-upload.component';
import { ProductDto } from '../models/gen.dtos';
import { ProductService } from '../services/product.service';
import { sortByTags } from '../utils/manifest.utils';

@Component({
  selector: 'app-products',
  templateUrl: './products.component.html',
  styleUrls: ['./products.component.css'],
})
export class ProductsComponent implements OnInit, OnDestroy {
  @ViewChild('appsidenav')
  sidenav: MatDrawer;

  public instanceGroup: string;
  public products: Map<string, ProductDto[]> = new Map();
  public selectedProductKey: string = null;
  public productsKeys: string[];

  private subscription: Subscription;
  private grid = new Map([['xs', 1], ['sm', 1], ['md', 2], ['lg', 3], ['xl', 5]]);

  loading = false;
  columns = 3; // calculated number of columns

  constructor(
    private mediaObserver: MediaObserver,
    private productService: ProductService,
    private route: ActivatedRoute,
    public dialog: MatDialog,
    public location: Location,
  ) {}

  ngOnInit() {
    this.instanceGroup = this.route.snapshot.paramMap.get('group');
    this.loadProducts();

    this.subscription = this.mediaObserver.media$.subscribe((change: MediaChange) => {
      this.columns = this.grid.get(change.mqAlias);
    });
  }

  public get selectedProductVersions() {
    return this.selectedProductKey ? this.products.get(this.selectedProductKey) : null;
  }

  public get selectedProductLatestVersion() {
    const versions = this.selectedProductVersions;
    return versions ? versions[0] : null;
  }

  private loadProducts() {
    this.loading = true;

    const productPromise = this.productService.getProducts(this.instanceGroup);
    productPromise.pipe(finalize(() => this.loading = false)).subscribe(p => {
      this.products = new Map();
      p.forEach(prod => {
        this.products.set(prod.name, this.products.get(prod.name) || []);
        this.products.get(prod.name).push(prod);
      });
      this.productsKeys = Array.from(this.products.keys());
      this.productsKeys.forEach(key => {
        const versions: ProductDto[] = this.products.get(key);
          this.products.set(key, sortByTags(versions, v => v.key.tag, false));
      });
      if (this.selectedProductKey && this.productsKeys.indexOf(this.selectedProductKey) === -1) {
        this.selectedProductKey = null;
      }
      if (!this.selectedProductKey) {
        this.sidenav.close();
      }
    });
  }

  versionDeleted(): void {
    this.loadProducts();
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  openProduct(productKey: string): void {
    this.selectedProductKey = productKey;
    this.sidenav.open();
  }

  openUploadDialog() {
    const config = new MatDialogConfig();
    config.width = '80%';
    config.height = '60%';
    config.data = {
      title: 'Upload Products',
      headerMessage: 'Upload products into this instance group. The selected archive may either contain a new product or a new version of an existing product.',
      url: this.productService.getProductUploadUrl(this.instanceGroup),
      mimeTypes: ['application/x-zip-compressed', 'application/zip'],
      mimeTypeErrorMessage: 'Only ZIP files can be uploaded.'
    }
    this.dialog
      .open(FileUploadComponent, config)
      .afterClosed()
      .subscribe(e => {
        this.loadProducts();
      });
  }
}
