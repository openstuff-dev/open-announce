import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FeedMessage } from '@openstuff-dev/announce';
import { signUser } from '@openstuff-dev/announce/server';
import type {
  Message,
  MessagesPage,
  PublishedMessage,
  SystemWithPublishKey,
  SystemWithSecret,
  TenantExport,
} from '@open-announce/contracts';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { createPool, migrate, type Pool, withScope } from '../src/db.js';
import { DEMO_DEVELOPER, seedDemo } from '../src/seed-demo.js';

// These tests need Postgres: TEST_DATABASE_URL=postgres://user:pass@localhost:5432/openannounce_test.
// The database is emptied first.
const url = process.env.TEST_DATABASE_URL ?? '';

/** The value, or a failed test saying what was missing. */
function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`Expected a ${what}.`);
  return value;
}

describe.skipIf(!url)('API against Postgres', () => {
  let app: FastifyInstance;
  let pool: Pool;
  let admin: string;
  let developer: string;
  let demo: { publicKey: string; secret: string };

  const inject = (
    cookie: string | null,
    method: string,
    path: string,
    payload?: unknown,
    headers = {},
  ) =>
    app.inject({
      method: method as 'GET',
      url: path,
      payload: payload as object,
      headers: { ...(cookie ? { cookie } : {}), ...headers },
    });

  async function signIn(email: string, password: string): Promise<string> {
    const response = await inject(null, 'POST', '/api/session', { email, password });
    expect(response.statusCode).toBe(200);
    const cookie = must(response.cookies.find((c) => c.name === 'oa_session'), 'session cookie');
    return `oa_session=${cookie.value}`;
  }

  const feed = (headers: Record<string, string>) => inject(null, 'GET', '/api/v1/feed', undefined, headers);
  const titles = (body: string) =>
    (JSON.parse(body) as { messages: FeedMessage[] }).messages.map((m) => m.title);

  beforeAll(async () => {
    const owner = new pg.Client({ connectionString: url });
    await owner.connect();
    await owner.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await owner.end();
    await migrate(url, fileURLToPath(new URL('../migrations', import.meta.url)));
    pool = createPool(url);
    app = await buildApp({ ...loadConfig({}), databaseUrl: url, logLevel: 'silent' }, pool);
    await pool.query(
      `INSERT INTO accounts (email, name, password_hash, is_server_admin) VALUES ('root@example.com', 'Root', $1, true)`,
      [await hashPassword('root-password')],
    );
    await seedDemo(pool);
    admin = await signIn('root@example.com', 'root-password');
    developer = await signIn(DEMO_DEVELOPER.email, DEMO_DEVELOPER.password);
    const { rows } = await withScope(pool, { bypass: true }, (db) =>
      db.query<{ publicKey: string; secret: string }>(
        `SELECT public_key AS "publicKey", signing_secret AS secret FROM systems WHERE slug = 'demo-app'`,
      ),
    );
    demo = must(rows.at(0), 'demo system');
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('sign-in', () => {
    it('refuses a wrong password and answers /api/me when signed in', async () => {
      const wrong = await inject(null, 'POST', '/api/session', { email: 'root@example.com', password: 'nope' });
      expect(wrong.statusCode).toBe(401);
      expect((await inject(null, 'GET', '/api/me')).statusCode).toBe(401);
      const me = (await inject(admin, 'GET', '/api/me')).json<{ isServerAdmin: boolean; tenants: unknown[] }>();
      expect(me).toMatchObject({ isServerAdmin: true, tenants: [{ slug: 'demo', role: 'admin' }] });
    });

    it('changes a password and signs out the other sessions', async () => {
      const other = await signIn(DEMO_DEVELOPER.email, DEMO_DEVELOPER.password);
      const current = await signIn(DEMO_DEVELOPER.email, DEMO_DEVELOPER.password);
      const change = (from: string, to: string) =>
        inject(current, 'PUT', '/api/me/password', { current: from, next: to });
      expect((await change('nope', 'a-new-password')).statusCode).toBe(400);
      expect((await change(DEMO_DEVELOPER.password, 'a-new-password')).statusCode).toBe(200);
      expect((await inject(other, 'GET', '/api/me')).statusCode).toBe(401);
      expect((await inject(current, 'GET', '/api/me')).statusCode).toBe(200);
      await change('a-new-password', DEMO_DEVELOPER.password);
      // The change signed out the session the other tests use.
      developer = await signIn(DEMO_DEVELOPER.email, DEMO_DEVELOPER.password);
    });

    it('refuses changes posted from another origin', async () => {
      const response = await inject(admin, 'POST', '/api/t/demo/groups', { name: 'X' }, { origin: 'https://evil.test' });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('feed', () => {
    it('needs a known public key', async () => {
      expect((await feed({})).statusCode).toBe(401);
      expect((await feed({ 'x-openannounce-key': 'pk_unknown' })).statusCode).toBe(401);
    });

    it('shows a visitor only the published, current messages for everyone', async () => {
      const response = await feed({ 'x-openannounce-key': demo.publicKey });
      expect(response.statusCode).toBe(200);
      expect(titles(response.body).sort()).toEqual([
        'Dark mode is here',
        'Faster search',
        'Planned maintenance on Saturday, 06:00–08:00 UTC',
        'The new reporting page is live',
      ]);
      expect(response.headers['cache-control']).toBe('private, max-age=60');
    });

    it('adds the groups an admin gave a signed user', async () => {
      const alice = await signUser(demo.secret, { sub: 'alice' });
      const bob = await signUser(demo.secret, { sub: 'bob' });
      const forAlice = titles((await feed({ 'x-openannounce-key': demo.publicKey, 'x-openannounce-user': alice })).body);
      const forBob = titles((await feed({ 'x-openannounce-key': demo.publicKey, 'x-openannounce-user': bob })).body);
      expect(forAlice).toContain('Welcome to the new staff portal');
      expect(forAlice).not.toContain('Invoicing is down');
      expect(forBob).toContain('Invoicing is down');
    });

    it('uses exactly the groups in the token when it has some', async () => {
      const token = await signUser(demo.secret, { sub: 'alice', groups: ['finance'] });
      const list = titles((await feed({ 'x-openannounce-key': demo.publicKey, 'x-openannounce-user': token })).body);
      expect(list).toContain('Invoicing is down');
      expect(list).not.toContain('Welcome to the new staff portal');
    });

    it('refuses forged and expired user tokens', async () => {
      const forged = await signUser('sk_not_the_secret', { sub: 'bob', groups: ['finance'] });
      const expired = await signUser(demo.secret, { sub: 'bob', exp: 1 });
      for (const token of [forged, expired, 'garbage']) {
        const response = await feed({ 'x-openannounce-key': demo.publicKey, 'x-openannounce-user': token });
        expect(response.statusCode).toBe(401);
      }
    });

    it('answers 304 to a matching ETag, in one database round trip', async () => {
      const first = await feed({ 'x-openannounce-key': demo.publicKey });
      const etag = String(first.headers.etag);
      expect(etag).toMatch(/^W\/"/);
      const spy = vi.spyOn(pg.Client.prototype, 'query');
      const again = await feed({ 'x-openannounce-key': demo.publicKey, 'if-none-match': etag });
      expect(again.statusCode).toBe(304);
      // The system lookup is cached; the scope, the query and the commit share one trip.
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('only lets the system’s own origins read it, once it lists any', async () => {
      const systems = (await inject(developer, 'GET', '/api/t/demo/systems')).json<{ id: string }[]>();
      const id = systems[0].id;
      await inject(developer, 'PATCH', `/api/t/demo/systems/${id}`, { allowedOrigins: ['https://app.example.com/'] });
      const ok = await feed({ 'x-openannounce-key': demo.publicKey, origin: 'https://app.example.com' });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.com');
      const other = await feed({ 'x-openannounce-key': demo.publicKey, origin: 'https://other.example.com' });
      expect(other.statusCode).toBe(403);
      await inject(developer, 'PATCH', `/api/t/demo/systems/${id}`, { allowedOrigins: [] });
    });
  });

  describe('roles', () => {
    it('lets developers read messages and manage keys, not publish or manage people', async () => {
      expect((await inject(developer, 'GET', '/api/t/demo/messages')).statusCode).toBe(200);
      const message = { kind: 'news', display: 'sidebar', title: 'Hi', status: 'published' };
      expect((await inject(developer, 'POST', '/api/t/demo/messages', message)).statusCode).toBe(403);
      expect((await inject(developer, 'GET', '/api/t/demo/members')).statusCode).toBe(403);
      expect((await inject(developer, 'POST', '/api/t/demo/systems', { name: 'X' })).statusCode).toBe(403);
      const systems = (await inject(developer, 'GET', '/api/t/demo/systems')).json<{ id: string }[]>();
      const rotated = await inject(developer, 'POST', `/api/t/demo/systems/${systems[0].id}/rotate`, {});
      expect(rotated.statusCode).toBe(200);
      demo.secret = rotated.json<SystemWithSecret>().signingSecret;
    });

    it('never lets anyone change their own role', async () => {
      const me = (await inject(developer, 'GET', '/api/me')).json<{ id: string }>();
      const raise = await inject(developer, 'PATCH', `/api/t/demo/members/${me.id}`, { role: 'admin' });
      expect(raise.statusCode).toBe(403);
      const root = (await inject(admin, 'GET', '/api/me')).json<{ id: string }>();
      await inject(admin, 'POST', '/api/t/demo/members', { email: 'root@example.com', role: 'admin' });
      const self = await inject(admin, 'PATCH', `/api/t/demo/members/${root.id}`, { role: 'developer' });
      expect(self.statusCode).toBe(403);
    });

    it('keeps tenant management to server admins', async () => {
      expect((await inject(developer, 'POST', '/api/tenants', { name: 'Mine' })).statusCode).toBe(403);
    });
  });

  it('creates once per idempotency key', async () => {
    const headers = { 'idempotency-key': 'abc-123' };
    const first = await inject(admin, 'POST', '/api/t/demo/groups', { name: 'Once' }, headers);
    const second = await inject(admin, 'POST', '/api/t/demo/groups', { name: 'Once' }, headers);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
  });

  describe('messages', () => {
    it('enforces the display rules', async () => {
      const popupNews = await inject(admin, 'POST', '/api/t/demo/messages', {
        kind: 'news', display: 'popup', title: 'No', status: 'draft',
      });
      expect(popupNews.statusCode).toBe(400);
      expect(popupNews.json<{ error: string }>().error).toBe('A news message shows as sidebar, not as popup.');
      const banner = await inject(admin, 'POST', '/api/t/demo/messages', {
        kind: 'maintenance', display: 'banner', title: 'Down', closeable: true, status: 'draft',
      });
      expect(banner.json<Message>().closeable).toBe(false);
    });

    it('updates a message and shows the new version in the feed', async () => {
      const page = (await inject(admin, 'GET', '/api/t/demo/messages')).json<MessagesPage>();
      const live = must(page.messages.find((m) => m.title === 'The new reporting page is live'));
      const saved = await inject(admin, 'PUT', `/api/t/demo/messages/${live.id}`, { ...live, title: 'Reports moved' });
      expect(saved.statusCode).toBe(200);
      expect(saved.json<Message>().updatedAt).not.toBe(live.updatedAt);
      expect(titles((await feed({ 'x-openannounce-key': demo.publicKey })).body)).toContain('Reports moved');
    });
  });

  describe('tenants are isolated', () => {
    let other: { slug: string; systemId: string; groupId: string; publicKey: string };

    beforeAll(async () => {
      await inject(admin, 'POST', '/api/tenants', { name: 'Other company', slug: 'other' });
      const system = (await inject(admin, 'POST', '/api/t/other/systems', { name: 'Other app' })).json<SystemWithSecret>();
      const group = (await inject(admin, 'POST', '/api/t/other/groups', { name: 'Secret group' })).json<{ id: string }>();
      await inject(admin, 'POST', '/api/t/other/messages', {
        kind: 'announcement', display: 'banner', title: 'Only for Other', status: 'published',
      });
      other = { slug: 'other', systemId: system.id, groupId: group.id, publicKey: system.publicKey };
    });

    it('keeps each tenant’s messages out of the other’s feed', async () => {
      expect(titles((await feed({ 'x-openannounce-key': demo.publicKey })).body)).not.toContain('Only for Other');
      expect(titles((await feed({ 'x-openannounce-key': other.publicKey })).body)).toEqual(['Only for Other']);
    });

    it('shows a scoped query only its own tenant’s rows, even without a WHERE', async () => {
      const { rows } = await pool.query<{ id: string }>("SELECT id FROM tenants WHERE slug = 'demo'");
      const titlesSeen = await withScope(pool, { tenantId: rows[0].id }, async (db) =>
        (await db.query<{ title: string }>('SELECT title FROM messages')).rows.map((r) => r.title),
      );
      expect(titlesSeen).not.toContain('Only for Other');
      expect(titlesSeen.length).toBeGreaterThan(0);
    });

    it('doesn’t let members of one tenant into another', async () => {
      expect((await inject(developer, 'GET', '/api/t/other/messages')).statusCode).toBe(404);
    });

    it('drops another tenant’s systems and groups from a message’s targets', async () => {
      const saved = await inject(admin, 'POST', '/api/t/demo/messages', {
        kind: 'news', display: 'sidebar', title: 'Targets', status: 'draft',
        systemIds: [other.systemId], groupIds: [other.groupId],
      });
      expect(saved.json<Message>()).toMatchObject({ systemIds: [], groupIds: [] });
    });
  });

  describe('server connections stay out of exports', () => {
    it('UC-5/S6 leaves the saved OpenVersion connection out of a tenant export', async () => {
      const connectionUrl = 'https://versions.example.com';
      const connectionKey = 'pk_export_check_0123456789';
      const sealedToken = 'sealed-deploy-token-export-check';
      await pool.query(
        `INSERT INTO server_integrations (kind, url, public_key, deploy_token_encrypted) VALUES ('openversion', $1, $2, $3)
         ON CONFLICT (kind) DO UPDATE SET url = EXCLUDED.url, public_key = EXCLUDED.public_key,
           deploy_token_encrypted = EXCLUDED.deploy_token_encrypted`,
        [connectionUrl, connectionKey, sealedToken],
      );
      const response = await inject(admin, 'GET', '/api/t/demo/export');
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(connectionUrl);
      expect(response.body).not.toContain(connectionKey);
      expect(response.body).not.toContain(sealedToken);
      expect(response.body).not.toContain('server_integrations');
      await pool.query("DELETE FROM server_integrations WHERE kind = 'openversion'");
    });
  });

  describe('publish API', () => {
    let key = '';
    let systemId = '';
    const publish = (body: unknown, idempotencyKey?: string, token = key) =>
      inject(null, 'POST', '/api/v1/messages', body, {
        authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      });

    beforeAll(async () => {
      const systems = (await inject(admin, 'GET', '/api/t/demo/systems')).json<SystemWithSecret[]>();
      systemId = must(systems.find((s) => s.slug === 'demo-app'), 'demo system').id;
    });

    it('lets only admins make a publish key, and shows it once', async () => {
      expect((await inject(developer, 'POST', `/api/t/demo/systems/${systemId}/publish-key`)).statusCode).toBe(403);
      const made = await inject(admin, 'POST', `/api/t/demo/systems/${systemId}/publish-key`);
      expect(made.statusCode).toBe(200);
      const body = made.json<SystemWithPublishKey>();
      key = body.publishKey;
      expect(key).toMatch(/^ak_/);
      expect(body.publishKeyHint).toBe(`ak_••••${key.slice(-4)}`);
      const listed = (await inject(admin, 'GET', '/api/t/demo/systems')).json<SystemWithSecret[]>();
      expect(JSON.stringify(listed)).not.toContain(key);
      const { rows } = await withScope(pool, { bypass: true }, (db) =>
        db.query<{ hash: string }>('SELECT publish_key_hash AS hash FROM systems WHERE id = $1', [systemId]),
      );
      expect(rows[0].hash).not.toContain(key);
    });

    it('tells another system which system a key posts to', async () => {
      const who = await inject(null, 'GET', '/api/v1/publish-key', undefined, { authorization: `Bearer ${key}` });
      expect(who.json()).toMatchObject({
        tenant: { slug: 'demo', name: 'Demo company' },
        system: { slug: 'demo-app' },
      });
      expect((await inject(null, 'GET', '/api/v1/publish-key')).statusCode).toBe(401);
    });

    it('posts News to the key’s system, exactly once per Idempotency-Key', async () => {
      const message = { title: 'Shop 1.5.0', body: '- Gift wrapping', groups: ['staff'] };
      expect((await publish(message)).statusCode).toBe(400);
      const first = await publish(message, 'release-r1');
      expect(first.statusCode).toBe(201);
      const posted = first.json<PublishedMessage>();
      expect(posted).toMatchObject({ kind: 'news', title: 'Shop 1.5.0', system: 'demo-app', groups: ['staff'] });
      const retry = await publish(message, 'release-r1');
      expect(retry.statusCode).toBe(200);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.json<PublishedMessage>().id).toBe(posted.id);
      // Concurrent retries still post once.
      await Promise.all([publish(message, 'release-r2'), publish(message, 'release-r2'), publish(message, 'release-r2')]);
      const { rows } = await withScope(pool, { bypass: true }, (db) =>
        db.query<{ n: number }>(`SELECT count(*)::int AS n FROM messages WHERE title = 'Shop 1.5.0'`),
      );
      expect(rows[0].n).toBe(2);
      expect((await publish({ ...message, title: 'Other' }, 'release-r1')).statusCode).toBe(422);
      const page = (await inject(admin, 'GET', '/api/t/demo/messages')).json<MessagesPage>();
      const saved = must(page.messages.find((m) => m.id === posted.id));
      expect(saved).toMatchObject({ kind: 'news', display: 'sidebar', status: 'published', systemIds: [systemId] });
    });

    it('refuses unknown groups and keys, and stops working once revoked', async () => {
      const unknown = await publish({ title: 'X', groups: ['nope'] }, 'release-r3');
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json<{ error: string }>().error).toContain('nope');
      // A refused request doesn't use up its key.
      expect((await publish({ title: 'X' }, 'release-r3')).statusCode).toBe(201);
      expect((await publish({ title: 'X' }, 'k', 'ak_00000000000000000000000000')).statusCode).toBe(401);
      expect((await inject(admin, 'DELETE', `/api/t/demo/systems/${systemId}/publish-key`)).statusCode).toBe(200);
      expect((await publish({ title: 'X' }, 'release-r4')).statusCode).toBe(401);
    });
  });

  it('exports a tenant and imports it into another', async () => {
    const exported = (await inject(admin, 'GET', '/api/t/demo/export')).json<TenantExport>();
    expect(JSON.stringify(exported)).not.toContain('sk_');
    expect(JSON.stringify(exported)).not.toContain('ak_');
    await inject(admin, 'POST', '/api/tenants', { name: 'Copy', slug: 'copy' });
    const imported = await inject(admin, 'POST', '/api/t/copy/import', exported);
    expect(imported.statusCode).toBe(200);
    const page = (await inject(admin, 'GET', '/api/t/copy/messages')).json<MessagesPage>();
    expect(page.messages).toHaveLength(exported.messages.length);
    const popup = must(page.messages.find((m) => m.title === 'Welcome to the new staff portal'));
    expect(popup.groupIds).toHaveLength(1);
  });
});
