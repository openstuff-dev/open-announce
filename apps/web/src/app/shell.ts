import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { Role } from '@open-announce/contracts';
import {
  Icon,
  IconButton,
  IdentityBadge,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  NavLink as OsNavLink,
  Page,
  PopoverTrigger,
  ShellFooter,
  ShellSwitcher,
  ShellSwitcherButton,
  ShellUser,
  initials,
} from '@openstuff-dev/ui-angular';
import { Session } from './core/session';
import {
  iconAudience,
  iconCheck,
  iconMenu,
  iconMessages,
  iconSettings,
  iconSignOut,
  iconSystems,
  iconTenants,
} from './shared/icons';
import { roleLabels } from './shared/labels';

export { initials };

type IconNode = typeof iconMessages;
interface NavItem {
  path: string;
  label: string;
  icon: IconNode;
  roles: readonly Role[];
}

/** The pages in the sidebar, and who sees each. */
const LINKS: NavItem[] = [
  { path: 'messages', label: 'Messages', icon: iconMessages, roles: ['admin', 'developer'] },
  { path: 'systems', label: 'Systems', icon: iconSystems, roles: ['admin', 'developer'] },
  { path: 'audience', label: 'Groups and users', icon: iconAudience, roles: ['admin'] },
];

/**
 * The frame around every signed-in page, laid out like OpenPurpose's: the brand row, the tenant
 * switch, the pages, and at the bottom Settings and who is signed in, with sign-out.
 */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    Icon,
    IconButton,
    IdentityBadge,
    Menu,
    MenuItem,
    MenuLabel,
    MenuSeparator,
    OsNavLink,
    Page,
    PopoverTrigger,
    ShellFooter,
    ShellSwitcher,
    ShellSwitcherButton,
    ShellUser,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="os-shell" [attr.data-open]="menuOpen() ? '' : null">
      <nav class="os-shell-sidebar" id="sidebar" aria-label="Main">
        <a class="os-shell-brand brand" routerLink="/">
          <!-- The OpenStuff ring with OpenAnnounce's bars, as on announce.openstuff.dev. -->
          <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
            <path
              class="ring"
              fill-rule="evenodd"
              d="M16 1.5a14.5 14.5 0 1 0 0 29a14.5 14.5 0 1 0 0-29Zm0 4a10.5 10.5 0 1 1 0 21a10.5 10.5 0 1 1 0-21Z"
            />
            <path
              class="glyph"
              d="M10.6 11h10.8v2.6H10.6ZM10.6 14.7h10.8v2.6H10.6ZM10.6 18.4h7v2.6h-7Z"
            />
          </svg>
          OpenAnnounce
        </a>

        @if (me(); as me) {
          @if (me.tenants.length || me.isServerAdmin) {
            <div os-shell-switcher>
              <button type="button" os-shell-switcher-button [os-popover-trigger]="wsMenu">
                @if (session.membership(); as current) {
                  <span os-identity-badge aria-hidden="true">{{ initials(current.name) }}</span>
                  <span class="os-shell-switcher-text">
                    <strong>{{ current.name }}</strong>
                    <small>{{ roleLabels[current.role] }}</small>
                  </span>
                } @else {
                  <span os-identity-badge neutral aria-hidden="true">?</span>
                  <span class="os-shell-switcher-text">
                    <strong>Choose a tenant</strong>
                    <small>{{ me.tenants.length }} available</small>
                  </span>
                }
              </button>
              <div
                os-menu
                #wsMenu="osPopover"
                class="os-shell-switcher-menu"
                aria-label="Switch tenant"
              >
                @if (me.tenants.length) {
                  <div os-menu-label>Tenants</div>
                  @for (t of me.tenants; track t.slug) {
                    <button
                      type="button"
                      os-menu-item
                      role="menuitemradio"
                      [attr.aria-checked]="t.slug === tenant()"
                      (click)="pick(t.slug)"
                    >
                      <span os-identity-badge size="sm" aria-hidden="true">{{
                        initials(t.name)
                      }}</span>
                      {{ t.name }}
                      @if (t.slug === tenant()) {
                        <svg os-icon [icon]="icons.check" size="sm"></svg>
                      }
                    </button>
                  }
                }
                @if (me.isServerAdmin) {
                  <hr os-menu-separator />
                  <a os-menu-item routerLink="/settings/tenants">
                    <svg os-icon [icon]="icons.tenants" size="sm"></svg>Manage tenants
                  </a>
                }
              </div>
            </div>
          }
        }

        @if (tenant(); as t) {
          @for (link of links(); track link.path) {
            <a
              os-nav-link
              [routerLink]="['/t', t, link.path]"
              routerLinkActive
              ariaCurrentWhenActive="page"
              [icon]="link.icon"
              >{{ link.label }}</a
            >
          }
        }

        <div os-shell-footer>
          <a
            os-nav-link
            [routerLink]="settingsLink()"
            routerLinkActive
            ariaCurrentWhenActive="page"
            [icon]="icons.settings"
            >Settings</a
          >
          @if (me(); as me) {
            <div os-shell-user [name]="me.name || me.email" [role]="roleLine()">
              <button
                os-icon-button
                variant="ghost"
                type="button"
                label="Sign out"
                title="Sign out"
                (click)="signOut()"
              >
                <svg os-icon [icon]="icons.signOut" size="sm"></svg>
              </button>
            </div>
          }
        </div>
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
          @if (session.membership(); as current) {
            <span class="where">{{ current.name }}</span>
          }
        </header>
        <main os-page>
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: `
    .brand .ring {
      fill: var(--os-fg-default);
    }

    .brand .glyph {
      fill: var(--os-brand-default);
    }

    .where {
      color: var(--os-fg-muted);
      font-size: var(--os-text-sm);
    }
  `,
})
export class Shell {
  protected readonly session = inject(Session);
  private readonly router = inject(Router);
  protected readonly me = this.session.me;
  protected readonly tenant = this.session.tenant;
  protected readonly menuOpen = signal(false);
  protected readonly roleLabels = roleLabels;
  protected readonly initials = initials;
  protected readonly icons = {
    check: iconCheck,
    menu: iconMenu,
    settings: iconSettings,
    signOut: iconSignOut,
    tenants: iconTenants,
  };

  /** Settings of the tenant in view, or the server's when none is. */
  protected readonly settingsLink = computed(() => {
    const t = this.tenant();
    return t ? ['/t', t, 'settings'] : ['/settings'];
  });

  protected readonly links = computed(() => {
    const role = this.session.role();
    return role ? LINKS.filter((l) => l.roles.includes(role)) : [];
  });

  /** "Server admin", or the role in this tenant. */
  protected readonly roleLine = computed(() => {
    if (this.me()?.isServerAdmin) return 'Server admin';
    const role = this.session.role();
    return role ? roleLabels[role] : '';
  });

  constructor() {
    const sync = () => {
      const match = /^\/t\/([^/?#]+)/.exec(this.router.url);
      // Pages outside a tenant (Settings, Tenants) keep the last one in the switch.
      if (match?.[1]) this.session.tenant.set(decodeURIComponent(match[1]));
      else if (!this.session.tenant()) {
        this.session.tenant.set(this.me()?.tenants.at(0)?.slug ?? null);
      }
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

  protected pick(slug: string): void {
    const current = /^\/t\/[^/]+\/([^/?#]+)/.exec(this.router.url)?.[1];
    const role = this.me()?.tenants.find((t) => t.slug === slug)?.role;
    const allowed = role && LINKS.some((l) => l.path === current && l.roles.includes(role));
    void this.router.navigate(['/t', slug, allowed && current ? current : 'messages']);
  }

  protected async signOut(): Promise<void> {
    await this.session.signOut();
    await this.router.navigate(['/sign-in']);
  }
}
