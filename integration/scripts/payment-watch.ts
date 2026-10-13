/**
 * Watch the conversation for the customer's response to a payment request.
 *
 * Reads message history rather than requiring a webhook tunnel, so it works
 * from a laptop. The reply arrives as `amb.payment_response`, carrying the
 * opaque `state` you supplied and an echo of what you charged — never the
 * Apple Pay token, which goes to your payment gateway instead.
 */
import { MspClient } from '@1440io/msp-api';
import { paymentRequestOf, paymentState } from '@1440io/msp-webhooks';
import { env, hasCredentials } from '../env.ts';

if (!hasCredentials || !env.conversationId) {
  console.error('✗ MSP_API_KEY and MSP_TEST_CONVERSATION_ID are both required.');
  process.exit(1);
}

const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });
const seconds = Number(process.env['PAYMENT_WATCH_SECONDS'] ?? 180);
const deadline = Date.now() + seconds * 1000;
const seen = new Set<string>();

console.log(`\nWatching ${env.conversationId} for ${seconds}s — approve or cancel on the device.\n`);

while (Date.now() < deadline) {
  const detail = await client.conversations.get(env.conversationId, { count: 15 });
  for (const message of [...(detail.messages ?? [])].reverse()) {
    const row = message as unknown as Record<string, any>;
    const kind = row['content']?.['kind'];
    if (!kind || seen.has(row['id'])) continue;
    seen.add(row['id']);
    if (kind === 'amb.payment' || kind === 'amb.payment_response') {
      console.log(`  ${kind}  ${row['id']}`);
      if (kind === 'amb.payment_response') {
        const state = paymentState(row['content']);
        const request = paymentRequestOf(row['content']);
        console.log(`    state:  ${state ?? '(none)'}`);
        console.log(`    charge: ${request?.total?.amount} ${request?.currencyCode}`);
        console.log('\n  The customer responded. Confirm settlement with your payment gateway —');
        console.log('  1440 never sees the Apple Pay token.\n');
        process.exit(0);
      }
    }
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log('\n  No payment response within the window.\n');
