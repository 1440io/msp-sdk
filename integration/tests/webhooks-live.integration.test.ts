import { createServer, type Server } from 'node:http';
import { afterAll, expect, it } from 'vitest';
import { MemoryReplayCache, WebhookReceiver } from '@1440io/msp-webhooks';
import type { WebhookEvent } from '@1440io/msp-types';
import { describeWebhookLive } from '../gates.ts';
import { env, RUN_ID } from '../env.ts';
import { testClient } from '../client.ts';
import { assertMatchesSchema } from '../schema.ts';

interface Received {
  event: WebhookEvent;
  id: string;
  receivedAt: number;
}

/**
 * End-to-end: a real delivery, signed by the platform, arriving over the
 * network and verified by this SDK.
 *
 * Requires the integration's webhook URL to point at this process — expose it
 * with a tunnel first:
 *
 *   cloudflared tunnel --url http://localhost:3000
 *   ngrok http 3000
 *
 * then set the integration's endpoint to `<public-url>/webhooks/1440`.
 */
describeWebhookLive('webhooks: live end-to-end', () => {
  const received: Received[] = [];
  const rejected: unknown[] = [];
  let server: Server | undefined;

  // Built inside listen(), not in the describe body: Vitest evaluates the body
  // of a skipped describe too, and the secret may not be set at that point.
  function buildReceiver(): WebhookReceiver {
    return new WebhookReceiver({
      secret: env.webhookSecret!,
      replayCache: new MemoryReplayCache(),
      onEvent: (event, context) => {
        received.push({ event, id: context.id, receivedAt: Date.now() });
        console.log(`   ← ${event.type} ${context.id}`);
      },
      onError: (error) => {
        rejected.push(error);
      },
    });
  }

  async function listen(): Promise<void> {
    const receiver = buildReceiver();
    server = createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const result = await receiver.handle({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });

    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(env.webhookPort, resolve);
    });
    console.log(`   listening on http://localhost:${env.webhookPort} — expose this via a tunnel`);
  }

  /** Wait until `match` accepts a delivery, or the timeout expires. */
  async function waitFor(
    match: (item: Received) => boolean,
    timeoutMs: number,
  ): Promise<Received | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = received.find(match);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return undefined;
  }

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  it(
    'receives and verifies a real platform delivery',
    async () => {
      await listen();

      // An invitation is the one event we can provoke on demand: creating one
      // produces messaging_invitation.updated transitions to this endpoint.
      let expectedInvitationId: string | undefined;
      if (env.allowInitiate && env.phoneNumber) {
        const invitation = await testClient().invitations.create({
          phoneNumber: env.phoneNumber,
          callerReference: `${RUN_ID}-live-webhook`,
          targetAgentStatus: 'bot',
        });
        expectedInvitationId = invitation.id;
        console.log(`   provoked invitation ${invitation.id} — waiting for its webhook`);
      } else {
        console.log(
          `   waiting up to ${env.webhookTimeoutMs / 1000}s for any delivery — ` +
            'send a message to the business from a device now',
        );
      }

      const delivery = await waitFor(
        (item) =>
          expectedInvitationId === undefined ||
          (item.event.type === 'messaging_invitation.updated' &&
            item.event.messagingInvitation.messagingInvitationId === expectedInvitationId),
        env.webhookTimeoutMs,
      );

      if (!delivery) {
        throw new Error(
          `No verified delivery arrived within ${env.webhookTimeoutMs / 1000}s. Check that the ` +
            'integration endpoint points at your tunnel, that outbound delivery is enabled, and ' +
            `that nothing was rejected (${rejected.length} rejection(s) so far).`,
        );
      }

      // Every rejection is a real problem here: the platform signed it, so a
      // failure means the secret or the verifier disagrees with production.
      expect(rejected).toEqual([]);

      const schema =
        delivery.event.type === 'message.received'
          ? 'WebhookMessageReceivedEvent'
          : 'WebhookMessagingInvitationUpdatedEvent';
      assertMatchesSchema(schema, delivery.event, 'live delivery');
      // Webhook-Id equals the envelope eventId — the verifier enforces this.
      expect(delivery.id).toBe(delivery.event.eventId);
    },
    // The wait itself sets the pace; give the hook room beyond it.
    env.webhookTimeoutMs + 60_000,
  );
});
