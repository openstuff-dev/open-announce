import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
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
    const pool = { query: () => Promise.resolve({ rows: [] }) } as unknown as Pool;
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
