import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { Tenant } from '@open-announce/contracts';
import {
  Button,
  Callout,
  Cell,
  ConfirmDialog,
  Control,
  DataTable,
  Field,
  SectionHeader,
  SettingCard,
  SettingCardFooter,
  Skeleton,
  Toaster,
} from '@openstuff-dev/ui-angular';
import { Api, errorText } from '../../core/api';
import { IdempotencyKey } from '../../core/idempotency';
import { slowLoading } from '../../core/loading';
import { Session } from '../../core/session';
import { shortDate } from '../../shared/labels';

/** For server admins: every tenant on this server. */
@Component({
  selector: 'app-tenants',
  imports: [
    FormsModule,
    RouterLink,
    Button,
    Callout,
    Cell,
    Control,
    DataTable,
    Field,
    SectionHeader,
    SettingCard,
    SettingCardFooter,
    Skeleton,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-section-header
      title="Tenants"
      description="Each tenant is a company or division with its own systems, groups, messages and members."
    ></header>

    <form
      os-setting-card
      title="Add a tenant"
      description="Make a tenant for a company or division."
      (ngSubmit)="create()"
    >
      <os-field label="Tenant name" [error]="createError()">
        <input
          os-input
          name="name"
          required
          maxlength="120"
          placeholder="Acme Corp"
          [(ngModel)]="name"
        />
      </os-field>
      <div os-setting-card-footer>
        <button os-button variant="primary" type="submit" [loading]="creating()">Add tenant</button>
      </div>
    </form>

    @if (error(); as error) {
      <os-callout tone="danger" title="The tenants didn’t load">{{ error }}</os-callout>
    }
    @if (tenants(); as tenants) {
      <os-data-table
        caption="Tenants"
        [columns]="columns"
        [rows]="rows(tenants)"
        rowKey="id"
        empty="No tenants yet."
      >
        <ng-template os-cell="name" let-t>
          <a [routerLink]="['/t', t.slug, 'messages']">{{ t.name }}</a>
          <span class="os-cell-sub">{{ t.slug }}</span>
        </ng-template>
        <ng-template os-cell="createdAt" let-t>
          <span class="nums">{{ date(t.createdAt) }}</span>
        </ng-template>
        <ng-template os-cell="actions" let-t>
          <button
            type="button"
            os-button
            size="sm"
            variant="ghost"
            tone="danger"
            [attr.aria-label]="'Delete ' + t.name"
            (click)="remove(t)"
          >
            Delete
          </button>
        </ng-template>
      </os-data-table>
    } @else if (loading.slow()) {
      <os-skeleton [lines]="4" />
    }
  `,
  styles: `
    .nums {
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class Tenants {
  /** The tenant in the address, if any: deleting it leaves the page for Settings outside one. */
  readonly tenant = input('');
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmDialog);
  private readonly toaster = inject(Toaster);
  private readonly session = inject(Session);
  protected readonly tenants = signal<Tenant[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected readonly columns = [
    { key: 'name' as const, label: 'Tenant' },
    { key: 'createdAt' as const, label: 'Added' },
    { key: 'actions' as const, label: 'Actions', align: 'end' as const },
  ];

  protected readonly date = shortDate;
  protected readonly rows = (tenants: Tenant[]) => tenants.map((t) => ({ ...t, actions: '' }));
  protected name = '';
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  private readonly key = new IdempotencyKey();

  constructor() {
    void this.load();
  }

  protected async create(): Promise<void> {
    this.creating.set(true);
    this.createError.set(null);
    try {
      const tenant = await this.api.post<Tenant>('/api/tenants', { name: this.name }, this.key.value);
      this.key.renew();
      this.name = '';
      this.tenants.update((t) => t && [...t, tenant].sort((a, b) => a.name.localeCompare(b.name)));
      await this.session.load();
    } catch (error) {
      this.createError.set(errorText(error));
    } finally {
      this.creating.set(false);
    }
  }

  protected async remove(tenant: Tenant): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete ${tenant.name}?`,
      message:
        'Its systems, messages, groups and users are deleted, and apps using its keys stop showing messages at once. ' +
        'This can’t be undone. Member accounts stay, with their other tenants.',
      confirmLabel: 'Delete tenant',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`/api/t/${encodeURIComponent(tenant.slug)}`);
      this.tenants.update((list) => list?.filter((t) => t.id !== tenant.id) ?? null);
      this.toaster.show(`Deleted ${tenant.name}.`, { tone: 'success' });
      await this.session.load();
      if (tenant.slug === this.tenant()) await this.router.navigate(['/settings', 'tenants']);
    } catch (error) {
      this.toaster.show(errorText(error), { tone: 'danger' });
    }
  }

  private async load(): Promise<void> {
    try {
      this.tenants.set(
        await this.loading.track(
          this.api.get<Tenant[]>('/api/tenants', {
            onFresh: (t) => {
              this.tenants.set(t);
            },
          }),
        ),
      );
    } catch (error) {
      this.error.set(errorText(error));
    }
  }
}
