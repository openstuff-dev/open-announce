import { Injectable } from '@angular/core';
import { startServerIntegrations } from '@openstuff-dev/ui';
import { APP_VERSION } from '../build-version';

/**
 * Starts OpenVersion in the browser when a server admin connected it on Settings › Integrations.
 * Its package loads only then. Nothing waits for this, and a failure leaves the app as it is:
 * signing in never depends on it. OpenAnnounce never connects to itself.
 */
@Injectable({ providedIn: 'root' })
export class ServerIntegrations {
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    void startServerIntegrations({
      version: APP_VERSION,
      load: {
        openversion: async (connection) => {
          const [{ configure }] = await Promise.all([
            import('@openstuff-dev/version'),
            import('@openstuff-dev/version/update'),
          ]);
          configure(connection);
          document.body.prepend(document.createElement('ov-update'));
        },
      },
    });
  }
}
