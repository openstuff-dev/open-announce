import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button, EmptyState } from '@openstuff-dev/ui-angular';
import { Session } from '../core/session';

/** `/`: straight to the first tenant's messages, or what to do when there's none. */
@Component({
  selector: 'app-start',
  imports: [RouterLink, Button, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (session.me(); as me) {
      @if (me.isServerAdmin) {
        <os-empty-state title="Make your first tenant" [level]="1">
          A tenant is a company or a division, with its own systems, groups and messages.
          <div os-actions>
            <a os-button variant="primary" routerLink="/tenants">Make a tenant</a>
          </div>
        </os-empty-state>
      } @else {
        <os-empty-state title="You’re not in a tenant yet" [level]="1">
          Ask an admin to add you, then sign in again.
        </os-empty-state>
      }
    }
  `,
})
export class Start {
  protected readonly session = inject(Session);

  constructor() {
    const first = this.session.me()?.tenants[0];
    if (first) void inject(Router).navigate(['/t', first.slug, 'messages'], { replaceUrl: true });
  }
}
