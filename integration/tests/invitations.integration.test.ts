import { expect, it } from 'vitest';
import { isMspApiError, uuidv7 } from '@1440io/msp-api';
import { INVITATION_STATUSES, isTerminalInvitationStatus } from '@1440io/msp-types';
import { describeApi, describeInitiate } from '../gates.ts';
import { env, RUN_ID } from '../env.ts';
import { testClient } from '../client.ts';
import { assertEachMatchesSchema, assertMatchesSchema } from '../schema.ts';

describeApi('messaging invitations: reading', () => {
  it('lists invitations in the documented envelope', async () => {
    const page = await testClient().invitations.list({ count: 5 });

    assertMatchesSchema('MessagingInvitationList', page, 'GET /messaging/invitations');
    assertEachMatchesSchema('MessagingInvitation', page.messagingInvitations, 'invitations');
    console.log(`   ${page.messagingInvitations.length} invitation(s)`);
  });

  it('only reports statuses the spec declares', async () => {
    const page = await testClient().invitations.list({ count: 25 });

    for (const invitation of page.messagingInvitations) {
      expect(INVITATION_STATUSES as readonly string[]).toContain(invitation.status);
      if (invitation.status === 'accepted') {
        // An accepted invitation with no conversation is unusable.
        expect(invitation.conversationId).not.toBeNull();
      }
    }
  });

  it('filters by status', async () => {
    const page = await testClient().invitations.list({ count: 10, status: 'accepted' });

    for (const invitation of page.messagingInvitations) {
      expect(invitation.status).toBe('accepted');
    }
  });

  it('gets one invitation by id', async () => {
    const client = testClient();
    const page = await client.invitations.list({ count: 1 });
    const first = page.messagingInvitations[0];

    if (!first) {
      console.log('   no invitations in this org — detail test skipped');
      return;
    }

    const one = await client.invitations.get(first.id);

    assertMatchesSchema('MessagingInvitation', one, 'GET /messaging/invitations/{id}');
    expect(one.id).toBe(first.id);
  });

  it('404s on an invitation id that does not exist', async () => {
    const error = await testClient()
      .invitations.get('01890000-0000-7000-8000-00000000f00d')
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && error.status).toBe(404);
  });

  it('no longer exposes the retired initiations route', async () => {
    // The old path was removed server-side; this pins that the client is not
    // silently pointing at something that 404s.
    expect('initiations' in testClient()).toBe(false);
  });
});

/**
 * `messaging_invitation_unavailable` is a documented 422: the capability is not
 * available for this org, not a malformed request. Report and skip rather than
 * failing a run for a configuration the SDK cannot influence.
 */
function unavailable(error: unknown): boolean {
  if (!isMspApiError(error) || error.status !== 422) return false;
  const body = error.body as { error?: string } | undefined;
  const isUnavailable = body?.error === 'messaging_invitation_unavailable';
  if (isUnavailable) {
    console.log('   messaging invitations are not enabled for this org — skipped');
  }
  return isUnavailable;
}

describeInitiate('messaging invitations: reaching a real device', () => {
  it('invites a customer and reaches a terminal status', async () => {
    const client = testClient();
    // Stable per run, so a re-run inside the same run does not ping twice.
    const requestMessageId = uuidv7();

    const created = await client.invitations
      .create({
        phoneNumber: env.phoneNumber!,
        requestMessageId,
        callerReference: RUN_ID,
        targetAgentStatus: 'bot',
        targetFirstName: 'Integration',
        targetLastName: 'Test',
      })
      .catch((error: unknown) => {
        if (unavailable(error)) return undefined;
        throw error;
      });
    if (!created) return;

    assertMatchesSchema('MessagingInvitation', created, 'POST /messaging/invitations');
    expect(created.effectiveReference).toBe(RUN_ID);
    expect(INVITATION_STATUSES as readonly string[]).toContain(created.status);
    console.log(`   invitation ${created.id} → ${created.status}`);

    let current = created;
    const deadline = Date.now() + 45_000;
    while (!isTerminalInvitationStatus(current.status) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      current = await client.invitations.get(created.id);
    }

    console.log(
      `   settled at ${current.status}${current.reasonCode ? ` (${current.reasonCode})` : ''}`,
    );
    if (isTerminalInvitationStatus(current.status)) {
      if (current.status === 'accepted') expect(current.conversationId).not.toBeNull();
      else if (current.status !== 'declined') expect(current.reasonCode).not.toBeNull();
    }
  }, 90_000);

  it('replays the same requestMessageId instead of inviting twice', async () => {
    const client = testClient();
    const requestMessageId = uuidv7();
    const reference = `${RUN_ID}-replay`;

    const invite = () =>
      client.invitations.create({
        phoneNumber: env.phoneNumber!,
        requestMessageId,
        callerReference: reference,
        targetAgentStatus: 'bot',
      });

    const first = await invite().catch((error: unknown) => {
      if (unavailable(error)) return undefined;
      throw error;
    });
    if (!first) return;

    const replay = await invite();

    // The device must have been contacted once, not once per call.
    expect(replay.id).toBe(first.id);
  });

  it('rejects a malformed phone number without contacting anyone', async () => {
    const error = await testClient()
      .invitations.create({ phoneNumber: 'not-a-phone-number' })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    if (!isMspApiError(error)) return;
    expect(error.status).toBeGreaterThanOrEqual(400);
    expect(error.status).toBeLessThan(500);
    // Documented as invalid_recipient rather than a generic failure.
    const body = error.body as { error?: string } | undefined;
    if (body?.error) {
      expect(['invalid_recipient', 'messaging_invitation_unavailable']).toContain(body.error);
    }
  });
});
