import { expect, it } from 'vitest';
import { isMspApiError, uuidv7 } from '@1440io/msp-api';
import { PERMISSION_KEYS } from '@1440io/msp-types';
import { describeApi, describeSend } from '../gates.ts';
import { env } from '../env.ts';
import { testClient } from '../client.ts';
import { assertMatchesSchema } from '../schema.ts';

/**
 * Typing indicators and Apple Pay requests.
 *
 * Typing is transient and safe to exercise against a real conversation — it
 * persists nothing. A payment request needs an Apple merchant session minted by
 * a merchant backend, which this suite has no way to obtain, so the payment
 * tests check the permission gate and the validation path rather than a
 * successful charge.
 */
const NOWHERE = '01890000-0000-7000-8000-0000000d0000';

function grantIncludes(permission: string, grant: readonly string[] | undefined): boolean {
  return (grant ?? []).includes(permission);
}

describeApi('payments: the permission gate', () => {
  it('declares RequestPayments in the permission catalogue', () => {
    // A grant missing it means requestPayment is a 403 for this integration.
    expect(PERMISSION_KEYS as readonly string[]).toContain('RequestPayments');
  });

  it('reports whether this integration may request payments', async () => {
    const token = await testClient().auth.exchangeIntegrationToken(env.apiKey!);
    const allowed = grantIncludes('RequestPayments', token.grant.permissionKeys);

    console.log(`   RequestPayments granted: ${allowed}`);
    expect(typeof allowed).toBe('boolean');
  });

  it('rejects a payment request with a malformed merchant session', async () => {
    const error = await testClient()
      .messaging.requestPayment({
        conversationId: NOWHERE,
        requestMessageId: uuidv7(),
        // Deliberately invalid: merchantIdentifier must be 64 hex characters.
        merchantSession: {
          epochTimestamp: Date.now(),
          expiresAt: Date.now() + 300_000,
          merchantSessionIdentifier: 'session',
          nonce: 'nonce',
          merchantIdentifier: 'not-hex',
          displayName: 'Integration Test',
          initiative: 'messaging',
          initiativeContext: 'https://example.com/checkout',
          signature: 'sig',
        } as never,
        paymentRequest: {
          currencyCode: 'USD',
          total: { label: 'Integration test', amount: '1.00', type: 'final' },
        } as never,
        receivedMessage: { title: 'Pay for your order' } as never,
        replyMessage: { title: 'Thanks' } as never,
      })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    if (!isMspApiError(error)) return;

    // 403 when the grant lacks RequestPayments, otherwise a validation reject.
    expect([400, 403, 422]).toContain(error.status);
    const body = error.body as { error?: string; code?: string; issues?: unknown[] } | undefined;
    console.log(
      `   rejected ${error.status}` +
        (body?.code ? ` code=${body.code}` : '') +
        (body?.issues ? ` issues=${body.issues.length}` : ''),
    );
    // Never silently accepted — that would be a payable bubble on a bad session.
    expect(error.status).not.toBe(200);
  });
});

describeSend('typing indicators', () => {
  it('starts and ends typing in a real conversation', async () => {
    const client = testClient();

    // Transient: nothing is persisted, so this leaves no trace in history.
    await expect(
      client.messaging.sendTyping({ conversationId: env.conversationId!, state: 'start' }),
    ).resolves.toBeUndefined();
    await expect(
      client.messaging.sendTyping({ conversationId: env.conversationId!, state: 'end' }),
    ).resolves.toBeUndefined();
  });

  it('leaves no message behind', async () => {
    const client = testClient();
    const before = await client.conversations.get(env.conversationId!, { count: 5 });

    await client.messaging.sendTyping({ conversationId: env.conversationId!, state: 'start' });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const after = await client.conversations.get(env.conversationId!, { count: 5 });
    expect(after.messages?.[0]?.id).toBe(before.messages?.[0]?.id);
  });

  it('rejects a state outside start and end', async () => {
    const error = await testClient()
      .messaging.sendTyping({ conversationId: env.conversationId!, state: 'hovering' as never })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && error.status).toBeGreaterThanOrEqual(400);
    expect(isMspApiError(error) && error.status).toBeLessThan(500);
  });
});

describeApi('typing: conversation ownership', () => {
  it('404s on a conversation this business does not own', async () => {
    const error = await testClient()
      .messaging.sendTyping({ conversationId: NOWHERE, state: 'start' })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && error.status).toBe(404);
  });
});
