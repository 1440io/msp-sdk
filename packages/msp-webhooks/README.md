# @1440io/msp-webhooks

Signature verification and framework adapters for [1440](https://1440.io) MSP API webhooks.

```bash
npm install @1440io/msp-webhooks
```

Verification is built on Web Crypto, so the same code runs on Node 20.10+, Cloudflare Workers, Vercel Edge, Deno, and Bun. Ships ESM and CJS. Zero runtime dependencies beyond `@1440io/msp-types`.

## Events

| Type | Fires when |
| --- | --- |
| `message.received` | A customer sends an inbound message. `message.content` is a union tagged by `kind` — `text`, `opt_out`, `amb.quick_reply_response`, `amb.list_picker_response`, `amb.time_picker_response`, `amb.form_response`, `amb.authentication_response`, and a few more. |
| `messaging_invitation.updated` | A messaging invitation changes status. |

The envelope carries `eventId`, `v`, `organizationId`, `conversationId`, `channelAddress`, `intentId`, `groupId`, `locale`, and `capabilityList` — the rich-messaging capabilities the customer's device advertised, which is what to check before choosing a template.

Both arrive as an HTTP POST with a `Webhook-Id`, `Webhook-Timestamp`, and `Webhook-Signature` header. Any 2xx acknowledges; a non-2xx or a timeout is retried with backoff over several minutes and then abandoned. A `410 Gone` is terminal and disables delivery for the integration, so never return one by accident.

## The rules this package implements

Verification is easy to get subtly wrong, so all of it is handled here:

- HMAC-SHA256 over `{Webhook-Id}.{Webhook-Timestamp}.{rawBody}`, where the key is the base64-decode of the signing secret **after** the `whsec_` prefix.
- The HMAC covers the **exact request bytes**. Parsing and re-serializing the JSON changes key order or whitespace and breaks the signature — every adapter here passes raw bytes through.
- `Webhook-Signature` may carry several space-delimited `v1,…` tokens during a key rotation. The delivery is accepted if **any** token matches, and unknown scheme versions are ignored rather than rejected.
- Deliveries more than five minutes from now are rejected.
- The envelope's `eventId` must match the `Webhook-Id` header; a mismatch means the body and the signature headers describe different events, and is rejected.
- Retries reuse the same `Webhook-Id`, so dedupe on it.
- Header lookups are case-insensitive, and any verification error is a rejection.

## Quick start

```ts
import { WebhookReceiver, MemoryReplayCache } from '@1440io/msp-webhooks';

const receiver = new WebhookReceiver({
  secret: process.env.MSP_WEBHOOK_SECRET!,   // 'whsec_…', shown once at integration creation
  replayCache: new MemoryReplayCache(),
  on: {
    'message.received': async (event, context) => {
      console.log(context.id, event.conversationId, event.message.content?.kind);
    },
    'messaging_invitation.updated': async (event) => {
      const { messagingInvitationId, status } = event.messagingInvitation;
      console.log(messagingInvitationId, status);
    },
  },
  onError: (error) => logger.warn({ error }, 'webhook rejected'),
});

const result = await receiver.handle({ headers, body: rawBody });
// result.status: 200 verified (or already handled) · 400 rejected · 500 your handler threw
```

The status mapping is deliberate: a handler that throws returns 500 so the platform retries, while a duplicate returns 200 so it stops.

## Adapters

### Next.js App Router, Hono, Remix, Deno, Workers

```ts
// app/api/webhooks/1440/route.ts
import { createFetchWebhookHandler } from '@1440io/msp-webhooks/fetch';

export const POST = createFetchWebhookHandler({
  secret: process.env.MSP_WEBHOOK_SECRET!,
  on: { 'message.received': async (event) => { await enqueue(event); } },
});
```

### Express

```ts
import express from 'express';
import { createExpressWebhookHandler } from '@1440io/msp-webhooks/express';

const app = express();

// Raw body for this route only — express.json() would destroy the signed bytes.
app.post(
  '/webhooks/1440',
  express.raw({ type: '*/*' }),
  createExpressWebhookHandler({
    secret: process.env.MSP_WEBHOOK_SECRET!,
    on: { 'message.received': async (event) => { await enqueue(event); } },
  }),
);

app.use(express.json()); // everything else, as usual
```

If a JSON parser has already consumed the body, the handler forwards a clear error to `next()` instead of failing verification for no visible reason.

### Fastify

```ts
import Fastify from 'fastify';
import { fastifyMspWebhooks } from '@1440io/msp-webhooks/fastify';

const app = Fastify();

// Register in its own scope so the raw parser does not leak onto other routes.
await app.register(fastifyMspWebhooks, {
  path: '/webhooks/1440',
  secret: process.env.MSP_WEBHOOK_SECRET!,
  on: { 'message.received': async (event) => { await enqueue(event); } },
});
```

### AWS Lambda

```ts
import { createLambdaWebhookHandler } from '@1440io/msp-webhooks/lambda';

export const handler = createLambdaWebhookHandler({
  secret: process.env.MSP_WEBHOOK_SECRET!,
  on: { 'message.received': async (event) => { await enqueue(event); } },
});
```

Handles API Gateway payload formats 1.0 and 2.0 and Lambda Function URLs, base64 bodies included. A fresh execution environment starts with an empty in-memory replay cache, so back `replayCache` with DynamoDB or Redis if you need deduplication across invocations.

## Verifying by hand

```ts
import { WebhookVerifier } from '@1440io/msp-webhooks';

const verifier = new WebhookVerifier({ secret: process.env.MSP_WEBHOOK_SECRET! });
const { event, id, timestamp } = await verifier.verify({ headers, body: rawBody });
```

Keep one verifier around rather than constructing per request — it imports the HMAC key once.

`verify()` throws `WebhookVerificationError` with a `code`: `missing_headers`, `malformed_timestamp`, `stale_timestamp`, `invalid_signature_header`, `invalid_signature`, `invalid_secret`, `invalid_payload`, or `duplicate`. Treat them all as rejections except `duplicate`, which means you have already handled the event — acknowledge it with a 2xx.

## Rotating a secret

Pass both, and either verifies:

```ts
new WebhookVerifier({ secret: [process.env.MSP_WEBHOOK_SECRET_OLD!, process.env.MSP_WEBHOOK_SECRET_NEW!] });
```

## Replay protection

`MemoryReplayCache` is bounded and TTL'd (an hour by default), which is enough for a single long-lived process. Across instances, or anywhere the process is short-lived, implement the one-method `ReplayCache` interface over shared storage:

```ts
import type { ReplayCache } from '@1440io/msp-webhooks';

const redisCache: ReplayCache = {
  async seen(id) {
    // SET NX returns null when the key already exists.
    return (await redis.set(`webhook:${id}`, '1', 'EX', 3600, 'NX')) === null;
  },
};
```

## Narrowing events

```ts
import { isMessageReceived, isInitiationUpdated } from '@1440io/msp-webhooks';

if (isMessageReceived(event)) {
  event.data.message; // narrowed to the inbound message
}
```

`dataVersion` is date-pinned and changes additively, so pin the version you understand and ignore fields you do not recognize.

## Handling customer replies

`content` is a union tagged by `kind`, so TypeScript narrows it natively — no guard needed:

```ts
if (message.content?.kind === 'text') {
  message.content.body;      // narrowed
}
```

What the helpers add is normalization. The interactive payloads arrive in Apple's native shape — hyphenated keys, per-kind nesting, timestamps that are not RFC 3339 — and reading them by hand is where the bugs live:

```ts
import {
  textBody, selectedIds, selectedTitles, selectedTimeslot,
  formAnswers, authenticationStatus, respondsTo, sessionOf,
  isInteractiveResponse, isRedacted, isKind,
} from '@1440io/msp-webhooks';

on: {
  'message.received': async (event) => {
    const { content } = event.message;

    // A private form response arrives with its body withheld.
    if (isRedacted(event.message)) return;

    const body = textBody(content);
    if (body !== null) console.log(body);

    if (isInteractiveResponse(content)) {
      const prompt = respondsTo(content);   // which rich message was answered
      const session = sessionOf(content);

      switch (content.kind) {
        case 'amb.quick_reply_response':
        case 'amb.list_picker_response':
          console.log(selectedIds(content), selectedTitles(content));
          break;
        case 'amb.time_picker_response': {
          const slot = selectedTimeslot(content);   // { id, startsAt: Date, durationSeconds }
          break;
        }
        case 'amb.form_response':
          console.log(formAnswers(content));        // keyed by page identifier
          break;
        case 'amb.authentication_response':
          console.log(authenticationStatus(content));  // success | failure | cancel | unknown
          break;
      }
    }

    if (isKind(content, 'opt_out')) await suppress(event.conversationId);
  },
}
```

### Correlating a reply with its prompt

`respondsTo(content)` returns the identifier of the rich message being answered, so a bot holding several prompts open knows which was tapped. It returns `null` when the channel made no correlation promise — custom iMessage apps carry none — so never assume it is present.

### Two things production does that the spec does not describe

**Reactions arrive as text.** A "Liked" reaction comes through as `kind: 'text'` with the body `"Liked 1 Business Message"`. This revision dropped the `tapback` kind entirely, which matches the behaviour, so there is nothing to narrow to.

**Time-picker times are not RFC 3339.** The schema pins them to `YYYY-MM-DDTHH:mm+0000` — no seconds, no colon in the offset. JavaScript's `Date` accepts it, so the problem stays hidden until the value reaches a stricter parser (`Temporal.Instant.from`, `date-fns/parseISO`, Go, Java, Python). `selectedTimeslot()` and `parseAppleTimestamp()` handle both forms and hand back a real `Date`.

## Rotating a secret

Pass both, and either verifies:

```ts
new WebhookVerifier({ secret: [process.env.MSP_WEBHOOK_SECRET_OLD!, process.env.MSP_WEBHOOK_SECRET_NEW!] });
```

## Replay protection

`MemoryReplayCache` is bounded and TTL'd (an hour by default), which is enough for a single long-lived process. Across instances, or anywhere the process is short-lived, implement the one-method `ReplayCache` interface over shared storage:

```ts
import type { ReplayCache } from '@1440io/msp-webhooks';

const redisCache: ReplayCache = {
  async seen(id) {
    // SET NX returns null when the key already exists.
    return (await redis.set(`webhook:${id}`, '1', 'EX', 3600, 'NX')) === null;
  },
};
```

## Narrowing events

```ts
import { isMessageReceived, isInitiationUpdated } from '@1440io/msp-webhooks';

if (isMessageReceived(event)) {
  event.data.message; // narrowed to the inbound message
}
```

`dataVersion` is date-pinned and changes additively, so pin the version you understand and ignore fields you do not recognize.

## Handling customer replies

A message's `content` shape is decided by its sibling `messageType`, which
TypeScript cannot narrow on its own — inside `if (message.messageType === 'interactive')`,
`message.content.responseType` is still an error. These guards do it properly:

```ts
import {
  isTextMessage,
  isInteractiveMessage,
  isTapbackMessage,
  isOptOutMessage,
  selectedIds,
  selectedTitles,
  formValuesByPage,
  respondsTo,
} from '@1440io/msp-webhooks';

on: {
  'message.received': async (event) => {
    const { message } = event.data;

    if (isTextMessage(message)) {
      console.log(message.content.body);          // no cast
    }

    if (isInteractiveMessage(message)) {
      // Which rich message was this a reply to?
      const prompt = respondsTo(message);          // requestIdentifier, or null

      switch (message.content.responseType) {
        case 'quick_reply':
        case 'list_picker':
          console.log(selectedIds(message.content), selectedTitles(message.content));
          break;
        case 'time_picker':
          console.log(message.content.selectedStartTime);
          break;
        case 'form':
          console.log(formValuesByPage(message.content));
          if (message.content.private) {
            // Private form responses are access-restricted — do not log or forward.
          }
          break;
      }
    }

    if (isTapbackMessage(message)) {
      console.log(message.content.kind, 'on', message.content.targetMessageId);
    }

    if (isOptOutMessage(message)) {
      await suppress(event.conversationId, message.content.reason);
    }
  },
}
```

### Correlating a reply with its prompt

`respondsTo(message)` returns the identifier of the rich message being answered, so a bot holding several prompts open at once knows which was tapped. Send a raw interactive payload with your own `requestIdentifier` and the platform preserves it:

```ts
const requestIdentifier = uuidv7();

await client.messaging.sendRaw({
  conversationId,
  channel: 'amb',
  messageType: 'quick_reply',
  payload: {
    type: 'interactive',
    interactiveData: {
      bid: AMB_INTERACTIVE_BID,
      data: {
        version: '1.0',
        requestIdentifier,
        'quick-reply': { summaryText: 'How did we do?', items },
      },
    },
  },
});
```

`respondsTo` returns `null` when the channel made no correlation promise — custom iMessage apps are documented as carrying none at all, so never assume it is present.

### Two things production does that the spec does not describe

Both confirmed against the live API, and both will bite silently.

**Time-picker times are not RFC 3339.** `selectedStartTime` is declared as a `date-time`, but what arrives is Apple's basic format — `2026-08-25T23:55+0000`, with no seconds and no colon in the offset. JavaScript's `Date` happens to accept it, so `new Date(value)` works and the problem stays hidden until the value reaches something stricter: `Temporal.Instant.from`, `date-fns/parseISO`, Go's `time.RFC3339`, Java's `Instant.parse`, and Python's `fromisoformat` all reject it.

```ts
import { selectedStartTime, parseAppleTimestamp } from '@1440io/msp-webhooks';

const when = selectedStartTime(message.content);   // Date | null, handles both forms
when?.toISOString();                               // safe to hand downstream
```

**Reactions arrive as text, not tapbacks.** A "Liked" reaction on AMB has been observed arriving as `messageType: 'text'` with the body `"Liked 1 Business Message"` — not as `messageType: 'tapback'` with a structured `kind` and `targetMessageId`. `isTapbackMessage()` is there for when a channel does send a structured one, but do not build reaction handling on it alone; a text body matching that prose is what you will actually receive on AMB today.

## Replying to a message

Verification is inbound-only — the signing secret is never used to send. To reply, use [`@1440io/msp-api`](../msp-api) with the event's `conversationId` and your integration API key.

```ts
import { MspClient } from '@1440io/msp-api';

const client = new MspClient({ apiKey: process.env.MSP_API_KEY! });

on: {
  'message.received': async (event) => {
    await client.messaging.sendText({
      conversationId: event.conversationId,
      body: 'Thanks — an agent will be with you shortly.',
    });
  },
}
```

Acknowledge fast and do the work asynchronously where you can: the platform retries on a timeout, and a slow handler turns into duplicate deliveries.

## License

MIT
