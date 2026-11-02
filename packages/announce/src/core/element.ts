import { clientFor, type FeedClient } from './client.js';
import { type OpenAnnounceConfig, whenConfigured } from './config.js';
import { baseCss, sheet, structuralCss } from './styles.js';
import type { FeedMessage, Kind } from './types.js';

export interface MessageActions {
  /** Closes the message (or marks news read) and remembers it. */
  dismiss(): void;
}

/**
 * Replaces the inside of each message (the title, text and link). The element keeps the frame:
 * the banner, dialog or popover, the close button and what screen readers hear.
 */
export type RenderMessage = (message: FeedMessage, actions: MessageActions) => Node;

export interface AnnounceEventMap {
  'openannounce:show': CustomEvent<{ message: FeedMessage }>;
  'openannounce:dismiss': CustomEvent<{ message: FeedMessage }>;
}

/** What the three elements share: config, the shared feed client, styles and events. */
export abstract class AnnounceElement extends HTMLElement {
  static observedAttributes = ['url', 'public-key', 'user-token', 'unstyled'];

  // `declare`: no field initialisers, which would wipe values a host set before the element
  // was defined (they're on the instance already when it's upgraded).
  /** Overrides `configure()` for this element only. */
  declare config: OpenAnnounceConfig | undefined;
  /** See {@link RenderMessage}. */
  declare renderMessage: RenderMessage | undefined;

  /**
   * Shows these messages instead of the feed, and doesn't fetch: for previews and tests.
   * Closing one hides it until you set the list again; nothing is remembered.
   */
  get messages(): FeedMessage[] | undefined {
    return this.fixed;
  }

  set messages(list: FeedMessage[] | undefined) {
    this.fixed = list;
    if (!this.isConnected) return;
    this.disconnectedCallback();
    void this.connect();
  }

  private fixed: FeedMessage[] | undefined;

  protected abstract readonly kind: Kind;
  protected client: FeedClient | undefined;
  protected readonly root: ShadowRoot;
  private unsubscribe: (() => void) | undefined;
  private readonly shown = new Set<string>();
  private connectId = 0;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    // `messages` set before the element was defined sits on the instance and hides the
    // accessor below; move it behind the accessor.
    const early = Object.getOwnPropertyDescriptor(this, 'messages');
    if (early) {
      delete (this as { messages?: unknown }).messages;
      this.fixed = early.value as FeedMessage[] | undefined;
    }
  }

  connectedCallback(): void {
    this.applyStyles();
    void this.connect();
  }

  disconnectedCallback(): void {
    this.connectId++;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  attributeChangedCallback(name: string): void {
    if (!this.isConnected) return;
    if (name === 'unstyled') this.applyStyles();
    else {
      this.disconnectedCallback();
      void this.connect();
    }
  }

  /** Fetches again now, skipping the cache. */
  refresh(): Promise<void> {
    return this.client?.load(true).then(() => undefined) ?? Promise.resolve();
  }

  /** Shows the messages of this element's kind that it should show now. */
  protected abstract render(messages: FeedMessage[]): void;

  /** Closes `message` and remembers it. */
  protected dismiss(message: FeedMessage): void {
    this.emit('openannounce:dismiss', { message });
    if (this.fixed) {
      this.fixed = this.fixed.filter((m) => m !== message);
      this.render(this.fixed.filter((m) => m.kind === this.kind));
      return;
    }
    this.client?.dismissed.add(message);
    this.client?.notify();
  }

  protected isDismissed(message: FeedMessage): boolean {
    return this.client?.dismissed.has(message) ?? false;
  }

  /** Fires `openannounce:show` once per message version. */
  protected markShown(message: FeedMessage): void {
    const key = `${message.id}@${message.updatedAt}`;
    if (this.shown.has(key)) return;
    this.shown.add(key);
    this.emit('openannounce:show', { message });
  }

  protected emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** The title, text and link of a message, or what `renderMessage` makes of it. */
  protected content(message: FeedMessage, titleTag = 'p'): Node {
    if (this.renderMessage) return this.renderMessage(message, { dismiss: () => {
      this.dismiss(message);
    } });
    const wrap = el('div', { class: 'content', part: 'content' });
    const title = el(titleTag, { class: 'title', part: 'title' });
    title.textContent = message.title;
    wrap.append(title);
    if (message.body.trim()) {
      const body = el('div', { class: 'body', part: 'body' });
      for (const paragraph of message.body.split(/\n\s*\n/)) {
        const p = el('p');
        p.textContent = paragraph.trim();
        body.append(p);
      }
      wrap.append(body);
    }
    if (message.link) {
      const a = el('a', { class: 'link', part: 'link', href: message.link.url });
      a.textContent = message.link.label || message.link.url;
      wrap.append(a);
    }
    return wrap;
  }

  protected closeButton(onClick: () => void): HTMLButtonElement {
    const button = el('button', { class: 'close', part: 'close', type: 'button' });
    button.setAttribute('aria-label', this.getAttribute('close-label') ?? 'Close');
    button.textContent = '×';
    button.addEventListener('click', onClick);
    return button;
  }

  private applyStyles(): void {
    this.root.adoptedStyleSheets = [sheet(this.hasAttribute('unstyled') ? structuralCss : baseCss)];
  }

  private async connect(): Promise<void> {
    const id = ++this.connectId;
    if (this.fixed) {
      this.client = undefined;
      this.render(this.fixed.filter((m) => m.kind === this.kind));
      return;
    }
    const config = this.config ?? this.configFromAttributes() ?? (await whenConfigured());
    if (id !== this.connectId) return;
    this.client = clientFor(config);
    this.unsubscribe = this.client.subscribe((messages) => {
      this.render(messages.filter((m) => m.kind === this.kind));
    });
  }

  private configFromAttributes(): OpenAnnounceConfig | undefined {
    const url = this.getAttribute('url');
    const publicKey = this.getAttribute('public-key');
    if (!url || !publicKey) return undefined;
    return { url, publicKey, user: this.getAttribute('user-token') ?? undefined };
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K];
export function el(tag: string, attrs?: Record<string, string>): HTMLElement;
export function el(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/** Defines a custom element once, so importing a module twice is harmless. */
export function define(name: string, constructor: CustomElementConstructor): void {
  if (!customElements.get(name)) customElements.define(name, constructor);
}
