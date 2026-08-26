/**
 * Send a text message, then the same message again with the same idempotency
 * key to show the replay coming back as a duplicate rather than a second send.
 */
import { MspClient, uuidv7 } from '@1440io/msp-api';

const conversationId = process.argv[2];
if (!conversationId) {
  console.error('Usage: send-message.ts <conversationId>');
  process.exit(1);
}

const client = MspClient.fromEnv();

// Minting the key ourselves means a retry — even after a restart — collapses
// onto this send instead of delivering twice.
const requestMessageId = uuidv7();

const first = await client.messaging.sendText({
  conversationId,
  body: 'Thanks for reaching out — an agent will be with you shortly.',
  requestMessageId,
});
console.log('sent:', first.messageId, 'duplicate:', first.duplicate);

const replay = await client.messaging.sendText({
  conversationId,
  body: 'Thanks for reaching out — an agent will be with you shortly.',
  requestMessageId,
});
console.log('replayed:', replay.messageId, 'duplicate:', replay.duplicate); // duplicate: true
