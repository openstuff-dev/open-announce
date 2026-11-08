import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyBaseLogger } from 'fastify';
import type { FetchPolicy } from '@openstuff-dev/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { checkDeployToken, ConnectionError, connectionFor, publishOwnVersion } from '../src/openversion.js';

// A stand-in OpenVersion on localhost. Localhost is internal, so the test policy allows it, as a
// self-hosted server with OPENANNOUNCE_FETCH=private would.
const policy: FetchPolicy = { mode: 'private', allow: ['127.0.0.1', 'localhost'], envPrefix: 'OPENANNOUNCE' };
const log = { info: () => undefined, warn: () => undefined } as unknown as FastifyBaseLogger;
const GOOD = 'ov_live_good_token';

interface Seen {
  method?: string;
  auth?: string;
  idempotency?: string;
  body?: string;
}
let seen: Seen[] = [];
let answerPublish = 201;
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      seen.push({
        method: request.method,
        auth: request.headers.authorization,
        idempotency: request.headers['idempotency-key'] as string | undefined,
        body,
      });
      if (request.headers.authorization !== `Bearer ${GOOD}`) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end('{"error":"nope"}');
        return;
      }
      if (request.method === 'POST') {
        response.writeHead(answerPublish, { 'content-type': 'application/json' });
        response.end('{}');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('null');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  seen = [];
  answerPublish = 201;
});

describe('publishing this server’s version to OpenVersion', () => {
  it('publishes a new version with the deploy token and a version key', async () => {
    const outcome = await publishOwnVersion(policy, { url: base, deployToken: GOOD }, '1.4.0', log);
    expect(outcome).toBe('published');
    expect(seen[0]).toMatchObject({
      method: 'POST',
      auth: `Bearer ${GOOD}`,
      idempotency: 'openannounce-1.4.0',
    });
    expect(JSON.parse(seen[0]?.body ?? '{}')).toEqual({ version: '1.4.0', notes: '' });
  });

  it('leaves an already-live version alone, without an error', async () => {
    answerPublish = 409;
    expect(await publishOwnVersion(policy, { url: base, deployToken: GOOD }, '1.4.0', log)).toBe('not-newer');
  });

  it('reports a refused deploy token without throwing', async () => {
    expect(await publishOwnVersion(policy, { url: base, deployToken: 'ov_live_bad' }, '1.4.0', log)).toBe('refused');
  });

  it('skips a local build that has no release version, and sends nothing', async () => {
    expect(await publishOwnVersion(policy, { url: base, deployToken: GOOD }, 'unknown', log)).toBe('skipped');
    expect(seen).toEqual([]);
  });

  it('checks a deploy token by reading the live release', async () => {
    await expect(checkDeployToken(policy, base, GOOD)).resolves.toContain('works');
    await expect(checkDeployToken(policy, base, 'ov_live_bad')).rejects.toBeInstanceOf(ConnectionError);
  });

  it('uses the environment’s URL and token when both are set, else the saved ones', async () => {
    const pool = {
      query: () =>
        Promise.resolve({ rows: [{ url: 'https://saved.example.com', deploy_token_sealed: null }] }),
    };
    const fromEnv = loadConfig({
      OPENANNOUNCE_OPENVERSION_URL: 'https://env.example.com/',
      OPENANNOUNCE_OPENVERSION_DEPLOY_TOKEN: GOOD,
    });
    expect(await connectionFor(pool, fromEnv, { open: () => '' })).toEqual({
      url: 'https://env.example.com',
      deployToken: GOOD,
    });
    const saved = loadConfig({});
    expect(await connectionFor(pool, saved, { open: () => '' })).toBeNull();
  });
});
