import type { FetchLike } from '../src/index.js';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface StubResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A fetch stub that replays queued responses and records what it was sent. */
export function stubFetch(responses: StubResponse[]): {
  fetch: FetchLike;
  requests: RecordedRequest[];
} {
  const queue = [...responses];
  const requests: RecordedRequest[] = [];

  const fetch: FetchLike = async (url, init) => {
    requests.push({
      url,
      method: init.method ?? 'GET',
      headers: normalizeHeaders(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
    });

    const next = queue.shift();
    if (!next) throw new Error(`stubFetch ran out of responses at request ${requests.length}`);

    const status = next.status ?? 200;
    const body = next.body === undefined ? '' : JSON.stringify(next.body);
    return new Response(body, {
      status,
      headers: { 'content-type': 'application/json', ...next.headers },
    });
  };

  return { fetch, requests };
}

/** A token-exchange response with an expiry `secondsFromNow` in the future. */
export function tokenResponse(token: string, secondsFromNow = 900): StubResponse {
  return {
    body: {
      type: 'api',
      tokenType: 'Bearer',
      token,
      expiresAt: new Date(Date.now() + secondsFromNow * 1000).toISOString(),
      grant: { tier: 'member', permissionKeys: ['SendMessages'] },
    },
  };
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}
