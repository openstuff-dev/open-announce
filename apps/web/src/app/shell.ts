import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  Button,
  Callout,
  Control,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Icon,
  IconButton,
  Page,
  Toaster,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from './core/api';
import { Session } from './core/session';
import {
  iconAudience,
  iconData,
  iconMembers,
  iconMenu,
  iconMessages,
  iconSignOut,
  iconSystems,
  iconTenants,
} from './shared/icons';

/** The frame around every signed-in page: the sidebar, the tenant switch and the topbar. */
@Component({
  selector: 'app-shell',
  imports: [
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    Button,
    Callout,
    Control,
    Dialog,
    DialogBody,
    DialogClose,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    Icon,
    IconButton,
    Page,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="os-shell" [attr.data-open]="menuOpen() ? '' : null">
      <nav class="os-shell-sidebar" id="sidebar" aria-label="Main">
        <a class="os-shell-brand" routerLink="/">
          <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1Z" />
            <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" fill="none" />
          </svg>
          OpenAnnounce
        </a>

        @if (me(); as me) {
          @if (me.tenants.length > 1 || me.isServerAdmin) {
            <label class="tenant-switch">
              <span class="os-visually-hidden">Tenant</span>
              <select class="os-select" [value]="tenant() ?? ''" (change)="switchTenant($event)">
                @if (!tenant()) {
                  <option value="" disabled>Choose a tenant</option>
                }
                @for (t of me.tenants; track t.slug) {
                  <option [value]="t.slug">{{ t.name }}</option>
                }
              </select>
            </label>
          } @else if (me.tenants[0]; as only) {
            <p class="tenant-name">{{ only.name }}</p>
          }
        }

        @if (tenant(); as t) {
          <a
            class="nav-link"
            [routerLink]="['/t', t, 'messages']"
            routerLinkActive="active"
            ariaCurrentWhenActive="page"
          >
            <svg os-icon [icon]="icons.messages"></svg>Messages
          </a>
          <a
            class="nav-link"
            [routerLink]="['/t', t, 'systems']"
            routerLinkActive="active"
            ariaCurrentWhenActive="page"
          >
            <svg os-icon [icon]="icons.systems"></svg>Systems
          </a>
          @if (session.isAdmin()) {
            <a
              class="nav-link"
              [routerLink]="['/t', t, 'audience']"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
            >
              <svg os-icon [icon]="icons.audience"></svg>Groups and users
            </a>
            <a
              class="nav-link"
              [routerLink]="['/t', t, 'members']"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
            >
              <svg os-icon [icon]="icons.members"></svg>Members
            </a>
            <a
              class="nav-link"
              [routerLink]="['/t', t, 'data']"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
            >
              <svg os-icon [icon]="icons.data"></svg>Export and import
            </a>
          }
        }
        @if (me()?.isServerAdmin) {
          <a
            class="nav-link nav-end"
            routerLink="/tenants"
            routerLinkActive="active"
            ariaCurrentWhenActive="page"
          >
            <svg os-icon [icon]="icons.tenants"></svg>Tenants
          </a>
        }
      </nav>

      <div class="os-shell-content">
        <header class="os-shell-topbar">
          <button
            type="button"
            os-icon-button
            class="os-shell-menu"
            variant="ghost"
            label="Menu"
            aria-controls="sidebar"
            [attr.aria-expanded]="menuOpen()"
            (click)="menuOpen.set(!menuOpen())"
          >
            <svg os-icon [icon]="icons.menu"></svg>
          </button>
          @if (session.role(); as role) {
            <span class="role"
              >You’re {{ role === 'admin' ? 'an admin' : 'a developer' }} here</span
            >
          }
          <button
            os-button
            type="button"
            variant="ghost"
            size="sm"
            class="account"
            [attr.aria-label]="'Change the password of ' + (me()?.name || me()?.email)"
            (click)="openPassword()"
          >
            {{ me()?.name || me()?.email }}
          </button>
          <button type="button" os-button variant="ghost" size="sm" (click)="signOut()">
            <svg os-icon [icon]="icons.signOut" size="sm"></svg>Sign out
          </button>
        </header>
        <main os-page>
          <router-outlet />
        </main>
      </div>
    </div>

    <dialog os-dialog size="sm" [(open)]="passwordOpen">
      <header os-dialog-header><h2 os-dialog-title>Change your password</h2></header>
      <form id="password-form" os-dialog-body class="stack" (ngSubmit)="changePassword()">
        @if (passwordError(); as error) {
          <os-callout tone="danger">{{ error }}</os-callout>
        }
        <os-field label="Current password">
          <input
            os-input
            type="password"
            name="current"
            autocomplete="current-password"
            required
            [(ngModel)]="current"
          />
        </os-field>
        <os-field
          label="New password"
          hint="At least 10 characters. Your other sessions are signed out."
        >
          <input
            os-input
            type="password"
            name="next"
            autocomplete="new-password"
            required
            minlength="10"
            [(ngModel)]="next"
          />
        </os-field>
      </form>
      <footer os-dialog-footer>
        <button os-button os-dialog-close type="button">Cancel</button>
        <button
          os-button
          variant="primary"
          type="submit"
          form="password-form"
          [loading]="savingPassword()"
        >
          Change password
        </button>
      </footer>
    </dialog>
  `,
  styles: `
    .brand-mark {
      inline-size: 1.4rem;
      block-size: 1.4rem;
      fill: var(--os-brand-default);
      stroke: var(--os-brand-default);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .tenant-switch {
      display: block;
      margin-block-end: var(--os-space-3);
    }

    .tenant-switch select {
      inline-size: 100%;
    }

    .tenant-name {
      margin: 0 0 var(--os-space-3);
      padding-inline: var(--os-space-3);
      color: var(--os-fg-muted);
      font-size: var(--os-text-sm);
    }

    .nav-end {
      margin-block-start: auto;
    }

    .role {
      color: var(--os-fg-muted);
      font-size: var(--os-text-sm);
    }

    .account {
      max-inline-size: 16rem;
      margin-inline-start: auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @container os-shell (inline-size < 40rem) {
      .role {
        display: none;
      }
    }
  `,
})
export class Shell {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);
  protected readonly me = this.session.me;
  protected readonly tenant = this.session.tenant;
  protected readonly menuOpen = signal(false);
  protected readonly icons = {
    messages: iconMessages,
    systems: iconSystems,
    audience: iconAudience,
    members: iconMembers,
    data: iconData,
    tenants: iconTenants,
    menu: iconMenu,
    signOut: iconSignOut,
  };

  protected readonly hasTenant = computed(() => this.tenant() !== null);

  constructor() {
    const sync = () => {
      const match = /^\/t\/([^/?#]+)/.exec(this.router.url);
      this.session.tenant.set(match?.[1] ? decodeURIComponent(match[1]) : null);
    };
    sync();
    const sub = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        sync();
        this.menuOpen.set(false);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
    });
  }

  protected switchTenant(event: Event): void {
    const slug = (event.target as HTMLSelectElement).value;
    const page = /^\/t\/[^/]+\/([^/?#]+)/.exec(this.router.url)?.[1] ?? 'messages';
    void this.router.navigate(['/t', slug, page]);
  }

  private readonly api = inject(Api);
  private readonly toaster = inject(Toaster);
  protected readonly passwordOpen = signal(false);
  protected readonly savingPassword = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected current = '';
  protected next = '';

  protected openPassword(): void {
    this.current = '';
    this.next = '';
    this.passwordError.set(null);
    this.passwordOpen.set(true);
  }

  protected async changePassword(): Promise<void> {
    this.savingPassword.set(true);
    this.passwordError.set(null);
    try {
      await this.api.put('/api/me/password', { current: this.current, next: this.next });
      this.passwordOpen.set(false);
      this.toaster.show('Changed your password.', { tone: 'success' });
    } catch (error) {
      this.passwordError.set(errorText(error));
    } finally {
      this.savingPassword.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    await this.session.signOut();
    await this.router.navigate(['/sign-in']);
  }
}
