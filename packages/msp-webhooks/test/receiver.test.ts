import { describe, expect, it, vi } from 'vitest';
import { MemoryReplayCache, WebhookReceiver } from '../src/index.js';
import { createFetchWebhookHandler } from '../src/adapters/fetch.js';
import { createLambdaWebhookHandler } from '../src/adapters/lambda.js';
import { createExpressWebhookHandler } from '../src/adapters/express.js';
import { buildDelivery, makeSecret, messageReceivedEvent } from './helpers.js';

const SECRET = makeSecret(1);

describe('WebhookReceiver', () => {
  it('dispatches to the handler for the event type', async () => {
    const onMessage = vi.fn();
    const onInvitation = vi.fn();
    const receiver = new WebhookReceiver({
      secret: SECRET,
      on: { 'message.received': onMessage, 'messaging_invitation.updated': onInvitation },
    });

    const result = await receiver.handle(await buildDelivery({ secret: SECRET }));

    expect(result.status).toBe(200);
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage.mock.calls[0]![1]).toMatchObject({ id: messageReceivedEvent.eventId });
    expect(onInvitation).not.toHaveBeenCalled();
  });

  it('answers 400 when verification fails, and reports the reason', async () => {
    const onError = vi.fn();
    const receiver = new WebhookReceiver({ secret: SECRET, onError });

    const result = await receiver.handle(await buildDelivery({ secret: makeSecret(2) }));

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ ok: false, code: 'invalid_signature' });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('answers 500 when a handler throws, so the platform retries', async () => {
    const receiver = new WebhookReceiver({
      secret: SECRET,
      on: {
        'message.received': () => {
          throw new Error('queue is down');
        },
      },
    });

    const result = await receiver.handle(await buildDelivery({ secret: SECRET }));

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ ok: false, error: 'queue is down' });
  });

  it('acknowledges a duplicate with 200 and does not run handlers twice', async () => {
    const onMessage = vi.fn();
    const receiver = new WebhookReceiver({
      secret: SECRET,
      replayCache: new MemoryReplayCache(),
      on: { 'message.received': onMessage },
    });
    const delivery = await buildDelivery({ secret: SECRET });

    const first = await receiver.handle(delivery);
    const second = await receiver.handle(delivery);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(onMessage).toHaveBeenCalledOnce();
  });

  it('routes an event type it has no handler for to onUnhandledEvent', async () => {
    const onUnhandledEvent = vi.fn();
    const receiver = new WebhookReceiver({ secret: SECRET, onUnhandledEvent });

    const result = await receiver.handle(await buildDelivery({ secret: SECRET }));

    expect(result.status).toBe(200);
    expect(onUnhandledEvent).toHaveBeenCalledOnce();
  });

  it('calls onEvent for every verified event', async () => {
    const onEvent = vi.fn();
    const receiver = new WebhookReceiver({ secret: SECRET, onEvent });

    await receiver.handle(await buildDelivery({ secret: SECRET }));

    expect(onEvent).toHaveBeenCalledOnce();
  });
});

describe('fetch adapter', () => {
  it('verifies a Request and answers with JSON', async () => {
    const onMessage = vi.fn();
    const handler = createFetchWebhookHandler({
      secret: SECRET,
      on: { 'message.received': onMessage },
    });
    const delivery = await buildDelivery({ secret: SECRET });

    const response = await handler(
      new Request('https://example.com/webhooks/1440', {
        method: 'POST',
        headers: delivery.headers,
        body: delivery.body,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(onMessage).toHaveBeenCalledOnce();
  });

  it('answers 400 on a forged signature', async () => {
    const handler = createFetchWebhookHandler({ secret: SECRET });
    const delivery = await buildDelivery({ secret: makeSecret(7) });

    const response = await handler(
      new Request('https://example.com/webhooks/1440', {
        method: 'POST',
        headers: delivery.headers,
        body: delivery.body,
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe('lambda adapter', () => {
  it('handles a plain-text body', async () => {
    const handler = createLambdaWebhookHandler({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });

    const result = await handler({ headers: delivery.headers, body: delivery.body });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ ok: true });
  });

  it('decodes a base64 body before hashing it', async () => {
    const handler = createLambdaWebhookHandler({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(delivery.body)));

    const result = await handler({
      headers: delivery.headers,
      body: encoded,
      isBase64Encoded: true,
    });

    expect(result.statusCode).toBe(200);
  });
});

describe('express adapter', () => {
  function mockResponse() {
    const state: { status?: number; body?: unknown } = {};
    const res = {
      status(code: number) {
        state.status = code;
        return res;
      },
      json(body: unknown) {
        state.body = body;
        return body;
      },
    };
    return { res, state };
  }

  it('verifies a Buffer body left by express.raw()', async () => {
    const handler = createExpressWebhookHandler({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });
    const { res, state } = mockResponse();

    await handler(
      { headers: delivery.headers, body: Buffer.from(delivery.body) },
      res,
      (error) => {
        throw error;
      },
    );

    expect(state.status).toBe(200);
    expect(state.body).toEqual({ ok: true });
  });

  it('reads the raw stream when no parser has run', async () => {
    const handler = createExpressWebhookHandler({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });
    const { res, state } = mockResponse();
    const req = {
      headers: delivery.headers,
      async *[Symbol.asyncIterator]() {
        // Two chunks, to prove reassembly is byte-exact.
        yield new TextEncoder().encode(delivery.body.slice(0, 10));
        yield new TextEncoder().encode(delivery.body.slice(10));
      },
    };

    await handler(req, res, (error) => {
      throw error;
    });

    expect(state.status).toBe(200);
  });

  it('fails loudly when a JSON parser already consumed the body', async () => {
    const handler = createExpressWebhookHandler({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });
    const { res } = mockResponse();
    const next = vi.fn();

    await handler(
      { headers: delivery.headers, body: JSON.parse(delivery.body) as object },
      res,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(String(next.mock.calls[0]![0])).toContain('raw bytes');
  });
});
