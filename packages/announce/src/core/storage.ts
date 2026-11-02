type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const memory = new Map<string, string>();
const memoryStore: Store = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
};

/** localStorage when the page may use it (private modes and sandboxed frames may not), else
 * memory. */
export function defaultStorage(): Store {
  try {
    const probe = '__openannounce__';
    globalThis.localStorage.setItem(probe, probe);
    globalThis.localStorage.removeItem(probe);
    return globalThis.localStorage;
  } catch {
    return memoryStore;
  }
}

// The caller says what it stored.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function readJson<T>(store: Store, key: string): T | undefined {
  try {
    const raw = store.getItem(key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function writeJson(store: Store, key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the feed still works, it just isn't remembered.
  }
}

/** A short, stable hash, so cache keys don't hold the user token itself. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
