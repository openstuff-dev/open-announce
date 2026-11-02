import { describe, expect, it, vi } from 'vitest';
import { FeedClient } from '../src/core/client.js';
import type { FeedMessage } from '../src/core/types.js';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const message: FeedMessage = {
  id: 'm1',
  kind: 'announcement',
  display: 'banner',
  severity: 'info',
  title: 'Hello',
  body: '',
  closeable: true,
  link: null,
  startsAt: null,
  endsAt: null,
  updatedAt: '2026-01-01T00:00:00Z',
};

function respond(status: number, body?: unknown, etag = '"v1"') {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { ETag: etag, 'Content-Type': 'application/json' },
  });
}

describe('FeedClient', () => {
  it('shares one request between callers and sends the key and user', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(respond(200, { messages: [message] })));
    const client = new FeedClient(
      { url: 'https://a.test/', publicKey: 'pk_1', user: 'tok', storage: memoryStorage() },
      fetchFn,
    );
    const [a, b] = await Promise.all([client.load(), client.load()]);
    expect(a).toEqual([message]);
    expect(b).toEqual([message]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('https://a.test/api/v1/feed', {
      headers: { 'X-OpenAnnounce-Key': 'pk_1', 'X-OpenAnnounce-User': 'tok' },
      cache: 'no-store',
    });
  });

  it('uses the stored feed within the TTL, then asks with If-None-Match', async () => {
    let now = 0;
    const storage = memoryStorage();
    const fetchFn = vi.fn(() => Promise.resolve(respond(200, { messages: [message] })));
    const config = { url: 'https://a.test', publicKey: 'pk_1', cacheTtl: 60, storage };
    await new FeedClient(config, fetchFn, () => now).load();

    // A new page load within the TTL: no request.
    await new FeedClient(config, fetchFn, () => now).load();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now = 61_000;
    fetchFn.mockResolvedValueOnce(respond(304));
    expect(await new FeedClient(config, fetchFn, () => now).load()).toEqual([message]);
    expect(fetchFn).toHaveBeenLastCalledWith(expect.any(String), {
      headers: { 'X-OpenAnnounce-Key': 'pk_1', 'If-None-Match': '"v1"' },
      cache: 'no-store',
    });
  });

  it('keeps the stored feed when the server is down', async () => {
    let now = 0;
    const storage = memoryStorage();
    const config = { url: 'https://a.test', publicKey: 'pk_1', storage };
    const up = () => Promise.resolve(respond(200, { messages: [message] }));
    await new FeedClient(config, up, () => now).load();
    now = 999_999;
    const down = new FeedClient(config, () => Promise.reject(new TypeError('offline')), () => now);
    expect(await down.load()).toEqual([message]);
  });

  it('keeps one cache per user', async () => {
    const storage = memoryStorage();
    const fetchFn = vi.fn(() => Promise.resolve(respond(200, { messages: [message] })));
    await new FeedClient({ url: 'https://a.test', publicKey: 'pk_1', user: 'alice', storage }, fetchFn).load();
    await new FeedClient({ url: 'https://a.test', publicKey: 'pk_1', user: 'bob', storage }, fetchFn).load();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('shows an edited message again after it was dismissed', () => {
    const client = new FeedClient({ url: 'https://a.test', publicKey: 'pk_1', storage: memoryStorage() });
    client.dismissed.add(message);
    expect(client.dismissed.has(message)).toBe(true);
    expect(client.dismissed.has({ ...message, updatedAt: '2026-02-01T00:00:00Z' })).toBe(false);
  });
});
