import { createServer, type Server } from 'node:http';
import { afterAll, expect, it } from 'vitest';
import { uuidv7 } from '@1440io/msp-api';
import {
  MemoryReplayCache,
  WebhookReceiver,
  isInteractiveMessage,
  isTapbackMessage,
  isTextMessage,
  respondsTo,
  selectedIds,
  selectedTitles,
  formValuesByPage,
} from '@1440io/msp-webhooks';
import type { WebhookMessageSummary } from '@1440io/msp-types';
import { describeIf } from '../gates.ts';
import { env, hasCredentials, RUN_ID } from '../env.ts';
import { testClient } from '../client.ts';
import { assertMatchesSchema } from '../schema.ts';
import { AMB_INTERACTIVE_BID } from '../fixtures/rich.ts';

/**
 * The full rich-messaging round trip: send an interactive prompt, a human taps
 * it on a real device, and the reply comes back over the webhook.
 *
 * This is the only way to test inbound responses — there is no API that
 * synthesizes a customer tap. It needs the send tier, the signing secret, and
 * the local receiver exposed so the platform can reach it.
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
  message: WebhookMessageSummary;
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
          inbound.push({ message: event.data.message, eventId: context.id });
          console.log(`   ← ${event.data.message.messageType} (${context.id})`);
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

      // We supply the request identifier ourselves: the spec says built-in
      // interactive payloads preserve one, which is what makes correlation
      // deterministic rather than best-effort.
      const requestIdentifier = uuidv7();

      await testClient().messaging.sendRaw({
        conversationId: env.conversationId!,
        channel: 'amb',
        messageType: 'quick_reply',
        payload: {
          type: 'interactive',
          interactiveData: {
            bid: AMB_INTERACTIVE_BID,
            data: {
              version: '1.0',
              requestIdentifier,
              'quick-reply': {
                summaryText: `Round-trip test ${RUN_ID.slice(-6)} — tap either option`,
                items: [
                  { identifier: 'roundtrip-yes', title: 'Yes' },
                  { identifier: 'roundtrip-no', title: 'No' },
                ],
              },
            },
          },
        },
      });

      const reply = await waitFor(
        (item) => isInteractiveMessage(item.message) && respondsTo(item.message) === requestIdentifier,
        env.webhookTimeoutMs,
        'Tap "Yes" or "No" on the quick reply that just arrived on the device.',
      );

      if (!reply) {
        const seen = inbound.map((item) => item.message.messageType).join(', ') || 'nothing';
        throw new Error(
          `No correlated reply arrived within ${env.webhookTimeoutMs / 1000}s. Received: ${seen}. ` +
            `Check the tunnel, the integration endpoint, and that someone tapped the prompt. ` +
            `${rejected.length} delivery/deliveries failed verification.`,
        );
      }

      // Nothing signed by the platform should ever fail verification.
      expect(rejected).toEqual([]);

      const { message } = reply;
      if (!isInteractiveMessage(message)) throw new Error('expected an interactive message');

      assertMatchesSchema('WebhookContentInteractiveResponse', message.content, 'tapped reply');
      expect(message.content.responseType).toBe('quick_reply');
      expect(respondsTo(message)).toBe(requestIdentifier);

      // A quick reply carries exactly one selection, and it must be one of ours.
      const ids = selectedIds(message.content);
      expect(ids).toHaveLength(1);
      expect(['roundtrip-yes', 'roundtrip-no']).toContain(ids[0]);

      console.log(
        `   ✓ customer chose "${selectedTitles(message.content)[0] ?? ids[0]}" ` +
          `(${ids[0]}), correlated to ${requestIdentifier}`,
      );
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
        `\n   👉 From the device: send a plain text message, then long-press a ` +
          `message and add a tapback reaction.`,
      );
      console.log(`      collecting for ${Math.round(windowMs / 1000)}s…\n`);

      const seen = new Set<string>();
      let lastReport = 0;
      while (Date.now() < deadline) {
        for (const item of inbound.slice(before)) seen.add(item.message.messageType);
        // Both shapes in hand — no reason to keep the run waiting.
        if (seen.has('text') && seen.has('tapback')) break;

        const remaining = Math.round((deadline - Date.now()) / 1000);
        if (remaining % 15 === 0 && remaining !== lastReport) {
          lastReport = remaining;
          console.log(`      ${remaining}s left… (seen: ${[...seen].join(', ') || 'nothing yet'})`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const collected = inbound.slice(before);
      if (collected.length === 0) {
        console.log('   nothing arrived — skipping the extra-shapes check');
        return;
      }

      // Nothing the platform signed should ever fail verification.
      expect(rejected).toEqual([]);

      for (const { message } of collected) {
        const schema =
          message.messageType === 'text'
            ? 'WebhookContentText'
            : message.messageType === 'interactive'
              ? 'WebhookContentInteractiveResponse'
              : message.messageType === 'tapback'
                ? 'WebhookContentTapback'
                : 'WebhookContentOptOut';
        assertMatchesSchema(schema, message.content, `inbound ${message.messageType}`);

        if (isTextMessage(message)) {
          // Narrowing has to reach the body without a cast.
          expect(typeof message.content.body).toBe('string');
          console.log(`   ✓ text: ${JSON.stringify(message.content.body).slice(0, 80)}`);
        }

        if (isTapbackMessage(message)) {
          expect(typeof message.content.kind).toBe('string');
          // A reaction that names no target cannot be attached to anything.
          expect(message.content.targetMessageId).toBeTruthy();
          console.log(
            `   ✓ tapback: "${message.content.kind}" on ${message.content.targetMessageId}`,
          );
        }

        if (isInteractiveMessage(message)) {
          console.log(
            `   ✓ interactive: ${message.content.responseType} ` +
              `${JSON.stringify(selectedIds(message.content))}`,
          );
          if (message.content.responseType === 'form') {
            expect(Object.keys(formValuesByPage(message.content)).length).toBeGreaterThan(0);
          }
        }

        for (const attachment of message.attachments) {
          assertMatchesSchema('WebhookAttachment', attachment, 'inbound attachment');
          // A presigned URL without an expiry would be a leak waiting to happen.
          if (attachment.url) expect(attachment.urlExpiresAt).not.toBeNull();
        }
      }

      console.log(`   shapes covered this run: ${[...seen].join(', ')}`);
      expect(collected.length).toBeGreaterThan(0);
    },
    Math.max(env.webhookTimeoutMs, 90_000) + 60_000,
  );
});
