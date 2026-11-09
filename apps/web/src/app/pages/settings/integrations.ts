import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { System } from '@open-announce/contracts';
import {
  Button,
  Callout,
  EmptyState,
  SectionHeader,
  SettingCard,
  SettingCardBody,
  Skeleton,
  slowLoading,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../../core/api';
import { ServerConnections } from './server-connections';

/**
 * Integrations: this server's connection to OpenVersion (server admins), and where other systems
 * post to this tenant (admins). OpenAnnounce never connects to itself.
 */
@Component({
  selector: 'app-integrations',
  imports: [
    RouterLink,
    Button,
    Callout,
    EmptyState,
    SectionHeader,
    SettingCard,
    SettingCardBody,
    ServerConnections,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-section-header
      title="Integrations"
      description="Connect OpenAnnounce to the rest of OpenStuff. Each one is optional, and nothing changes until you connect it."
    ></header>

    @if (tenant() && admin()) {
      <section
        os-setting-card
        title="Other systems post here"
        description="A system with a publish key can post News here, such as OpenVersion’s release notes."
      >
        <div os-setting-card-body>
          @if (error(); as error) {
            <os-callout tone="danger" title="The systems didn’t load">{{ error }}</os-callout>
          } @else if (systems()) {
            @if (posting().length === 0) {
              <os-empty-state title="No system can post here yet">
                <p>
                  Make a publish key for a system on the Systems page, and give it to the backend
                  that posts.
                </p>
                <div><a os-button [routerLink]="systemsLink()">Open Systems</a></div>
              </os-empty-state>
            } @else {
              <p class="posting">
                {{ posting().length === 1 ? 'This system has' : 'These systems have' }} a publish
                key: {{ postingNames() }}.
              </p>
              <div><a os-button [routerLink]="systemsLink()">Open Systems</a></div>
            }
          } @else if (loading.slow()) {
            <os-skeleton [lines]="2" />
          }
        </div>
      </section>
    }

    @if (serverAdmin()) {
      <app-server-connections />
    }
  `,
  styles: `
    .posting {
      margin: 0;
    }
  `,
})
export class Integrations {
  /** The tenant in the address. Empty outside one. */
  readonly tenant = input('');
  readonly admin = input(false);
  readonly serverAdmin = input(false);

  private readonly api = inject(Api);
  protected readonly systems = signal<System[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected readonly posting = computed(() =>
    (this.systems() ?? []).filter((system) => system.publishKeyHint),
  );

  protected readonly postingNames = computed(() => this.posting().map((s) => s.name).join(', '));
  protected readonly systemsLink = computed(() => ['/t', this.tenant(), 'systems']);

  constructor() {
    effect(() => {
      const tenant = this.tenant();
      if (tenant && this.admin()) void this.load(tenant);
    });
  }

  private async load(tenant: string): Promise<void> {
    this.error.set(null);
    try {
      const systems = await this.loading.track(
        this.api.get<System[]>(`/api/t/${encodeURIComponent(tenant)}/systems`),
      );
      if (tenant === this.tenant()) this.systems.set(systems);
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
