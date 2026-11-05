import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ensureFirstAdmin } from '../src/bootstrap.js';
import type { Pool } from '../src/db.js';
import { loadConfig } from '../src/config.js';

describe('settings', () => {
  it('starts with defaults when no variables are set', () => {
    expect(loadConfig({})).toMatchObject({
      port: 8080,
      host: '0.0.0.0',
      publicUrl: 'http://localhost:8080',
      adminEmail: 'admin@example.com',
      adminPassword: undefined,
      sessionDays: 30,
      feedMaxAge: 60,
      trustProxy: false,
      demo: false,
    });
  });

  it('reads the variables', () => {
    const config = loadConfig({
      OPENANNOUNCE_PUBLIC_URL: 'https://announce.example.com/',
      OPENANNOUNCE_ADMIN_EMAIL: 'Me@Example.com',
      OPENANNOUNCE_TRUST_PROXY: 'true',
      OPENANNOUNCE_DEMO: 'on',
    });
    expect(config).toMatchObject({
      publicUrl: 'https://announce.example.com',
      adminEmail: 'me@example.com',
      trustProxy: true,
      demo: true,
    });
  });
});

describe('first admin', () => {
  it('says where to change the password that it logs once', async () => {
    const warn = vi.fn();
    const pool = {
      query: vi.fn(() => Promise.resolve({ rows: [{ any: false }] })),
    } as unknown as Pool;
    const log = { warn, info: vi.fn() } as unknown as FastifyBaseLogger;
    await ensureFirstAdmin(pool, loadConfig({}), log);
    expect(warn.mock.calls[0]?.[0]).toContain('change it under Settings');
    expect(warn.mock.calls[0]?.[0]).not.toContain('top bar');
  });
});
