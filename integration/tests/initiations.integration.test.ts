import { expect, it } from 'vitest';
import { isMspApiError } from '@1440io/msp-api';
import { INITIATION_STATUSES, isTerminalInitiationStatus } from '@1440io/msp-types';
import { describeApi, describeInitiate } from '../gates.ts';
import { env, RUN_ID } from '../env.ts';
import { testClient } from '../client.ts';
import { assertEachMatchesSchema, assertMatchesSchema } from '../schema.ts';

describeApi('initiations: reading', () => {
  it('lists initiations in the documented envelope', async () => {
    const page = await testClient().initiations.list({ count: 5 });

    assertMatchesSchema('ConversationInitiationList', page, 'GET /messaging/initiations');
    assertEachMatchesSchema('ConversationInitiation', page.initiations, 'initiations');
    console.log(`   ${page.initiations.length} initiation(s)`);
  });

  it('only reports statuses the spec declares', async () => {
    const page = await testClient().initiations.list({ count: 25 });

    for (const initiation of page.initiations) {
      expect(INITIATION_STATUSES as readonly string[]).toContain(initiation.status);
      if (initiation.status === 'accepted') {
        // An accepted initiation without a conversation is unusable.
        expect(initiation.conversationId).not.toBeNull();
      }
    }
  });

  it('filters by status', async () => {
    const page = await testClient().initiations.list({ count: 10, status: 'accepted' });

    for (const initiation of page.initiations) expect(initiation.status).toBe('accepted');
  });

  it('gets one initiation by id', async () => {
    const client = testClient();
    const page = await client.initiations.list({ count: 1 });
    const first = page.initiations[0];

    if (!first) {
      console.log('   no initiations in this org — detail test skipped');
      return;
    }

    const one = await client.initiations.get(first.id);

    assertMatchesSchema('ConversationInitiation', one, 'GET /messaging/initiations/{id}');
    expect(one.id).toBe(first.id);
  });

  it('404s on an initiation id that does not exist', async () => {
    const error = await testClient()
      .initiations.get('01890000-0000-7000-8000-00000000f00d')
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && error.status).toBe(404);
  });
});

describeInitiate('initiations: reaching a real device', () => {
  it('initiates a conversation and reaches a terminal status', async () => {
    const client = testClient();
    // Stable per run, so a re-run inside the same run id is idempotent rather
    // than pinging the device twice.
    const idempotencyKey = `${RUN_ID}-initiate`;

    const created = await client.initiations.create({
      channel: env.channel,
      phoneNumber: env.phoneNumber!,
      idempotencyKey,
      callerReference: RUN_ID,
      targetAgentStatus: 'bot',
      targetFirstName: 'Integration',
      targetLastName: 'Test',
    });

    assertMatchesSchema('ConversationInitiation', created, 'POST /messaging/initiations');
    expect(created.effectiveReference).toBe(RUN_ID);
    expect(INITIATION_STATUSES as readonly string[]).toContain(created.status);
    console.log(`   initiation ${created.id} → ${created.status}`);

    let current = created;
    const deadline = Date.now() + 45_000;
    while (!isTerminalInitiationStatus(current.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      current = await client.initiations.get(created.id);
    }

    console.log(
      `   settled at ${current.status}${current.reasonCode ? ` (${current.reasonCode})` : ''}`,
    );
    if (isTerminalInitiationStatus(current.status)) {
      // Every terminal state must explain itself: a conversation, or a reason.
      if (current.status === 'accepted') expect(current.conversationId).not.toBeNull();
      else if (current.status !== 'declined') expect(current.reasonCode).not.toBeNull();
    }
  }, 90_000);

  it('replays the same idempotency key instead of initiating twice', async () => {
    const client = testClient();
    const idempotencyKey = `${RUN_ID}-initiate`;

    const replay = await client.initiations.create({
      channel: env.channel,
      phoneNumber: env.phoneNumber!,
      idempotencyKey,
      callerReference: RUN_ID,
      targetAgentStatus: 'bot',
      targetFirstName: 'Integration',
      targetLastName: 'Test',
    });

    const listed = await client.initiations.list({ count: 50 }).toArray(50);
    const matching = listed.filter((item) => item.effectiveReference === RUN_ID);

    // The device must have been pinged once, not once per call.
    expect(matching.length).toBeLessThanOrEqual(1);
    expect(replay.effectiveReference).toBe(RUN_ID);
  });

  it('rejects a malformed phone number without contacting anyone', async () => {
    const error = await testClient()
      .initiations.create({
        channel: env.channel,
        phoneNumber: 'not-a-phone-number',
        idempotencyKey: `${RUN_ID}-invalid`,
      })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && error.status).toBeGreaterThanOrEqual(400);
    expect(isMspApiError(error) && error.status).toBeLessThan(500);
  });
});
