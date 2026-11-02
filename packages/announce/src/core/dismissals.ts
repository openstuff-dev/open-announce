import type { FeedMessage } from './types.js';
import { readJson, writeJson } from './storage.js';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Remembers which messages the user closed (or, for news, read), per message version: when an
 * admin edits a message, its `updatedAt` changes and it shows again.
 */
export class MessageMarks {
  constructor(
    private readonly store: Store,
    private readonly key: string,
  ) {}

  has(message: Pick<FeedMessage, 'id' | 'updatedAt'>): boolean {
    return this.all()[message.id] === message.updatedAt;
  }

  add(...messages: Pick<FeedMessage, 'id' | 'updatedAt'>[]): void {
    const marks = this.all();
    for (const m of messages) marks[m.id] = m.updatedAt;
    writeJson(this.store, this.key, marks);
  }

  /** Forgets messages that are no longer in the feed, so storage doesn't grow forever. */
  prune(current: Pick<FeedMessage, 'id'>[]): void {
    const marks = this.all();
    const keep = new Set(current.map((m) => m.id));
    const kept = Object.fromEntries(Object.entries(marks).filter(([id]) => keep.has(id)));
    if (Object.keys(kept).length !== Object.keys(marks).length) {
      writeJson(this.store, this.key, kept);
    }
  }

  private all(): Record<string, string> {
    return readJson<Record<string, string>>(this.store, this.key) ?? {};
  }
}
