import { describe, expect, it } from 'vitest';
import {
  MemoryReplayCache,
  WebhookVerificationError,
  WebhookVerifier,
  isMessageReceived,
  verifyWebhook,
} from '../src/index.js';
import { buildDelivery, makeSecret, messageReceivedEvent, signDelivery } from './helpers.js';

const SECRET = makeSecret(1);

describe('WebhookVerifier', () => {
  it('accepts a correctly signed delivery and narrows the event', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });

    const { event, id } = await verifier.verify(delivery);

    expect(id).toBe(messageReceivedEvent.eventId);
    expect(isMessageReceived(event)).toBe(true);
    if (isMessageReceived(event)) {
      expect(event.message.content).toMatchObject({ kind: 'text', body: expect.any(String) });
    }
  });

  it('works with a Headers object as well as a plain record', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });

    const result = await verifier.verify({
      headers: new Headers(delivery.headers),
      body: delivery.body,
    });

    expect(result.event.type).toBe('message.received');
  });

  it('accepts raw bytes, matching what a stream hands you', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });

    const result = await verifier.verify({
      headers: delivery.headers,
      body: new TextEncoder().encode(delivery.body),
    });

    expect(result.event.type).toBe('message.received');
  });

  it('rejects a body that was re-serialized rather than passed through raw', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });
    // Same data, different byte order — exactly what a JSON body parser causes.
    const reserialized = JSON.stringify({ type: 'message.received', ...messageReceivedEvent });

    await expect(
      verifier.verify({ headers: delivery.headers, body: reserialized }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('rejects a signature made with a different secret', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const delivery = await buildDelivery({ secret: makeSecret(2) });

    await expect(verifier.verify(delivery)).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it.each([
    ['Webhook-Id'],
    ['Webhook-Timestamp'],
    ['Webhook-Signature'],
  ])('rejects a delivery missing %s', async (header) => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });
    delete delivery.headers[header];

    await expect(verifier.verify(delivery)).rejects.toMatchObject({ code: 'missing_headers' });
  });

  it('rejects a non-numeric timestamp', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });
    delivery.headers['Webhook-Timestamp'] = '2026-07-20T14:30:00Z';

    await expect(verifier.verify(delivery)).rejects.toMatchObject({ code: 'malformed_timestamp' });
  });

  it('rejects a delivery older than the tolerance', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const delivery = await buildDelivery({
      secret: SECRET,
      timestampSeconds: Math.floor(Date.now() / 1000) - 301,
    });

    await expect(verifier.verify(delivery)).rejects.toMatchObject({ code: 'stale_timestamp' });
  });

  it('rejects a delivery too far in the future', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const delivery = await buildDelivery({
      secret: SECRET,
      timestampSeconds: Math.floor(Date.now() / 1000) + 400,
    });

    await expect(verifier.verify(delivery)).rejects.toMatchObject({ code: 'stale_timestamp' });
  });

  it('honours a widened tolerance', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET, toleranceSeconds: 3600 });
    const delivery = await buildDelivery({
      secret: SECRET,
      timestampSeconds: Math.floor(Date.now() / 1000) - 600,
    });

    await expect(verifier.verify(delivery)).resolves.toMatchObject({ id: messageReceivedEvent.eventId });
  });

  it('accepts either secret during a rotation', async () => {
    const oldSecret = makeSecret(3);
    const newSecret = makeSecret(4);
    const verifier = new WebhookVerifier({ secret: [oldSecret, newSecret] });

    for (const secret of [oldSecret, newSecret]) {
      const delivery = await buildDelivery({ secret });
      await expect(verifier.verify(delivery)).resolves.toBeTruthy();
    }
  });

  it('accepts a header carrying several space-delimited tokens', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });
    const stale = await signDelivery({
      id: messageReceivedEvent.eventId,
      timestamp: Number(delivery.headers['Webhook-Timestamp']),
      body: delivery.body,
      secret: makeSecret(9),
    });
    delivery.headers['Webhook-Signature'] = `${stale} ${delivery.headers['Webhook-Signature']}`;

    await expect(verifier.verify(delivery)).resolves.toBeTruthy();
  });

  it('ignores tokens from an unknown scheme version', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });
    delivery.headers['Webhook-Signature'] = `v2,bm90LWEtdjEtc2ln ${delivery.headers['Webhook-Signature']}`;

    await expect(verifier.verify(delivery)).resolves.toBeTruthy();
  });

  it('rejects a header with no usable token', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const delivery = await buildDelivery({ secret: SECRET });
    delivery.headers['Webhook-Signature'] = 'v2,bm90LWEtdjEtc2ln';

    await expect(verifier.verify(delivery)).rejects.toMatchObject({
      code: 'invalid_signature_header',
    });
  });

  it('rejects a correctly signed body that is not JSON', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET });
    const id = messageReceivedEvent.eventId;
    const timestamp = Math.floor(Date.now() / 1000);
    const body = 'not json';
    const signature = await signDelivery({ id, timestamp, body, secret: SECRET });

    await expect(
      verifier.verify({
        headers: {
          'webhook-id': id,
          'webhook-timestamp': String(timestamp),
          'webhook-signature': signature,
        },
        body,
      }),
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('rejects a malformed secret', () => {
    expect(() => new WebhookVerifier({ secret: '' })).toThrow(WebhookVerificationError);
  });

  it('flags a replayed delivery as a duplicate', async () => {
    const verifier = new WebhookVerifier({ secret: SECRET, replayCache: new MemoryReplayCache() });
    const delivery = await buildDelivery({ secret: SECRET });

    await expect(verifier.verify(delivery)).resolves.toBeTruthy();
    await expect(verifier.verify(delivery)).rejects.toMatchObject({ code: 'duplicate' });
  });

  it('does not record an id that failed verification', async () => {
    const cache = new MemoryReplayCache();
    const verifier = new WebhookVerifier({ secret: SECRET, replayCache: cache });
    const forged = await buildDelivery({ secret: makeSecret(5) });

    await expect(verifier.verify(forged)).rejects.toMatchObject({ code: 'invalid_signature' });
    expect(cache.size).toBe(0);
  });

  it('uses an injected clock', async () => {
    const timestamp = 1_800_000_000;
    const verifier = new WebhookVerifier({ secret: SECRET, now: () => timestamp * 1000 });
    const delivery = await buildDelivery({ secret: SECRET, timestampSeconds: timestamp });

    await expect(verifier.verify(delivery)).resolves.toMatchObject({ timestamp });
  });
});

describe('verifyWebhook', () => {
  it('verifies in one call', async () => {
    const delivery = await buildDelivery({ secret: SECRET });

    const { event } = await verifyWebhook({ ...delivery, secret: SECRET });

    expect(event.type).toBe('message.received');
  });
});

describe('MemoryReplayCache', () => {
  it('forgets entries once their TTL passes', async () => {
    const cache = new MemoryReplayCache({ ttlMs: 1 });

    expect(cache.seen('a')).toBe(false);
    expect(cache.seen('a')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cache.seen('a')).toBe(false);
  });

  it('stays under its entry cap', () => {
    const cache = new MemoryReplayCache({ maxEntries: 10 });
    for (let i = 0; i < 100; i += 1) cache.seen(`id-${i}`);
    expect(cache.size).toBeLessThanOrEqual(10);
  });
});
