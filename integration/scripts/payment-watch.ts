/**
 * Watch the conversation for the customer's response to a payment request.
 *
 * Reads message history rather than requiring a webhook tunnel, so it works
 * from a laptop. The reply arrives as `amb.payment_response`, carrying the
 * `state` Apple reports for the transaction and an echo of what you charged.
 * The request carries no `state` field, so this is Apple's word, not yours.
 * The Apple Pay token never passes through here — it goes to your gateway
 * instead.
 */
import { MspClient } from '@1440io/msp-api';
import { paymentRequestOf, paymentState, respondsTo } from '@1440io/msp-webhooks';
import { readFileSync } from 'node:fs';
import { env, hasCredentials } from '../env.ts';
import { MARKER, type PaymentMarker } from './payment-marker.ts';

if (!hasCredentials || !env.conversationId) {
  console.error('✗ MSP_API_KEY and MSP_TEST_CONVERSATION_ID are both required.');
  process.exit(1);
}

const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });
const seconds = Number(process.env['PAYMENT_WATCH_SECONDS'] ?? 180);

/** Read the conversation, newest message first. */
async function recent(): Promise<Record<string, any>[]> {
  const detail = await client.conversations.get(env.conversationId!, { count: 25 });
  const rows = (detail.messages ?? []) as unknown as Record<string, any>[];
  return [...rows].sort((a, b) =>
    String(b['createdAt'] ?? '').localeCompare(String(a['createdAt'] ?? '')),
  );
}

const when = (m: Record<string, any>) => String(m['createdAt'] ?? '');
const kindOf = (m: Record<string, any>) => String(m['content']?.['kind'] ?? '');

// Correlate on the request identifier Apple echoes back. Falling back to a
// timestamp anchor would accept any newer response; matching the identifier
// accepts only the reply to the request we actually sent.
let marker: PaymentMarker | null = null;
try {
  marker = JSON.parse(readFileSync(MARKER, 'utf8')) as PaymentMarker;
} catch {
  marker = null;
}

const anchor = (await recent()).find((m) => kindOf(m) === 'amb.payment');
if (!marker && !anchor) {
  console.log('\n  No payment request found on this conversation. Send one first.\n');
  process.exit(0);
}

const matches = marker
  ? (m: Record<string, any>) => respondsTo(m['content']) === marker!.requestMessageId
  : (m: Record<string, any>) => when(m) > when(anchor!);

console.log(`\nWatching ${env.conversationId} for ${seconds}s`);
if (marker) {
  console.log(`  correlating on requestMessageId ${marker.requestMessageId} (sent ${marker.sentAt})`);
} else {
  console.log(`  no marker file — falling back to responses newer than ${when(anchor!)}`);
}
console.log('  approve or cancel on the device.\n');

const deadline = Date.now() + seconds * 1000;
while (Date.now() < deadline) {
  const reply = (await recent()).find(
    (m) => kindOf(m) === 'amb.payment_response' && matches(m),
  );
  if (reply) {
    const state = paymentState(reply['content']);
    const request = paymentRequestOf(reply['content']);
    console.log(`  amb.payment_response  ${reply['id']}  (${when(reply)})`);
    console.log(`    state:  ${state ?? '(none)'}`);
    console.log(`    charge: ${request?.total?.amount} ${request?.currencyCode}`);
    console.log('\n  The customer responded. Confirm settlement with your payment gateway —');
    console.log('  1440 never sees the Apple Pay token.\n');
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log('\n  No response to that request within the window.\n');
