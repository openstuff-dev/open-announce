import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  type Connection,
  connectionFor,
  type System,
  type SystemWithPublishKey,
  type SystemWithSecret,
} from '@open-announce/contracts';
import {
  Button,
  Callout,
  CodeBlock,
  ConfirmDialog,
  Control,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Icon,
  onReturn,
  PageHeader,
  SecretDialog,
  Skeleton,
  slowLoading,
  Tab,
  Tabs,
  Toaster,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../core/api';
import { IdempotencyKey } from '../core/idempotency';
import { Session } from '../core/session';
import { CopyButton } from '../shared/copy-button';
import { iconPlus } from '../shared/icons';

/**
 * The systems messages show in. Admins add them; developers (and admins) set their origins,
 * replace their keys, and copy the setup code.
 */
@Component({
  selector: 'app-systems',
  imports: [
    FormsModule,
    Button,
    Callout,
    CodeBlock,
    Control,
    CopyButton,
    Dialog,
    DialogBody,
    DialogClose,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    EmptyState,
    Field,
    Icon,
    PageHeader,
    Skeleton,
    Tab,
    Tabs,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-page-header
      title="Systems"
      description="The apps your messages show in. Each has a public key for the browser and a secret for your backend."
    >
      @if (session.isAdmin()) {
        <button type="button" os-button variant="primary" (click)="openCreate()">
          <svg os-icon [icon]="iconPlus" size="sm"></svg>New system
        </button>
      }
    </header>

    @if (error(); as error) {
      <os-callout tone="danger" title="The systems didn’t load">{{ error }}</os-callout>
    }

    @if (systems(); as systems) {
      @for (s of systems; track s.id) {
        <section class="system" [attr.aria-labelledby]="'sys-' + s.id">
          <header class="head">
            <h2 [id]="'sys-' + s.id">{{ s.name }}</h2>
            <span class="slug">{{ s.slug }}</span>
          </header>

          <dl class="keys">
            <div>
              <dt>Public key</dt>
              <dd>
                <code>{{ s.publicKey }}</code
                ><app-copy-button [text]="s.publicKey" what="public key" />
                <button type="button" os-button size="sm" (click)="showConnection(s)">
                  Get a connection string
                </button>
              </dd>
            </div>
            <div>
              <dt>Secret</dt>
              <dd>
                <code>{{ s.secretHint }}</code>
                <button type="button" os-button size="sm" (click)="rotate(s)">
                  Replace secret
                </button>
              </dd>
            </div>
            <div>
              <dt>Publish key</dt>
              <dd>
                @if (s.publishKeyHint) {
                  <code>{{ s.publishKeyHint }}</code>
                } @else {
                  <span class="muted">None. Other systems can’t post here.</span>
                }
                @if (session.isAdmin()) {
                  <button type="button" os-button size="sm" (click)="makePublishKey(s)">
                    {{ s.publishKeyHint ? 'Replace publish key' : 'Make publish key' }}
                  </button>
                  @if (s.publishKeyHint) {
                    <button
                      type="button"
                      os-button
                      size="sm"
                      variant="ghost"
                      tone="danger"
                      (click)="revokePublishKey(s)"
                    >
                      Revoke
                    </button>
                  }
                }
              </dd>
            </div>
          </dl>

          <form class="origins" (ngSubmit)="saveOrigins(s)">
            <os-field
              label="Allowed origins"
              hint="One per line, like https://app.example.com. Empty: any website may read this system’s feed."
              [error]="originErrors()[s.id]"
            >
              <textarea
                os-textarea
                rows="2"
                [name]="'origins-' + s.id"
                [(ngModel)]="originText[s.id]"
              ></textarea>
            </os-field>
            <button os-button size="sm" type="submit" [loading]="savingOrigins() === s.id">
              Save origins
            </button>
          </form>

          <os-tabs label="Set up {{ s.name }}">
            <ng-template os-tab="install" label="Install">
              <pre><code>{{ snippets(s).install }}</code></pre>
              <app-copy-button [text]="snippets(s).install" what="install command" />
            </ng-template>
            <ng-template os-tab="config" label="openannounce.config.js">
              <pre><code>{{ snippets(s).config }}</code></pre>
              <app-copy-button [text]="snippets(s).config" what="config" />
            </ng-template>
            <ng-template os-tab="page" label="Page">
              <pre><code>{{ snippets(s).page }}</code></pre>
              <app-copy-button [text]="snippets(s).page" what="page code" />
            </ng-template>
            <ng-template os-tab="backend" label="Backend">
              <pre><code>{{ snippets(s).backend }}</code></pre>
              <app-copy-button [text]="snippets(s).backend" what="backend code" />
            </ng-template>
            <ng-template os-tab="publish" label="Publish API">
              <p class="tab-note">
                Another system (OpenVersion, a CI job) posts News here with the publish key. Send an
                Idempotency-Key, such as the id of what you announce, so a retry never posts twice.
              </p>
              <pre><code>{{ snippets(s).publish }}</code></pre>
              <app-copy-button [text]="snippets(s).publish" what="publish example" />
            </ng-template>
          </os-tabs>

          @if (session.isAdmin()) {
            <div class="danger">
              <button
                type="button"
                os-button
                variant="ghost"
                tone="danger"
                size="sm"
                (click)="remove(s)"
              >
                Delete {{ s.name }}
              </button>
            </div>
          }
        </section>
      } @empty {
        <os-empty-state title="No systems yet" bordered>
          Add the first app your messages should show in.
          @if (session.isAdmin()) {
            <div os-actions>
              <button type="button" os-button variant="primary" (click)="openCreate()">
                New system
              </button>
            </div>
          }
        </os-empty-state>
      }
    } @else if (loading.slow()) {
      <os-skeleton [lines]="8" />
    }

    <dialog os-dialog [(open)]="connectionOpen">
      @if (connection(); as c) {
        <header os-dialog-header>
          <h2 os-dialog-title>Connection string for {{ c.name }}</h2>
        </header>
        <div os-dialog-body class="stack">
          <p>{{ c.instructions }}</p>
          <os-code-block wrap [code]="c.value" what="connection string" />
          <p class="os-hint">
            The secret is only shown when it’s made. To get a string that holds it, replace the
            secret: backends using the old secret stop working until they get the new one, and their
            users see only messages for everyone meanwhile.
          </p>
        </div>
        <footer os-dialog-footer>
          <button os-button os-dialog-close variant="primary" type="button">Done</button>
        </footer>
      }
    </dialog>

    <dialog os-dialog [(open)]="createOpen">
      <header os-dialog-header><h2 os-dialog-title>New system</h2></header>
      <form id="new-system" os-dialog-body class="stack" (ngSubmit)="create()">
        @if (createError(); as error) {
          <os-callout tone="danger">{{ error }}</os-callout>
        }
        <os-field label="Name" hint="Like Customer portal or Intranet.">
          <input os-input name="name" required maxlength="120" [(ngModel)]="newName" />
        </os-field>
      </form>
      <footer os-dialog-footer>
        <button os-button os-dialog-close type="button">Cancel</button>
        <button os-button variant="primary" type="submit" form="new-system" [loading]="creating()">
          Add system
        </button>
      </footer>
    </dialog>
  `,
  styles: `
    .tab-note {
      max-inline-size: 65ch;
      margin: 0 0 var(--os-space-3);
    }

    .muted {
      color: var(--os-fg-muted);
    }

    .system {
      display: grid;
      gap: var(--os-space-4);
      padding: var(--os-space-5);
      border: 1px var(--os-border-style) var(--os-border-default);
      border-radius: var(--os-radius-lg);
      background: var(--os-bg-default);
    }

    .head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--os-space-2);
      align-items: baseline;
    }

    h2 {
      margin: 0;
      font-size: var(--os-text-lg);
      text-wrap: balance;
    }

    .slug {
      color: var(--os-fg-muted);
      font-family: var(--os-font-mono);
      font-size: var(--os-text-sm);
    }

    .keys {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
      gap: var(--os-space-3);
      margin: 0;
    }

    dt {
      color: var(--os-fg-muted);
      font-size: var(--os-text-sm);
    }

    dd {
      display: flex;
      flex-wrap: wrap;
      gap: var(--os-space-2);
      align-items: center;
      margin: 0;
    }

    code {
      overflow-wrap: anywhere;
    }

    .origins {
      display: grid;
      gap: var(--os-space-2);
      justify-items: start;
    }

    .origins os-field {
      inline-size: 100%;
    }

    pre {
      overflow-x: auto;
      margin: 0 0 var(--os-space-2);
      padding: var(--os-space-3);
      border-radius: var(--os-radius-md);
      background: var(--os-bg-alternative);
      font-size: var(--os-text-sm);
    }

    .danger {
      display: flex;
      justify-content: end;
    }
  `,
})
export class Systems {
  readonly tenant = input.required<string>();
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toaster = inject(Toaster);
  private readonly confirm = inject(ConfirmDialog);
  private readonly secrets = inject(SecretDialog);
  protected readonly iconPlus = iconPlus;
  protected readonly systems = signal<System[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected originText: Record<string, string> = {};
  protected readonly originErrors = signal<Record<string, string | null>>({});
  protected readonly savingOrigins = signal<string | null>(null);

  protected readonly createOpen = signal(false);
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  protected newName = '';
  private readonly key = new IdempotencyKey();

  private readonly origin = computed(() => location.origin);

  protected readonly connectionOpen = signal(false);
  protected readonly connection = signal<(Connection & { name: string }) | null>(null);

  constructor() {
    effect(() => {
      void this.load(this.tenant());
    });
    inject(DestroyRef).onDestroy(onReturn(() => void this.load(this.tenant())));
  }

  protected snippets(s: System): Record<'install' | 'config' | 'page' | 'backend' | 'publish', string> {
    return {
      publish: `curl -X POST ${this.origin()}/api/v1/messages \\
  -H "Authorization: Bearer $OPENANNOUNCE_PUBLISH_KEY" \\
  -H "Idempotency-Key: release-1.5.0" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "${s.name} 1.5.0", "body": "- Gift wrapping at checkout", "groups": []}'`,
      install: 'npm install @openstuff-dev/announce',
      config: `// openannounce.config.js
import { defineConfig } from '@openstuff-dev/announce';

export default defineConfig({
  url: '${this.origin()}',
  publicKey: '${s.publicKey}',
  // A token your backend makes for the signed-in user (see Backend).
  user: () => fetch('/api/openannounce-token').then((r) => r.text()),
});`,
      page: `<!-- Where the banners go, usually first in <body> -->
<oa-maintenance></oa-maintenance>
<oa-announcements></oa-announcements>
<!-- The news sidebar, opened by any button with class "news-button" -->
<oa-news trigger=".news-button"></oa-news>

<script type="module">
  import { configure } from '@openstuff-dev/announce';
  import '@openstuff-dev/announce/announcements';
  import '@openstuff-dev/announce/maintenance';
  import '@openstuff-dev/announce/news';
  import config from './openannounce.config.js';
  configure(config);
</script>`,
      backend: `// Node, Deno, Bun or an edge function
import { signUser } from '@openstuff-dev/announce/server';

// GET /api/openannounce-token, for the signed-in user
const token = await signUser(process.env.OPENANNOUNCE_SECRET, {
  sub: user.id,           // their id in your system
  groups: ['finance'],    // group slugs; leave out to use the groups set in OpenAnnounce
});`,
    };
  }

  /** A connection string without the secret, which was only shown when it was made. */
  protected showConnection(s: System): void {
    this.connection.set({ name: s.name, ...connectionFor(s, this.origin()) });
    this.connectionOpen.set(true);
  }

  protected openCreate(): void {
    this.newName = '';
    this.createError.set(null);
    this.createOpen.set(true);
  }

  protected async create(): Promise<void> {
    this.creating.set(true);
    this.createError.set(null);
    try {
      const created = await this.api.post<SystemWithSecret>(
        `/api/t/${encodeURIComponent(this.tenant())}/systems`,
        { name: this.newName },
        this.key.value,
      );
      this.key.renew();
      this.createOpen.set(false);
      this.adopt([...(this.systems() ?? []), created]);
      await this.secrets.show({
        title: `Secret of ${created.name}`,
        secret: created.signingSecret,
        what: 'secret',
        instructions: 'Put it in your backend’s settings, for example as OPENANNOUNCE_SECRET. Never put it in browser code.',
        connection: connectionFor(created, this.origin(), { signingSecret: created.signingSecret }),
      });
    } catch (error) {
      this.createError.set(errorText(error));
    } finally {
      this.creating.set(false);
    }
  }

  protected async rotate(s: System): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Replace the secret of ${s.name}?`,
      message: 'The current secret stops working at once. Users signed with it see only messages for everyone until your backend uses the new one.',
      confirmLabel: 'Replace secret',
      danger: true,
    });
    if (!ok) return;
    try {
      const rotated = await this.api.post<SystemWithSecret>(
        `/api/t/${encodeURIComponent(this.tenant())}/systems/${s.id}/rotate`,
        {},
      );
      this.adopt((this.systems() ?? []).map((x) => (x.id === s.id ? rotated : x)));
      await this.secrets.show({
        title: `New secret for ${rotated.name}`,
        secret: rotated.signingSecret,
        what: 'secret',
        instructions: 'Backends using the old secret stop working until they get this one. Put it in your backend’s settings, for example as OPENANNOUNCE_SECRET. Never put it in browser code.',
        connection: connectionFor(rotated, this.origin(), { signingSecret: rotated.signingSecret }),
      });
    } catch (error) {
      this.toaster.show(errorText(error), { tone: 'danger' });
    }
  }

  protected async makePublishKey(s: System): Promise<void> {
    if (s.publishKeyHint) {
      const ok = await this.confirm.confirm({
        title: `Replace the publish key of ${s.name}?`,
        message: 'The current key stops working at once. Systems that post with it fail until they have the new one.',
        confirmLabel: 'Replace publish key',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const made = await this.api.post<SystemWithPublishKey>(
        `/api/t/${encodeURIComponent(this.tenant())}/systems/${s.id}/publish-key`,
        {},
      );
      const { publishKey: _key, ...system } = made;
      this.adopt((this.systems() ?? []).map((x) => (x.id === s.id ? system : x)));
      await this.secrets.show({
        title: `Publish key for ${made.name}`,
        secret: made.publishKey,
        what: 'publish key',
        instructions: 'Paste it into the system that posts here, for example OpenVersion’s OpenAnnounce integration.',
        connection: connectionFor(made, this.origin(), { publishKey: made.publishKey }),
      });
    } catch (error) {
      this.toaster.show(errorText(error), { tone: 'danger' });
    }
  }

  protected async revokePublishKey(s: System): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Revoke the publish key of ${s.name}?`,
      message: 'Systems that post with it get an error from now on. Messages they already posted stay.',
      confirmLabel: 'Revoke publish key',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(
        `/api/t/${encodeURIComponent(this.tenant())}/systems/${s.id}/publish-key`,
      );
      this.adopt(
        (this.systems() ?? []).map((x) => (x.id === s.id ? { ...x, publishKeyHint: null } : x)),
      );
      this.toaster.show('Revoked the publish key.', { tone: 'success' });
    } catch (error) {
      this.toaster.show(errorText(error), { tone: 'danger' });
    }
  }

  protected async saveOrigins(s: System): Promise<void> {
    this.savingOrigins.set(s.id);
    this.originErrors.update((e) => ({ ...e, [s.id]: null }));
    const allowedOrigins = (this.originText[s.id] ?? '')
      .split(/[\s,]+/)
      .map((o) => o.trim())
      .filter(Boolean);
    try {
      const saved = await this.api.patch<System>(
        `/api/t/${encodeURIComponent(this.tenant())}/systems/${s.id}`,
        { allowedOrigins },
      );
      this.adopt((this.systems() ?? []).map((x) => (x.id === s.id ? saved : x)));
      this.toaster.show('Saved the origins.', { tone: 'success' });
    } catch (error) {
      this.originErrors.update((e) => ({ ...e, [s.id]: errorText(error) }));
    } finally {
      this.savingOrigins.set(null);
    }
  }

  protected async remove(s: System): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete ${s.name}?`,
      message: 'Its keys stop working at once, and messages aimed only at it show nowhere. You can’t undo this.',
      confirmLabel: `Delete ${s.name}`,
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`/api/t/${encodeURIComponent(this.tenant())}/systems/${s.id}`);
      this.adopt((this.systems() ?? []).filter((x) => x.id !== s.id));
    } catch (error) {
      this.toaster.show(errorText(error), { tone: 'danger' });
    }
  }

  private adopt(systems: System[]): void {
    this.systems.set(systems);
    for (const s of systems) this.originText[s.id] = s.allowedOrigins.join('\n');
  }

  private async load(tenant: string): Promise<void> {
    this.error.set(null);
    try {
      const systems = await this.loading.track(
        this.api.get<System[]>(`/api/t/${encodeURIComponent(tenant)}/systems`, {
          onFresh: (fresh) => {
            if (tenant === this.tenant()) this.adopt(fresh);
          },
        }),
      );
      if (tenant === this.tenant()) this.adopt(systems);
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
