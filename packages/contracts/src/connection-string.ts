import { makeConnectionString } from '@openstuff-dev/server/connection-string';
import type { System } from './index.js';

/** A connection string with where to paste it, as `SecretDialog`'s `connection` takes it. */
export interface Connection {
  value: string;
  instructions: string;
}

/** What the string holds besides the address and the public key. */
export type ConnectionSecret =
  | { signingSecret: string } |
  { publishKey: string } |
  Record<string, never>;

/**
 * A system's connection string: this server's address (`url`, the page's origin in the web app),
 * the system's public key and at most one secret. With a secret, show it once.
 */
export function connectionFor(
  system: Pick<System, 'publicKey' | 'allowedOrigins'>,
  url: string,
  secret: ConnectionSecret = {},
): Connection {
  const value = makeConnectionString('openannounce', { url, publicKey: system.publicKey, ...secret });
  const origins = system.allowedOrigins.length
    ? ' Add that app’s address to this system’s Allowed origins, or leave the list empty, or it can’t read the messages.'
    : '';
  if ('publishKey' in secret) {
    return {
      value,
      instructions: `Paste it in OpenVersion’s publish key field: it fills in the address and the key.`,
    };
  }
  if ('signingSecret' in secret) {
    return {
      value,
      instructions: `To connect another OpenStuff app, paste this in its Settings › Integrations, on the OpenAnnounce card.${origins}`,
    };
  }
  return {
    value,
    instructions: `To connect another OpenStuff app, paste this in its Settings › Integrations, on the OpenAnnounce card. It holds no secret, so that app shows only messages for everyone. To aim messages at groups, enter the secret there too, under Enter details instead.${origins}`,
  };
}
