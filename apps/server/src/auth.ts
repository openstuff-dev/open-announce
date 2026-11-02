import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Me, Role } from '@open-announce/contracts';
import type { Config } from './config.js';
import type { Pool } from './db.js';
import { HttpError } from './errors.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;
export const SESSION_COOKIE = 'oa_session';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** A password people can type: four groups of letters and digits. */
export function newPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export interface Account {
  id: string;
  email: string;
  name: string;
  isServerAdmin: boolean;
}

export interface TenantAccess {
  tenantId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    account: Account | null;
  }
}

/** Wrong passwords per address and email in the last 15 minutes. */
const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 10;

const signIn = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) });

export function registerAuth(app: FastifyInstance, pool: Pool, config: Config): void {
  const secure = config.publicUrl.startsWith('https://');
  app.decorateRequest('account', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;
    const { rows } = await pool.query<Account>(
      `SELECT a.id, a.email, a.name, a.is_server_admin AS "isServerAdmin"
         FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [sha256(token)],
    );
    request.account = rows.at(0) ?? null;
  });

  // Session cookies are SameSite=Lax, so other sites can't send them with a POST. This also
  // refuses changes from pages on another origin, for browsers that don't do SameSite.
  const ownOrigin = new URL(config.publicUrl).origin;
  app.addHook('onRequest', (request, _reply, done) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || !request.url.startsWith('/api/')) {
      done();
      return;
    }
    const origin = request.headers.origin;
    if (request.url.startsWith('/api/v1/') || !origin) {
      done();
      return;
    }
    const host = request.headers.host;
    if (origin !== ownOrigin && origin !== `${request.protocol}://${host}`) {
      done(new HttpError(403, 'Changes must come from the OpenAnnounce app itself.'));
      return;
    }
    done();
  });

  app.post('/api/session', async (request, reply) => {
    const { email, password } = signIn.parse(request.body);
    const key = `${request.ip}|${email.toLowerCase()}`;
    const failed = failures.get(key);
    if (failed && failed.until > Date.now() && failed.count >= MAX_FAILURES) {
      throw new HttpError(429, 'Too many wrong passwords. Try again in 15 minutes.');
    }
    const { rows } = await pool.query<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM accounts WHERE email = $1',
      [email.toLowerCase()],
    );
    // Hash even for unknown emails, so the answer takes as long either way.
    const found = rows.at(0);
    const ok = await verifyPassword(password, found?.password_hash ?? DUMMY_HASH);
    if (!found || !ok) {
      const until = Date.now() + 15 * 60_000;
      const count = (failed && failed.until > Date.now() ? failed.count : 0) + 1;
      failures.set(key, { count, until });
      throw new HttpError(401, 'That email and password don’t match.');
    }
    failures.delete(key);
    const token = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO sessions (token_hash, account_id, expires_at)
       VALUES ($1, $2, now() + make_interval(days => $3))`,
      [sha256(token), found.id, config.sessionDays],
    );
    void reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: config.sessionDays * 86400,
    });
    return { ok: true };
  });

  app.delete('/api/session', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Changes your own password; your other sessions are signed out. */
  app.put('/api/me/password', async (request) => {
    const account = requireAccount(request);
    const body = z
      .object({
        current: z.string().min(1).max(200),
        next: z.string().min(10, 'Use at least 10 characters.').max(200),
      })
      .parse(request.body);
    const { rows } = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM accounts WHERE id = $1',
      [account.id],
    );
    const stored = rows.at(0)?.password_hash ?? DUMMY_HASH;
    if (!(await verifyPassword(body.current, stored))) {
      throw new HttpError(400, 'Your current password isn’t right.');
    }
    const token = request.cookies[SESSION_COOKIE] ?? '';
    await pool.query(
      'UPDATE accounts SET password_hash = $2 WHERE id = $1',
      [account.id, await hashPassword(body.next)],
    );
    await pool.query('DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $2', [
      account.id,
      sha256(token),
    ]);
    return { ok: true };
  });

  app.get('/api/me', async (request): Promise<Me> => {
    const account = requireAccount(request);
    const { rows } = await pool.query<Me['tenants'][number]>(
      account.isServerAdmin
        ? `SELECT t.slug, t.name, coalesce(m.role, 'admin') AS role FROM tenants t
             LEFT JOIN memberships m ON m.tenant_id = t.id AND m.account_id = $1 ORDER BY t.name`
        : `SELECT t.slug, t.name, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
            WHERE m.account_id = $1 ORDER BY t.name`,
      [account.id],
    );
    return { ...account, tenants: rows };
  });
}

const DUMMY_HASH = ['scrypt', Buffer.alloc(16).toString('base64'), Buffer.alloc(64).toString('base64')]
  .join('$');

export function requireAccount(request: FastifyRequest): Account {
  if (!request.account) throw new HttpError(401, 'Sign in first.');
  return request.account;
}

/**
 * What the signed-in account may do in a tenant. Server admins are admins everywhere. This is
 * the one place the API checks roles; every tenant route goes through it.
 */
export async function tenantAccess(
  pool: Pool,
  request: FastifyRequest,
  slug: string,
  allowed: readonly Role[],
): Promise<TenantAccess & { account: Account }> {
  const account = requireAccount(request);
  const { rows } = await pool.query<{ id: string; role: Role | null }>(
    `SELECT t.id, m.role FROM tenants t
       LEFT JOIN memberships m ON m.tenant_id = t.id AND m.account_id = $2
      WHERE t.slug = $1`,
    [slug, account.id],
  );
  const row = rows.at(0);
  const role: Role | null = row ? (account.isServerAdmin ? 'admin' : row.role) : null;
  if (!row || !role) throw new HttpError(404, 'That tenant wasn’t found.');
  if (!allowed.includes(role)) throw new HttpError(403, 'Only an admin of this tenant can do that.');
  return { tenantId: row.id, role, account };
}

/** For replies that set nothing else; keeps handlers short. */
export type Reply = FastifyReply;
