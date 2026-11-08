import type { FetchPolicy } from '@openstuff-dev/server';
/** Settings from environment variables. Each has a default, so the server starts without any. */
export interface Config {
  /** The release this image was built from, set by the image build. `unknown` for a local build. */
  appVersion: string;
  port: number;
  host: string;
  /** The built web app to serve next to the API, if any. */
  webDir: string | undefined;
  logLevel: string;
  databaseUrl: string;
  /** Where people reach OpenAnnounce. Used for cookies and the setup snippets. */
  publicUrl: string;
  /** The first admin's email and password. Without a password, one is made and logged once. */
  adminEmail: string;
  adminPassword: string | undefined;
  sessionDays: number;
  /** How long browsers and host systems may reuse a feed, in seconds. */
  feedMaxAge: number;
  /** Behind a reverse proxy: true, or the proxy's addresses. */
  trustProxy: boolean | string;
  /** Serve the demo host page at /demo. */
  demo: boolean;
  /** Where the built @openstuff-dev/announce is, for the demo page. */
  sdkDir: string | undefined;
  /**
   * A server-wide OpenVersion connection from the environment. When the URL and public key are
   * both set, they win over the one saved in the Integrations tab, which then shows read-only.
   */
  openVersion: { url: string | undefined; publicKey: string | undefined };
  /** Integrations fetch only public addresses unless this is `private`. */
  fetch: 'public' | 'private';
  fetchAllow: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const trust = env.OPENANNOUNCE_TRUST_PROXY ?? '';
  return {
    appVersion: env.VERSION?.trim() || 'unknown',
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    webDir: env.WEB_DIR || undefined,
    logLevel: env.LOG_LEVEL ?? 'info',
    databaseUrl: env.DATABASE_URL ?? 'postgres://openannounce:openannounce@localhost:5432/openannounce',
    publicUrl: (env.OPENANNOUNCE_PUBLIC_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
    adminEmail: (env.OPENANNOUNCE_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase(),
    adminPassword: env.OPENANNOUNCE_ADMIN_PASSWORD || undefined,
    sessionDays: Number(env.OPENANNOUNCE_SESSION_DAYS ?? 30),
    feedMaxAge: Number(env.OPENANNOUNCE_FEED_MAX_AGE ?? 60),
    trustProxy: trust === 'true' ? true : trust || false,
    demo: env.OPENANNOUNCE_DEMO === 'on',
    sdkDir: env.OPENANNOUNCE_SDK_DIR || undefined,
    openVersion: {
      url: env.OPENANNOUNCE_OPENVERSION_URL?.replace(/\/$/, '') || undefined,
      publicKey: env.OPENANNOUNCE_OPENVERSION_PUBLIC_KEY || undefined,
    },
    fetch: env.OPENANNOUNCE_FETCH === 'private' ? 'private' : 'public',
    fetchAllow: (env.OPENANNOUNCE_FETCH_ALLOW ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** The fetch policy integrations use, from OPENANNOUNCE_FETCH and OPENANNOUNCE_FETCH_ALLOW. */
export const policyFrom = (config: Config): FetchPolicy => ({
  mode: config.fetch,
  allow: config.fetchAllow,
  envPrefix: 'OPENANNOUNCE',
});
