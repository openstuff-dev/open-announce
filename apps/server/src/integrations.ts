import { type ConnectionDetails, type IntegrationOffer, openVersion } from '@openstuff-dev/server';
import type { Config } from './config.js';

/**
 * The connections this server offers: OpenVersion only. The environment's values win when set,
 * and the card then shows read-only.
 */
export function integrationOffers(config: Config): IntegrationOffer[] {
  const { url, publicKey, deployToken } = config.openVersion;
  const environment: ConnectionDetails | null =
    url && publicKey ? { url, publicKey, ...(deployToken ? { deployToken } : {}) } : null;
  return [
    {
      kind: openVersion,
      signingSecret: false,
      deployToken: true,
      environment,
      envPrefix: 'OPENANNOUNCE_OPENVERSION',
    },
  ];
}
