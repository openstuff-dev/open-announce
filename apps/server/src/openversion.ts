import {
  type FetchPolicy,
  FetchRefused,
  safeFetch,
  type SafeResponse,
} from '@openstuff-dev/server';

/** A connection problem, shown as is. `retry` says whether trying again may help. */
export class ConnectionError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
  }
}

function serverSays(response: SafeResponse): string {
  try {
    const error = (JSON.parse(response.body) as { error?: unknown }).error;
    if (typeof error === 'string' && error) return error;
  } catch {
    // Not JSON: fall back to the status.
  }
  return `it answered ${response.status}`;
}

/**
 * Checks an OpenVersion environment's public key against its version API, without changing
 * anything. The API answers 401 for an unknown key and 403 for an origin the environment doesn't
 * allow, so the answer says what to change. `origin` is this server's own address, which the
 * environment must list under allowed origins.
 */
export async function checkOpenVersion(
  policy: FetchPolicy,
  url: string,
  publicKey: string,
  origin: string,
): Promise<string> {
  let response: SafeResponse;
  try {
    response = await safeFetch(
      `${url.replace(/\/$/, '')}/api/v1/version?key=${encodeURIComponent(publicKey)}`,
      policy,
      { headers: { origin, accept: 'application/json', 'user-agent': 'OpenAnnounce' } },
    );
  } catch (err) {
    if (err instanceof FetchRefused) throw new ConnectionError(err.message, false);
    throw new ConnectionError('That address didn’t answer. Check the URL and that OpenVersion is running.', true);
  }
  if (response.status === 200 || response.status === 304) return 'Connected to OpenVersion.';
  if (response.status === 401) {
    throw new ConnectionError(`OpenVersion doesn’t recognise this public key: ${serverSays(response)}`, false);
  }
  if (response.status === 403) {
    throw new ConnectionError(
      `Add ${origin} to allowed origins in OpenVersion, on the environment’s page, then test again.`,
      false,
    );
  }
  if (response.status === 404) {
    throw new ConnectionError(`${url} doesn’t look like an OpenVersion with the version API. Check the URL.`, false);
  }
  if (response.status === 429) {
    throw new ConnectionError('OpenVersion is checking too often. Try again in a minute.', true);
  }
  throw new ConnectionError(`OpenVersion said: ${serverSays(response)}`, response.status >= 500);
}
