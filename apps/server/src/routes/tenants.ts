import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Member, NewMember, Role, Tenant } from '@open-announce/contracts';
import { hashPassword, newPassword, requireAccount, tenantAccess } from '../auth.js';
import type { Pool } from '../db.js';
import { HttpError } from '../errors.js';
import { name, slug, slugify, tenantParam, uuid } from './shared.js';

const role = z.enum(['admin', 'developer']);

export function registerTenantRoutes(app: FastifyInstance, pool: Pool): void {
  const serverAdmin = (request: Parameters<typeof requireAccount>[0]) => {
    const account = requireAccount(request);
    if (!account.isServerAdmin) throw new HttpError(403, 'Only a server admin can manage tenants.');
    return account;
  };

  app.get('/api/tenants', async (request): Promise<Tenant[]> => {
    serverAdmin(request);
    const { rows } = await pool.query<Tenant>(
      'SELECT id, slug, name, created_at AS "createdAt" FROM tenants ORDER BY name',
    );
    return rows;
  });

  app.post('/api/tenants', async (request, reply): Promise<Tenant> => {
    serverAdmin(request);
    const body = z.object({ name, slug: slug.optional() }).parse(request.body);
    const { rows } = await pool.query<Tenant>(
      `INSERT INTO tenants (slug, name) VALUES ($1, $2)
       RETURNING id, slug, name, created_at AS "createdAt"`,
      [body.slug ?? slugify(body.name), body.name],
    );
    void reply.code(201);
    return rows[0];
  });

  app.patch('/api/t/:tenant', async (request): Promise<{ ok: true }> => {
    const { tenant } = tenantParam.parse(request.params);
    const access = await tenantAccess(pool, request, tenant, ['admin']);
    const body = z.object({ name }).parse(request.body);
    await pool.query('UPDATE tenants SET name = $2 WHERE id = $1', [access.tenantId, body.name]);
    return { ok: true };
  });

  app.delete('/api/t/:tenant', async (request): Promise<{ ok: true }> => {
    serverAdmin(request);
    const { tenant } = tenantParam.parse(request.params);
    await pool.query('DELETE FROM tenants WHERE slug = $1', [tenant]);
    return { ok: true };
  });

  // Members --------------------------------------------------------------------------------

  app.get('/api/t/:tenant/members', async (request): Promise<Member[]> => {
    const { tenant } = tenantParam.parse(request.params);
    const access = await tenantAccess(pool, request, tenant, ['admin']);
    const { rows } = await pool.query<Member>(
      `SELECT a.id AS "accountId", a.email, a.name, m.role
         FROM memberships m JOIN accounts a ON a.id = m.account_id
        WHERE m.tenant_id = $1 ORDER BY a.name, a.email`,
      [access.tenantId],
    );
    return rows;
  });

  /** Adds someone by email. A new account gets a password, shown this once. */
  app.post('/api/t/:tenant/members', async (request, reply): Promise<NewMember> => {
    const { tenant } = tenantParam.parse(request.params);
    const access = await tenantAccess(pool, request, tenant, ['admin']);
    const body = z
      .object({ email: z.email().max(200), name: z.string().trim().max(120).default(''), role })
      .parse(request.body);
    const email = body.email.toLowerCase();
    const password = newPassword();
    const created = await pool.query<{ id: string; name: string; created: boolean }>(
      `INSERT INTO accounts (email, name, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, name, (xmax = 0) AS created`,
      [email, body.name, await hashPassword(password)],
    );
    const account = created.rows[0];
    const inserted = await pool.query(
      `INSERT INTO memberships (tenant_id, account_id, role) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [access.tenantId, account.id, body.role],
    );
    if (!inserted.rowCount) throw new HttpError(409, `${email} is already a member.`);
    void reply.code(201);
    return {
      accountId: account.id,
      email,
      name: account.name,
      role: body.role,
      password: account.created ? password : null,
    };
  });

  app.patch('/api/t/:tenant/members/:accountId', async (request): Promise<{ ok: true }> => {
    const params = z.object({ tenant: slug, accountId: uuid }).parse(request.params);
    const access = await tenantAccess(pool, request, params.tenant, ['admin']);
    // Nobody changes their own role: an admin can't lock the tenant out by accident, and
    // nobody can raise their own rights.
    if (params.accountId === access.account.id) {
      throw new HttpError(403, 'You can’t change your own role. Ask another admin.');
    }
    const body = z.object({ role }).parse(request.body);
    const result = await pool.query(
      'UPDATE memberships SET role = $3 WHERE tenant_id = $1 AND account_id = $2',
      [access.tenantId, params.accountId, body.role satisfies Role],
    );
    if (!result.rowCount) throw new HttpError(404, 'That member wasn’t found.');
    return { ok: true };
  });

  app.delete('/api/t/:tenant/members/:accountId', async (request): Promise<{ ok: true }> => {
    const params = z.object({ tenant: slug, accountId: uuid }).parse(request.params);
    const access = await tenantAccess(pool, request, params.tenant, ['admin']);
    if (params.accountId === access.account.id) {
      throw new HttpError(403, 'You can’t remove yourself. Ask another admin.');
    }
    await pool.query('DELETE FROM memberships WHERE tenant_id = $1 AND account_id = $2', [
      access.tenantId,
      params.accountId,
    ]);
    return { ok: true };
  });
}
