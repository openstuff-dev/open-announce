import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { allowedDisplays, closeableIsChoice, resolveDisplay } from '@openstuff-dev/announce';
import type {
  Display,
  FeedMessage,
  Kind,
  Message,
  MessageInput,
  MessagesPage,
} from '@open-announce/contracts';
import {
  Badge,
  Button,
  Callout,
  Cell,
  Check,
  Checkbox,
  Control,
  DataTable,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Drawer,
  EmptyState,
  Field,
  Icon,
  onReturn,
  PageHeader,
  SegmentedControl,
  Skeleton,
  slowLoading,
  Switch,
  Toaster,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../core/api';
import { IdempotencyKey } from '../core/idempotency';
import { Session } from '../core/session';
import { iconPlus } from '../shared/icons';
import {
  displayHints,
  displayLabels,
  fromLocalInput,
  kindLabels,
  severityLabels,
  shortDate,
  statusLabels,
  toLocalInput,
} from '../shared/labels';
import { Preview } from '../shared/preview';

type Filter = Kind | 'all';

/** A label map as options for a select or segmented control. */
const options = <T extends string>(labels: Record<T, string>) =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

const blank = (kind: Kind = 'announcement'): MessageInput => ({
  kind,
  display: allowedDisplays(kind)[0] ?? 'banner',
  severity: 'info',
  title: '',
  body: '',
  closeable: true,
  linkUrl: null,
  linkLabel: null,
  status: 'draft',
  startsAt: null,
  endsAt: null,
  systemIds: [],
  groupIds: [],
});

@Component({
  selector: 'app-messages',
  imports: [
    FormsModule,
    Badge,
    Button,
    Callout,
    Cell,
    Check,
    Checkbox,
    Control,
    DataTable,
    DialogBody,
    DialogClose,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Drawer,
    EmptyState,
    Field,
    Icon,
    PageHeader,
    Preview,
    SegmentedControl,
    Skeleton,
    Switch,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-page-header
      title="Messages"
      description="News, announcements and maintenance messages, and who sees them where."
    >
      @if (session.isAdmin()) {
        <button type="button" os-button variant="primary" (click)="create()">
          <svg os-icon [icon]="iconPlus" size="sm"></svg>New message
        </button>
      }
    </header>

    <os-segmented-control label="Show" [options]="filters" [(value)]="filter" />

    @if (loadError(); as error) {
      <os-callout tone="danger" title="The messages didn’t load">{{ error }}</os-callout>
    }

    @if (page(); as page) {
      @if (page.messages.length === 0) {
        <os-empty-state title="No messages yet" bordered>
          Write a message, aim it at systems and groups, and publish it.
          @if (session.isAdmin()) {
            <div os-actions>
              <button type="button" os-button variant="primary" (click)="create()">
                New message
              </button>
            </div>
          }
        </os-empty-state>
      } @else {
        <os-data-table
          caption="Messages"
          [columns]="columns"
          [rows]="rows()"
          rowKey="id"
          empty="No messages of this kind."
        >
          <ng-template os-cell="title" let-m>
            <button class="row-open" type="button" (click)="edit(m)">{{ m.title }}</button>
            <span class="os-cell-sub">{{ kindLabel(m.kind) }} · {{ displayLabel(m.display) }}</span>
          </ng-template>
          <ng-template os-cell="status" let-m>
            <span os-badge [tone]="statusTone(m)">{{ statusText(m) }}</span>
          </ng-template>
          <ng-template os-cell="when" let-m>
            <span class="nums">{{ when(m) }}</span>
          </ng-template>
          <ng-template os-cell="audience" let-m>{{ audience(m) }}</ng-template>
        </os-data-table>
      }
    } @else if (loading.slow()) {
      <os-skeleton [lines]="6" />
    }

    <dialog os-drawer [(open)]="editorOpen" size="lg" closedby="closerequest">
      <header os-dialog-header>
        <h2 os-dialog-title>
          {{ editingId() ? (session.isAdmin() ? 'Edit message' : 'Message') : 'New message' }}
        </h2>
      </header>
      <div os-dialog-body>
        <form id="message-form" class="editor" (ngSubmit)="save()">
          <fieldset class="plain" [disabled]="!session.isAdmin()">
            @if (saveError(); as error) {
              <os-callout tone="danger">{{ error }}</os-callout>
            }
            <os-segmented-control
              label="Kind"
              name="kind"
              [options]="kinds"
              [value]="draft().kind"
              (valueChange)="setKind($event)"
            />

            <div class="row">
              <os-field label="Shows as" [hint]="displayHint()">
                <select
                  os-select
                  name="display"
                  [ngModel]="draft().display"
                  (ngModelChange)="patch({ display: $event })"
                >
                  @for (d of displays(); track d) {
                    <option [value]="d">{{ displayLabel(d) }}</option>
                  }
                </select>
              </os-field>
              <os-field label="Severity">
                <select
                  os-select
                  name="severity"
                  [ngModel]="draft().severity"
                  (ngModelChange)="patch({ severity: $event })"
                >
                  @for (s of severities; track s.value) {
                    <option [value]="s.value">{{ s.label }}</option>
                  }
                </select>
              </os-field>
            </div>

            @if (closeableChoice()) {
              <label os-check>
                <input
                  type="checkbox"
                  os-switch
                  name="closeable"
                  [ngModel]="draft().closeable"
                  (ngModelChange)="patch({ closeable: $event })"
                />
                Users can close it
              </label>
            } @else {
              <p class="note">{{ closeableNote() }}</p>
            }

            <os-field label="Title">
              <input
                os-input
                name="title"
                required
                maxlength="200"
                [ngModel]="draft().title"
                (ngModelChange)="patch({ title: $event })"
              />
            </os-field>
            <os-field label="Text" hint="Plain text. Leave a blank line between paragraphs.">
              <textarea
                os-textarea
                name="body"
                rows="4"
                maxlength="10000"
                [ngModel]="draft().body"
                (ngModelChange)="patch({ body: $event })"
              ></textarea>
            </os-field>
            <div class="row">
              <os-field label="Link (optional)" hint="https://…">
                <input
                  os-input
                  type="url"
                  name="linkUrl"
                  [ngModel]="draft().linkUrl"
                  (ngModelChange)="patch({ linkUrl: $event || null })"
                />
              </os-field>
              <os-field label="Link text">
                <input
                  os-input
                  name="linkLabel"
                  maxlength="80"
                  [ngModel]="draft().linkLabel"
                  (ngModelChange)="patch({ linkLabel: $event || null })"
                />
              </os-field>
            </div>

            <div class="row">
              <os-field label="Shows from" hint="Empty: as soon as it’s published.">
                <input
                  os-input
                  type="datetime-local"
                  name="startsAt"
                  [ngModel]="local(draft().startsAt)"
                  (ngModelChange)="patch({ startsAt: fromLocal($event) })"
                />
              </os-field>
              <os-field label="Until" hint="Empty: until it’s archived.">
                <input
                  os-input
                  type="datetime-local"
                  name="endsAt"
                  [ngModel]="local(draft().endsAt)"
                  (ngModelChange)="patch({ endsAt: fromLocal($event) })"
                />
              </os-field>
            </div>

            <fieldset class="targets">
              <legend>Systems <span class="note">· none ticked: every system</span></legend>
              @for (s of page()?.systems ?? []; track s.id) {
                <label os-check>
                  <input
                    type="checkbox"
                    os-checkbox
                    [checked]="draft().systemIds.includes(s.id)"
                    (change)="toggle('systemIds', s.id)"
                  />
                  {{ s.name }}
                </label>
              } @empty {
                <p class="note">No systems yet. It shows in every system you add.</p>
              }
            </fieldset>
            <fieldset class="targets">
              <legend>Groups <span class="note">· none ticked: everyone</span></legend>
              @for (g of page()?.groups ?? []; track g.id) {
                <label os-check>
                  <input
                    type="checkbox"
                    os-checkbox
                    [checked]="draft().groupIds.includes(g.id)"
                    (change)="toggle('groupIds', g.id)"
                  />
                  {{ g.name }}
                </label>
              } @empty {
                <p class="note">No groups yet. Everyone sees it.</p>
              }
            </fieldset>

            <os-field label="Status">
              <select
                os-select
                name="status"
                [ngModel]="draft().status"
                (ngModelChange)="patch({ status: $event })"
              >
                @for (s of statuses; track s.value) {
                  <option [value]="s.value">{{ s.label }}</option>
                }
              </select>
            </os-field>
          </fieldset>

          <section class="preview" aria-label="Preview">
            <h3>Preview</h3>
            <app-preview [message]="preview()" />
          </section>
        </form>
      </div>
      <footer os-dialog-footer>
        @if (editingId() && session.isAdmin()) {
          <button
            os-button
            variant="ghost"
            tone="danger"
            type="button"
            class="delete"
            (click)="remove()"
          >
            Delete
          </button>
        }
        <button os-button os-dialog-close type="button">
          {{ session.isAdmin() ? 'Cancel' : 'Close' }}
        </button>
        @if (session.isAdmin()) {
          <button
            os-button
            variant="primary"
            type="submit"
            form="message-form"
            [loading]="saving()"
          >
            {{ draft().status === 'published' ? 'Save and publish' : 'Save' }}
          </button>
        }
      </footer>
    </dialog>
  `,
  styles: `
    .row-open {
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      font-weight: var(--os-font-weight-medium);
      text-align: start;
      text-wrap: balance;
      cursor: pointer;
    }

    .row-open:hover {
      text-decoration: underline;
    }

    .row-open::after {
      /* The whole first cell opens the message. */
      position: absolute;
      inset: 0;
      content: '';
    }

    :host ::ng-deep td:first-child {
      position: relative;
    }

    .nums {
      font-variant-numeric: tabular-nums;
    }

    .editor,
    .plain {
      display: grid;
      gap: var(--os-space-4);
    }

    .plain {
      min-inline-size: 0;
      margin: 0;
      padding: 0;
      border: 0;
    }

    .row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: var(--os-space-4);
    }

    .targets {
      display: flex;
      flex-wrap: wrap;
      gap: var(--os-space-2) var(--os-space-4);
      margin: 0;
      padding: 0;
      border: 0;
    }

    .targets legend {
      margin-block-end: var(--os-space-2);
      padding: 0;
      font-weight: var(--os-font-weight-medium);
    }

    .note {
      margin: 0;
      color: var(--os-fg-muted);
      font-size: var(--os-text-sm);
      font-weight: normal;
    }

    .preview h3 {
      margin: 0 0 var(--os-space-2);
      font-size: var(--os-text-sm);
    }

    .delete {
      margin-inline-end: auto;
    }
  `,
})
export class Messages {
  readonly tenant = input.required<string>();
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toaster = inject(Toaster);
  protected readonly iconPlus = iconPlus;

  protected readonly page = signal<MessagesPage | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected readonly filter = signal<Filter>('all');
  protected readonly filters = [
    { value: 'all' as Filter, label: 'All' },
    { value: 'announcement' as Filter, label: 'Announcements' },
    { value: 'maintenance' as Filter, label: 'Maintenance' },
    { value: 'news' as Filter, label: 'News' },
  ];

  protected readonly kinds = options(kindLabels);
  protected readonly severities = options(severityLabels);
  protected readonly statuses = options(statusLabels);
  protected readonly columns = [
    { key: 'title' as const, label: 'Message' },
    { key: 'status' as const, label: 'Status' },
    { key: 'when' as const, label: 'When' },
    { key: 'audience' as const, label: 'Who and where' },
  ];

  protected readonly rows = computed(() => {
    const filter = this.filter();
    const messages = this.page()?.messages ?? [];
    return (filter === 'all' ? messages : messages.filter((m) => m.kind === filter)).map((m) => ({
      ...m,
      when: '',
      audience: '',
    }));
  });

  protected readonly editorOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly draft = signal<MessageInput>(blank());
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  private readonly key = new IdempotencyKey();
  private editedAt = new Date().toISOString();

  protected readonly displays = computed(() => allowedDisplays(this.draft().kind));
  protected readonly displayHint = computed(() => displayHints[this.draft().display]);
  protected readonly closeableChoice = computed(() =>
    closeableIsChoice(this.draft().kind, this.draft().display),
  );

  protected readonly closeableNote = computed(() => {
    const d = this.draft();
    if (d.kind === 'news') return 'Users open and close the news sidebar themselves.';
    const check = resolveDisplay(d.kind, d.display);
    return check.ok && check.closeable
      ? 'Users can close it. It shows again only if you edit it.'
      : 'Users can’t close it. It shows until it ends or you archive it.';
  });

  /** What the preview shows: the draft as the feed would send it. */
  protected readonly preview = computed<FeedMessage>(() => {
    const d = this.draft();
    const check = resolveDisplay(d.kind, d.display, d.closeable);
    return {
      id: this.editingId() ?? 'preview',
      kind: d.kind,
      display: d.display,
      severity: d.severity,
      title: d.title || 'Your title',
      body: d.body,
      closeable: check.ok ? check.closeable : true,
      link: d.linkUrl ? { url: d.linkUrl, label: d.linkLabel ?? '' } : null,
      startsAt: d.startsAt ?? null,
      endsAt: d.endsAt ?? null,
      updatedAt: this.editedAt,
    };
  });

  constructor() {
    effect(() => {
      void this.load(this.tenant());
    });
    inject(DestroyRef).onDestroy(onReturn(() => void this.load(this.tenant())));
  }

  protected kindLabel = (k: Kind) => kindLabels[k];
  protected displayLabel = (d: Display) => displayLabels[d];
  protected local = toLocalInput;
  protected fromLocal = fromLocalInput;

  protected statusText(m: Message): string {
    if (m.status !== 'published') return statusLabels[m.status];
    const now = Date.now();
    if (m.startsAt && Date.parse(m.startsAt) > now) return 'Scheduled';
    if (m.endsAt && Date.parse(m.endsAt) <= now) return 'Ended';
    return 'Live';
  }

  protected statusTone(m: Message): 'success' | 'info' | 'neutral' | 'warning' {
    const text = this.statusText(m);
    return text === 'Live' ? 'success' : text === 'Scheduled' ? 'info' : text === 'Draft' ? 'warning' : 'neutral';
  }

  protected when(m: Message): string {
    if (m.startsAt && m.endsAt) return `${shortDate(m.startsAt)} – ${shortDate(m.endsAt)}`;
    if (m.startsAt) return `From ${shortDate(m.startsAt)}`;
    if (m.endsAt) return `Until ${shortDate(m.endsAt)}`;
    return `Edited ${shortDate(m.updatedAt)}`;
  }

  protected audience(m: Message): string {
    const page = this.page();
    const names = (ids: string[], list: { id: string; name: string }[] | undefined) =>
      ids.map((id) => list?.find((x) => x.id === id)?.name).filter(Boolean).join(', ');
    const groups = m.groupIds.length ? names(m.groupIds, page?.groups) : 'Everyone';
    const systems = m.systemIds.length ? names(m.systemIds, page?.systems) : 'every system';
    return `${groups} in ${systems}`;
  }

  protected create(): void {
    this.editingId.set(null);
    this.draft.set(blank());
    this.editedAt = new Date().toISOString();
    this.saveError.set(null);
    this.editorOpen.set(true);
  }

  protected edit(m: Message): void {
    this.editingId.set(m.id);
    this.draft.set({
      kind: m.kind,
      display: m.display,
      severity: m.severity,
      title: m.title,
      body: m.body,
      closeable: m.closeable,
      linkUrl: m.linkUrl,
      linkLabel: m.linkLabel,
      status: m.status,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      systemIds: m.systemIds,
      groupIds: m.groupIds,
    });
    this.editedAt = m.updatedAt;
    this.saveError.set(null);
    this.editorOpen.set(true);
  }

  protected patch(change: Partial<MessageInput>): void {
    this.draft.update((d) => ({ ...d, ...change }));
  }

  protected setKind(kind: Kind | undefined): void {
    if (!kind) return;
    const displays = allowedDisplays(kind);
    this.draft.update((d) => ({
      ...d,
      kind,
      display: displays.includes(d.display) ? d.display : (displays[0] ?? d.display),
    }));
  }

  protected toggle(field: 'systemIds' | 'groupIds', id: string): void {
    this.draft.update((d) => ({
      ...d,
      [field]: d[field].includes(id) ? d[field].filter((x) => x !== id) : [...d[field], id],
    }));
  }

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.saveError.set(null);
    const id = this.editingId();
    const base = `/api/t/${encodeURIComponent(this.tenant())}/messages`;
    try {
      const saved = id
        ? await this.api.put<Message>(`${base}/${id}`, this.draft())
        : await this.api.post<Message>(base, this.draft(), this.key.value);
      if (!id) this.key.renew();
      this.page.update((p) =>
        p && { ...p, messages: [saved, ...p.messages.filter((m) => m.id !== saved.id)] },
      );
      this.editorOpen.set(false);
      this.toaster.show(saved.status === 'published' ? 'Saved and published.' : 'Saved.', { tone: 'success' });
    } catch (error) {
      this.saveError.set(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }

  /** Deletes after the undo toast has gone; until then Undo puts it back. */
  protected remove(): void {
    const id = this.editingId();
    const page = this.page();
    const message = page?.messages.find((m) => m.id === id);
    if (!id || !page || !message) return;
    this.editorOpen.set(false);
    this.page.set({ ...page, messages: page.messages.filter((m) => m.id !== id) });
    const path = `/api/t/${encodeURIComponent(this.tenant())}/messages/${id}`;
    const timer = setTimeout(() => {
      this.api.delete(path).catch((error: unknown) => {
        this.restore(message);
        this.toaster.show(`It wasn’t deleted: ${errorText(error)}`, { tone: 'danger' });
      });
    }, 8000);
    this.toaster.show(`Deleted “${message.title}”.`, {
      duration: 8000,
      action: {
        label: 'Undo',
        run: () => {
          clearTimeout(timer);
          this.restore(message);
        },
      },
    });
  }

  private restore(message: Message): void {
    this.page.update((p) => p && { ...p, messages: [message, ...p.messages] });
  }

  private async load(tenant: string): Promise<void> {
    this.loadError.set(null);
    try {
      const page = await this.loading.track(
        this.api.get<MessagesPage>(`/api/t/${encodeURIComponent(tenant)}/messages`, {
          onFresh: (fresh) => {
            if (tenant === this.tenant()) this.page.set(fresh);
          },
        }),
      );
      if (tenant === this.tenant()) this.page.set(page);
    } catch (error) {
      this.loadError.set(errorText(error));
    }
  }
}
