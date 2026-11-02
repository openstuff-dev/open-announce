import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EndUser, Group } from '@open-announce/contracts';
import { tenantAccess } from '../auth.js';
import { type Client, type Pool, withScope } from '../db.js';
import { notFound } from '../errors.js';
import { idParam, name, slug, slugify, tenantParam, uuid } from './shared.js';

/** Groups and the users in them: who sees which messages. */
export function registerAudienceRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/t/:tenant/groups', async (request): Promise<{ groups: Group[]; users: EndUser[] }> => {
    const { tenant } = tenantParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    return withScope(pool, { tenantId }, async (db) => {
      // Both lists in one round trip: the page shows them side by side.
      const { rows } = await db.query<{ groups: Group[] | null; users: EndUser[] | null }>(
        `SELECT
          (SELECT json_agg(json_build_object('id', g.id, 'slug', g.slug, 'name', g.name,
             'userCount', (SELECT count(*) FROM user_groups ug WHERE ug.group_id = g.id)) ORDER BY g.name)
             FROM groups g) AS groups,
          (SELECT json_agg(json_build_object('id', u.id, 'externalId', u.external_id, 'name', u.name,
             'groupIds', coalesce((SELECT json_agg(ug.group_id) FROM user_groups ug WHERE ug.user_id = u.id), '[]'))
             ORDER BY u.external_id) FROM end_users u) AS users`,
      );
      return { groups: rows[0]?.groups ?? [], users: rows[0]?.users ?? [] };
    });
  });

  app.post('/api/t/:tenant/groups', async (request, reply): Promise<Group> => {
    const { tenant } = tenantParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    const body = z.object({ name, slug: slug.optional() }).parse(request.body);
    const group = await withScope(pool, { tenantId }, async (db) => {
      const { rows } = await db.query<Group>(
        `INSERT INTO groups (tenant_id, slug, name) VALUES ($1, $2, $3)
         RETURNING id, slug, name, 0 AS "userCount"`,
        [tenantId, body.slug ?? slugify(body.name), body.name],
      );
      return rows[0];
    });
    void reply.code(201);
    return group;
  });

  app.patch('/api/t/:tenant/groups/:id', async (request): Promise<{ ok: true }> => {
    const { tenant, id } = idParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    const body = z.object({ name }).parse(request.body);
    const result = await withScope(pool, { tenantId }, (db) =>
      db.query('UPDATE groups SET name = $2 WHERE id = $1', [id, body.name]),
    );
    if (!result.rowCount) throw notFound('That group');
    return { ok: true };
  });

  app.delete('/api/t/:tenant/groups/:id', async (request): Promise<{ ok: true }> => {
    const { tenant, id } = idParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    await withScope(pool, { tenantId }, (db) => db.query('DELETE FROM groups WHERE id = $1', [id]));
    return { ok: true };
  });

  const userBody = z.object({
    externalId: z.string().trim().min(1, 'Give the user’s id in your system.').max(200),
    name: z.string().trim().max(120).default(''),
    groupIds: z.array(uuid).max(200).default([]),
  });

  app.post('/api/t/:tenant/users', async (request, reply): Promise<EndUser> => {
    const { tenant } = tenantParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    const body = userBody.parse(request.body);
    const user = await withScope(pool, { tenantId }, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        'INSERT INTO end_users (tenant_id, external_id, name) VALUES ($1, $2, $3) RETURNING id',
        [tenantId, body.externalId, body.name],
      );
      const id = rows[0].id;
      const groupIds = await setGroups(db, tenantId, id, body.groupIds);
      return { id, externalId: body.externalId, name: body.name, groupIds };
    });
    void reply.code(201);
    return user;
  });

  app.patch('/api/t/:tenant/users/:id', async (request): Promise<EndUser> => {
    const { tenant, id } = idParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    const body = userBody.parse(request.body);
    return withScope(pool, { tenantId }, async (db) => {
      const result = await db.query('UPDATE end_users SET external_id = $2, name = $3 WHERE id = $1', [
        id,
        body.externalId,
        body.name,
      ]);
      if (!result.rowCount) throw notFound('That user');
      const groupIds = await setGroups(db, tenantId, id, body.groupIds);
      return { id, externalId: body.externalId, name: body.name, groupIds };
    });
  });

  app.delete('/api/t/:tenant/users/:id', async (request): Promise<{ ok: true }> => {
    const { tenant, id } = idParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    await withScope(pool, { tenantId }, (db) => db.query('DELETE FROM end_users WHERE id = $1', [id]));
    return { ok: true };
  });
}

/**
 * Replaces a user's groups. Only groups this tenant can see are kept: foreign keys skip
 * row-level security, so an id from another tenant would otherwise be stored.
 */
async function setGroups(
  db: Client,
  tenantId: string,
  userId: string,
  groupIds: string[],
): Promise<string[]> {
  const { rows } = await db.query<{ group_id: string }>(
    `WITH gone AS (DELETE FROM user_groups WHERE user_id = $2)
     INSERT INTO user_groups (tenant_id, user_id, group_id)
     SELECT $1, $2, g.id FROM groups g WHERE g.id = ANY($3::uuid[])
     RETURNING group_id`,
    [tenantId, userId, groupIds],
  );
  return rows.map((r) => r.group_id);
}
