import { describe, expect, it } from 'vitest';
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
