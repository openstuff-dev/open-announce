import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
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

describe('a file that is missing', () => {
  it('answers 404, not the web app, and unknown pages still get the web app', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'web-'));
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>app</title>');
    // The vault's upsert always returns its row, so the fake answers the same way.
    const pool = {
      query: () => Promise.resolve({ rows: [{ value: 'test-secret-key', inserted: false }] }),
    } as unknown as Pool;
    const app = await buildApp({ ...loadConfig({}), webDir, logLevel: 'silent' }, pool);
    try {
      const chunk = await app.inject({ url: '/chunk-missing.js?v=1' });
      expect(chunk.statusCode).toBe(404);
      expect(chunk.headers['content-type']).toContain('application/json');
      const page = await app.inject({ url: '/settings' });
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toContain('text/html');
    } finally {
      await app.close();
      rmSync(webDir, { recursive: true, force: true });
    }
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

describe('version', () => {
  it('reads the release the image was built from, or unknown for a local build', () => {
    expect(loadConfig({ VERSION: ' 1.4.0 ' }).appVersion).toBe('1.4.0');
    expect(loadConfig({}).appVersion).toBe('unknown');
  });
});
