import type { OpenAnnounceConfig } from './config.js';
import { MessageMarks } from './dismissals.js';
import { defaultStorage, hash, readJson, writeJson } from './storage.js';
import type { Feed, FeedMessage } from './types.js';

interface Cached {
  etag: string | null;
  messages: FeedMessage[];
  /** When the feed was last confirmed, in ms since the epoch. */
  checkedAt: number;
}

type Listener = (messages: FeedMessage[]) => void;

/**
 * Fetches a system's feed for the signed-in user. Every element on the page shares one client,
 * so the page makes one request however many elements it has.
 *
 * - A feed fetched less than `cacheTtl` seconds ago (in this tab or an earlier
 * visit) is used as is.
 * - After that it asks again with `If-None-Match`; a 304 keeps the stored messages.
 * - When the server can't be reached, the stored messages stay up.
 */
export class FeedClient {
  readonly dismissed: MessageMarks;
  readonly read: MessageMarks;
  private readonly store;
  private messages: FeedMessage[] | undefined;
  private inFlight: Promise<FeedMessage[]> | undefined;
  private readonly listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly config: OpenAnnounceConfig,
    private readonly fetchFn: typeof fetch = (...args) => globalThis.fetch(...args),
    private readonly now: () => number = Date.now,
  ) {
    this.store = config.storage ?? defaultStorage();
    this.dismissed = new MessageMarks(this.store, `openannounce:dismissed:${config.publicKey}`);
    this.read = new MessageMarks(this.store, `openannounce:read:${config.publicKey}`);
  }

  /** Calls `listener` with the messages now (when known) and after every change. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.messages) listener(this.messages);
    void this.load().catch(() => undefined);
    this.startPolling();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopPolling();
    };
  }

  /** The feed, from the cache while it's fresh. Concurrent calls share one request. */
  load(force = false): Promise<FeedMessage[]> {
    this.inFlight ??= this.fetchFeed(force).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  /** Tells every element that the user closed or read something. */
  notify(): void {
    if (this.messages) this.emit(this.messages);
  }

  private async fetchFeed(force: boolean): Promise<FeedMessage[]> {
    const user = typeof this.config.user === 'function' ? await this.config.user() : this.config.user;
    // Per user, so someone signing in after someone else never sees the other's messages.
    const cacheKey = `openannounce:feed:${this.config.publicKey}:${hash(user ?? '')}`;
    const cached = readJson<Cached>(this.store, cacheKey);
    const ttl = (this.config.cacheTtl ?? 60) * 1000;
    if (cached && !force && this.now() - cached.checkedAt < ttl) {
      return this.update(cached.messages);
    }

    const headers: Record<string, string> = { 'X-OpenAnnounce-Key': this.config.publicKey };
    if (user) headers['X-OpenAnnounce-User'] = user;
    if (cached?.etag) headers['If-None-Match'] = cached.etag;

    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.url.replace(/\/$/, '')}/api/v1/feed`, {
        headers,
        // The client keeps its own cache, keyed by user; the browser's would mix users up.
        cache: 'no-store',
      });
    } catch (error) {
      if (cached) return this.update(cached.messages);
      throw error;
    }
    if (response.status === 304 && cached) {
      writeJson(this.store, cacheKey, { ...cached, checkedAt: this.now() });
      return this.update(cached.messages);
    }
    if (!response.ok) {
      if (cached) return this.update(cached.messages);
      throw new Error(`OpenAnnounce feed: ${response.status} ${response.statusText}`);
    }
    const feed = (await response.json()) as Feed;
    writeJson(this.store, cacheKey, {
      etag: response.headers.get('ETag'),
      messages: feed.messages,
      checkedAt: this.now(),
    } satisfies Cached);
    this.dismissed.prune(feed.messages);
    this.read.prune(feed.messages);
    return this.update(feed.messages);
  }

  private update(messages: FeedMessage[]): FeedMessage[] {
    const changed = JSON.stringify(messages) !== JSON.stringify(this.messages);
    this.messages = messages;
    if (changed) this.emit(messages);
    return messages;
  }

  private emit(messages: FeedMessage[]): void {
    for (const listener of this.listeners) listener(messages);
  }

  private startPolling(): void {
    const seconds = this.config.refreshInterval ?? 300;
    if (this.timer || seconds <= 0) return;
    this.timer = setInterval(() => {
      if (globalThis.document.visibilityState !== 'hidden') void this.load().catch(() => undefined);
    }, seconds * 1000);
  }

  private stopPolling(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

const clients = new Map<string, FeedClient>();

/** The page's one client for this config. */
export function clientFor(config: OpenAnnounceConfig): FeedClient {
  const key = `${config.url}|${config.publicKey}|${typeof config.user === 'string' ? config.user : ''}`;
  let client = clients.get(key);
  if (!client) {
    client = new FeedClient(config);
    clients.set(key, client);
  }
  return client;
}
