import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Tenant } from '@open-announce/contracts';
import {
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
        [rows]="tenants"
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
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  protected readonly tenants = signal<Tenant[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = slowLoading();
  protected readonly columns = [
    { key: 'name' as const, label: 'Tenant' },
    { key: 'createdAt' as const, label: 'Added' },
  ];

  protected readonly date = shortDate;
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
