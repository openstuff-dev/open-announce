import { AnnounceElement, define, el } from '../core/element.js';
import type { FeedMessage } from '../core/types.js';

export { configure, defineConfig } from '../core/config.js';
export { AnnounceElement };

/**
 * `<oa-announcements>`: announcement banners where you put it, and announcement popups
 * (one at a time) over the page. Both can be closed, and stay closed until the message changes.
 */
export class OaAnnouncements extends AnnounceElement {
  protected readonly kind = 'announcement' as const;
  private readonly banners = el('div', { class: 'banners', part: 'banners' });
  private readonly dialog = el('dialog', { class: 'popup surface', part: 'popup' });
  private popupId: string | undefined;

  constructor() {
    super();
    this.root.append(this.banners, this.dialog);
    this.dialog.setAttribute('aria-labelledby', 'oa-popup-title');
    // Escape closes the dialog without our buttons; count that as closing the message too.
    this.dialog.addEventListener('close', () => {
      this.closePopup();
    });
  }

  private popupMessage: FeedMessage | undefined;

  /** Remembers the popup as closed at once, then closes the dialog. */
  private closePopup(): void {
    const message = this.popupMessage;
    this.popupMessage = undefined;
    this.popupId = undefined;
    if (message) this.dismiss(message);
    if (this.dialog.open) this.dialog.close();
  }

  protected render(messages: FeedMessage[]): void {
    const visible = messages.filter((m) => !this.isDismissed(m));

    this.banners.replaceChildren(
      ...visible
        .filter((m) => m.display === 'banner')
        .map((message) => {
          const banner = el('div', { class: 'banner', part: 'banner', role: 'status' });
          banner.dataset.severity = message.severity;
          banner.append(this.content(message), this.closeButton(() => {
            this.dismiss(message);
          }));
          this.markShown(message);
          return banner;
        }),
    );

    const popup = visible.find((m) => m.display === 'popup');
    const key = popup && `${popup.id}@${popup.updatedAt}`;
    if (key === this.popupId) return;
    if (!popup) {
      // The message ended or was withdrawn while open: close without counting it as read.
      this.popupMessage = undefined;
      this.popupId = undefined;
      if (this.dialog.open) this.dialog.close();
      return;
    }
    this.popupId = key;
    this.popupMessage = popup;
    const head = el('div', { class: 'head' });
    const content = this.content(popup, 'h2');
    if (content instanceof HTMLElement) content.querySelector('.title')?.setAttribute('id', 'oa-popup-title');
    head.append(content, this.closeButton(() => {
      this.closePopup();
    }));
    const ok = el('button', { class: 'button', part: 'button', type: 'button', autofocus: '' });
    ok.textContent = this.getAttribute('ok-label') ?? 'Got it';
    ok.addEventListener('click', () => {
      this.closePopup();
    });
    const actions = el('div', { class: 'actions' });
    actions.append(ok);
    this.dialog.replaceChildren(head, actions);
    if (!this.dialog.open) this.dialog.showModal();
    this.markShown(popup);
  }
}

define('oa-announcements', OaAnnouncements);

declare global {
  interface HTMLElementTagNameMap {
    'oa-announcements': OaAnnouncements;
  }
}
