import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Button, Callout, FileInput, SectionHeader, SettingCard } from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../../core/api';

interface ImportResult {
  systems: number;
  groups: number;
  users: number;
  messages: number;
}

/** Everything in this tenant as one JSON file, and back again. */
@Component({
  selector: 'app-data',
  imports: [Button, Callout, FileInput, SectionHeader, SettingCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-section-header
      title="Export and import"
      description="Your data is yours: take it to another OpenAnnounce server, or keep a copy."
    ></header>

    <section
      os-setting-card
      title="Export"
      description="One JSON file with this tenant’s systems, groups, users and messages. Secrets aren’t in it: an import makes new keys."
    >
      <div><a os-button variant="primary" [href]="exportUrl()" download>Download export</a></div>
    </section>

    <section
      os-setting-card
      title="Import"
      description="Adds what’s in an export file to this tenant. Systems, groups and users with the same slug or id are updated; messages are always added."
    >
      <input
        type="file"
        os-file-input
        accept="application/json,.json"
        aria-label="Export file"
        (change)="pick($event)"
        [disabled]="busy()"
      />
      @if (result(); as r) {
        <os-callout tone="success" title="Imported">
          {{ r.systems }} systems, {{ r.groups }} groups, {{ r.users }} users and
          {{ r.messages }} messages. New systems have new keys: copy them from Systems.
        </os-callout>
      }
      @if (error(); as error) {
        <os-callout tone="danger" title="Nothing was imported">{{ error }}</os-callout>
      }
    </section>
  `,
})
export class Data {
  readonly tenant = input.required<string>();
  private readonly api = inject(Api);
  protected readonly busy = signal(false);
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly error = signal<string | null>(null);

  protected exportUrl(): string {
    return `/api/t/${encodeURIComponent(this.tenant())}/export`;
  }

  protected async pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.busy.set(true);
    this.result.set(null);
    this.error.set(null);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('That file isn’t JSON. Choose a file you exported from OpenAnnounce.');
      }
      this.result.set(await this.api.post<ImportResult>(`/api/t/${encodeURIComponent(this.tenant())}/import`, data));
    } catch (error) {
      this.error.set(errorText(error));
    } finally {
      this.busy.set(false);
      input.value = '';
    }
  }
}
