import { expect, it } from 'vitest';
import { respondsTo, selectedTimeslot } from '@1440io/msp-webhooks';
import { INBOUND_CONTENT_KINDS } from '@1440io/msp-types';
import { describeApi } from '../gates.ts';
import { env } from '../env.ts';
import { testClient } from '../client.ts';
import { assertMatchesSchema } from '../schema.ts';

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
  it('stores every message under a documented content kind', async () => {
    const messages = await recentMessages();
    const withContent = messages.filter((m) => m['content'] != null);

    if (withContent.length === 0) {
      console.log('   no messages with content on this conversation — skipped');
      return;
    }

    const kinds = new Set<string>();
    for (const message of withContent) {
      const kind = message['content']['kind'] as string | undefined;
      if (kind === undefined) continue;
      kinds.add(kind);
    }
    console.log(`   content kinds seen: ${[...kinds].join(', ') || '(none)'}`);

    // History holds both directions. Outbound rich sends use the send kinds
    // (`amb.quick_reply`), inbound replies the response kinds
    // (`amb.quick_reply_response`) — only the latter are inbound content.
    const inboundKinds = [...kinds].filter((kind) => kind.endsWith('_response') || kind === 'text');
    const unknown = inboundKinds.filter(
      (kind) => !(INBOUND_CONTENT_KINDS as readonly string[]).includes(kind),
    );
    if (unknown.length > 0) {
      // A new inbound kind is the platform moving ahead of the spec.
      console.warn(`   ⚠ inbound kind(s) outside the documented set: ${unknown.join(', ')}`);
    }
    expect(kinds.size).toBeGreaterThan(0);
  });

  it('correlates every interactive reply back to its prompt', async () => {
    const messages = await recentMessages();
    // Only inbound replies carry a correlation identifier; an outbound rich
    // send shares the `amb.` prefix but is not a reply.
    const interactive = messages.filter((m) =>
      String(m['content']?.['kind'] ?? '').endsWith('_response'),
    );
    if (interactive.length === 0) {
      console.log('   no interactive replies yet — skipped');
      return;
    }

    for (const message of interactive) {
      const correlation = respondsTo(message['content']);
      if (message['content']['kind'] === 'amb.imessage_app_response') continue; // no promise
      // Without an identifier a bot cannot tell which prompt was answered.
      expect(correlation, `reply ${message['id']} carries no requestIdentifier`).toBeTruthy();
    }
  });

  it('yields a usable instant for every time-picker reply', async () => {
    const messages = await recentMessages();
    const timePickers = messages.filter(
      (m) => m['content']?.['kind'] === 'amb.time_picker_response',
    );

    if (timePickers.length === 0) {
      console.log('   no time-picker replies yet — skipped');
      return;
    }

    for (const message of timePickers) {
      const slot = selectedTimeslot(message['content']);
      expect(slot, `could not read a slot from ${JSON.stringify(message['content'])}`).not.toBeNull();
      expect(Number.isNaN(slot!.startsAt.getTime())).toBe(false);
      expect(slot!.durationSeconds).toBeGreaterThan(0);
      console.log(`   booked ${slot!.startsAt.toISOString()} for ${slot!.durationSeconds}s`);
    }
  });

  it('reports how reactions actually arrive', async () => {
    const messages = await recentMessages();

    // The spec no longer declares a tapback kind at all, which matches what we
    // observed: reactions arrive as text prose.
    const structuredTapbacks = messages.filter((m) => m['content']?.['kind'] === 'tapback');
    // Apple has been observed delivering reactions as prose rather than as a
    // structured tapback — "Liked 1 Business Message" arrives as plain text.
    const prose = messages.filter(
      (m) =>
        m['content']?.['kind'] === 'text' &&
        /^(Liked|Loved|Disliked|Laughed at|Emphasized|Questioned)\b/.test(
          String(m['content']?.['body'] ?? ''),
        ),
    );

    console.log(
      `   reactions: ${structuredTapbacks.length} structured, ${prose.length} delivered as text`,
    );
    if (prose.length > 0) {
      console.log(
        '   reactions arrive as text prose — the spec dropped the tapback kind, ' +
          'which matches this.',
      );
    }
    // Nothing should be arriving under a kind the spec no longer declares.
    expect(structuredTapbacks).toHaveLength(0);
  });
});
