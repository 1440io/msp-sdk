import { WebhookVerifier } from '@1440io/msp-webhooks';
import type { WebhookEvent } from '@1440io/msp-types';

export { Conversation } from './conversation.js';

/**
 * Edge ingestion for 1440 webhooks.
 *
 * The Worker does exactly two things: verify the signature, and hand the event
 * to the object that owns that conversation. Verification is Web Crypto, so it
 * runs at whichever PoP the request landed on — the delivery is accepted or
 * rejected before it has travelled to a region.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Test hooks, so the spike can drive a conversation without a live device.
    if (url.pathname.startsWith('/conv/')) {
      const [, , conversationId, action] = url.pathname.split('/');
      return forward(env, conversationId!, `/${action}`, await request.text());
    }

    if (request.method !== 'POST' || url.pathname !== '/webhooks/1440') {
      return new Response('not found', { status: 404 });
    }

    // One verifier per isolate: the HMAC key is imported once and reused
    // across every request that isolate serves.
    verifier ??= new WebhookVerifier({ secret: env.MSP_WEBHOOK_SECRET });

    let event: WebhookEvent;
    try {
      // Raw bytes — the signature covers the exact body, so nothing may parse
      // it first.
      const result = await verifier.verify({
        headers: request.headers,
        body: new Uint8Array(await request.arrayBuffer()),
      });
      event = result.event;
    } catch (error) {
      return Response.json(
        { ok: false, error: error instanceof Error ? error.message : 'rejected' },
        { status: 400 },
      );
    }

    if (!event.conversationId) {
      return Response.json({ ok: true, note: 'no conversation to route to' });
    }

    // The conversation id 1440 assigned is the object's name. No lookup table.
    return forward(env, event.conversationId, '/event', JSON.stringify(event));
  },

} satisfies ExportedHandler<Env>;

/** Route to the object that owns this conversation. The id needs no mapping. */
function forward(env: Env, conversationId: string, path: string, body: string): Promise<Response> {
  const stub = env.CONVERSATION.get(env.CONVERSATION.idFromName(conversationId));
  return stub.fetch(`https://conversation${path}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
}

let verifier: WebhookVerifier | undefined;
