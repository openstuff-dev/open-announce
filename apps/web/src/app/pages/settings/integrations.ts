import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Button, SectionHeader, SettingCard } from '@openstuff-dev/ui-angular';
import { ServerConnections } from './server-connections';

/**
 * Integrations: this server's connection to OpenVersion (server admins), and where other systems
 * post to this tenant (admins). OpenAnnounce never connects to itself.
 */
@Component({
  selector: 'app-integrations',
  imports: [RouterLink, Button, SectionHeader, SettingCard, ServerConnections],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-section-header
      title="Integrations"
      description="How OpenAnnounce works with other systems: the ones that post here, and the OpenStuff apps it connects to."
    ></header>

    @if (tenant() && admin()) {
      <section
        os-setting-card
        title="Other systems post here"
        description="Each system on the Systems page has a publish key, so its backend can post messages here, and a public key, so its app can show them."
      >
        <div class="systems-link">
          <a os-button [routerLink]="['/t', tenant(), 'systems']">Open Systems</a>
        </div>
      </section>
    }

    @if (serverAdmin()) {
      <app-server-connections />
    }
  `,
  styles: `
    .systems-link {
      padding: var(--os-space-4) var(--os-space-5);
    }
  `,
})
export class Integrations {
  /** The tenant in the address. Empty outside one. */
  readonly tenant = input('');
  readonly admin = input(false);
  readonly serverAdmin = input(false);
}
