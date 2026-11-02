import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Button, Callout, PageHeader } from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../core/api';

interface ImportResult {
  systems: number;
  groups: number;
  users: number;
  messages: number;
}

/** Everything in this tenant as one JSON file, and back again. */
@Component({
  selector: 'app-data',
  imports: [Button, Callout, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-page-header
      title="Export and import"
      description="Your data is yours: take it to another OpenAnnounce server, or keep a copy."
    ></header>

    <section class="stack">
      <h2>Export</h2>
      <p>
        One JSON file with this tenant’s systems, groups, users and messages. Secrets aren’t in it:
        an import makes new keys.
      </p>
      <div><a os-button variant="primary" [href]="exportUrl()" download>Download export</a></div>
    </section>

    <section class="stack">
      <h2>Import</h2>
      <p>
        Adds what’s in an export file to this tenant. Systems, groups and users with the same slug
        or id are updated; messages are always added.
      </p>
      <label class="file">
        <span class="os-visually-hidden">Export file</span>
        <input
          type="file"
          accept="application/json,.json"
          (change)="pick($event)"
          [disabled]="busy()"
        />
      </label>
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
  styles: `
    h2 {
      margin: 0;
      font-size: var(--os-text-lg);
    }

    p {
      max-inline-size: 60ch;
      margin: 0;
      text-wrap: pretty;
    }
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
