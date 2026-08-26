/**
 * List active conversations, following cursors, and print a one-line summary
 * of each. Demonstrates pagination and typed error handling.
 */
import { MspClient, isMspApiError } from '@1440io/msp-api';

const client = MspClient.fromEnv();

try {
  let count = 0;
  for await (const conversation of client.conversations.list({ status: 'active', count: 50 })) {
    const name = [conversation.firstName, conversation.lastName].filter(Boolean).join(' ') || '(unnamed)';
    console.log(
      `${conversation.id}  ${conversation.channelPlatform.padEnd(10)} ${conversation.agentStatus.padEnd(6)} ${name}`,
    );
    count += 1;
    if (count >= 100) break; // Stop early — the iterator will not fetch another page.
  }
  console.log(`\n${count} conversation(s).`);
} catch (error) {
  if (isMspApiError(error)) {
    console.error(`API error ${error.status}: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
