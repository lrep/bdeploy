import { Injectable } from '@angular/core';
import { ActivatedRoute, ActivatedRouteSnapshot, NavigationEnd, NavigationExtras, Router } from '@angular/router';
import { isString } from 'lodash-es';
import { BehaviorSubject } from 'rxjs';
import { filter, map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class NavAreasService {
  panelVisible$ = new BehaviorSubject<boolean>(false);
  panelMaximized$ = new BehaviorSubject<boolean>(false);
  menuMaximized$ = new BehaviorSubject<boolean>(false);

  primaryRoute$ = new BehaviorSubject<ActivatedRouteSnapshot>(null);
  panelRoute$ = new BehaviorSubject<ActivatedRouteSnapshot>(null);

  groupContext$ = new BehaviorSubject<string>(null);
  instanceContext$ = new BehaviorSubject<string>(null);

  private primaryState: string;

  constructor(private router: Router, private activatedRoute: ActivatedRoute) {
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        map(() => this.activatedRoute)
      )
      .subscribe((route) => {
        // SOMEthing changed in the routing, some navigation happened. we need to find out which outlet changed
        // 1. if the panel outlet is visible, and no panel route is active, hide the outlet.
        // 2. if the panel outlet is not visible, and a panel route is active, show the outlet.
        // 3. if a panel route is active, set the expanded state according to its data.
        // 4. if the primary outlet changed, navigate the panel outlet to 'null' to hide it.

        // the two potential activated routes are *direct* childs of the main route. no need to recurse.
        const primary = this.findChildRouteForOutlet(route, 'primary');
        const panel = this.findChildRouteForOutlet(route, 'panel');

        // the *actual* component route which is displayed in the according outlet may *not* have the outlet
        // property set to the requested outlet - only the first child needs to have that.
        const primarySnapshot = this.findRouteLeaf(primary)?.snapshot;
        const panelSnapshot = this.findRouteLeaf(panel)?.snapshot;

        // update the states visible to the flyin part of the main nav.
        this.panelVisible$.next(panelSnapshot ? true : false);
        this.panelMaximized$.next(panelSnapshot && panelSnapshot.data && panelSnapshot.data['max']);

        // if the component (name) in the primary outlet changed, we want to leave the panel navigation.
        const newPrimaryState = isString(primarySnapshot.component) ? primarySnapshot.component : primarySnapshot.component.name;

        // trigger updates of component names for those interested.
        this.primaryRoute$.next(primarySnapshot);
        this.panelRoute$.next(panelSnapshot);

        // primaryState may not be set in case we are just navigating from the void, i.e. somebody opened a link
        // which includes a panel navigation.
        if (this.primaryState && newPrimaryState !== this.primaryState) {
          this.closePanel();
        }

        // we need the primary state to detect whether it changes to clear the panel routing. however
        // we set it to null whenever there is *no* panel route active, to allow to go back/forward to
        // such states through the browser back/forward buttons - it will we treated just like any external
        // (e.g. pasted) links.
        this.primaryState = panelSnapshot ? newPrimaryState : null;

        // as a last step, we determine the current route context. this is done by extracting router parameterx
        // with special names.
        const group = primarySnapshot.paramMap.get('group');
        if (this.groupContext$.value !== group) {
          this.groupContext$.next(group);
          this.instanceContext$.next(null);
        }
        const instance = primarySnapshot.paramMap.get('instance');
        if (this.instanceContext$.value !== instance) {
          this.instanceContext$.next(instance);
        }
      });
  }

  public closePanel() {
    this.router.navigate(['', { outlets: { panel: null } }], { replaceUrl: true });
  }

  public navigateBoth(primary: any[], panel: any[], primaryExtra?: NavigationExtras, panelExtra?: NavigationExtras) {
    this.router.navigate(primary, primaryExtra).then((nav) => {
      if (nav) {
        // need to perform a panel navigation separately to avoid closing the panel and to separate query params.
        this.router.navigate(['', { outlets: { panel } }], panelExtra);
      }
    });
  }

  private findRouteLeaf(route: ActivatedRoute): ActivatedRoute {
    if (!route) {
      return null;
    }
    let result = route;
    while (result.firstChild) {
      result = result.firstChild;
    }
    return result;
  }

  private findChildRouteForOutlet(route: ActivatedRoute, outlet: string): ActivatedRoute {
    if (!route.children) {
      return null;
    }

    for (const child of route.children) {
      if (child.outlet === outlet) {
        return child;
      }
    }
  }
}