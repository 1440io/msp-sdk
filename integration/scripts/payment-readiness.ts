/**
 * Report how far an Apple Pay request gets, without charging anyone.
 *
 * The platform runs its payment checks in a documented order:
 *
 *   apple_pay_unavailable → apple_pay_session_expired
 *     → apple_pay_merchant_mismatch → apple_pay_gateway_mismatch
 *
 * so the first one that fires says how much configuration is in place. This
 * sends a structurally valid request carrying a deliberately bogus merchant
 * session: it can never produce a payable bubble, because the merchant will
 * not match and the signature is not Apple's.
 *
 * Run it after each configuration change:
 *   npm run payment:readiness
 */
import { MspClient, isMspApiError, uuidv7 } from '@1440io/msp-api';
import { env, hasCredentials } from '../env.ts';

if (!hasCredentials) {
  console.error('✗ MSP_API_KEY is not set.');
  process.exit(1);
}
if (!env.conversationId) {
  console.error('✗ MSP_TEST_CONVERSATION_ID is not set — the payment checks run after conversation lookup.');
  process.exit(1);
}

const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });

const token = await client.auth.exchangeIntegrationToken(env.apiKey!);
const granted = (token.grant.permissionKeys ?? []).includes('RequestPayments');
const settings = await client.admin.settings().catch(() => undefined);

console.log(`\nApple Pay readiness — ${env.baseUrl}`);
if (settings) console.log(`  business: ${settings.name} (${settings.slug}) ${settings.id}`);
console.log(`  ${granted ? '✓' : '✗'} RequestPayments permission`);

if (!granted) {
  console.log('\n  Grant RequestPayments to this integration before going further.\n');
  process.exit(0);
}

const outcome = await client.messaging
  .requestPayment({
    conversationId: env.conversationId,
    requestMessageId: uuidv7(),
    // Deliberately not a real Apple session: 64 hex zeros will not match any
    // configured merchant, so this cannot become a payable bubble.
    merchantSession: {
      epochTimestamp: Date.now(),
      expiresAt: Date.now() + 300_000,
      merchantSessionIdentifier: 'readiness-probe',
      nonce: 'readiness-probe',
      merchantIdentifier: '0'.repeat(64),
      displayName: 'Readiness probe',
      initiative: 'messaging',
      initiativeContext: 'https://example.com/readiness',
      signature: 'not-a-real-signature',
    },
    paymentRequest: {
      currencyCode: 'USD',
      total: { label: 'Readiness probe', amount: '1.00', type: 'final' },
    } as never,
    receivedMessage: { title: 'Readiness probe — not a real charge', style: 'large' } as never,
    replyMessage: { title: 'Readiness probe', style: 'large' } as never,
  })
  .then(
    (result) => ({ accepted: true as const, result }),
    (error: unknown) => {
      if (!isMspApiError(error)) throw error;
      return { accepted: false as const, status: error.status, body: error.body as Record<string, unknown> };
    },
  );

if (outcome.accepted) {
  console.log(`\n  ⚠ ACCEPTED (messageId ${outcome.result.messageId}).`);
  console.log('    A bogus session was not rejected — check the device, and check what');
  console.log('    the platform validates before delivering a payable bubble.\n');
  process.exit(0);
}

const code = String(outcome.body?.['code'] ?? '');
const message = String(outcome.body?.['error'] ?? '');

const ladder: Record<string, string> = {
  apple_pay_unavailable:
    'Apple Pay is not configured for this business. This is the first check, so\n' +
    '    nothing downstream is reachable yet: confirm Apple approval, business\n' +
    '    enablement, and that a merchant identifier and payment gateway are set.',
  apple_pay_session_expired:
    'Configuration is in place and the merchant matched — the probe session was\n' +
    '    simply stale. Real sessions last about five minutes; mint one per request.',
  apple_pay_merchant_mismatch:
    'Configuration is in place. The probe merchant did not match the configured\n' +
    '    one, which is exactly right for a bogus session — this is the furthest a\n' +
    '    probe can get. Supply a real merchant session next.',
  apple_pay_gateway_mismatch:
    'Merchant matched; the gateway did not. Check the payment gateway registered\n' +
    '    for this business against the one Apple has.',
};

console.log(`  ✗ payment request: ${outcome.status} ${code || '(no code)'}`);
if (message) console.log(`    ${message}`);
if (ladder[code]) console.log(`\n    ${ladder[code]}`);
else if (outcome.status === 400) {
  console.log(`\n    Rejected by schema validation rather than a payment check:`);
  console.log(`    ${JSON.stringify(outcome.body?.['issues'] ?? outcome.body)}`);
}
console.log();
