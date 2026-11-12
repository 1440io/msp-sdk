/**
 * A webhook endpoint on plain `node:http` that verifies every delivery, replies
 * to inbound text messages, and tracks initiation outcomes.
 *
 * The raw request bytes are collected by hand here — that is the whole point:
 * the signature covers the exact bytes, so nothing may parse them first.
 */
import { createServer } from 'node:http';
import { MspClient } from '@1440io/msp-api';
import {
  MemoryReplayCache,
  WebhookReceiver,
  isInteractiveResponse,
  respondsTo,
  selectedIds,
  textBody,
} from '@1440io/msp-webhooks';

const client = MspClient.fromEnv();

const receiver = new WebhookReceiver({
  secret: process.env.MSP_WEBHOOK_SECRET!,
  replayCache: new MemoryReplayCache(),
  on: {
    'message.received': async (event, context) => {
      const { message } = event;
      console.log(`[${context.id}] ${message.content?.kind} on ${event.conversationId}`);

      const body = textBody(message.content);
      if (body !== null) {
        await client.messaging.sendText({
          conversationId: event.conversationId,
          body: `Got it — you said "${body}". An agent is on the way.`,
        });
      }

      // A tapped rich message: report what they chose and which prompt it answered.
      if (isInteractiveResponse(message.content)) {
        console.log(
          `  chose ${JSON.stringify(selectedIds(message.content))} ` +
            `in reply to ${respondsTo(message.content) ?? '(uncorrelated)'}`,
        );
      }
    },
    'messaging_invitation.updated': async (event) => {
      const { messagingInvitationId, status, reasonCode } = event.messagingInvitation;
      console.log(
        `invitation ${messagingInvitationId} → ${status}${reasonCode ? ` (${reasonCode})` : ''}`,
      );
    },
  },
  onError: (error) => console.warn('webhook rejected:', error),
});

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhooks/1440') {
    res.writeHead(404).end();
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  const result = await receiver.handle({ headers: req.headers, body: Buffer.concat(chunks) });

  res.writeHead(result.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(result.body));
});

server.listen(3000, () => console.log('listening on http://localhost:3000/webhooks/1440'));
