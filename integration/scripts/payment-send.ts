/**
 * Send a real Apple Pay request using a merchant session you generated.
 *
 * Merchant sessions expire in about five minutes, so this is built to fail
 * fast: it validates the session against the spec schema and checks the clock
 * *before* spending the window, and it is a dry run unless you pass `--send`.
 *
 *   1. Generate a session (initiative "messaging", your initiativeContext URL)
 *   2. Save Apple's raw JSON response to merchant-session.json in the repo root
 *   3. npm run payment:send            — validate only
 *      npm run payment:send -- --send  — actually put a payable bubble on the device
 *
 * `--send` creates a real charge prompt on a real device. It is off by default
 * for that reason.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MspClient, isMspApiError, uuidv7 } from '@1440io/msp-api';
import { env, hasCredentials } from '../env.ts';
import { checkSchema } from '../schema.ts';

const SEND = process.argv.includes('--send');
const AMOUNT = process.env['PAYMENT_AMOUNT'] ?? '1.00';
const CURRENCY = process.env['PAYMENT_CURRENCY'] ?? 'USD';
const LABEL = process.env['PAYMENT_LABEL'] ?? '1440 SDK test charge';

if (!hasCredentials || !env.conversationId) {
  console.error('✗ MSP_API_KEY and MSP_TEST_CONVERSATION_ID are both required.');
  process.exit(1);
}

const sessionPath = resolve(import.meta.dirname, '../../merchant-session.json');
let merchantSession: Record<string, unknown>;
try {
  merchantSession = JSON.parse(readFileSync(sessionPath, 'utf8')) as Record<string, unknown>;
} catch {
  console.error(`✗ Could not read ${sessionPath}`);
  console.error('  Save the raw JSON Apple returned from merchant validation there.');
  process.exit(1);
}

console.log('\nApple Pay payment request');
console.log(`  conversation: ${env.conversationId}`);
console.log(`  charge:       ${AMOUNT} ${CURRENCY} — "${LABEL}"`);

// ── Pre-flight, so a bad session never burns its own five-minute window ──────
const problems: string[] = [];

const { violations } = checkSchema('RequestPaymentBody', {
  requestMessageId: '018f1a2b-3c4d-7e8f-9012-3456789abcde',
  conversationId: env.conversationId,
  merchantSession,
  paymentRequest: { currencyCode: CURRENCY, total: { label: LABEL, amount: AMOUNT, type: 'final' } },
  receivedMessage: { title: LABEL, style: 'large' },
  replyMessage: { title: 'Thank you', style: 'large' },
});
for (const v of violations) if (v.includes('merchantSession')) problems.push(v);

const merchantId = String(merchantSession['merchantIdentifier'] ?? '');
if (!/^[a-fA-F0-9]{64}$/.test(merchantId)) {
  problems.push(
    `merchantIdentifier is ${JSON.stringify(merchantId.slice(0, 24))}… — the session must carry ` +
      "the 64-character hex value Apple returns, not your 'merchant.…' registration id",
  );
}

const expiresAt = Number(merchantSession['expiresAt'] ?? 0);
const secondsLeft = Math.round((expiresAt - Date.now()) / 1000);
if (!Number.isFinite(expiresAt) || expiresAt <= 0) problems.push('expiresAt is missing or invalid');
else if (secondsLeft <= 0) problems.push(`session expired ${-secondsLeft}s ago — generate a fresh one`);

console.log(`  merchant:     ${merchantId.slice(0, 16)}…  (${merchantId.length} chars)`);
console.log(`  session:      ${merchantSession['merchantSessionIdentifier']}`);
console.log(`  expires in:   ${secondsLeft}s`);
console.log(`  initiative:   ${merchantSession['initiative']} @ ${merchantSession['initiativeContext']}`);

if (problems.length > 0) {
  console.error('\n✗ Not sending:');
  for (const p of problems) console.error(`    - ${p}`);
  console.error();
  process.exit(1);
}
console.log('\n  ✓ session validates against the spec schema and has not expired');

if (!SEND) {
  console.log('\n  Dry run. Re-run with --send to put a real payable bubble on the device.\n');
  process.exit(0);
}

if (secondsLeft < 30) {
  console.error(`\n✗ Only ${secondsLeft}s left on the session — generate a fresh one.\n`);
  process.exit(1);
}

const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });
const requestMessageId = uuidv7();
console.log(`\n  sending… requestMessageId=${requestMessageId}`);

try {
  const result = await client.messaging.requestPayment({
    conversationId: env.conversationId,
    requestMessageId,
    merchantSession: merchantSession as never,
    paymentRequest: {
      currencyCode: CURRENCY,
      total: { label: LABEL, amount: AMOUNT, type: 'final' },
    } as never,
    receivedMessage: { title: LABEL, style: 'large' } as never,
    replyMessage: { title: 'Thank you', style: 'large' } as never,
  });
  console.log(`  ✓ delivered — messageId ${result.messageId}, duplicate ${result.duplicate}`);
  console.log('\n  Check the device: a payable bubble should be there.');
  console.log('  On approval Apple posts the encrypted token to YOUR payment gateway,');
  console.log('  not to 1440 — so settlement is confirmed with your PSP, not here.');
  console.log('\n  Watch for the reply with:  npm run payment:watch\n');
} catch (error) {
  if (!isMspApiError(error)) throw error;
  const body = error.body as { code?: string; error?: string; issues?: unknown[] } | undefined;
  console.error(`\n  ✗ ${error.status} ${body?.code ?? ''} ${body?.error ?? ''}`);
  if (body?.issues) console.error(`    ${JSON.stringify(body.issues)}`);
  const hints: Record<string, string> = {
    apple_pay_unavailable: 'Apple Pay is not enabled for this business.',
    apple_pay_session_expired: 'The session elapsed between minting and sending.',
    apple_pay_merchant_mismatch:
      "The session's merchantIdentifier does not match the one configured in 1440.\n" +
      '    Note that 1440 must hold the 64-hex value Apple returns, not "merchant.…".',
    apple_pay_gateway_mismatch:
      'The payment gateway in the session does not match the one configured in 1440.',
  };
  if (body?.code && hints[body.code]) console.error(`\n    ${hints[body.code]}`);
  console.error();
  process.exit(1);
}
