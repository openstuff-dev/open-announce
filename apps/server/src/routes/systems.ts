import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { System, SystemWithSecret } from '@open-announce/contracts';
import { tenantAccess } from '../auth.js';
import { type Pool, withScope } from '../db.js';
import { notFound } from '../errors.js';
import { forgetSystems } from './feed.js';
import { idParam, name, newPublicKey, newSigningSecret, slug, slugify, tenantParam } from './shared.js';

const origin = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
    } catch {
      // Falls through to the issue below.
    }
    ctx.addIssue({ code: 'custom', message: `"${value}" isn’t an origin like https://app.example.com.` });
    return z.NEVER;
  });

const COLUMNS = `id, slug, name, public_key AS "publicKey", left(signing_secret, 7) || '…' AS "secretHint",
  allowed_origins AS "allowedOrigins", created_at AS "createdAt"`;

export function registerSystemRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/t/:tenant/systems', async (request): Promise<System[]> => {
    const { tenant } = tenantParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin', 'developer']);
    return withScope(pool, { tenantId }, async (db) => {
      const { rows } = await db.query<System>(`SELECT ${COLUMNS} FROM systems ORDER BY name`);
      return rows;
    });
  });

  // "Admins can create systems."
  app.post('/api/t/:tenant/systems', async (request, reply): Promise<SystemWithSecret> => {
    const { tenant } = tenantParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    const body = z
      .object({ name, slug: slug.optional(), allowedOrigins: z.array(origin).max(50).default([]) })
      .parse(request.body);
    const row = await withScope(pool, { tenantId }, async (db) => {
      const { rows } = await db.query<SystemWithSecret>(
        `INSERT INTO systems (tenant_id, slug, name, public_key, signing_secret, allowed_origins)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${COLUMNS}, signing_secret AS "signingSecret"`,
        [
          tenantId,
          body.slug ?? slugify(body.name),
          body.name,
          newPublicKey(),
          newSigningSecret(),
          body.allowedOrigins,
        ],
      );
      return rows[0];
    });
    void reply.code(201);
    return row;
  });

  // Developers set up systems: name and origins.
  app.patch('/api/t/:tenant/systems/:id', async (request): Promise<System> => {
    const { tenant, id } = idParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin', 'developer']);
    const body = z
      .object({ name: name.optional(), allowedOrigins: z.array(origin).max(50).optional() })
      .parse(request.body);
    const row = await withScope(pool, { tenantId }, async (db) => {
      const { rows } = await db.query<System>(
        `UPDATE systems SET name = coalesce($2, name), allowed_origins = coalesce($3, allowed_origins)
          WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, body.name ?? null, body.allowedOrigins ?? null],
      );
      return rows.at(0);
    });
    if (!row) throw notFound('That system');
    forgetSystems();
    return row;
  });

  /** A new secret (and, with `publicKey: true`, a new public key). The old ones stop working. */
  app.post('/api/t/:tenant/systems/:id/rotate', async (request): Promise<SystemWithSecret> => {
    const { tenant, id } = idParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin', 'developer']);
    const body = z.object({ publicKey: z.boolean().default(false) }).parse(request.body ?? {});
    const row = await withScope(pool, { tenantId }, async (db) => {
      const { rows } = await db.query<SystemWithSecret>(
        `UPDATE systems SET signing_secret = $2, public_key = coalesce($3, public_key)
          WHERE id = $1 RETURNING ${COLUMNS}, signing_secret AS "signingSecret"`,
        [id, newSigningSecret(), body.publicKey ? newPublicKey() : null],
      );
      return rows.at(0);
    });
    if (!row) throw notFound('That system');
    forgetSystems();
    return row;
  });

  app.delete('/api/t/:tenant/systems/:id', async (request): Promise<{ ok: true }> => {
    const { tenant, id } = idParam.parse(request.params);
    const { tenantId } = await tenantAccess(pool, request, tenant, ['admin']);
    await withScope(pool, { tenantId }, (db) => db.query('DELETE FROM systems WHERE id = $1', [id]));
    forgetSystems();
    return { ok: true };
  });
}
