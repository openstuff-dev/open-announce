/**
 * For your backend: sign who is signed in, so the browser can't claim someone else's groups.
 * Uses Web Crypto, so it runs in Node 20+, Deno, Bun and edge runtimes.
 *
 * ```ts
 * import { signUser } from '@openstuff-dev/announce/server';
 * const token = await signUser(process.env.OPENANNOUNCE_SECRET, {
 *   sub: user.id,
 *   groups: ['finance'],
 * });
 * ```
 */

export interface UserClaims {
  /** The user's id in your system. Admins can put users into groups by this id. */
  sub: string;
  /**
   * Group slugs the user is in. Leave it out to use the groups an admin gave this user in
   * OpenAnnounce.
   */
  groups?: string[];
  /** When the token stops working, in seconds since the epoch. Default: in 12 hours. */
  exp?: number;
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function key(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    usage,
  ]);
}

/** A token for `X-OpenAnnounce-User`, signed with the system's secret (sk_…). */
export async function signUser(secret: string, claims: UserClaims): Promise<string> {
  if (!secret) throw new Error('signUser needs the system secret (sk_…).');
  if (!claims.sub) throw new Error('signUser needs a sub: the user id in your system.');
  const exp = claims.exp ?? Math.floor(Date.now() / 1000) + 12 * 3600;
  const payload = base64url(encoder.encode(JSON.stringify({ ...claims, exp })));
  const signature = await crypto.subtle.sign('HMAC', await key(secret, 'sign'), encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

export type VerifyResult =
  | { ok: true; claims: UserClaims & { exp: number } } |
  { ok: false; error: string };

/** Checks a token from `signUser`. The comparison takes the same time whatever the input. */
export async function verifyUser(
  secret: string,
  token: string,
  now = Date.now(),
): Promise<VerifyResult> {
  const parts = token.split('.');
  const [payload, signature] = parts;
  if (parts.length !== 2 || !payload || !signature) {
    return { ok: false, error: 'The user token is malformed.' };
  }
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await key(secret, 'verify'),
      fromBase64url(signature),
      encoder.encode(payload),
    );
  } catch {
    return { ok: false, error: 'The user token is malformed.' };
  }
  if (!valid) return { ok: false, error: 'The user token has a wrong signature.' };
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
  } catch {
    return { ok: false, error: 'The user token is malformed.' };
  }
  if (!isClaims(claims)) return { ok: false, error: 'The user token is malformed.' };
  if (claims.exp * 1000 <= now) return { ok: false, error: 'The user token has expired.' };
  return { ok: true, claims };
}

function isClaims(value: unknown): value is UserClaims & { exp: number } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sub === 'string' &&
    v.sub.length > 0 &&
    typeof v.exp === 'number' &&
    (v.groups === undefined || (Array.isArray(v.groups) && v.groups.every((g) => typeof g === 'string')))
  );
}
