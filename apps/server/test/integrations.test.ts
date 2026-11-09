import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { integrationOffers } from '../src/integrations.js';

describe('server connections from configuration', () => {
  it('offers OpenVersion only, and no connection until a variable sets one', () => {
    const offers = integrationOffers(loadConfig({}));
    expect(offers.map((offer) => offer.kind.kind)).toEqual(['openversion']);
    expect(offers[0].environment).toBeNull();
  });

  it('UC-5/S5 offers the environment connection, with its deploy token, so the card is read-only', () => {
    const [version] = integrationOffers(
      loadConfig({
        OPENANNOUNCE_OPENVERSION_URL: 'https://versions.example.com/',
        OPENANNOUNCE_OPENVERSION_PUBLIC_KEY: 'pk_live_example',
        OPENANNOUNCE_OPENVERSION_DEPLOY_TOKEN: 'ov_live_token',
      }),
    );
    expect(version.deployToken).toBe(true);
    expect(version.signingSecret).toBe(false);
    expect(version.envPrefix).toBe('OPENANNOUNCE_OPENVERSION');
    expect(version.environment).toEqual({
      url: 'https://versions.example.com',
      publicKey: 'pk_live_example',
      deployToken: 'ov_live_token',
    });
  });
});
