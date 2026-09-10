import { afterAll, expect, it } from 'vitest';
import { isMspApiError, uuidv7 } from '@1440io/msp-api';
import type { RichTemplateWriteBody, TemplateVariableValue } from '@1440io/msp-types';
import { describeSend } from '../gates.ts';
import { env, resourceName, RUN_ID } from '../env.ts';
import { testClient } from '../client.ts';
import { assertMatchesSchema } from '../schema.ts';
import {
  authenticationTemplate,
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

describeSend('rich sends: authentication', () => {
  it('sends an authentication request carrying its state', async () => {
    const templateId = await publish(authenticationTemplate(resourceName('send-auth'))).catch(
      (error: unknown) => {
        // Authentication templates need channel configuration this org may lack.
        if (isMspApiError(error)) {
          console.warn(`   authentication template rejected: ${error.status} ${error.message}`);
          return undefined;
        }
        throw error;
      },
    );
    if (!templateId) return;

    const state = `${RUN_ID}-auth-state`;
    const outcome = await testClient()
      .messaging.sendAuthentication({
        conversationId: env.conversationId!,
        templateId,
        state,
      })
      .then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => {
          if (!isMspApiError(error)) throw error;
          return { ok: false as const, status: error.status, message: error.message };
        },
      );

    if (!outcome.ok) {
      console.warn(`   authentication send rejected: ${outcome.status} ${outcome.message}`);
      return;
    }
    assertMatchesSchema('SendMessageSuccess', outcome.result, 'authentication send');
    console.log(`   authentication request delivered as ${outcome.result.messageId}`);
  });
});

describeSend('rich sends: variable validation', () => {
  /**
   * All three rejections are correct 422s that name the offending variable in
   * prose, but they carry no machine-readable code — no `reasons`, no
   * `issues`. An earlier revision returned
   * `reasons: [{ code: 'missing_variable_value' }]`, so branching on a code is
   * no longer possible for template-variable problems; only the message
   * distinguishes them.
   */
  it('refuses a send that omits a required variable', async () => {
    const templateId = await publish(listPickerTemplate(resourceName('send-missingvar')));

    const outcome = await send(templateId); // `options` is required

    expect(outcome.ok, 'send was accepted without its required variable').toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(422);
    // The reject has to name the variable, or the caller cannot fix it.
    expect(outcome.message).toContain('options');
    if (outcome.codes.length === 0) {
      console.log('   rejected in prose only — no reason code to branch on');
    }
  });

  it('refuses a collection variable given a scalar', async () => {
    const templateId = await publish(listPickerTemplate(resourceName('send-badvar')));

    const outcome = await send(templateId, { options: 'not a collection' });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(422);
    expect(outcome.message).toMatch(/options/);
  });

  it('refuses a value for a variable the template never declared', async () => {
    const templateId = await publish(staticListPickerTemplate(resourceName('send-extravar')));

    const outcome = await send(templateId, { neverDeclared: 'x' });

    // Silently accepting a typo'd variable name would render the wrong message.
    expect(outcome.ok, 'an undeclared variable was accepted').toBe(false);
    if (outcome.ok) return;
    expect(outcome.status).toBe(422);
    expect(outcome.message).toContain('neverDeclared');
  });
});

describeSend('rich sends: raw channel payloads', () => {
  it('delivers a raw quick reply payload', async () => {
    const result = await testClient().messaging.sendRaw({
      conversationId: env.conversationId!,
      content: rawQuickReply([
        { identifier: `${RUN_ID}-yes`, title: 'Yes' },
        { identifier: `${RUN_ID}-no`, title: 'No' },
      ]),
    });

    assertMatchesSchema('SendMessageSuccess', result, 'raw quick reply');
    expect(result.duplicate).toBe(false);
    console.log(`   raw quick reply delivered as ${result.messageId}`);
  });

  it('replays identical raw content instead of sending it twice', async () => {
    const client = testClient();
    const requestMessageId = uuidv7();
    // Two items: the schema pins quick replies to 2-5.
    const content = rawQuickReply([
      { identifier: 'replay-a', title: 'Replay A' },
      { identifier: 'replay-b', title: 'Replay B' },
    ]);

    const first = await client.messaging.sendRaw({
      conversationId: env.conversationId!,
      content,
      requestMessageId,
    });
    const replay = await client.messaging.sendRaw({
      conversationId: env.conversationId!,
      content,
      requestMessageId,
    });

    // Idempotency hashes the canonical content, so this must replay the
    // original message rather than delivering a second one.
    expect(replay.messageId).toBe(first.messageId);
    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
  });


  it('rejects a one-item quick reply locally, never reaching Apple', async () => {
    // Previously the spec said 1–5, the validator accepted one, and Apple
    // rejected it as a 502 that named no cause. The schema now pins 2–5.
    const error = await testClient()
      .messaging.sendRaw({
        conversationId: env.conversationId!,
        content: rawQuickReply([{ identifier: 'solo', title: 'Only option' }]),
      })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    if (!isMspApiError(error)) return;
    expect(error.status).toBeGreaterThanOrEqual(400);
    expect(error.status).toBeLessThan(500);
    expect(error.status, 'this should no longer reach the channel').not.toBe(502);
  });

  it('conflicts when the same key carries a changed payload', async () => {
    const client = testClient();
    const requestMessageId = uuidv7();

    await client.messaging.sendRaw({
      conversationId: env.conversationId!,
      content: rawQuickReply([
        { identifier: 'a', title: 'Original' },
        { identifier: 'a2', title: 'Original two' },
      ]),
      requestMessageId,
    });

    const error = await client.messaging
      .sendRaw({
        conversationId: env.conversationId!,
        content: rawQuickReply([
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
