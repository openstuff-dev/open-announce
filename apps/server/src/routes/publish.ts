import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PublishedMessage, SystemWithPublishKey } from '@open-announce/contracts';
import { sha256, tenantAccess } from '../auth.js';
import { type Client, type Pool, withScope } from '../db.js';
import { HttpError, notFound } from '../errors.js';
import { saveMessage } from './messages.js';
import { idParam, newPublishKey, slug } from './shared.js';

interface Publisher {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  systemId: string;
  systemSlug: string;
  systemName: string;
}

const publishBody = z.object({
  title: z.string().trim().min(1, 'Give the message a title.').max(200),
  body: z.string().max(10000, 'Keep the text under 10,000 characters.').default(''),
  groups: z.array(slug).max(50).default([]),
  publishAt: z.iso.datetime({ offset: true }).optional(),
  link: z
    .object({ url: z.url({ protocol: /^https?$/ }), label: z.string().trim().max(80).optional() })
    .optional(),
});

/** The system a publish key (`Authorization: Bearer ak_…`) belongs to, or a 401. */
async function publisher(pool: Pool, request: FastifyRequest): Promise<Publisher> {
  const match = /^Bearer\s+(ak_[\w-]{20,100})$/i.exec(request.headers.authorization ?? '');
  if (!match) {
    throw new HttpError(401, 'Send the system’s publish key as Authorization: Bearer ak_….');
  }
  const { rows } = await withScope(pool, { bypass: true }, (db) =>
    db.query<Publisher>(
      `SELECT t.id AS "tenantId", t.slug AS "tenantSlug", t.name AS "tenantName",
              s.id AS "systemId", s.slug AS "systemSlug", s.name AS "systemName"
         FROM systems s JOIN tenants t ON t.id = s.tenant_id WHERE s.publish_key_hash = $1`,
      [sha256(match[1])],
    ),
  );
  const found = rows.at(0);
  if (!found) {
    throw new HttpError(401, 'That publish key isn’t valid. An admin can make a new one on the system’s page.');
  }
  return found;
}

async function published(db: Client, messageId: string, system: string): Promise<PublishedMessage> {
  const { rows } = await db.query<PublishedMessage>(
    `SELECT m.id, 'news' AS kind, m.title, m.starts_at AS "startsAt", $2::text AS system,
            coalesce((SELECT json_agg(g.slug ORDER BY g.slug) FROM message_groups mg
                       JOIN groups g ON g.id = mg.group_id WHERE mg.message_id = m.id), '[]') AS groups
       FROM messages m WHERE m.id = $1`,
    [messageId, system],
  );
  const row = rows.at(0);
  if (!row) throw new HttpError(410, 'The message posted with this Idempotency-Key was deleted.');
  return row;
}

/**
 * The publish API: another system (OpenVersion, a CI job) posts News to one system with that
 * system's publish key. Each Idempotency-Key posts once, ever, so retries are safe.
 */
export function registerPublishRoutes(app: FastifyInstance, pool: Pool): void {
  /** Makes or replaces the publish key. The old one stops working at once. Shown this once. */
  app.post('/api/t/:tenant/systems/:id/publish-key', async (request): Promise<SystemWithPublishKey> => {
    const { tenant, id } = idParam.parse(request.params);
    // A publish key publishes messages, so only admins hand one out.
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    const key = newPublishKey();
    const row = await withScope(pool, { tenantId }, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        'UPDATE systems SET publish_key_hash = $2, publish_key_last4 = $3 WHERE id = $1 RETURNING id',
        [id, sha256(key), key.slice(-4)],
      );
      if (!rows.at(0)) throw notFound('That system');
      const { rows: systems } = await db.query<SystemWithPublishKey>(
        `SELECT id, slug, name, public_key AS "publicKey", left(signing_secret, 7) || '…' AS "secretHint",
                allowed_origins AS "allowedOrigins", created_at AS "createdAt",
                'ak_••••' || publish_key_last4 AS "publishKeyHint", $2::text AS "publishKey"
           FROM systems WHERE id = $1`,
        [id, key],
      );
      return systems[0];
    });
    return row;
  });

  /** Revokes the publish key: posts with it get a 401 from now on. */
  app.delete('/api/t/:tenant/systems/:id/publish-key', async (request): Promise<{ ok: true }> => {
    const { tenant, id } = idParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    const result = await withScope(pool, { tenantId }, (db) =>
      db.query('UPDATE systems SET publish_key_hash = NULL, publish_key_last4 = NULL WHERE id = $1', [id]),
    );
    if (!result.rowCount) throw notFound('That system');
    return { ok: true };
  });

  /** Which system a publish key posts to. Cheap: other systems use it to test the key. */
  app.get('/api/v1/publish-key', async (request) => {
    const p = await publisher(pool, request);
    return {
      tenant: { slug: p.tenantSlug, name: p.tenantName },
      system: { slug: p.systemSlug, name: p.systemName },
    };
  });

  /** Posts a News message to the key's system. Needs an Idempotency-Key. */
  app.post('/api/v1/messages', async (request, reply): Promise<PublishedMessage> => {
    const p = await publisher(pool, request);
    const header = request.headers['idempotency-key'];
    const key = typeof header === 'string' ? header.trim() : '';
    if (!key || key.length > 200) {
      throw new HttpError(400, 'Send an Idempotency-Key header (up to 200 characters), e.g. the id of what you’re announcing, so a retry never posts twice.');
    }
    const input = publishBody.parse(request.body);
    const hash = sha256(JSON.stringify(input));
    return withScope(pool, { tenantId: p.tenantId }, async (db) => {
      // Claims the key first; a second request with it waits here until the first commits.
      const claim = await db.query<{ message_id: string | null; request_hash: string }>(
        `INSERT INTO publish_requests (tenant_id, system_id, idempotency_key, request_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (system_id, idempotency_key) DO NOTHING
         RETURNING message_id, request_hash`,
        [p.tenantId, p.systemId, key, hash],
      );
      if (!claim.rowCount) {
        const { rows } = await db.query<{ message_id: string | null; request_hash: string }>(
          'SELECT message_id, request_hash FROM publish_requests WHERE system_id = $1 AND idempotency_key = $2',
          [p.systemId, key],
        );
        const first = rows[0];
        if (first.request_hash !== hash) {
          throw new HttpError(422, 'This Idempotency-Key was already used for a different message. Use a new key.');
        }
        if (!first.message_id) throw new HttpError(410, 'The message posted with this Idempotency-Key was deleted.');
        void reply.header('Idempotent-Replayed', 'true');
        return published(db, first.message_id, p.systemSlug);
      }

      const groupIds: string[] = [];
      if (input.groups.length) {
        const { rows } = await db.query<{ id: string; slug: string }>(
          'SELECT id, slug FROM groups WHERE slug = ANY($1)',
          [input.groups],
        );
        const missing = input.groups.filter((g) => !rows.some((r) => r.slug === g));
        if (missing.length) {
          throw new HttpError(400, `There’s no group ${missing.join(', ')} in ${p.tenantName}. Leave groups out to post for everyone.`);
        }
        groupIds.push(...rows.map((r) => r.id));
      }
      const message = await saveMessage(db, p.tenantId, null, {
        kind: 'news',
        display: 'sidebar',
        severity: 'info',
        title: input.title,
        body: input.body,
        linkUrl: input.link?.url ?? null,
        linkLabel: input.link?.label ?? null,
        status: 'published',
        startsAt: input.publishAt ?? null,
        endsAt: null,
        systemIds: [p.systemId],
        groupIds,
      });
      await db.query(
        'UPDATE publish_requests SET message_id = $3 WHERE system_id = $1 AND idempotency_key = $2',
        [p.systemId, key, message.id],
      );
      void reply.code(201);
      return published(db, message.id, p.systemSlug);
    });
  });
}
