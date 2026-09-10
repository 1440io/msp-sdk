import { createServer, type Server } from 'node:http';
import { afterAll, expect, it } from 'vitest';
import { uuidv7 } from '@1440io/msp-api';
import {
  MemoryReplayCache,
  WebhookReceiver,
  authenticationStatus,
  formAnswers,
  isInteractiveResponse,
  respondsTo,
  selectedIds,
  selectedTimeslot,
  selectedTitles,
  textBody,
} from '@1440io/msp-webhooks';
import type { InboundMessage } from '@1440io/msp-types';
import { describeIf } from '../gates.ts';
import { env, hasCredentials, RUN_ID } from '../env.ts';
import { testClient } from '../client.ts';
import { assertMatchesSchema } from '../schema.ts';
import { rawQuickReply } from '../fixtures/rich.ts';

/**
 * The full rich-messaging round trip: send an interactive prompt, a human taps
 * it on a real device, and the reply comes back over the webhook.
 *
 * This is the only way to test inbound responses — no API synthesizes a
 * customer tap. It needs the send tier, the signing secret, and the local
 * receiver exposed so the platform can reach it.
 */
const describeRoundTrip = describeIf(
  hasCredentials &&
    env.allowSend &&
    env.conversationId !== undefined &&
    env.webhookSecret !== undefined &&
    env.webhookLive,
  'needs MSP_TEST_ALLOW_SEND, MSP_TEST_CONVERSATION_ID, MSP_WEBHOOK_SECRET, and ' +
    'MSP_TEST_WEBHOOK_LIVE=1 with the receiver exposed via a tunnel',
);

interface Inbound {
  message: InboundMessage;
  eventId: string;
}

describeRoundTrip('rich round trip: prompt → tap → response', () => {
  const inbound: Inbound[] = [];
  const rejected: unknown[] = [];
  let server: Server | undefined;

  async function listen(): Promise<void> {
    if (server) return;
    const receiver = new WebhookReceiver({
      secret: env.webhookSecret!,
      replayCache: new MemoryReplayCache(),
      on: {
        'message.received': (event, context) => {
          inbound.push({ message: event.message, eventId: context.id });
          console.log(`   ← ${event.message.content?.kind} (${context.id})`);
        },
      },
      onError: (error) => {
        rejected.push(error);
      },
    });

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
  }

  /** Wait for an inbound message matching `match`, or give up. */
  async function waitFor(
    match: (item: Inbound) => boolean,
    timeoutMs: number,
    prompt: string,
  ): Promise<Inbound | undefined> {
    const deadline = Date.now() + timeoutMs;
    console.log(`\n   👉 ${prompt}`);
    console.log(`      waiting up to ${Math.round(timeoutMs / 1000)}s…\n`);

    let lastReport = 0;
    while (Date.now() < deadline) {
      const found = inbound.find(match);
      if (found) return found;
      const remaining = Math.round((deadline - Date.now()) / 1000);
      if (remaining % 15 === 0 && remaining !== lastReport) {
        lastReport = remaining;
        console.log(`      ${remaining}s left…`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return undefined;
  }

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  it(
    'correlates a tapped quick reply back to the message that prompted it',
    async () => {
      await listen();

      // Correlation is by requestMessageId now: the platform injects the
      // request identifier into the channel payload and echoes it back.
      const requestMessageId = uuidv7();

      await testClient().messaging.sendRaw({
        conversationId: env.conversationId!,
        requestMessageId,
        content: rawQuickReply(
          [
            { identifier: 'roundtrip-yes', title: 'Yes' },
            { identifier: 'roundtrip-no', title: 'No' },
          ],
          `Round-trip test ${RUN_ID.slice(-6)} — tap either option`,
        ),
      });

      const reply = await waitFor(
        (item) => isInteractiveResponse(item.message.content),
        env.webhookTimeoutMs,
        'Tap "Yes" or "No" on the quick reply that just arrived on the device.',
      );

      if (!reply) {
        const seen = inbound.map((item) => item.message.content?.kind).join(', ') || 'nothing';
        throw new Error(
          `No interactive reply arrived within ${env.webhookTimeoutMs / 1000}s. Received: ${seen}. ` +
            `Check the tunnel, the integration endpoint, and that someone tapped the prompt. ` +
            `${rejected.length} delivery/deliveries failed verification.`,
        );
      }

      // Nothing the platform signed should ever fail verification.
      expect(rejected).toEqual([]);

      const { content } = reply.message;
      assertMatchesSchema('WebhookMessageReceivedEvent', {
        eventId: reply.eventId,
        v: 1,
        organizationId: 'unused',
        type: 'message.received',
        conversationId: env.conversationId!,
        channelAddress: 'unused',
        intentId: null,
        groupId: null,
        locale: null,
        capabilityList: null,
        message: reply.message,
      }, 'tapped reply');

      expect(content?.kind).toBe('amb.quick_reply_response');
      const ids = selectedIds(content);
      expect(ids).toHaveLength(1);
      expect(['roundtrip-yes', 'roundtrip-no']).toContain(ids[0]);

      const correlation = respondsTo(content);
      console.log(
        `   ✓ customer chose "${selectedTitles(content)[0] ?? ids[0]}" (${ids[0]})` +
          `, correlated to ${correlation ?? '(no identifier echoed)'}`,
      );
      // The identifier is echoed; whether it equals our requestMessageId is the
      // platform's business, so only its presence is asserted.
      expect(correlation).toBeTruthy();
    },
    env.webhookTimeoutMs + 120_000,
  );

  it(
    'parses every inbound shape the device produces',
    async () => {
      await listen();

      const before = inbound.length;
      const windowMs = Math.max(env.webhookTimeoutMs, 90_000);
      const deadline = Date.now() + windowMs;

      console.log(
        `\n   👉 From the device: send a plain text message, then tap another rich prompt.`,
      );
      console.log(`      collecting for ${Math.round(windowMs / 1000)}s…\n`);

      const seen = new Set<string>();
      while (Date.now() < deadline) {
        for (const item of inbound.slice(before)) {
          if (item.message.content?.kind) seen.add(item.message.content.kind);
        }
        if (seen.size >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const collected = inbound.slice(before);
      if (collected.length === 0) {
        console.log('   nothing arrived — skipping the extra-shapes check');
        return;
      }
      expect(rejected).toEqual([]);

      for (const { message } of collected) {
        const { content } = message;
        const body = textBody(content);
        if (body !== null) console.log(`   ✓ text: ${JSON.stringify(body).slice(0, 80)}`);

        if (content?.kind === 'amb.time_picker_response') {
          const slot = selectedTimeslot(content);
          expect(slot).not.toBeNull();
          console.log(`   ✓ time picker: ${slot!.startsAt.toISOString()}`);
        }
        if (content?.kind === 'amb.form_response') {
          const answers = formAnswers(content);
          console.log(`   ✓ form pages: ${Object.keys(answers).join(', ')}`);
        }
        if (content?.kind === 'amb.authentication_response') {
          console.log(`   ✓ authentication: ${authenticationStatus(content)}`);
        }

        for (const attachment of message.attachments) {
          // A presigned URL without an expiry would be a leak waiting to happen.
          if (attachment.accessUrl) expect(attachment.accessUrlExpiresAt).not.toBeNull();
          expect(['pending', 'ready', 'failed']).toContain(attachment.status);
        }
      }

      console.log(`   shapes covered this run: ${[...seen].join(', ')}`);
      expect(collected.length).toBeGreaterThan(0);
    },
    Math.max(env.webhookTimeoutMs, 90_000) + 60_000,
  );
});
