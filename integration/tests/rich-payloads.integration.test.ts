import { expect, it } from 'vitest';
import { isMspApiError, uuidv7 } from '@1440io/msp-api';
import { describeApi } from '../gates.ts';
import { testClient } from '../client.ts';
import {
  AMB_INTERACTIVE_BID,
  rawListPicker,
  rawListPickerWithWrongItemKey,
  rawQuickReply,
  rawQuickReplyWrongMarker,
} from '../fixtures/rich.ts';

/**
 * Rich payload validation — deliberately non-destructive.
 *
 * Every send here targets a conversation id that cannot exist, so even a
 * payload that passes validation is answered with 404 rather than delivered.
 * That makes the whole file safe to run without the send tier, while still
 * exercising the real validator on the real API.
 *
 * The spec is explicit that a documented set of rejections happens *before*
 * conversation lookup, so for those a 404 means the guard did not fire.
 */
const NOWHERE = '01890000-0000-7000-8000-0000000d0000';

async function sendRaw(messageType: string, payload: Record<string, unknown>) {
  return testClient()
    .messaging.sendRaw({
      conversationId: NOWHERE,
      channel: 'amb',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messageType: messageType as any,
      payload,
      requestMessageId: uuidv7(),
    })
    .then(
      () => ({ ok: true as const, status: 0, code: undefined as string | undefined, reasons: [] as string[] }),
      (error: unknown) => {
        if (!isMspApiError(error)) throw error;
        return {
          ok: false as const,
          status: error.status,
          code: error.code,
          reasons: (error.reasons ?? []).map((reason) => reason.code),
          message: error.message,
        };
      },
    );
}

/** Assert a rejection that the spec promises happens before conversation lookup. */
function expectPreLookupRejection(result: Awaited<ReturnType<typeof sendRaw>>, what: string) {
  expect(result.ok, `${what} was accepted — it should have been rejected`).toBe(false);
  expect(result.status).toBeGreaterThanOrEqual(400);
  expect(result.status).toBeLessThan(500);
  expect(
    result.status,
    `${what} produced a 404, so the payload reached conversation lookup — the spec says ` +
      'this class of payload is rejected before that point',
  ).not.toBe(404);
}

describeApi('rich payloads: caller-owned envelope fields are rejected', () => {
  it.each([['sourceId'], ['destinationId'], ['id'], ['v']])(
    'rejects a payload carrying %s',
    async (field) => {
      const result = await sendRaw('text', { type: 'text', body: 'hi', [field]: 'caller-supplied' });

      // The platform owns the envelope; letting a caller set these would let
      // one business address another's conversation.
      expectPreLookupRejection(result, `payload with ${field}`);
    },
  );

  it('rejects interactiveDataRef', async () => {
    const result = await sendRaw('list_picker', {
      type: 'interactive',
      interactiveDataRef: { title: 'x', url: 'https://example.com', owner: 'x', signature: 'x' },
    });

    expectPreLookupRejection(result, 'interactiveDataRef');
  });

  it('rejects richLinkDataRef', async () => {
    const result = await sendRaw('rich_link', {
      type: 'interactive',
      richLinkDataRef: { title: 'x', url: 'https://example.com' },
    });

    expectPreLookupRejection(result, 'richLinkDataRef');
  });

  it('rejects an attachments payload', async () => {
    const result = await sendRaw('text', { type: 'attachment', body: 'x', attachments: [] });

    expectPreLookupRejection(result, 'attachment payload');
  });

  it('rejects a typing indicator payload', async () => {
    const result = await sendRaw('text', { type: 'typing_start' });

    expectPreLookupRejection(result, 'typing payload');
  });

  it('rejects an Apple Pay payload', async () => {
    const result = await sendRaw('text', {
      type: 'interactive',
      interactiveData: {
        bid: 'com.apple.messages.MSMessageExtensionBalloonPlugin:0000000000:com.apple.icloud.apps.messages.business.extension',
        data: { version: '1.0', requestIdentifier: 'x', applePay: { payment: {} } },
      },
    });

    expectPreLookupRejection(result, 'Apple Pay payload');
  });

  it('rejects an authentication payload', async () => {
    const result = await sendRaw('text', {
      type: 'interactive',
      interactiveData: {
        bid: AMB_INTERACTIVE_BID,
        data: { version: '1.0', authenticate: { oauth2: {} } },
      },
    });

    expectPreLookupRejection(result, 'authentication payload');
  });
});

describeApi('rich payloads: shape validation', () => {
  it('rejects a quick reply with no items', async () => {
    const result = await sendRaw('quick_reply', rawQuickReply([]));

    // Documented as 1–5 items.
    expect(result.ok).toBe(false);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  it('rejects a quick reply with more than five items', async () => {
    const tooMany = Array.from({ length: 6 }, (_, index) => ({
      identifier: `item-${index}`,
      title: `Item ${index}`,
    }));

    const result = await sendRaw('quick_reply', rawQuickReply(tooMany));

    expect(result.ok).toBe(false);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  it('accepts a quick reply at the five-item boundary', async () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      identifier: `item-${index}`,
      title: `Item ${index}`,
    }));

    const result = await sendRaw('quick_reply', rawQuickReply(five));

    // Valid shape, unroutable conversation: 404 is the *correct* answer here,
    // and proves validation passed rather than tripping a shape guard.
    expect(result.status).toBe(404);
  });

  it('rejects the documented listPickerItem pitfall', async () => {
    const result = await sendRaw('list_picker', rawListPickerWithWrongItemKey());

    // The one capture-backed guard the spec calls out by name.
    expect(result.ok).toBe(false);
    expect(result.status).not.toBe(404);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  it('accepts a correctly keyed list picker', async () => {
    const result = await sendRaw('list_picker', rawListPicker());

    expect(result.status).toBe(404); // shape fine, conversation absent
  });

  it('rejects the camelCase quickReply marker', async () => {
    const result = await sendRaw('quick_reply', rawQuickReplyWrongMarker());

    // Apple's marker is `quick-reply`; `quickReply` reads as a different type
    // entirely, and the mismatch is reported against the type rather than the
    // spelling — worth a test, because the error does not name the real cause.
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('message_type_mismatch');
  });

  it('rejects a declared type that disagrees with the payload', async () => {
    // Declared quick_reply, but the payload carries a list picker.
    const result = await sendRaw('quick_reply', rawListPicker());

    expect(result.ok).toBe(false);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  it('rejects a message type outside the supported set', async () => {
    const result = await sendRaw('carrier_pigeon', { type: 'text', body: 'hi' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('rejects a body over the 5 MiB cap', async () => {
    const result = await sendRaw('text', { type: 'text', body: 'x'.repeat(5 * 1024 * 1024 + 1024) });

    expect(result.ok).toBe(false);
    // Documented as a hard cap measured before JSON parsing.
    expect([400, 413]).toContain(result.status);
  }, 120_000);
});
