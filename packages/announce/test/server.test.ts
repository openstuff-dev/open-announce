import { describe, expect, it } from 'vitest';
import { signUser, verifyUser } from '../src/server/index.js';

const secret = 'sk_test_secret';

describe('signUser and verifyUser', () => {
  it('round-trips the claims', async () => {
    const token = await signUser(secret, { sub: 'u1', groups: ['finance'] });
    const result = await verifyUser(secret, token);
    expect(result).toMatchObject({ ok: true, claims: { sub: 'u1', groups: ['finance'] } });
  });

  it('rejects another system’s secret and edited claims', async () => {
    const token = await signUser(secret, { sub: 'u1', groups: ['staff'] });
    expect(await verifyUser('sk_other', token)).toEqual({ ok: false, error: 'The user token has a wrong signature.' });
    const [, signature] = token.split('.');
    const forged = `${btoa(JSON.stringify({ sub: 'u1', groups: ['admins'], exp: 9999999999 })).replace(/=+$/, '')}.${signature}`;
    expect(await verifyUser(secret, forged)).toMatchObject({ ok: false });
  });

  it('rejects expired and malformed tokens', async () => {
    const token = await signUser(secret, { sub: 'u1', exp: 1000 });
    expect(await verifyUser(secret, token)).toEqual({ ok: false, error: 'The user token has expired.' });
    expect(await verifyUser(secret, 'nope')).toEqual({ ok: false, error: 'The user token is malformed.' });
    expect(await verifyUser(secret, 'a.b.c')).toEqual({ ok: false, error: 'The user token is malformed.' });
    expect(await verifyUser(secret, '%%%.%%%')).toEqual({ ok: false, error: 'The user token is malformed.' });
  });
});
