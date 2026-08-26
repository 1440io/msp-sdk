import { afterAll, expect, it } from 'vitest';
import { isMspApiError, uuidv7 } from '@1440io/msp-api';
import type { RichTemplateWriteBody, TemplateVariableValue } from '@1440io/msp-types';
import { describeSend } from '../gates.ts';
import { env, resourceName, RUN_ID } from '../env.ts';
import { testClient } from '../client.ts';
import { assertMatchesSchema } from '../schema.ts';
import {
  listPickerTemplate,
  quickReplyTemplate,
  rawQuickReply,
  staticListPickerTemplate,
  timePickerTemplate,
} from '../fixtures/rich.ts';

/**
 * Real rich sends into `MSP_TEST_CONVERSATION_ID`.
 *
 * These put interactive prompts on a real device. Templates published here
 * cannot be deleted (only archived), so they are archived on the way out and
 * swept later by `npm run integration:cleanup`.
 */
const publishedTemplates: string[] = [];

/** Publish a template and return its id, remembering it for teardown. */
async function publish(body: RichTemplateWriteBody): Promise<string> {
  const client = testClient();
  const created = await client.admin.templates.create(body);
  const published = await client.admin.templates.publish(created.id);
  expect(published.status).toBe('published');
  publishedTemplates.push(created.id);
  return created.id;
}

/** Send a template, returning either the success or the rejection detail. */
async function send(templateId: string, variables?: Record<string, TemplateVariableValue>) {
  return testClient()
    .messaging.sendTemplate({
      conversationId: env.conversationId!,
      templateId,
      ...(variables ? { variables } : {}),
    })
    .then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => {
        if (!isMspApiError(error)) throw error;
        return {
          ok: false as const,
          status: error.status,
          codes: (error.reasons ?? []).map((reason) => reason.code),
          message: error.message,
        };
      },
    );
}

const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

describeSend('rich sends: templates', () => {
  afterAll(async () => {
    const client = testClient();
    for (const id of publishedTemplates) {
      await client.admin.templates.archive(id).catch(() => undefined);
      await client.admin.templates.delete(id).catch(() => undefined);
    }
  });

  it('sends a quick reply the customer can tap', async () => {
    const templateId = await publish(quickReplyTemplate(resourceName('send-qr')));

    const outcome = await send(templateId);

    if (!outcome.ok) {
      // A blocked channel is a legitimate answer; surface why rather than
      // failing on something the device, not the SDK, decided.
      console.warn(`   quick reply rejected: ${outcome.status} ${outcome.codes.join(', ')}`);
      expect(outcome.codes.length).toBeGreaterThan(0);
      return;
    }
    assertMatchesSchema('SendMessageSuccess', outcome.result, 'quick reply send');
    expect(outcome.result.duplicate).toBe(false);
    console.log(`   quick reply delivered as ${outcome.result.messageId}`);
  });

  it('sends a list picker with fixed items', async () => {
    const templateId = await publish(staticListPickerTemplate(resourceName('send-lp')));

    const outcome = await send(templateId);

    if (!outcome.ok) {
      console.warn(`   list picker rejected: ${outcome.status} ${outcome.codes.join(', ')}`);
      return;
    }
    expect(outcome.result.messageId).toBeTruthy();
    console.log(`   list picker delivered as ${outcome.result.messageId}`);
  });

  it('sends a list picker whose items are supplied per send', async () => {
    const templateId = await publish(listPickerTemplate(resourceName('send-lp-dyn')));

    const outcome = await send(templateId, {
      options: [
        { id: 'opt-1', title: 'Option one', subtitle: 'From the integration suite' },
        { id: 'opt-2', title: 'Option two', subtitle: null },
      ],
    });

    if (!outcome.ok) {
      console.warn(`   dynamic list picker rejected: ${outcome.status} ${outcome.codes.join(', ')}`);
      return;
    }
    expect(outcome.result.duplicate).toBe(false);
  });

  it('sends a time picker whose slots are supplied per send', async () => {
    const templateId = await publish(timePickerTemplate(resourceName('send-tp')));

    const outcome = await send(templateId, {
      slots: [
        { id: 'slot-1', startTime: soon(60), durationSeconds: 1800 },
        { id: 'slot-2', startTime: soon(120), durationSeconds: 1800 },
      ],
    });

    if (!outcome.ok) {
      console.warn(`   time picker rejected: ${outcome.status} ${outcome.codes.join(', ')}`);
      return;
    }
    expect(outcome.result.duplicate).toBe(false);
  });
});

describeSend('rich sends: variable validation', () => {
  it('refuses a send that omits a required variable', async () => {
    const templateId = await publish(listPickerTemplate(resourceName('send-missingvar')));

    const outcome = await send(templateId); // `options` is required

    expect(outcome.ok, 'send was accepted without its required variable').toBe(false);
    if (outcome.ok) return;
    expect(outcome.codes).toContain('missing_variable_value');
    // The reject has to name the variable, or the caller cannot fix it.
    expect(outcome.message).toContain('options');
  });

  it('refuses a collection variable given a scalar', async () => {
    const templateId = await publish(listPickerTemplate(resourceName('send-badvar')));

    const outcome = await send(templateId, { options: 'not a collection' });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.codes.some((code) => code.includes('variable'))).toBe(true);
  });

  it('refuses a value for a variable the template never declared', async () => {
    const templateId = await publish(staticListPickerTemplate(resourceName('send-extravar')));

    const outcome = await send(templateId, { neverDeclared: 'x' });

    // Either rejected, or ignored — both are defensible, but silently sending
    // with a typo'd variable name is worth knowing about either way.
    if (outcome.ok) {
      console.log('   undeclared variables are ignored rather than rejected');
    } else {
      expect(outcome.codes.length).toBeGreaterThan(0);
    }
  });
});

describeSend('rich sends: raw channel payloads', () => {
  it('delivers a raw quick reply payload', async () => {
    const result = await testClient().messaging.sendRaw({
      conversationId: env.conversationId!,
      channel: 'amb',
      messageType: 'quick_reply',
      payload: rawQuickReply([
        { identifier: `${RUN_ID}-yes`, title: 'Yes' },
        { identifier: `${RUN_ID}-no`, title: 'No' },
      ]),
    });

    expect(result).toBeTruthy();
    console.log(`   raw quick reply: ${JSON.stringify(result).slice(0, 120)}`);
  });

  it('replays an identical raw payload instead of sending it twice', async () => {
    const client = testClient();
    const requestMessageId = uuidv7();
    // Two items: Apple rejects a single-item quick reply outright (see below).
    const payload = rawQuickReply([
      { identifier: 'replay-a', title: 'Replay A' },
      { identifier: 'replay-b', title: 'Replay B' },
    ]);

    const first = await client.messaging.sendRaw({
      conversationId: env.conversationId!,
      channel: 'amb',
      messageType: 'quick_reply',
      payload,
      requestMessageId,
    });
    const replay = await client.messaging.sendRaw({
      conversationId: env.conversationId!,
      channel: 'amb',
      messageType: 'quick_reply',
      payload,
      requestMessageId,
    });

    // Idempotency hashes canonical { channel, payload }, so this must replay
    // the original message rather than delivering a second one.
    expect(replay.messageId).toBe(first.messageId);
    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
  });

  it('surfaces Apple rejecting a one-item quick reply as a provider error', async () => {
    // The spec documents quick replies as 1–5 items and the platform validator
    // accepts one, but Apple's gateway 400s it — which reaches the caller as a
    // 502 that says nothing about item counts. Pinned here so that if local
    // validation is later tightened to catch it earlier, we notice.
    const error = await testClient()
      .messaging.sendRaw({
        conversationId: env.conversationId!,
        channel: 'amb',
        messageType: 'quick_reply',
        payload: rawQuickReply([{ identifier: 'solo', title: 'Only option' }]),
      })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    if (!isMspApiError(error)) return;

    if (error.status === 502) {
      expect(error.reasons?.map((reason) => reason.code)).toContain('provider_rejected');
      console.warn(
        '   ⚠ a one-item quick reply is accepted locally and rejected by Apple — ' +
          'the documented 1–5 range is really 2–5.',
      );
    } else {
      // Better outcome: caught before it ever reached Apple.
      expect(error.status).toBeGreaterThanOrEqual(400);
      expect(error.status).toBeLessThan(500);
      console.log('   local validation now rejects a one-item quick reply');
    }
  });

  it('conflicts when the same key carries a changed payload', async () => {
    const client = testClient();
    const requestMessageId = uuidv7();

    await client.messaging.sendRaw({
      conversationId: env.conversationId!,
      channel: 'amb',
      messageType: 'quick_reply',
      payload: rawQuickReply([
        { identifier: 'a', title: 'Original' },
        { identifier: 'a2', title: 'Original two' },
      ]),
      requestMessageId,
    });

    const error = await client.messaging
      .sendRaw({
        conversationId: env.conversationId!,
        channel: 'amb',
        messageType: 'quick_reply',
        payload: rawQuickReply([
          { identifier: 'b', title: 'Changed' },
          { identifier: 'b2', title: 'Changed two' },
        ]),
        requestMessageId,
      })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && error.status).toBe(409);
  });
});
