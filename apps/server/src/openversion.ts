import type { FastifyBaseLogger } from 'fastify';
import {
  type FetchPolicy,
  FetchRefused,
  safeFetch,
  type SafeResponse,
} from '@openstuff-dev/server';

/** A connection problem, shown as is. `retry` says whether trying again may help. */
export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
  }
}

function serverSays(response: SafeResponse): string {
  try {
    const error = (JSON.parse(response.body) as { error?: unknown }).error;
    if (typeof error === 'string' && error) return error;
  } catch {
    // Not JSON: fall back to the status.
  }
  return `it answered ${response.status}`;
}

/**
 * Checks an OpenVersion environment's public key against its version API, without changing
 * anything. The API answers 401 for an unknown key and 403 for an origin the environment doesn't
 * allow, so the answer says what to change. `origin` is this server's own address, which the
 * environment must list under allowed origins.
 */
export async function checkOpenVersion(
  policy: FetchPolicy,
  url: string,
  publicKey: string,
  origin: string,
): Promise<string> {
  let response: SafeResponse;
  try {
    response = await safeFetch(
      `${url.replace(/\/$/, '')}/api/v1/version?key=${encodeURIComponent(publicKey)}`,
      policy,
      { headers: { origin, accept: 'application/json', 'user-agent': 'OpenAnnounce' } },
    );
  } catch (err) {
    if (err instanceof FetchRefused) throw new ConnectionError(err.message, false);
    throw new ConnectionError('That address didn’t answer. Check the URL and that OpenVersion is running.', true);
  }
  if (response.status === 200 || response.status === 304) return 'Connected to OpenVersion.';
  if (response.status === 401) {
    throw new ConnectionError(`OpenVersion doesn’t recognise this public key: ${serverSays(response)}`, false);
  }
  if (response.status === 403) {
    throw new ConnectionError(
      `Add ${origin} to allowed origins in OpenVersion, on the environment’s page, then test again.`,
      false,
    );
  }
  if (response.status === 404) {
    throw new ConnectionError(`${url} doesn’t look like an OpenVersion with the version API. Check the URL.`, false);
  }
  if (response.status === 429) {
    throw new ConnectionError('OpenVersion is checking too often. Try again in a minute.', true);
  }
  throw new ConnectionError(`OpenVersion said: ${serverSays(response)}`, response.status >= 500);
}

/** Checks a deploy token by reading the live release. Only a token that may publish passes. */
export async function checkDeployToken(
  policy: FetchPolicy,
  url: string,
  deployToken: string,
): Promise<string> {
  let response: SafeResponse;
  try {
    response = await safeFetch(`${url.replace(/\/$/, '')}/api/v1/releases/live`, policy, {
      headers: {
        authorization: `Bearer ${deployToken}`,
        accept: 'application/json',
        'user-agent': 'OpenAnnounce',
      },
    });
  } catch (err) {
    if (err instanceof FetchRefused) throw new ConnectionError(err.message, false);
    throw new ConnectionError('That address didn’t answer. Check the URL and that OpenVersion is running.', true);
  }
  if (response.status === 200) return 'The deploy token works, so this server can publish its version.';
  if (response.status === 401 || response.status === 403) {
    throw new ConnectionError('OpenVersion doesn’t recognise this deploy token.', false);
  }
  throw new ConnectionError(`OpenVersion said: ${serverSays(response)}`, response.status >= 500);
}

export type PublishOutcome = 'skipped' | 'published' | 'not-newer' | 'refused' | 'failed';

/**
 * Publishes this image's version to OpenVersion when the server starts, so open tabs learn about it
 * with no CI step. The version is the idempotency key, so replicas starting together publish once.
 * OpenVersion refuses a version that isn't higher than the live one: that answer is fine and
 * leaves what's live alone, so starting an older image never rolls anything back. Never throws.
 */
export async function publishOwnVersion(
  policy: FetchPolicy,
  connection: { url: string; deployToken: string },
  version: string,
  log: FastifyBaseLogger,
): Promise<PublishOutcome> {
  // A local build has no release version, and OpenVersion would refuse it anyway.
  if (version === 'unknown') return 'skipped';
  try {
    const response = await safeFetch(`${connection.url.replace(/\/$/, '')}/api/v1/releases`, policy, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${connection.deployToken}`,
        'content-type': 'application/json',
        'idempotency-key': `openannounce-${version}`,
        'user-agent': 'openannounce-server',
      },
      body: JSON.stringify({ version, notes: '' }),
      timeout: 10_000,
    });
    if (response.status === 201) {
      log.info({ version }, 'Published this version to OpenVersion.');
      return 'published';
    }
    if (response.status === 409) {
      log.info({ version }, 'OpenVersion already has this version or a newer one live.');
      return 'not-newer';
    }
    if (response.status === 401 || response.status === 403) {
      log.warn('OpenVersion refused the deploy token, so this version was not published.');
      return 'refused';
    }
    log.warn({ status: response.status }, 'OpenVersion did not accept this version.');
    return 'failed';
  } catch (error) {
    log.warn({ err: (error as Error).message }, 'Could not reach OpenVersion to publish.');
    return 'failed';
  }
}

/**
 * The connection the server publishes with on start: the environment's, else the saved one. A saved
 * token that can't be read (for example after the secret key changed) is skipped, not an error.
 */
export async function connectionFor(
  pool: {
    query: (sql: string) => Promise<{
      rows: { url: string; deploy_token_sealed: string | null }[];
    }>;
  },
  config: { openVersion: { url: string | undefined; deployToken: string | undefined } },
  vault: { open: (sealed: string) => string },
): Promise<{ url: string; deployToken: string } | null> {
  if (config.openVersion.url && config.openVersion.deployToken) {
    return { url: config.openVersion.url, deployToken: config.openVersion.deployToken };
  }
  const { rows } = await pool.query(
    `SELECT url, deploy_token_sealed FROM server_integrations WHERE kind = 'openversion'`,
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  if (!row.deploy_token_sealed) return null;
  try {
    return { url: row.url, deployToken: vault.open(row.deploy_token_sealed) };
  } catch {
    return null;
  }
}
