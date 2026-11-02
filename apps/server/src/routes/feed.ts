import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { verifyUser } from '@openstuff-dev/announce/server';
import type { Config } from '../config.js';
import { type Pool, scopeSql, withScope } from '../db.js';

interface FeedSystem {
  id: string;
  tenantId: string;
  signingSecret: string;
  allowedOrigins: string[];
}

/**
 * Systems by public key, for 30 seconds: the feed is the busiest route and the key lookup is
 * the same every time. Any change to a system clears it.
 */
const systems = new Map<string, { system: FeedSystem | null; until: number }>();
export function forgetSystems(): void {
  systems.clear();
}

async function systemByKey(pool: Pool, key: string): Promise<FeedSystem | null> {
  const hit = systems.get(key);
  if (hit && hit.until > Date.now()) return hit.system;
  const system = await withScope(pool, { bypass: true }, async (db) => {
    const { rows } = await db.query<FeedSystem>(
      `SELECT id, tenant_id AS "tenantId", signing_secret AS "signingSecret", allowed_origins AS "allowedOrigins"
         FROM systems WHERE public_key = $1`,
      [key],
    );
    return rows.at(0) ?? null;
  });
  if (systems.size > 10_000) systems.clear();
  systems.set(key, { system, until: Date.now() + 30_000 });
  return system;
}

const ALLOWED_HEADERS = 'X-OpenAnnounce-Key, X-OpenAnnounce-User, If-None-Match';

/** The feed for host systems: the published, current messages for one system and user. */
export function registerFeedRoutes(app: FastifyInstance, pool: Pool, config: Config): void {
  // A preflight carries no header values, so it can't know the system. It says yes; the GET
  // then only lets the system's own origins read the answer.
  app.options('/api/v1/feed', (request, reply) => {
    void reply
      .header('Access-Control-Allow-Origin', request.headers.origin ?? '*')
      .header('Access-Control-Allow-Methods', 'GET')
      .header('Access-Control-Allow-Headers', ALLOWED_HEADERS)
      .header('Access-Control-Max-Age', '600')
      .header('Vary', 'Origin')
      .code(204)
      .send();
  });

  app.get('/api/v1/feed', async (request, reply) => {
    const origin = request.headers.origin;
    void reply.header('Vary', 'Origin, X-OpenAnnounce-Key, X-OpenAnnounce-User');
    void reply.header('Access-Control-Expose-Headers', 'ETag');
    const fail = (status: number, error: string) => {
      void reply.header('Access-Control-Allow-Origin', origin ?? '*');
      return reply.code(status).send({ error });
    };

    const key = header(request, 'x-openannounce-key');
    if (!key) return fail(401, 'Send the system’s public key in X-OpenAnnounce-Key.');
    const system = await systemByKey(pool, key);
    if (!system) return fail(401, 'That public key doesn’t belong to any system.');
    if (origin && system.allowedOrigins.length > 0 && !system.allowedOrigins.includes(origin)) {
      return fail(403, `${origin} isn’t one of this system’s allowed origins.`);
    }
    void reply.header('Access-Control-Allow-Origin', origin ?? '*');

    let sub: string | null = null;
    let groups: string[] | null = null;
    const token = header(request, 'x-openannounce-user');
    if (token) {
      const result = await verifyUser(system.signingSecret, token);
      if (!result.ok) return fail(401, result.error);
      sub = result.claims.sub;
      groups = result.claims.groups ?? null;
    }

    const body = await feedJson(pool, system, sub, groups);
    const etag = `W/"${createHash('sha1').update(body).digest('base64url')}"`;
    void reply.header('ETag', etag).header('Cache-Control', `private, max-age=${config.feedMaxAge}`);
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type('application/json; charset=utf-8').send(body);
  });
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

/**
 * The feed as JSON text, in one round trip: the transaction, the tenant scope and the query go
 * together, so values are inlined as escaped literals instead of parameters.
 *
 * - No groups in the token and a `sub`: the groups an admin gave that user.
 * - Groups in the token: exactly those.
 * - No token: only messages for everyone.
 */
async function feedJson(
  pool: Pool,
  system: FeedSystem,
  sub: string | null,
  groups: string[] | null,
): Promise<string> {
  const client = await pool.connect();
  try {
    const lit = (v: string) => client.escapeLiteral(v);
    const groupArray = `ARRAY[${(groups ?? []).slice(0, 100).map(lit).join(',')}]::text[]`;
    const stored = groups === null && sub !== null;
    const results = (await client.query<{ feed: string }>(`BEGIN READ ONLY; ${scopeSql(client, { tenantId: system.tenantId })};
      SELECT json_build_object('messages', coalesce(json_agg(json_build_object(
          'id', m.id, 'kind', m.kind, 'display', m.display, 'severity', m.severity,
          'title', m.title, 'body', m.body, 'closeable', m.closeable,
          'link', CASE WHEN m.link_url IS NULL THEN NULL
                  ELSE json_build_object('url', m.link_url, 'label', coalesce(m.link_label, '')) END,
          'startsAt', m.starts_at, 'endsAt', m.ends_at, 'updatedAt', m.updated_at)
        ORDER BY m.kind, coalesce(m.starts_at, m.updated_at) DESC, m.id), '[]'))::text AS feed
      FROM messages m
      WHERE m.status = 'published'
        AND (m.starts_at IS NULL OR m.starts_at <= now())
        AND (m.ends_at IS NULL OR m.ends_at > now())
        AND (NOT EXISTS (SELECT 1 FROM message_systems s WHERE s.message_id = m.id)
             OR EXISTS (SELECT 1 FROM message_systems s WHERE s.message_id = m.id AND s.system_id = ${lit(system.id)}))
        AND (NOT EXISTS (SELECT 1 FROM message_groups mg WHERE mg.message_id = m.id)
             OR EXISTS (SELECT 1 FROM message_groups mg JOIN groups g ON g.id = mg.group_id
                         WHERE mg.message_id = m.id
                           AND (g.slug = ANY(${groupArray})
                                OR (${stored ? 'true' : 'false'} AND EXISTS (
                                  SELECT 1 FROM user_groups ug JOIN end_users u ON u.id = ug.user_id
                                   WHERE ug.group_id = g.id AND u.external_id = ${lit(sub ?? '')})))));
      COMMIT;`)) as unknown as pg.QueryResult<{ feed: string }>[];
    // Results: BEGIN, the scope, the feed, COMMIT.
    return results[2].rows[0].feed;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
