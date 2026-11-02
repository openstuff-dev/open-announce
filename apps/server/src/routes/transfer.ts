import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TenantExport } from '@open-announce/contracts';
import { tenantAccess } from '../auth.js';
import { type Pool, withScope } from '../db.js';
import { HttpError } from '../errors.js';
import { messageInput, saveMessage } from './messages.js';
import { name, newPublicKey, newSigningSecret, slug, tenantParam } from './shared.js';

const importFile = z.object({
  format: z.literal('openannounce-export'),
  version: z.literal(1),
  systems: z
    .array(z.object({ slug, name, allowedOrigins: z.array(z.string()).default([]) }))
    .max(500),
  groups: z.array(z.object({ slug, name })).max(5000),
  users: z
    .array(
      z.object({
        externalId: z.string().min(1).max(200),
        name: z.string().max(120),
        groups: z.array(slug),
      }),
    )
    .max(100_000),
  messages: z
    .array(
      z.object({
        systems: z.array(slug),
        groups: z.array(slug),
        createdAt: z.string(),
        updatedAt: z.string(),
      }).loose(),
    )
    .max(10_000),
});

/** Everything a tenant holds, as one JSON file, and back. People own their data. */
export function registerTransferRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/t/:tenant/export', async (request, reply): Promise<TenantExport> => {
    const { tenant } = tenantParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    const data = await withScope(pool, { tenantId }, async (db) => {
      const { rows } = await db.query<{ data: TenantExport }>(
        `SELECT json_build_object(
          'format', 'openannounce-export', 'version', 1, 'exportedAt', now(),
          'tenant', (SELECT json_build_object('slug', slug, 'name', name) FROM tenants WHERE id = $1),
          'systems', coalesce((SELECT json_agg(json_build_object('slug', slug, 'name', name,
             'allowedOrigins', allowed_origins) ORDER BY slug) FROM systems), '[]'),
          'groups', coalesce((SELECT json_agg(json_build_object('slug', slug, 'name', name) ORDER BY slug)
             FROM groups), '[]'),
          'users', coalesce((SELECT json_agg(json_build_object('externalId', u.external_id, 'name', u.name,
             'groups', coalesce((SELECT json_agg(g.slug ORDER BY g.slug) FROM user_groups ug
               JOIN groups g ON g.id = ug.group_id WHERE ug.user_id = u.id), '[]')) ORDER BY u.external_id)
             FROM end_users u), '[]'),
          'messages', coalesce((SELECT json_agg(json_build_object(
             'kind', m.kind, 'display', m.display, 'severity', m.severity, 'title', m.title, 'body', m.body,
             'closeable', m.closeable, 'linkUrl', m.link_url, 'linkLabel', m.link_label, 'status', m.status,
             'startsAt', m.starts_at, 'endsAt', m.ends_at, 'createdAt', m.created_at, 'updatedAt', m.updated_at,
             'systems', coalesce((SELECT json_agg(s.slug ORDER BY s.slug) FROM message_systems ms
               JOIN systems s ON s.id = ms.system_id WHERE ms.message_id = m.id), '[]'),
             'groups', coalesce((SELECT json_agg(g.slug ORDER BY g.slug) FROM message_groups mg
               JOIN groups g ON g.id = mg.group_id WHERE mg.message_id = m.id), '[]'))
             ORDER BY m.created_at) FROM messages m), '[]')
        ) AS data`,
        [tenantId],
      );
      return rows[0].data;
    });
    void reply.header('Content-Disposition', `attachment; filename="openannounce-${tenant}.json"`);
    return data;
  });

  /**
   * Adds what's in an export to this tenant. Systems, groups and users with a slug or id it
   * already has are updated; messages are always added. Imported systems get new keys.
   */
  app.post('/api/t/:tenant/import', { bodyLimit: 20 * 1024 * 1024 }, async (request) => {
    const { tenant } = tenantParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    const file = importFile.parse(request.body);
    return withScope(pool, { tenantId }, async (db) => {
      const ids = { systems: new Map<string, string>(), groups: new Map<string, string>() };
      for (const s of file.systems) {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO systems (tenant_id, slug, name, public_key, signing_secret, allowed_origins)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name, allowed_origins = EXCLUDED.allowed_origins
           RETURNING id`,
          [tenantId, s.slug, s.name, newPublicKey(), newSigningSecret(), s.allowedOrigins],
        );
        ids.systems.set(s.slug, rows[0].id);
      }
      for (const g of file.groups) {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO groups (tenant_id, slug, name) VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [tenantId, g.slug, g.name],
        );
        ids.groups.set(g.slug, rows[0].id);
      }
      // All users in one statement; the last entry wins when an id is listed twice.
      const users = [...new Map(file.users.map((u) => [u.externalId, u])).values()];
      if (users.length > 0) {
        await db.query(
          `WITH data AS (SELECT * FROM json_to_recordset($2::json) AS x("externalId" text, name text, groups text[])),
                u AS (INSERT INTO end_users (tenant_id, external_id, name)
                      SELECT $1, "externalId", name FROM data
                      ON CONFLICT (tenant_id, external_id) DO UPDATE SET name = EXCLUDED.name
                      RETURNING id, external_id)
           INSERT INTO user_groups (tenant_id, user_id, group_id)
           SELECT $1, u.id, g.id FROM data d JOIN u ON u.external_id = d."externalId"
             JOIN groups g ON g.slug = ANY(d.groups)
           ON CONFLICT DO NOTHING`,
          [tenantId, JSON.stringify(users)],
        );
      }
      for (const [i, m] of file.messages.entries()) {
        const parsed = messageInput.safeParse({
          ...m,
          systemIds: m.systems.map((s) => ids.systems.get(s)).filter(Boolean),
          groupIds: m.groups.map((g) => ids.groups.get(g)).filter(Boolean),
        });
        if (!parsed.success) {
          throw new HttpError(400, `Message ${i + 1}: ${parsed.error.issues.at(0)?.message ?? 'invalid'}`);
        }
        const times = { createdAt: m.createdAt, updatedAt: m.updatedAt };
        await saveMessage(db, tenantId, null, parsed.data, times);
      }
      return {
        systems: file.systems.length,
        groups: file.groups.length,
        users: file.users.length,
        messages: file.messages.length,
      };
    });
  });
}
