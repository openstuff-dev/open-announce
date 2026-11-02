/** The settings in openannounce.config.js. */
export interface OpenAnnounceConfig {
  /** Where OpenAnnounce runs, e.g. https://announce.example.com. */
  url: string;
  /** The system's public key (pk_…). It's safe in the browser. */
  publicKey: string;
  /**
   * Who is signed in: a token your backend made with `signUser` from
   * `@openstuff-dev/announce/server`. Without one, users only see messages meant for everyone.
   */
  user?: string | (() => string | null | undefined | Promise<string | null | undefined>);
  /** How long a fetched feed is used before asking again, in seconds. Default 60. */
  cacheTtl?: number;
  /** How often an open page checks for new messages, in seconds. 0 turns it off. Default 300. */
  refreshInterval?: number;
  /** Where dismissals and the cache are kept. Default `localStorage`. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

/** Gives openannounce.config.js its types. Returns the config unchanged. */
export function defineConfig(config: OpenAnnounceConfig): OpenAnnounceConfig {
  return config;
}

let current: OpenAnnounceConfig | undefined;
const waiting: ((config: OpenAnnounceConfig) => void)[] = [];

/** Sets the config every OpenAnnounce element on the page uses. Call it once, early. */
export function configure(config: OpenAnnounceConfig): void {
  current = config;
  for (const resolve of waiting.splice(0)) resolve(config);
}

/** The config from `configure`, once it's been called. */
export function whenConfigured(): Promise<OpenAnnounceConfig> {
  return current ? Promise.resolve(current) : new Promise((resolve) => waiting.push(resolve));
}

/** For tests. */
export function resetConfig(): void {
  current = undefined;
}
