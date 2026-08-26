import { expect, it } from 'vitest';
import { parseAppleTimestamp } from '@1440io/msp-webhooks';
import { INTERACTIVE_RESPONSE_TYPES } from '@1440io/msp-types';
import { describeApi } from '../gates.ts';
import { env } from '../env.ts';
import { testClient } from '../client.ts';
import { assertMatchesSchema, checkSchema } from '../schema.ts';

/**
 * Customer replies as the read API stored them.
 *
 * A tap cannot be synthesized, but every reply that has ever arrived is on the
 * conversation — so this validates real interactive responses without needing
 * anyone at a device, and runs on the read tier alone.
 */
async function recentMessages() {
  const client = testClient();
  const conversationId =
    env.conversationId ?? (await client.conversations.list({ count: 1 })).conversations[0]?.id;
  if (!conversationId) return [];
  const detail = await client.conversations.get(conversationId, { count: 50 });
  return detail.messages as unknown as Record<string, any>[];
}

describeApi('stored replies: interactive responses', () => {
  it('stores interactive responses in the documented shape', async () => {
    const messages = await recentMessages();
    const interactive = messages.filter((m) => m['messageType'] === 'interactive');

    if (interactive.length === 0) {
      console.log('   no interactive replies on this conversation yet — skipped');
      return;
    }

    for (const message of interactive) {
      assertMatchesSchema(
        'WebhookContentInteractiveResponse',
        message['content'],
        'stored interactive reply',
      );
      expect(INTERACTIVE_RESPONSE_TYPES as readonly string[]).toContain(
        message['content']['responseType'],
      );
    }
    console.log(
      `   ${interactive.length} interactive reply(ies): ` +
        interactive.map((m) => m['content']['responseType']).join(', '),
    );
  });

  it('correlates every reply back to the message that prompted it', async () => {
    const messages = await recentMessages();
    const interactive = messages.filter((m) => m['messageType'] === 'interactive');
    if (interactive.length === 0) return;

    for (const message of interactive) {
      // Without an identifier a bot cannot tell which prompt was answered.
      expect(
        message['content']['requestIdentifier'],
        `reply ${message['id']} carries no requestIdentifier`,
      ).toBeTruthy();
    }
  });

  it('yields a usable instant for every time-picker reply', async () => {
    const messages = await recentMessages();
    const timePickers = messages.filter(
      (m) => m['messageType'] === 'interactive' && m['content']['responseType'] === 'time_picker',
    );

    if (timePickers.length === 0) {
      console.log('   no time-picker replies yet — skipped');
      return;
    }

    for (const message of timePickers) {
      const raw = message['content']['selectedStartTime'] as string | null;
      expect(raw, 'a time-picker reply with no chosen time').not.toBeNull();

      // The declared format and the real one disagree; the helper spans both.
      const parsed = parseAppleTimestamp(raw);
      expect(parsed, `could not parse selectedStartTime ${JSON.stringify(raw)}`).not.toBeNull();
      expect(Number.isNaN(parsed!.getTime())).toBe(false);

      const { undocumented } = checkSchema('WebhookContentInteractiveResponse', message['content']);
      const formatDrift = undocumented.find((entry) => entry.includes('selectedStartTime'));
      if (formatDrift) {
        console.warn(`   ⚠ ${raw} is not RFC 3339 — parseAppleTimestamp() handled it`);
      }
    }
  });

  it('reports how reactions actually arrive', async () => {
    const messages = await recentMessages();

    const structuredTapbacks = messages.filter((m) => m['messageType'] === 'tapback');
    // Apple has been observed delivering reactions as prose rather than as a
    // structured tapback — "Liked 1 Business Message" arrives as plain text.
    const prose = messages.filter(
      (m) =>
        m['messageType'] === 'text' &&
        /^(Liked|Loved|Disliked|Laughed at|Emphasized|Questioned)\b/.test(
          String(m['content']?.['body'] ?? ''),
        ),
    );

    console.log(
      `   reactions: ${structuredTapbacks.length} structured, ${prose.length} delivered as text`,
    );
    if (prose.length > 0 && structuredTapbacks.length === 0) {
      console.warn(
        '   ⚠ reactions arrive as text, not messageType "tapback" — isTapbackMessage() ' +
          'will never fire for these, so do not rely on it for AMB reactions.',
      );
    }

    for (const tapback of structuredTapbacks) {
      assertMatchesSchema('WebhookContentTapback', tapback['content'], 'stored tapback');
    }
    expect(messages.length).toBeGreaterThanOrEqual(0);
  });
});
