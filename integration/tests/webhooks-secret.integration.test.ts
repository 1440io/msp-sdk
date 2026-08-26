import { expect, it } from 'vitest';
import { MemoryReplayCache, WebhookReceiver, WebhookVerifier } from '@1440io/msp-webhooks';
import { describeWebhookSecret } from '../gates.ts';
import { env } from '../env.ts';
import { assertMatchesSchema } from '../schema.ts';

/**
 * Sign a body exactly the way the platform does, using the real signing
 * secret. This is the only way to exercise the secret without inbound traffic:
 * if the secret's format, prefix handling, or base64 decoding were wrong, none
 * of these would verify.
 */
async function sign(id: string, timestamp: number, body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(atob(secret.replace(/^whsec_/, '')), (c) => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  );
  return `v1,${btoa(String.fromCharCode(...mac))}`;
}

const EVENT = {
  id: '0196f1f8-4a2b-7a31-8f5c-0d9e7b6a1234',
  type: 'message.received',
  specVersion: 1,
  dataVersion: '2026-07-20',
  occurredAt: '2026-07-20T14:30:00.000Z',
  organizationId: 'org_123',
  clientId: 'client_123',
  conversationId: '0196f1f8-4a2b-7a31-8f5c-0d9e7b6a5678',
  data: {
    message: {
      id: '0196f1f8-4a2b-7a31-8f5c-0d9e7b6a9012',
      conversationId: '0196f1f8-4a2b-7a31-8f5c-0d9e7b6a5678',
      channelPlatform: 'amb',
      messageType: 'text',
      content: { body: 'Hello, I need help with my order.' },
      timestamp: '2026-07-20T14:30:00.000Z',
      intentId: null,
      groupId: null,
      locale: 'en-US',
      richRequestIdentifier: null,
      attachments: [],
    },
  },
};

async function delivery(secret: string, overrides: { id?: string; timestamp?: number } = {}) {
  const id = overrides.id ?? EVENT.id;
  const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000);
  const body = JSON.stringify(EVENT);
  return {
    headers: {
      'Webhook-Id': id,
      'Webhook-Timestamp': String(timestamp),
      'Webhook-Signature': await sign(id, timestamp, body, secret),
    },
    body,
  };
}

describeWebhookSecret('webhooks: the real signing secret', () => {
  it('is in the documented whsec_ + base64 format', () => {
    const secret = env.webhookSecret!;

    expect(secret.startsWith('whsec_')).toBe(true);
    const decoded = atob(secret.slice('whsec_'.length));
    // Anything shorter than 16 bytes would be a weak HMAC key.
    expect(decoded.length).toBeGreaterThanOrEqual(16);
  });

  it('verifies a delivery signed with it', async () => {
    const verifier = new WebhookVerifier({ secret: env.webhookSecret! });

    const { event, id } = await verifier.verify(await delivery(env.webhookSecret!));

    expect(id).toBe(EVENT.id);
    expect(event.type).toBe('message.received');
    // The fixture must itself match the spec, or the test proves nothing.
    assertMatchesSchema('WebhookMessageReceivedEvent', event, 'signed fixture');
  });

  it('rejects a body altered after signing', async () => {
    const verifier = new WebhookVerifier({ secret: env.webhookSecret! });
    const signed = await delivery(env.webhookSecret!);

    const tampered = signed.body.replace('I need help', 'I need a refund');

    await expect(
      verifier.verify({ headers: signed.headers, body: tampered }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });
  });

  it('rejects a signature made with a different secret', async () => {
    const verifier = new WebhookVerifier({ secret: env.webhookSecret! });
    const otherSecret = `whsec_${btoa('x'.repeat(32))}`;

    await expect(verifier.verify(await delivery(otherSecret))).rejects.toMatchObject({
      code: 'invalid_signature',
    });
  });

  it('rejects a delivery outside the five-minute window', async () => {
    const verifier = new WebhookVerifier({ secret: env.webhookSecret! });

    await expect(
      verifier.verify(
        await delivery(env.webhookSecret!, { timestamp: Math.floor(Date.now() / 1000) - 301 }),
      ),
    ).rejects.toMatchObject({ code: 'stale_timestamp' });
  });

  it('accepts the real secret alongside a rotation partner', async () => {
    const partner = `whsec_${btoa('y'.repeat(32))}`;
    const verifier = new WebhookVerifier({ secret: [partner, env.webhookSecret!] });

    await expect(verifier.verify(await delivery(env.webhookSecret!))).resolves.toBeTruthy();
    await expect(verifier.verify(await delivery(partner))).resolves.toBeTruthy();
  });

  it('drives the receiver end to end, deduping a retry', async () => {
    const seen: string[] = [];
    const receiver = new WebhookReceiver({
      secret: env.webhookSecret!,
      replayCache: new MemoryReplayCache(),
      on: { 'message.received': (event, context) => void seen.push(context.id) },
    });
    const signed = await delivery(env.webhookSecret!);

    const first = await receiver.handle(signed);
    const retry = await receiver.handle(signed); // retries reuse the id

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(seen).toHaveLength(1);
  });
});
