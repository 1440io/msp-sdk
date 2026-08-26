/**
 * Initiate a conversation with a customer and poll until the initiation
 * reaches a terminal status.
 *
 * Polling is fine for a script; in a service, handle `initiation.updated`
 * instead — see webhook-server.ts.
 */
import { MspClient } from '@1440io/msp-api';
import { isTerminalInitiationStatus } from '@1440io/msp-types';

const phoneNumber = process.argv[2];
if (!phoneNumber) {
  console.error('Usage: initiate-conversation.ts <e164PhoneNumber>');
  process.exit(1);
}

const client = MspClient.fromEnv();

let initiation = await client.initiations.create({
  channel: 'amb',
  phoneNumber,
  idempotencyKey: `example-${phoneNumber}-${new Date().toISOString().slice(0, 10)}`,
  targetAgentStatus: 'live',
});
console.log('created:', initiation.id, initiation.status);

while (!isTerminalInitiationStatus(initiation.status)) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  initiation = await client.initiations.get(initiation.id);
  console.log('status:', initiation.status);
}

console.log(
  initiation.status === 'accepted'
    ? `accepted — conversation ${initiation.conversationId}`
    : `ended as ${initiation.status} (${initiation.reasonCode ?? 'no reason code'})`,
);
