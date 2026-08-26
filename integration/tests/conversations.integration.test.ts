import { expect, it } from 'vitest';
import { MspNotFoundError } from '@1440io/msp-api';
import { AGENT_STATUSES, CONVERSATION_STATUSES } from '@1440io/msp-types';
import { describeApi, describeWrites } from '../gates.ts';
import { env } from '../env.ts';
import { testClient } from '../client.ts';
import { assertEachMatchesSchema, assertMatchesSchema } from '../schema.ts';

describeApi('conversations: reading', () => {
  it('returns a page in the documented envelope', async () => {
    const page = await testClient().conversations.list({ count: 5 });

    assertMatchesSchema('ConversationListResponse', page, 'GET /api/v0/conversations');
    expect(Array.isArray(page.conversations)).toBe(true);
    expect(page.conversations.length).toBeLessThanOrEqual(5);
    console.log(`   ${page.conversations.length} conversation(s), nextCursor=${page.nextCursor}`);
  });

  it('honours the count parameter', async () => {
    const page = await testClient().conversations.list({ count: 2 });

    expect(page.conversations.length).toBeLessThanOrEqual(2);
  });

  it('follows cursors to a genuinely different second page', async () => {
    const client = testClient();
    const first = await client.conversations.list({ count: 1 });

    if (!first.nextCursor) {
      console.log('   only one page of conversations — cursor test skipped');
      return;
    }

    const second = await client.conversations.list({ count: 1, cursor: first.nextCursor });

    assertMatchesSchema('ConversationListResponse', second, 'page 2');
    const firstId = first.conversations[0]?.id;
    const secondId = second.conversations[0]?.id;
    if (firstId && secondId) expect(secondId).not.toBe(firstId);
  });

  it('walks several pages through the paginator without repeating an id', async () => {
    const seen = new Set<string>();
    let count = 0;

    for await (const conversation of testClient().conversations.list({ count: 2 })) {
      expect(seen.has(conversation.id)).toBe(false); // a cursor bug would repeat here
      seen.add(conversation.id);
      count += 1;
      if (count >= 6) break; // three pages is enough to prove the cursor walks
    }

    console.log(`   walked ${count} conversation(s) across pages`);
  });

  it('only reports statuses the spec declares', async () => {
    const page = await testClient().conversations.list({ count: 25 });

    for (const conversation of page.conversations) {
      expect(CONVERSATION_STATUSES as readonly string[]).toContain(conversation.status);
      expect(AGENT_STATUSES as readonly string[]).toContain(conversation.agentStatus);
    }
  });

  it('filters by status', async () => {
    const page = await testClient().conversations.list({ count: 10, status: 'active' });

    for (const conversation of page.conversations) {
      expect(conversation.status).toBe('active');
    }
  });

  it('filters by platform', async () => {
    const page = await testClient().conversations.list({ count: 10, platform: 'amb' });

    for (const conversation of page.conversations) {
      expect(conversation.channelPlatform).toBe('amb');
    }
  });

  it('returns a conversation with its message window', async () => {
    const client = testClient();
    const page = await client.conversations.list({ count: 1 });
    const summary = page.conversations[0];

    if (!summary) {
      console.log('   no conversations in this org — detail test skipped');
      return;
    }

    const detail = await client.conversations.get(summary.id, { count: 10 });

    assertMatchesSchema('ConversationDetailResponse', detail, `GET /conversations/${summary.id}`);
    expect(detail.id).toBe(summary.id);
    expect(Array.isArray(detail.messages)).toBe(true);
    assertEachMatchesSchema('ConversationMessage', detail.messages, 'messages');
    console.log(`   ${detail.messages.length} message(s) on ${summary.id}`);
  });

  it('windows messages with before', async () => {
    const client = testClient();
    const page = await client.conversations.list({ count: 1 });
    const summary = page.conversations[0];
    if (!summary) return;

    const first = await client.conversations.get(summary.id, { count: 2 });
    const oldest = first.messages.at(-1);
    if (!oldest || first.messages.length < 2) {
      console.log('   too few messages to window — before test skipped');
      return;
    }

    const older = await client.conversations.get(summary.id, { count: 2, before: oldest.id });

    for (const message of older.messages) {
      expect(message.id).not.toBe(oldest.id);
    }
  });

  it('404s on a conversation id that does not exist', async () => {
    // A well-formed UUIDv7 that will not belong to this business.
    await expect(
      testClient().conversations.get('01890000-0000-7000-8000-00000000dead'),
    ).rejects.toBeInstanceOf(MspNotFoundError);
  });

  it('404s on a conversation belonging to another business', async () => {
    const error = await testClient()
      .conversations.get('01890000-0000-7000-8000-0000000000ff')
      .catch((e: unknown) => e);

    // Cross-tenant reads must be indistinguishable from "does not exist".
    expect(error).toBeInstanceOf(MspNotFoundError);
  });
});

describeWrites('conversations: renaming', () => {
  it('round-trips a customer name and restores the original', async () => {
    const client = testClient();
    const target = env.conversationId
      ? await client.conversations.get(env.conversationId)
      : (await client.conversations.list({ count: 1 })).conversations[0];

    if (!target) {
      console.log('   no conversation available — rename test skipped');
      return;
    }

    const original = { firstName: target.firstName, lastName: target.lastName };
    try {
      const renamed = await client.conversations.updateName(target.id, {
        firstName: 'Integration',
        lastName: 'Test',
      });

      assertMatchesSchema('ConversationListItem', renamed, 'PATCH /conversations/{id}');
      expect(renamed.firstName).toBe('Integration');
      expect(renamed.lastName).toBe('Test');

      const reread = await client.conversations.get(target.id, { count: 1 });
      expect(reread.firstName).toBe('Integration');
    } finally {
      // Put the customer's real name back, whatever happened above.
      await client.conversations.updateName(target.id, original);
    }
  });
});
