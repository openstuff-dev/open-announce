import { parseConnectionString } from '@openstuff-dev/server/connection-string';
import { describe, expect, it } from 'vitest';
import { connectionFor } from '../src/index.js';

const system = (allowedOrigins: string[] = []) => ({ publicKey: 'pk_sys_1234', allowedOrigins });
const URL = 'https://announce.example.com';

describe('connection strings', () => {
  it('UC-6/S1 UC-6/S2 hold the address, the public key and the signing secret', () => {
    const { value, instructions } = connectionFor(system(), URL, { signingSecret: 'sec_1' });
    expect(parseConnectionString(value, 'openannounce')).toEqual({
      url: URL,
      publicKey: 'pk_sys_1234',
      signingSecret: 'sec_1',
    });
    expect(instructions).toContain('Settings › Integrations, on the OpenAnnounce card');
  });

  it('UC-6/S3 holds no secret without one, and says it only shows messages for everyone', () => {
    const { value, instructions } = connectionFor(system(), URL);
    expect(parseConnectionString(value, 'openannounce')).toEqual({ url: URL, publicKey: 'pk_sys_1234' });
    expect(instructions).toContain('It holds no secret, so that app shows only messages for everyone.');
    expect(instructions).not.toMatch(/replace/i);
  });

  it('UC-6/S4 says the other app’s address must be in Allowed origins, or the list empty', () => {
    const note = 'Add that app’s address to this system’s Allowed origins, or leave the list empty';
    const listed = system(['https://shop.example.com']);
    expect(connectionFor(listed, URL).instructions).toContain(note);
    expect(connectionFor(listed, URL, { signingSecret: 's' }).instructions).toContain(note);
    expect(connectionFor(system(), URL).instructions).not.toContain(note);
  });

  it('UC-6/S5 holds a publish key in the form OpenVersion’s publish key field reads', () => {
    const { value, instructions } = connectionFor(system(), URL, { publishKey: 'ak_publish_1' });
    expect(parseConnectionString(value, 'openannounce')).toEqual({
      url: URL,
      publicKey: 'pk_sys_1234',
      publishKey: 'ak_publish_1',
    });
    expect(instructions).toContain('OpenVersion’s publish key field');
  });
});
