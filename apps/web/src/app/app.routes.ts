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

const serverAdmin: CanActivateFn = () =>
  inject(Session).me()?.isServerAdmin ? true : inject(Router).createUrlTree(['/']);

export const routes: Routes = [
  { path: 'sign-in', component: SignIn, title: 'Sign in · OpenAnnounce' },
  {
    path: '',
    component: Shell,
    canActivate: [signedIn],
    children: [
      { path: '', component: Start, title: 'OpenAnnounce' },
      {
        path: 'tenants',
        canActivate: [serverAdmin],
        loadComponent: () => import('./pages/tenants').then((m) => m.Tenants),
        title: 'Tenants · OpenAnnounce',
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
          {
            path: 'members',
            loadComponent: () => import('./pages/members').then((m) => m.Members),
            title: 'Members · OpenAnnounce',
          },
          {
            path: 'data',
            loadComponent: () => import('./pages/data').then((m) => m.Data),
            title: 'Export and import · OpenAnnounce',
          },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
