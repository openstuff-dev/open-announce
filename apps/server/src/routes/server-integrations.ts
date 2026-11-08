import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAccount } from '../auth.js';
import type { Config } from '../config.js';
import { policyFrom } from '../config.js';
import type { Pool } from '../db.js';
import { HttpError } from '../errors.js';
import { checkOpenVersion, ConnectionError } from '../openversion.js';
import { baseUrl } from './shared.js';

/** The server-wide OpenVersion connection, as the Integrations tab shows it. */
export interface ServerIntegration {
  kind: 'openversion';
  url: string | null;
  publicKey: string | null;
  status: 'not-connected' | 'connected' | 'problem' | 'set-by-server';
  source: 'database' | 'environment' | null;
  message: string | null;
  testedAt: string | null;
}

const publicKey = z
  .string()
  .trim()
  .regex(/^pk_[\w-]{10,60}$/, 'Paste the environment’s public key, which starts with pk_.');

interface Row {
  url: string;
  public_key: string;
  last_test_ok: boolean | null;
  last_test_message: string | null;
  last_tested_at: Date | null;
}

/**
 * Server-wide connections. Only server admins reach these routes. An environment variable wins
 * over the saved connection, which then shows read-only.
 */
export function registerServerIntegrationRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: Config,
  check: (url: string, key: string, origin: string) => Promise<string> = (url, key, origin) =>
    checkOpenVersion(policyFrom(config), url, key, origin),
): void {
  const origin = new URL(config.publicUrl).origin;
  const fromEnv =
    config.openVersion.url && config.openVersion.publicKey
      ? { url: config.openVersion.url, publicKey: config.openVersion.publicKey }
      : null;

  const serverAdmin = (request: Parameters<typeof requireAccount>[0]) => {
    const account = requireAccount(request);
    if (!account.isServerAdmin) throw new HttpError(403, 'Only a server admin can manage server connections.');
  };

  const loadRow = async (): Promise<Row | undefined> => {
    const { rows } = await pool.query<Row>(
      `SELECT url, public_key, last_test_ok, last_test_message, last_tested_at
         FROM server_integrations WHERE kind = 'openversion'`,
    );
    return rows[0];
  };

  const card = (row: Row | undefined): ServerIntegration => {
    if (fromEnv) {
      return {
        kind: 'openversion',
        url: fromEnv.url,
        publicKey: fromEnv.publicKey,
        status: 'set-by-server',
        source: 'environment',
        message: null,
        testedAt: null,
      };
    }
    if (!row) {
      return {
        kind: 'openversion',
        url: null,
        publicKey: null,
        status: 'not-connected',
        source: null,
        message: null,
        testedAt: null,
      };
    }
    return {
      kind: 'openversion',
      url: row.url,
      publicKey: row.public_key,
      status: row.last_test_ok === false ? 'problem' : 'connected',
      source: 'database',
      message: row.last_test_message,
      testedAt: row.last_tested_at?.toISOString() ?? null,
    };
  };

  /** Runs the check and says what it found: never throws for a failed check. */
  const runCheck = async (url: string, key: string): Promise<{ ok: boolean; message: string }> => {
    try {
      return { ok: true, message: await check(url, key, origin) };
    } catch (err) {
      if (err instanceof ConnectionError) return { ok: false, message: err.message };
      throw err;
    }
  };

  app.get('/api/admin/integrations', async (request): Promise<ServerIntegration[]> => {
    serverAdmin(request);
    return [card(await loadRow())];
  });

  /** Saves the connection, then tests it. The save happens either way, so a fix can follow. */
  app.put('/api/admin/integrations/openversion', async (request): Promise<ServerIntegration> => {
    serverAdmin(request);
    if (fromEnv) {
      throw new HttpError(
        409,
        'The server’s configuration sets this. Change OPENANNOUNCE_OPENVERSION_URL to change it here.',
      );
    }
    const body = z.object({ url: baseUrl, publicKey }).parse(request.body);
    const result = await runCheck(body.url, body.publicKey);
    await pool.query(
      `INSERT INTO server_integrations (kind, url, public_key, last_test_ok, last_test_message, last_tested_at, updated_at)
       VALUES ('openversion', $1, $2, $3, $4, now(), now())
       ON CONFLICT (kind) DO UPDATE SET url = EXCLUDED.url, public_key = EXCLUDED.public_key,
         last_test_ok = EXCLUDED.last_test_ok, last_test_message = EXCLUDED.last_test_message,
         last_tested_at = now(), updated_at = now()`,
      [body.url, body.publicKey, result.ok, result.message],
    );
    return card(await loadRow());
  });

  /**
   * Tests the values sent, or the saved connection when none are sent. Only a test of the saved
   * connection updates its stored result.
   */
  /**
   * Tests the values sent, or the saved connection when none are sent. Only a test of the saved
   * connection updates its stored result.
   */
  const testRoute = async (request: Parameters<typeof requireAccount>[0]) => {
    serverAdmin(request);
    const body = z
      .object({ url: baseUrl.optional(), publicKey: publicKey.optional() })
      .parse(request.body ?? {});
    const saved = await loadRow();
    const url = body.url ?? fromEnv?.url ?? saved?.url;
    const key = body.publicKey ?? fromEnv?.publicKey ?? saved?.public_key;
    if (!url || !key) throw new HttpError(400, 'Enter the OpenVersion address and public key first.');
    const result = await runCheck(url, key);
    const testsSaved = !fromEnv && saved !== undefined && !body.url && !body.publicKey;
    if (testsSaved) {
      await pool.query(
        `UPDATE server_integrations SET last_test_ok = $1, last_test_message = $2, last_tested_at = now()
          WHERE kind = 'openversion'`,
        [result.ok, result.message],
      );
    }
    return result;
  };
  app.post('/api/admin/integrations/openversion/test', testRoute);

  app.delete('/api/admin/integrations/openversion', async (request): Promise<{ ok: true }> => {
    serverAdmin(request);
    if (fromEnv) {
      throw new HttpError(
        409,
        'The server’s configuration sets this. Remove OPENANNOUNCE_OPENVERSION_URL to disconnect it here.',
      );
    }
    await pool.query("DELETE FROM server_integrations WHERE kind = 'openversion'");
    return { ok: true };
  });

  /** Public values only, so the web app can load its OpenVersion client. Never a secret. */
  app.get('/api/client-config', async (): Promise<{ openversion: { url: string; publicKey: string } | null }> => {
    if (fromEnv) return { openversion: fromEnv };
    const row = await loadRow();
    return { openversion: row ? { url: row.url, publicKey: row.public_key } : null };
  });
}
