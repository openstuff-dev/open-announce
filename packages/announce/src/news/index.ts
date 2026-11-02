import { AnnounceElement, define, el } from '../core/element.js';
import type { FeedMessage } from '../core/types.js';

export { configure, defineConfig } from '../core/config.js';
export { AnnounceElement };

/**
 * `<oa-news>`: a sidebar with the news, opened on demand so it never gets in the way.
 *
 * Open it with `trigger=".news-button"` (any CSS selector), with `element.open()`, or by
 * dispatching `openannounce:news-open` on `window`. It sets `unread` to how many news items the
 * user hasn't seen, and fires `openannounce:unread` when that changes, for your own badge.
 */
export class OaNews extends AnnounceElement {
  static override observedAttributes = [...AnnounceElement.observedAttributes, 'trigger'];

  protected readonly kind = 'news' as const;
  private readonly dialog = el('dialog', { class: 'sidebar surface', part: 'sidebar' });
  private readonly list = el('ul', { class: 'list', part: 'list' });
  private items: FeedMessage[] = [];
  private unreadCount = -1;

  constructor() {
    super();
    const head = el('div', { class: 'head', part: 'header' });
    const title = el('h2', { class: 'title', part: 'heading', id: 'oa-news-title' });
    title.textContent = this.getAttribute('heading') ?? 'News';
    head.append(title, this.closeButton(() => {
      this.close();
    }));
    this.dialog.setAttribute('aria-labelledby', 'oa-news-title');
    this.dialog.append(head, this.list);
    // A click on the backdrop closes it, like any drawer.
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog) this.close();
    });
    this.dialog.addEventListener('close', () => {
      this.render(this.items);
    });
    this.root.append(this.dialog);
  }

  /** How many news items the user hasn't seen. */
  get unread(): number {
    return Math.max(this.unreadCount, 0);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('click', this.onDocumentClick);
    window.addEventListener('openannounce:news-open', this.onOpenEvent);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('click', this.onDocumentClick);
    window.removeEventListener('openannounce:news-open', this.onOpenEvent);
  }

  override attributeChangedCallback(name: string): void {
    if (name !== 'trigger') super.attributeChangedCallback(name);
  }

  open(): void {
    if (!this.dialog.open) this.dialog.showModal();
    this.render(this.items);
    this.client?.read.add(...this.items);
    for (const message of this.items) this.markShown(message);
    this.updateUnread();
  }

  close(): void {
    this.dialog.close();
  }

  protected render(messages: FeedMessage[]): void {
    this.items = [...messages].sort((a, b) => date(b).localeCompare(date(a)));
    if (this.items.length === 0) {
      const empty = el('li', { class: 'empty', part: 'empty' });
      empty.textContent = this.getAttribute('empty-label') ?? 'No news yet.';
      this.list.replaceChildren(empty);
    } else {
      this.list.replaceChildren(
        ...this.items.map((message) => {
          const item = el('li', { class: 'item', part: 'item' });
          if (!this.client?.read.has(message)) item.dataset.unread = '';
          const when = el('time', { class: 'date', part: 'date', datetime: date(message) });
          when.textContent = new Date(date(message)).toLocaleDateString(undefined, { dateStyle: 'medium' });
          item.append(when, this.content(message, 'h3'));
          return item;
        }),
      );
    }
    this.updateUnread();
  }

  private updateUnread(): void {
    const count = this.items.filter((m) => !this.client?.read.has(m)).length;
    if (count === this.unreadCount) return;
    this.unreadCount = count;
    this.setAttribute('unread', String(count));
    this.emit('openannounce:unread', { count });
  }

  private readonly onDocumentClick = (event: Event): void => {
    const selector = this.getAttribute('trigger');
    if (!selector || !(event.target instanceof Element)) return;
    if (event.target.closest(selector)) this.open();
  };

  private readonly onOpenEvent = (): void => {
    this.open();
  };
}

function date(message: FeedMessage): string {
  return message.startsAt ?? message.updatedAt;
}

define('oa-news', OaNews);

declare global {
  interface HTMLElementTagNameMap {
    'oa-news': OaNews;
  }
  interface WindowEventMap {
    'openannounce:news-open': Event;
  }
}
