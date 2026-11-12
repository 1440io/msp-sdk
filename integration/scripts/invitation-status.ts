/** Show recent messaging invitations and their settlement status. */
import { MspClient } from '@1440io/msp-api';
import { env } from '../env.ts';

const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });
const page = await client.invitations.list({ count: 10 });
console.log();
for (const i of page.messagingInvitations) {
  const extras = [
    i.reasonCode ? `reason=${i.reasonCode}` : null,
    i.conversationId ? `conv=${i.conversationId}` : null,
    i.effectiveReference ? `ref=${i.effectiveReference}` : null,
  ].filter(Boolean).join('  ');
  console.log(`  ${i.id}  ${String(i.status).padEnd(10)}  ${i.createdAt ?? ''}  ${extras}`);
}
console.log();
