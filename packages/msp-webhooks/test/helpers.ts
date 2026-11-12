/** Sign a body exactly the way the platform does, for use in tests. */
export async function signDelivery(options: {
  id: string;
  timestamp: number;
  body: string;
  secret: string;
}): Promise<string> {
  const encoded = options.secret.replace(/^whsec_/, '');
  const keyBytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = new TextEncoder().encode(`${options.id}.${options.timestamp}.${options.body}`);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, signed));
  return `v1,${btoa(String.fromCharCode(...mac))}`;
}

/** A `whsec_`-prefixed secret with `bytes` of key material. */
export function makeSecret(seed = 1, bytes = 32): string {
  const key = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i += 1) key[i] = (i * 7 + seed) % 256;
  return `whsec_${btoa(String.fromCharCode(...key))}`;
}

export const messageReceivedEvent = {
  eventId: '0196f1f8-4a2b-7a31-8f5c-0d9e7b6a1234',
  v: 1,
  type: 'message.received',
  organizationId: 'org_123',
  conversationId: '0196f1f8-4a2b-7a31-8f5c-0d9e7b6a5678',
  channelAddress: 'urn:mbid:AQAAY',
  intentId: null,
  groupId: null,
  locale: 'en-US',
  capabilityList: null,
  message: {
    id: '0196f1f8-4a2b-7a31-8f5c-0d9e7b6a9012',
    channel: 'amb',
    externalId: 'urn:mbid:AQAAY',
    createdAt: '2026-07-20T14:30:00.000Z',
    attachments: [],
    actor: { type: 'customer' },
    redacted: false,
    content: { kind: 'text', body: 'Hello, I need help with my order.' },
  },
} as const;

/** Build headers + body for a signed delivery of `event`. */
export async function buildDelivery(options: {
  event?: unknown;
  secret: string;
  id?: string;
  timestampSeconds?: number;
}): Promise<{ headers: Record<string, string>; body: string }> {
  const id = options.id ?? messageReceivedEvent.eventId;
  const timestamp = options.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const body = JSON.stringify(options.event ?? messageReceivedEvent);
  const signature = await signDelivery({ id, timestamp, body, secret: options.secret });
  return {
    headers: {
      'Webhook-Id': id,
      'Webhook-Timestamp': String(timestamp),
      'Webhook-Signature': signature,
      'content-type': 'application/json',
    },
    body,
  };
}
