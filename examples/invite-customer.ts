/**
 * Invite a customer into a conversation and poll until the invitation settles.
 *
 * Polling is fine for a script; in a service, handle
 * `messaging_invitation.updated` instead — see webhook-server.ts.
 */
import { MspClient } from '@1440io/msp-api';
import { isTerminalInvitationStatus } from '@1440io/msp-types';

const phoneNumber = process.argv[2];
if (!phoneNumber) {
  console.error('Usage: invite-customer.ts <e164PhoneNumber>');
  process.exit(1);
}

const client = MspClient.fromEnv();

let invitation = await client.invitations.create({
  phoneNumber,
  targetAgentStatus: 'live',
  targetFirstName: 'Ada',
});
console.log('created:', invitation.id, invitation.status);

while (!isTerminalInvitationStatus(invitation.status)) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  invitation = await client.invitations.get(invitation.id);
  console.log('status:', invitation.status);
}

console.log(
  invitation.status === 'accepted'
    ? `accepted — conversation ${invitation.conversationId}`
    : `ended as ${invitation.status} (${invitation.reasonCode ?? 'no reason code'})`,
);
