import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The logic is tested in packages/contracts/test/connection-string.test.ts; these check the page.
const systems = () =>
  readFileSync(new URL('../../web/src/app/pages/systems.ts', import.meta.url), 'utf8');

describe('getting a connection string', () => {
  it('UC-6/S1 offers one with a new system’s secret, in the secret dialog', () => {
    expect(systems()).toContain(
      'connection: connectionFor(created, this.origin(), { signingSecret: created.signingSecret })',
    );
  });

  it('UC-6/S2 offers a new one on replacing the secret, and says old backends stop working', () => {
    const page = systems();
    expect(page).toContain(
      'connection: connectionFor(rotated, this.origin(), { signingSecret: rotated.signingSecret })',
    );
    expect(page).toContain('Backends using the old secret stop working until they get this one.');
  });

  it('UC-6/S3 gives one without the secret, and warns wherever it mentions replacing the secret', () => {
    const page = systems();
    expect(page).toContain('Get a connection string');
    expect(page).toContain('connectionFor(s, this.origin())');
    expect(page).toContain('backends using the old secret stop working until they get the new one');
  });

  it('UC-6/S5 offers one with a new publish key', () => {
    expect(systems()).toContain(
      'connection: connectionFor(made, this.origin(), { publishKey: made.publishKey })',
    );
  });
});
