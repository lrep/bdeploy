import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, Injector, inject } from '@angular/core';
import { AuthService } from '@auth0/auth0-angular';
import { BehaviorSubject, Observable, ReplaySubject, combineLatest, of } from 'rxjs';
import { catchError, finalize, first, map, skipWhile, switchMap, tap } from 'rxjs/operators';
import {
  ApiAccessToken,
  CredentialsApi,
  Permission,
  SpecialAuthenticators,
  UserChangePasswordDto,
  UserInfo,
} from '../../../models/gen.dtos';
import { suppressGlobalErrorHandling, suppressUnauthenticatedDelay } from '../utils/server.utils';
import { ConfigService } from './config.service';
import { NavAreasService } from './nav-areas.service';

@Injectable({
  providedIn: 'root',
})
export class AuthenticationService {
  private cfg = inject(ConfigService);
  private http = inject(HttpClient);
  private areas = inject(NavAreasService);
  private injector = inject(Injector);

  private tokenSubject: BehaviorSubject<string> = new BehaviorSubject(null);

  private userInfoSubject$: ReplaySubject<UserInfo> = new ReplaySubject(1);
  private currentUserInfo: UserInfo = null; // possibly uninitialized value
  get firstUserInfo$(): Observable<UserInfo> {
    return this.userInfoSubject$.pipe(first());
  }

  public isCurrentScopedExclusiveReadClient$: BehaviorSubject<boolean> = new BehaviorSubject(false);
  public isCurrentScopeWrite$: BehaviorSubject<boolean> = new BehaviorSubject(false);
  public isCurrentScopeAdmin$: BehaviorSubject<boolean> = new BehaviorSubject(false);
  public isGlobalAdmin$: BehaviorSubject<boolean> = new BehaviorSubject(false);
  public isGlobalExclusiveReadClient$: BehaviorSubject<boolean> = new BehaviorSubject(false);

  constructor() {
    this.cfg.initialSession.subscribe((v) => {
      this.tokenSubject.next(v);
    });

    this.userInfoSubject$.subscribe((userInfo) => {
      const wasEmpty = !this.currentUserInfo;
      this.currentUserInfo = userInfo;
      if (wasEmpty) {
        this.auth0Validate();
      }
    });

    combineLatest([
      this.areas.groupContext$,
      this.areas.repositoryContext$,
      this.tokenSubject, // just used as trigger
    ]).subscribe(([groupContext, repositoryContext]) => {
      if (groupContext || repositoryContext) {
        this.isCurrentScopeAdmin$.next(this.isCurrentScopeAdmin());
        this.isCurrentScopeWrite$.next(this.isCurrentScopeWrite());
      } else {
        this.isCurrentScopeAdmin$.next(this.isGlobalAdmin());
        this.isCurrentScopeWrite$.next(this.isGlobalWrite());
      }
      if (groupContext) {
        this.isCurrentScopedExclusiveReadClient$.next(this.isCurrentScopeExclusiveReadClient());
      }
    });

    this.tokenSubject.subscribe(() => {
      this.isGlobalAdmin$.next(this.isGlobalAdmin());
      this.isGlobalExclusiveReadClient$.next(this.isGlobalExclusiveReadClient());
    });
  }

  public authenticate(username: string, password: string, auth?: SpecialAuthenticators): Observable<any> {
    return this.http
      .post(this.cfg.config.api + '/auth/session', { user: username, password: password } as CredentialsApi, {
        responseType: 'text',
        headers: suppressGlobalErrorHandling(suppressUnauthenticatedDelay(new HttpHeaders())),
        params: auth ? new HttpParams().set('auth', auth) : undefined,
      })
      .pipe(
        catchError((err) => {
          this.tokenSubject.next(null);
          throw err;
        }),
        switchMap((t) => {
          return this.http
            .get<UserInfo>(this.cfg.config.api + '/auth/user', {
              headers: suppressGlobalErrorHandling(suppressUnauthenticatedDelay(new HttpHeaders())),
            })
            .pipe(
              catchError((err) => {
                this.userInfoSubject$.next(null);
                throw err;
              }),
              tap((userInfo) => {
                this.userInfoSubject$.next(userInfo);
                this.tokenSubject.next(t);
              })
            );
        })
      );
  }

  public isAuthenticated(): boolean {
    return this.tokenSubject.value !== null;
  }

  public getToken(): string {
    return this.tokenSubject.value;
  }

  public getTokenSubject(): BehaviorSubject<string> {
    return this.tokenSubject;
  }

  private getTokenPayload(): ApiAccessToken {
    const payload: any =
      this.tokenSubject && this.tokenSubject.value ? JSON.parse(atob(this.tokenSubject.value)).p : null;
    return payload ? JSON.parse(atob(payload)) : null;
  }

  public getCurrentUsername(): string {
    if (this.currentUserInfo) {
      return this.currentUserInfo.name;
    }
    const tokenPayload = this.getTokenPayload();
    return tokenPayload ? tokenPayload.it : null;
  }

  private auth0Validate() {
    const svc = this.injector.get(AuthService);
    svc.isLoading$.pipe(skipWhile((l) => l)).subscribe(() => {
      if (this.currentUserInfo.externalSystem !== 'AUTH0') {
        return;
      }
      svc
        .getAccessTokenSilently()
        .pipe(
          catchError((err) => {
            console.log('auth0 expired', err);
            this.logout();
            return of(null);
          })
        )
        .subscribe((t) => {
          // if we got one, we want to use it on the server as well.
          this.authenticate(this.currentUserInfo.name, t, SpecialAuthenticators.AUTH0)
            .pipe(
              catchError((err) => {
                console.log('cannot update auth0 token on server', err);
                return of(err);
              })
            )
            .subscribe(() => {
              console.log('auth0 token updated on server');
            });
        });
    });
  }

  private auth0Logout() {
    if (this.cfg.webAuthCfg?.auth0?.enabled && this.currentUserInfo?.externalSystem === 'AUTH0') {
      return this.injector.get(AuthService).logout();
    }
    return of(null);
  }

  public logout(): Observable<any> {
    this.tokenSubject.next(null);

    return combineLatest([
      this.http.post(`${this.cfg.config.api}/auth/session/logout`, null, {
        headers: suppressGlobalErrorHandling(suppressUnauthenticatedDelay(new HttpHeaders())),
      }),
      this.auth0Logout(),
    ]).pipe(
      catchError((err) => {
        console.log('Error during logout', err);
        return of(null); // just swallow it :)
      }),
      finalize(() => {
        window.location.reload();
      })
    );
  }

  public isGlobalAdmin(): boolean {
    const tokenPayload = this.getTokenPayload();
    if (tokenPayload && tokenPayload.c) {
      return !!tokenPayload.c.find((c) => c.scope === null && this.ge(c.permission, Permission.ADMIN));
    }
    return false;
  }

  private isGlobalWrite(): boolean {
    const tokenPayload = this.getTokenPayload();
    if (tokenPayload && tokenPayload.c) {
      return !!tokenPayload.c.find((c) => c.scope === null && this.ge(c.permission, Permission.WRITE));
    }
    return false;
  }

  private isGlobalExclusiveReadClient(): boolean {
    const tokenPayload = this.getTokenPayload();
    if (tokenPayload && tokenPayload.c) {
      // if it has a CLIENT permission
      const clientPerm = tokenPayload.c.find((c) => c.scope === null && c.permission === Permission.CLIENT);
      // and *NO* other global permissions
      const nonClientPerm = tokenPayload.c.find((c) => c.scope === null && c.permission !== Permission.CLIENT);

      return !!clientPerm && !nonClientPerm;
    }
    return false;
  }

  private isCurrentScopeAdmin(): boolean {
    const scope = this.areas.groupContext$.value ? this.areas.groupContext$.value : this.areas.repositoryContext$.value;
    if (!scope) {
      throw new Error('No scope currently active');
    }
    return this.isScopedAdmin(scope, this.currentUserInfo);
  }

  public isCurrentScopeWrite(): boolean {
    const scope = this.areas.groupContext$.value ? this.areas.groupContext$.value : this.areas.repositoryContext$.value;
    if (!scope) {
      throw new Error('No scope currently active');
    }
    return this.isScopedWrite(scope, this.currentUserInfo);
  }

  public isCurrentScopeRead(): boolean {
    const scope = this.areas.groupContext$.value ? this.areas.groupContext$.value : this.areas.repositoryContext$.value;
    if (!scope) {
      throw new Error('No scope currently active');
    }
    return this.isScopedRead(scope, this.currentUserInfo);
  }

  public isCurrentScopeExclusiveReadClient(): boolean {
    if (!this.areas.groupContext$.value) {
      throw new Error('No scope currently active');
    }
    return this.isScopedExclusiveReadClient(this.areas.groupContext$.value);
  }

  public isScopedAdmin$(scope: string): Observable<boolean> {
    return this.firstUserInfo$.pipe(map((userInfo) => this.isScopedAdmin(scope, userInfo)));
  }

  public isScopedWrite$(scope: string): Observable<boolean> {
    return this.firstUserInfo$.pipe(map((userInfo) => this.isScopedWrite(scope, userInfo)));
  }

  public isScopedRead$(scope: string): Observable<boolean> {
    return this.firstUserInfo$.pipe(map((userInfo) => this.isScopedRead(scope, userInfo)));
  }

  private isScopedAdmin(scope: string, userInfo: UserInfo): boolean {
    return this.isScoped(scope, userInfo, Permission.ADMIN);
  }

  private isScopedWrite(scope: string, userInfo: UserInfo): boolean {
    return this.isScoped(scope, userInfo, Permission.WRITE);
  }

  private isScopedRead(scope: string, userInfo: UserInfo): boolean {
    return this.isScoped(scope, userInfo, Permission.READ);
  }

  private isScoped(scope: string, userInfo: UserInfo, permission: Permission): boolean {
    if (userInfo && userInfo.mergedPermissions) {
      return !!userInfo.mergedPermissions.find(
        (sc) => (sc.scope === null || sc.scope === scope) && this.ge(sc.permission, permission)
      );
    }
    return false;
  }

  public isScopedExclusiveReadClient(scope: string): boolean {
    if (this.currentUserInfo && this.currentUserInfo.mergedPermissions) {
      // We have either a global or scoped CLIENT permission,
      const clientPerm = this.currentUserInfo.mergedPermissions.find(
        (sc) => (sc.scope === null || sc.scope === scope) && sc.permission === Permission.CLIENT
      );
      // ... and there is *NO* other permission on the user.
      const nonClientPerm = this.currentUserInfo.mergedPermissions.find(
        (sc) => (sc.scope === null || sc.scope === scope) && sc.permission !== Permission.CLIENT
      );
      return !!clientPerm && !nonClientPerm;
    }
    return false;
  }

  private ge(c1: Permission, c2: Permission): boolean {
    switch (c2) {
      case Permission.CLIENT:
        return c1 === Permission.CLIENT || c1 === Permission.READ || c1 === Permission.WRITE || c1 === Permission.ADMIN;
      case Permission.READ:
        return c1 === Permission.READ || c1 === Permission.WRITE || c1 === Permission.ADMIN;
      case Permission.WRITE:
        return c1 === Permission.WRITE || c1 === Permission.ADMIN;
      case Permission.ADMIN:
        return c1 === Permission.ADMIN;
    }
  }

  public getUserInfo(): Observable<UserInfo> {
    this.http
      .get<UserInfo>(this.cfg.config.api + '/auth/user')
      .subscribe((userInfo) => this.userInfoSubject$.next(userInfo));
    return this.userInfoSubject$.asObservable();
  }

  public updateUserInfo(info: UserInfo): Observable<any> {
    this.userInfoSubject$.next(info);
    return this.http.post<UserInfo>(this.cfg.config.api + '/auth/user', info);
  }

  public changePassword(dto: UserChangePasswordDto): Observable<any> {
    return this.http.post(this.cfg.config.api + '/auth/change-password', dto, {
      responseType: 'text',
      headers: suppressGlobalErrorHandling(new HttpHeaders()),
    });
  }

  public getAuthPackForUser(genFull: boolean): Observable<string> {
    return this.http.get(this.cfg.config.api + '/auth/auth-pack', {
      responseType: 'text',
      params: new HttpParams().append('full', genFull ? 'true' : 'false'),
    });
  }
}
