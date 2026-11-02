import { AnnounceElement, define, el } from '../core/element.js';
import type { FeedMessage } from '../core/types.js';

export { configure, defineConfig } from '../core/config.js';
export { AnnounceElement };

/**
 * `<oa-maintenance>`: maintenance banners where you put it, which nobody can close, and a
 * maintenance popover in the corner of the screen. The admin decides per popover message
 * whether it can be closed; the popover never closes on an outside click or Escape.
 */
export class OaMaintenance extends AnnounceElement {
  protected readonly kind = 'maintenance' as const;
  private readonly banners = el('div', { class: 'banners', part: 'banners' });
  private readonly panel = el('div', { class: 'popover surface', part: 'popover', popover: 'manual' });

  constructor() {
    super();
    this.panel.setAttribute('role', 'region');
    this.panel.setAttribute('aria-label', this.getAttribute('popover-label') ?? 'Maintenance');
    this.root.append(this.banners, this.panel);
  }

  protected render(messages: FeedMessage[]): void {
    this.banners.replaceChildren(
      ...messages
        .filter((m) => m.display === 'banner')
        .map((message) => {
          const role = message.severity === 'critical' ? 'alert' : 'status';
          const banner = el('div', { class: 'banner', part: 'banner', role });
          banner.dataset.severity = message.severity;
          banner.append(this.content(message));
          this.markShown(message);
          return banner;
        }),
    );

    const items = messages
      .filter((m) => m.display === 'popover' && !(m.closeable && this.isDismissed(m)))
      .map((message) => {
        const role = message.severity === 'critical' ? 'alert' : 'status';
        const item = el('div', { class: 'item', part: 'item', role });
        item.dataset.severity = message.severity;
        item.append(this.content(message));
        if (message.closeable) item.append(this.closeButton(() => {
          this.dismiss(message);
        }));
        this.markShown(message);
        return item;
      });
    this.panel.replaceChildren(...items);
    const open = this.panel.matches(':popover-open');
    if (items.length > 0 && !open) this.panel.showPopover();
    if (items.length === 0 && open) this.panel.hidePopover();
  }
}

define('oa-maintenance', OaMaintenance);

declare global {
  interface HTMLElementTagNameMap {
    'oa-maintenance': OaMaintenance;
  }
}
