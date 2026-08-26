/**
 * A standing webhook receiver for manual end-to-end checks.
 *
 * Run it, expose it with a tunnel, and point your integration's webhook URL at
 * `<public-url>/webhooks/1440`:
 *
 *   npm run webhook:listen
 *   cloudflared tunnel --url http://localhost:3000
 *
 * Every delivery is verified with the real signing secret and printed. Failed
 * verifications are printed loudly rather than silently dropped.
 */
import { createServer } from 'node:http';
import { MemoryReplayCache, WebhookReceiver } from '@1440io/msp-webhooks';
import { env } from '../env.ts';

if (!env.webhookSecret) {
  console.error('✗ MSP_WEBHOOK_SECRET is not set. Add it to .env.local.');
  process.exit(1);
}

let verified = 0;
let rejected = 0;

const receiver = new WebhookReceiver({
  secret: env.webhookSecret,
  replayCache: new MemoryReplayCache(),
  on: {
    'message.received': (event, context) => {
      const { message } = event.data;
      const preview =
        message.messageType === 'text' && 'body' in message.content
          ? JSON.stringify(message.content.body).slice(0, 120)
          : message.messageType;
      console.log(
        `✓ message.received  ${context.id}\n` +
          `    conversation ${event.conversationId} · ${message.channelPlatform} · ${preview}` +
          (message.attachments.length ? `\n    ${message.attachments.length} attachment(s)` : ''),
      );
    },
    'initiation.updated': (event, context) => {
      const { initiationId, status, reasonCode, conversationId } = event.data;
      console.log(
        `✓ initiation.updated ${context.id}\n` +
          `    ${initiationId} → ${status}${reasonCode ? ` (${reasonCode})` : ''}` +
          (conversationId ? ` · conversation ${conversationId}` : ''),
      );
    },
  },
  onEvent: () => {
    verified += 1;
  },
  onUnhandledEvent: (event) => {
    console.log(`? ${event.type} — no handler for this type (the SDK may be behind the platform)`);
  },
  onError: (error) => {
    rejected += 1;
    console.error(`✗ rejected: ${error instanceof Error ? error.message : String(error)}`);
  },
});

const server = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' }).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  const result = await receiver.handle({ headers: req.headers, body: Buffer.concat(chunks) });
  res.writeHead(result.status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(result.body));
});

server.listen(env.webhookPort, () => {
  console.log(`listening on http://localhost:${env.webhookPort}/webhooks/1440`);
  console.log('expose it with:  cloudflared tunnel --url http://localhost:' + env.webhookPort);
  console.log('then set that public URL as the integration webhook endpoint.\n');
});

process.on('SIGINT', () => {
  console.log(`\n${verified} verified, ${rejected} rejected.`);
  server.close(() => process.exit(0));
});
