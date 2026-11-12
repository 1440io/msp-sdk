import { describe, expect, it, vi } from 'vitest';
import {
  MspClient,
  MspNotFoundError,
  MspRateLimitError,
  MspValidationError,
  isMspApiError,
} from '../src/index.js';
import { stubFetch } from './helpers.js';

function client(responses: Parameters<typeof stubFetch>[0], options = {}) {
  const stub = stubFetch(responses);
  return {
    ...stub,
    client: new MspClient({ token: 'jwt', fetch: stub.fetch, ...options }),
  };
}

describe('request building', () => {
  it('serializes query parameters and drops undefined ones', async () => {
    const { client: c, requests } = client([{ body: { conversations: [], nextCursor: null } }]);

    await c.conversations.list({ count: 50, status: 'active', platform: undefined });

    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe('/api/v0/conversations');
    expect(url.searchParams.get('count')).toBe('50');
    expect(url.searchParams.get('status')).toBe('active');
    expect(url.searchParams.has('platform')).toBe(false);
  });

  it('encodes path parameters', async () => {
    const { client: c, requests } = client([{ body: { messages: [] } }]);

    await c.conversations.get('with/slash');

    expect(new URL(requests[0]!.url).pathname).toBe('/api/v0/conversations/with%2Fslash');
  });
});

describe('error mapping', () => {
  it('maps status codes onto typed errors and keeps the envelope', async () => {
    const { client: c } = client([
      { status: 404, body: { error: 'Conversation not found for this business' } },
    ]);

    const error = await c.conversations.get('missing').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MspNotFoundError);
    expect(isMspApiError(error) && error.status).toBe(404);
    expect(isMspApiError(error) && error.message).toContain(
      'Conversation not found for this business',
    );
  });

  it('surfaces the machine-readable code and rich reasons', async () => {
    const { client: c } = client([
      {
        status: 422,
        body: {
          error: 'capability_not_supported: form messages are unsupported here',
          code: 'capability_not_supported',
          reasons: [{ code: 'capability_not_supported', message: 'Device did not advertise forms' }],
        },
      },
    ]);

    const error = await c.messaging
      .sendText({ conversationId: 'c1', body: 'hi' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MspValidationError);
    expect(isMspApiError(error) && error.code).toBe('capability_not_supported');
    expect(isMspApiError(error) && error.reasons?.[0]?.code).toBe('capability_not_supported');
  });

  it('reads Retry-After off a 429', async () => {
    const { client: c } = client(
      [{ status: 429, body: { error: 'Slow down' }, headers: { 'retry-after': '2' } }],
      { retry: { maxRetries: 0 } },
    );

    const error = await c.channels.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MspRateLimitError);
    expect((error as MspRateLimitError).retryAfterMs).toBe(2000);
  });
});

describe('retries', () => {
  it('retries a GET through a 500 and returns the eventual success', async () => {
    const { client: c, requests } = client(
      [
        { status: 500, body: { error: 'boom' } },
        { body: { channels: [{ id: 'c1', platform: 'amb', externalId: 'x' }] } },
      ],
      { retry: { maxRetries: 2, initialDelayMs: 1 } },
    );

    const channels = await c.channels.list();

    expect(requests).toHaveLength(2);
    expect(channels).toHaveLength(1);
  });

  it('gives up after maxRetries', async () => {
    const { client: c, requests } = client(
      [
        { status: 503, body: { error: 'unavailable' } },
        { status: 503, body: { error: 'unavailable' } },
      ],
      { retry: { maxRetries: 1, initialDelayMs: 1 } },
    );

    await expect(c.channels.list()).rejects.toMatchObject({ status: 503 });
    expect(requests).toHaveLength(2);
  });

  it('does not retry a 4xx', async () => {
    const { client: c, requests } = client([{ status: 400, body: { error: 'bad' } }], {
      retry: { maxRetries: 3, initialDelayMs: 1 },
    });

    await expect(c.channels.list()).rejects.toBeInstanceOf(MspValidationError);
    expect(requests).toHaveLength(1);
  });

  it('retries a send, because requestMessageId makes it idempotent', async () => {
    const { client: c, requests } = client(
      [
        { status: 502, body: { error: 'channel unavailable' } },
        { body: { messageId: 'm1', channelMessageId: null, duplicate: false } },
      ],
      { retry: { maxRetries: 2, initialDelayMs: 1 } },
    );

    const result = await c.messaging.sendText({ conversationId: 'c1', body: 'hi' });

    expect(result.messageId).toBe('m1');
    // The retry must reuse the same idempotency key, or it would double-send.
    const first = JSON.parse(requests[0]!.body!) as { requestMessageId: string };
    const second = JSON.parse(requests[1]!.body!) as { requestMessageId: string };
    expect(second.requestMessageId).toBe(first.requestMessageId);
  });
});

describe('hooks', () => {
  it('reports every attempt to onRequest and onResponse', async () => {
    const onRequest = vi.fn();
    const onResponse = vi.fn();
    const { client: c } = client(
      [{ status: 500, body: { error: 'boom' } }, { body: { channels: [] } }],
      { retry: { maxRetries: 1, initialDelayMs: 1 }, onRequest, onResponse },
    );

    await c.channels.list();

    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(onResponse).toHaveBeenCalledTimes(2);
    expect(onResponse.mock.calls[0]![0]).toMatchObject({ status: 500, attempt: 1 });
    expect(onResponse.mock.calls[1]![0]).toMatchObject({ status: 200, attempt: 2 });
  });
});
