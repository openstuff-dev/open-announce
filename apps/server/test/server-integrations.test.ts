import Fastify, { type FastifyInstance } from 'fastify';
import { vaultFor } from '@openstuff-dev/server';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Account } from '../src/auth.js';
import { type Config, loadConfig } from '../src/config.js';
import type { Pool } from '../src/db.js';
import { registerErrorHandler } from '../src/errors.js';
import { ConnectionError } from '../src/openversion.js';
import { registerServerIntegrationRoutes } from '../src/routes/server-integrations.js';

// No database: the routes only run one table's queries, which a small in-memory stand-in
// answers.
// Real-database checks belong in the API suite.

const KEY = 'pk_testkey123456789';
const URL_ = 'https://versions.example.com';

interface Stored {
  url: string;
  public_key: string;
  deploy_token_sealed: string | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  last_tested_at: Date | null;
}

function fakePool(): { pool: Pool; stored: () => Stored | undefined } {
  let row: Stored | undefined;
  const query = (sql: string, params: unknown[] = []) => Promise.resolve(run(sql, params));
  const run = (sql: string, params: unknown[]) => {
    if (/^\s*SELECT url, public_key/.test(sql)) return { rows: row ? [row] : [] };
    if (/^\s*INSERT INTO server_integrations/.test(sql)) {
      const [url, publicKey, sealed, ok, message] = params as [
        string,
        string,
        string | null,
        boolean,
        string,
      ];
      row = {
        url,
        public_key: publicKey,
        deploy_token_sealed: sealed ?? row?.deploy_token_sealed ?? null,
        last_test_ok: ok,
        last_test_message: message,
        last_tested_at: new Date(),
      };
      return { rows: [] };
    }
    if (/^\s*UPDATE server_integrations/.test(sql)) {
      const [ok, message] = params as [boolean, string];
      if (row) {
        Object.assign(row, {
          last_test_ok: ok,
          last_test_message: message,
          last_tested_at: new Date(),
        });
      }
      return { rows: [] };
    }
    if (/^\s*DELETE FROM server_integrations/.test(sql)) {
      row = undefined;
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  return { pool: { query } as unknown as Pool, stored: () => row };
}

function config(env: Record<string, string> = {}): Config {
  return loadConfig({ OPENANNOUNCE_PUBLIC_URL: 'https://announce.example.com', ...env });
}

function build(
  account: Account | null,
  check: (url: string, key: string, origin: string) => Promise<string>,
  env: Record<string, string> = {},
  checkToken: (url: string, token: string) => Promise<string> = () =>
    Promise.resolve('The deploy token works.'),
) {
  const { pool, stored } = fakePool();
  const app: FastifyInstance = Fastify();
  registerErrorHandler(app);
  app.decorateRequest('account', null);
  app.addHook('onRequest', (request, _reply, done) => {
    request.account = account;
    done();
  });
  registerServerIntegrationRoutes(app, pool, config(env), vaultFor('test-secret'), check, checkToken);
  return { app, stored };
}

const admin: Account = { id: 'a1', email: 'admin@example.com', name: 'Admin', isServerAdmin: true };
const developer: Account = { id: 'd1', email: 'dev@example.com', name: 'Dev', isServerAdmin: false };

describe('server-wide OpenVersion connection', () => {
  let calls: [string, string, string][];
  let answer: () => Promise<string>;
  const check = (url: string, key: string, origin: string) => {
    calls.push([url, key, origin]);
    return answer();
  };
  beforeEach(() => {
    calls = [];
    answer = () => Promise.resolve('Connected to OpenVersion.');
  });

  it('tests with this server’s own origin and saves the connection', async () => {
    const { app, stored } = build(admin, check);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/integrations/openversion',
      payload: { url: `${URL_}/`, publicKey: KEY },
    });
    expect(response.statusCode).toBe(200);
    expect(calls).toEqual([[URL_, KEY, 'https://announce.example.com']]);
    expect(stored()).toMatchObject({ url: URL_, public_key: KEY, last_test_ok: true });
    expect(response.json()).toMatchObject({ kind: 'openversion', status: 'connected', source: 'database' });
  });

  it('keeps a connection that failed its test, so a fix can follow, and says why', async () => {
    answer = () =>
      Promise.reject(
        new ConnectionError('Add https://announce.example.com to allowed origins in OpenVersion.', false),
      );
    const { app, stored } = build(admin, check);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/integrations/openversion',
      payload: { url: URL_, publicKey: KEY },
    });
    expect(stored()?.last_test_ok).toBe(false);
    expect(response.json()).toMatchObject({
      status: 'problem',
      message: expect.stringContaining('allowed origins') as unknown,
    });
  });

  it('refuses the connection to a non-admin', async () => {
    const { app } = build(developer, check);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/integrations/openversion',
      payload: { url: URL_, publicKey: KEY },
    });
    expect(response.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });

  it('rejects a key that is not a public key', async () => {
    const { app } = build(admin, check);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/integrations/openversion',
      payload: { url: URL_, publicKey: 'ov_live_notapublickey' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain('pk_');
  });

  it('tests the saved connection and updates its result', async () => {
    const { app, stored } = build(admin, check);
    await app.inject({ method: 'PUT', url: '/api/admin/integrations/openversion', payload: { url: URL_, publicKey: KEY } });
    answer = () => Promise.reject(new ConnectionError('That address didn’t answer.', true));
    const response = await app.inject({ method: 'POST', url: '/api/admin/integrations/openversion/test' });
    expect(response.json()).toEqual({ ok: false, message: 'That address didn’t answer.' });
    expect(stored()?.last_test_ok).toBe(false);
  });

  it('a test of values sent does not overwrite the saved result', async () => {
    const { app, stored } = build(admin, check);
    await app.inject({ method: 'PUT', url: '/api/admin/integrations/openversion', payload: { url: URL_, publicKey: KEY } });
    answer = () => Promise.reject(new ConnectionError('nope', false));
    await app.inject({
      method: 'POST',
      url: '/api/admin/integrations/openversion/test',
      payload: { publicKey: 'pk_otherkey123456789' },
    });
    expect(stored()?.last_test_ok).toBe(true);
  });

  it('stores the deploy token sealed, tests it, and never returns it', async () => {
    const tokens: string[] = [];
    const { app, stored } = build(admin, check, {}, (_url, token) => {
      tokens.push(token);
      return Promise.resolve('The deploy token works, so this server can publish its version.');
    });
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/integrations/openversion',
      payload: { url: URL_, publicKey: KEY, deployToken: 'ov_live_secret_token' },
    });
    expect(tokens).toEqual(['ov_live_secret_token']);
    expect(stored()?.deploy_token_sealed).toBeTruthy();
    expect(stored()?.deploy_token_sealed).not.toContain('ov_live_secret_token');
    expect(response.body).not.toContain('ov_live_secret_token');
    expect(response.json()).toMatchObject({ hasDeployToken: true, status: 'connected' });
  });

  it('a deploy token OpenVersion refuses is a problem, and says so', async () => {
    const { app } = build(admin, check, {}, () =>
      Promise.reject(new ConnectionError('OpenVersion doesn’t recognise this deploy token.', false)),
    );
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/integrations/openversion',
      payload: { url: URL_, publicKey: KEY, deployToken: 'ov_live_wrong_token' },
    });
    expect(response.json()).toMatchObject({ status: 'problem', message: expect.stringContaining('deploy token') as unknown });
  });

  it('saving again without a deploy token keeps the saved one', async () => {
    const { app, stored } = build(admin, check);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/integrations/openversion',
      payload: { url: URL_, publicKey: KEY, deployToken: 'ov_live_secret_token' },
    });
    const sealed = stored()?.deploy_token_sealed;
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/integrations/openversion',
      payload: { url: URL_, publicKey: KEY },
    });
    expect(stored()?.deploy_token_sealed).toBe(sealed);
    expect(response.json()).toMatchObject({ hasDeployToken: true });
  });

  it('the public client config carries the URL and key, never a secret', async () => {
    const { app } = build(developer, check);
    const empty = await app.inject({ method: 'GET', url: '/api/client-config' });
    expect(empty.json()).toEqual({ openversion: null });

    const { app: withEnv } = build(null, check, {
      OPENANNOUNCE_OPENVERSION_URL: 'https://versions.example.com/',
      OPENANNOUNCE_OPENVERSION_PUBLIC_KEY: KEY,
    });
    const set = await withEnv.inject({ method: 'GET', url: '/api/client-config' });
    expect(set.json()).toEqual({ openversion: { url: URL_, publicKey: KEY } });
  });

  it('an environment variable wins, shows read-only, and refuses changes', async () => {
    const env = {
      OPENANNOUNCE_OPENVERSION_URL: URL_,
      OPENANNOUNCE_OPENVERSION_PUBLIC_KEY: KEY,
    };
    const { app } = build(admin, check, env);
    const card = await app.inject({ method: 'GET', url: '/api/admin/integrations' });
    expect(card.json()).toEqual([
      {
        kind: 'openversion',
        url: URL_,
        publicKey: KEY,
        hasDeployToken: false,
        status: 'set-by-server',
        source: 'environment',
        message: null,
        testedAt: null,
      },
    ]);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/integrations/openversion',
      payload: { url: 'https://other.example.com', publicKey: KEY },
    });
    expect(put.statusCode).toBe(409);
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/integrations/openversion' });
    expect(del.statusCode).toBe(409);
  });

  it('removes the connection', async () => {
    const { app, stored } = build(admin, check);
    await app.inject({ method: 'PUT', url: '/api/admin/integrations/openversion', payload: { url: URL_, publicKey: KEY } });
    const response = await app.inject({ method: 'DELETE', url: '/api/admin/integrations/openversion' });
    expect(response.json()).toEqual({ ok: true });
    expect(stored()).toBeUndefined();
  });
});
