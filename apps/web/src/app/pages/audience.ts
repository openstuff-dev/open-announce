import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { EndUser, Group } from '@open-announce/contracts';
import {
  Button,
  Callout,
  Cell,
  Check,
  Checkbox,
  Chip,
  Control,
  DataTable,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  PageHeader,
  Skeleton,
  Toaster,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../core/api';
import { IdempotencyKey } from '../core/idempotency';
import { onReturn, slowLoading } from '../core/loading';

interface AudienceData {
  groups: Group[];
  users: EndUser[];
}

/**
 * Groups decide who sees a message. A host system can send a user's groups in the signed
 * token; or it sends only the user's id, and the groups come from the users listed here.
 */
@Component({
  selector: 'app-audience',
  imports: [
    FormsModule,
    Button,
    Callout,
    Cell,
    Check,
    Checkbox,
    Chip,
    Control,
    DataTable,
    Dialog,
    DialogBody,
    DialogClose,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Field,
    PageHeader,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-page-header
      title="Groups and users"
      description="Aim messages at groups. Put users in groups here, or let your backend send their groups when it signs them."
    ></header>

    @if (error(); as error) {
      <os-callout tone="danger" title="This page didn’t load">{{ error }}</os-callout>
    }

    @if (data(); as data) {
      <section class="stack" aria-labelledby="groups-title">
        <h2 id="groups-title">Groups</h2>
        <form class="inline" (ngSubmit)="addGroup()">
          <os-field label="New group" [error]="groupError()">
            <input
              os-input
              name="group"
              maxlength="120"
              placeholder="Finance"
              [(ngModel)]="groupNameInput"
            />
          </os-field>
          <button os-button type="submit" [loading]="addingGroup()">Add group</button>
        </form>
        <os-data-table
          caption="Groups"
          [columns]="groupColumns"
          [rows]="groupRows()"
          rowKey="id"
          empty="No groups yet."
        >
          <ng-template os-cell="name" let-g>
            {{ g.name }}
            <span class="os-cell-sub"
              >Slug for tokens: <code>{{ g.slug }}</code></span
            >
          </ng-template>
          <ng-template os-cell="userCount" let-g
            ><span class="nums">{{ g.userCount }}</span></ng-template
          >
          <ng-template os-cell="actions" let-g>
            <button
              type="button"
              os-button
              variant="ghost"
              tone="danger"
              size="sm"
              (click)="removeGroup(g)"
            >
              Delete
            </button>
          </ng-template>
        </os-data-table>
      </section>

      <section class="stack" aria-labelledby="users-title">
        <div class="title-row">
          <h2 id="users-title">Users</h2>
          <button type="button" os-button (click)="editUser(null)">Add user</button>
        </div>
        <p class="note">
          Only needed when your backend signs users without their groups. The id is the one your
          system uses (the token’s <code>sub</code>).
        </p>
        <os-data-table
          caption="Users"
          [columns]="userColumns"
          [rows]="data.users"
          rowKey="id"
          empty="No users yet."
        >
          <ng-template os-cell="externalId" let-u>
            <button class="row-open" type="button" (click)="editUser(u)">{{ u.externalId }}</button>
            @if (u.name) {
              <span class="os-cell-sub">{{ u.name }}</span>
            }
          </ng-template>
          <ng-template os-cell="groupIds" let-u>
            <span class="chips">
              @for (id of u.groupIds; track id) {
                <span os-chip>{{ groupName(id) }}</span>
              } @empty {
                <span class="note">No groups</span>
              }
            </span>
          </ng-template>
        </os-data-table>
      </section>
    } @else if (loading.slow()) {
      <os-skeleton [lines]="8" />
    }

    <dialog os-dialog [(open)]="userOpen">
      <header os-dialog-header>
        <h2 os-dialog-title>{{ userId() ? 'Edit user' : 'Add user' }}</h2>
      </header>
      <form id="user-form" os-dialog-body class="stack" (ngSubmit)="saveUser()">
        @if (userError(); as error) {
          <os-callout tone="danger">{{ error }}</os-callout>
        }
        <os-field
          label="Id in your system"
          hint="The sub your backend signs, like a user id or email."
        >
          <input
            os-input
            name="externalId"
            required
            maxlength="200"
            [(ngModel)]="user.externalId"
          />
        </os-field>
        <os-field label="Name (optional)">
          <input os-input name="name" maxlength="120" [(ngModel)]="user.name" />
        </os-field>
        <fieldset class="groups">
          <legend>Groups</legend>
          @for (g of data()?.groups ?? []; track g.id) {
            <label os-check>
              <input
                type="checkbox"
                os-checkbox
                [checked]="user.groupIds.includes(g.id)"
                (change)="toggleGroup(g.id)"
              />
              {{ g.name }}
            </label>
          } @empty {
            <p class="note">Add a group first.</p>
          }
        </fieldset>
      </form>
      <footer os-dialog-footer>
        @if (userId()) {
          <button
            os-button
            variant="ghost"
            tone="danger"
            type="button"
            class="push"
            (click)="removeUser()"
          >
            Delete
          </button>
        }
        <button os-button os-dialog-close type="button">Cancel</button>
        <button os-button variant="primary" type="submit" form="user-form" [loading]="savingUser()">
          Save
        </button>
      </footer>
    </dialog>
  `,
  styles: `
    h2 {
      margin: 0;
      font-size: var(--os-text-lg);
      text-wrap: balance;
    }

    .inline {
      display: flex;
      flex-wrap: wrap;
      gap: var(--os-space-3);
      align-items: end;
    }

    .title-row {
      display: flex;
      gap: var(--os-space-3);
      align-items: center;
      justify-content: space-between;
    }

    .note {
      margin: 0;
      color: var(--os-fg-muted);
      font-size: var(--os-text-sm);
      text-wrap: pretty;
    }

    .nums {
      font-variant-numeric: tabular-nums;
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--os-space-1);
    }

    .row-open {
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      font-weight: var(--os-font-weight-medium);
      cursor: pointer;
    }

    .row-open:hover {
      text-decoration: underline;
    }

    .groups {
      display: flex;
      flex-wrap: wrap;
      gap: var(--os-space-2) var(--os-space-4);
      margin: 0;
      padding: 0;
      border: 0;
    }

    .push {
      margin-inline-end: auto;
    }
  `,
})
export class Audience {
  readonly tenant = input.required<string>();
  private readonly api = inject(Api);
  private readonly toaster = inject(Toaster);
  protected readonly data = signal<AudienceData | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected readonly groupColumns = [
    { key: 'name' as const, label: 'Group' },
    { key: 'userCount' as const, label: 'Users listed here', align: 'end' as const },
    { key: 'actions' as const, label: 'Actions', align: 'end' as const },
  ];

  protected readonly userColumns = [
    { key: 'externalId' as const, label: 'User' },
    { key: 'groupIds' as const, label: 'Groups' },
  ];

  /** DataTable shows row properties; the actions column needs one too. */
  protected readonly groupRows = computed(() => (this.data()?.groups ?? []).map((g) => ({ ...g, actions: '' })));

  protected groupName = (id: string) => this.data()?.groups.find((g) => g.id === id)?.name ?? '?';
  protected groupNameInput = '';
  protected readonly groupError = signal<string | null>(null);
  protected readonly addingGroup = signal(false);
  private readonly groupKey = new IdempotencyKey();

  protected readonly userOpen = signal(false);
  protected readonly userId = signal<string | null>(null);
  protected user = { externalId: '', name: '', groupIds: [] as string[] };
  protected readonly userError = signal<string | null>(null);
  protected readonly savingUser = signal(false);
  private readonly userKey = new IdempotencyKey();

  constructor() {
    effect(() => {
      void this.load(this.tenant());
    });
    inject(DestroyRef).onDestroy(onReturn(() => void this.load(this.tenant())));
  }

  private get base(): string {
    return `/api/t/${encodeURIComponent(this.tenant())}`;
  }

  protected async addGroup(): Promise<void> {
    const name = this.groupNameInput.trim();
    if (!name) {
      this.groupError.set('Give the group a name.');
      return;
    }
    this.addingGroup.set(true);
    this.groupError.set(null);
    try {
      const group = await this.api.post<Group>(`${this.base}/groups`, { name }, this.groupKey.value);
      this.groupKey.renew();
      this.groupNameInput = '';
      this.data.update((d) => d && { ...d, groups: byName([...d.groups, group]) });
    } catch (error) {
      this.groupError.set(errorText(error));
    } finally {
      this.addingGroup.set(false);
    }
  }

  /** Gone at once, deleted after the undo toast. */
  protected removeGroup(group: Group): void {
    this.data.update((d) => d && { ...d, groups: d.groups.filter((g) => g.id !== group.id) });
    const timer = setTimeout(() => {
      this.api.delete(`${this.base}/groups/${group.id}`).catch((error: unknown) => {
        this.data.update((d) => d && { ...d, groups: [...d.groups, group] });
        this.toaster.show(`It wasn’t deleted: ${errorText(error)}`, { tone: 'danger' });
      });
    }, 8000);
    this.toaster.show(`Deleted the group ${group.name}.`, {
      duration: 8000,
      action: {
        label: 'Undo',
        run: () => {
          clearTimeout(timer);
          this.data.update((d) => d && { ...d, groups: byName([...d.groups, group]) });
        },
      },
    });
  }

  protected editUser(user: EndUser | null): void {
    this.userId.set(user?.id ?? null);
    this.user = { externalId: user?.externalId ?? '', name: user?.name ?? '', groupIds: [...(user?.groupIds ?? [])] };
    this.userError.set(null);
    this.userOpen.set(true);
  }

  protected toggleGroup(id: string): void {
    const ids = this.user.groupIds;
    this.user.groupIds = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  }

  protected async saveUser(): Promise<void> {
    this.savingUser.set(true);
    this.userError.set(null);
    const id = this.userId();
    try {
      const saved = id
        ? await this.api.patch<EndUser>(`${this.base}/users/${id}`, this.user)
        : await this.api.post<EndUser>(`${this.base}/users`, this.user, this.userKey.value);
      if (!id) this.userKey.renew();
      const others = (d: AudienceData) => d.users.filter((u) => u.id !== saved.id);
      this.data.update((d) => d && { ...d, users: [...others(d), saved] });
      this.userOpen.set(false);
    } catch (error) {
      this.userError.set(errorText(error));
    } finally {
      this.savingUser.set(false);
    }
  }

  protected removeUser(): void {
    const id = this.userId();
    const user = this.data()?.users.find((u) => u.id === id);
    if (!user) return;
    this.userOpen.set(false);
    this.data.update((d) => d && { ...d, users: d.users.filter((u) => u.id !== user.id) });
    const timer = setTimeout(() => {
      this.api.delete(`${this.base}/users/${user.id}`).catch((error: unknown) => {
        this.data.update((d) => d && { ...d, users: [...d.users, user] });
        this.toaster.show(`It wasn’t deleted: ${errorText(error)}`, { tone: 'danger' });
      });
    }, 8000);
    this.toaster.show(`Deleted the user ${user.externalId}.`, {
      duration: 8000,
      action: {
        label: 'Undo',
        run: () => {
          clearTimeout(timer);
          this.data.update((d) => d && { ...d, users: [...d.users, user] });
        },
      },
    });
  }

  private async load(tenant: string): Promise<void> {
    this.error.set(null);
    try {
      const data = await this.loading.track(
        this.api.get<AudienceData>(`/api/t/${encodeURIComponent(tenant)}/groups`, {
          onFresh: (fresh) => {
            if (tenant === this.tenant()) this.data.set(fresh);
          },
        }),
      );
      if (tenant === this.tenant()) this.data.set(data);
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}

const byName = (groups: Group[]) => groups.sort((a, b) => a.name.localeCompare(b.name));
