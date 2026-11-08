import { inject } from '@angular/core';
import { type CanActivateFn, Router, type Routes } from '@angular/router';
import { Session } from './core/session';
import { Shell } from './shell';
import { SignIn } from './pages/sign-in';
import { Start } from './pages/start';

const signedIn: CanActivateFn = async (_route, state) => {
  const session = inject(Session);
  const me = session.me() ?? (await session.load());
  return me ? true : inject(Router).createUrlTree(['/sign-in'], { queryParams: { next: state.url } });
};

export const routes: Routes = [
  { path: 'sign-in', component: SignIn, title: 'Sign in · OpenAnnounce' },
  {
    path: '',
    component: Shell,
    canActivate: [signedIn],
    children: [
      { path: '', component: Start, title: 'OpenAnnounce' },
      // Old address: Tenants moved into Settings.
      { path: 'tenants', redirectTo: 'settings/tenants', pathMatch: 'full' },
      { path: 'settings', redirectTo: 'settings/account', pathMatch: 'full' },
      {
        path: 'settings/:tab',
        loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage),
        title: 'Settings · OpenAnnounce',
      },
      {
        path: 't/:tenant',
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'messages' },
          {
            path: 'messages',
            loadComponent: () => import('./pages/messages').then((m) => m.Messages),
            title: 'Messages · OpenAnnounce',
          },
          {
            path: 'systems',
            loadComponent: () => import('./pages/systems').then((m) => m.Systems),
            title: 'Systems · OpenAnnounce',
          },
          {
            path: 'audience',
            loadComponent: () => import('./pages/audience').then((m) => m.Audience),
            title: 'Groups and users · OpenAnnounce',
          },
          // Old addresses: these moved into Settings.
          { path: 'members', redirectTo: 'settings/members', pathMatch: 'full' },
          { path: 'data', redirectTo: 'settings/data', pathMatch: 'full' },
          { path: 'settings', redirectTo: 'settings/account', pathMatch: 'full' },
          {
            path: 'settings/:tab',
            loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage),
            title: 'Settings · OpenAnnounce',
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
