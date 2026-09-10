# 1440 MSP SDK

TypeScript packages for the **1440 Apple Messages for Business MSP API**, generated from and kept in sync with `spec/1440-cloud-openapi.json`.

| Package | What it is |
| --- | --- |
| [`@1440io/msp-api`](packages/msp-api) | The client. Auto JWT exchange and refresh, cursor pagination, typed errors, retries. |
| [`@1440io/msp-webhooks`](packages/msp-webhooks) | Webhook signature verification and framework adapters. Web Crypto, so it runs on Node, edge, Workers, and Deno. |
| [`@1440io/msp-types`](packages/msp-types) | Types generated from the OpenAPI spec, plus curated aliases and enum vocabularies. Both packages above depend on it. |

## Install

```bash
npm install @1440io/msp-api
```

Add the webhook package wherever you receive deliveries — often a different service than the one that sends:

```bash
npm install @1440io/msp-webhooks
```

## Send a message

```ts
import { MspClient } from '@1440io/msp-api';

const client = new MspClient({ apiKey: process.env.MSP_API_KEY! });

for await (const conversation of client.conversations.list({ status: 'active' })) {
  await client.messaging.sendText({
    conversationId: conversation.id,
    body: 'Thanks for reaching out — an agent is on the way.',
  });
}
```

The client exchanges your `msp_…` integration API key for a short-lived access JWT, caches it, refreshes it a minute before expiry, and retries once if the server rejects a token early. Nothing to wire up.

## Receive a webhook

```ts
// app/api/webhooks/1440/route.ts (Next.js App Router)
import { createFetchWebhookHandler } from '@1440io/msp-webhooks/fetch';

export const POST = createFetchWebhookHandler({
  secret: process.env.MSP_WEBHOOK_SECRET!,
  on: {
    'message.received': async (event) => {
      console.log(event.conversationId, event.message.content?.kind);
    },
    'messaging_invitation.updated': async (event) => {
      const { messagingInvitationId, status } = event.messagingInvitation;
      console.log(messagingInvitationId, status);
    },
  },
});
```

Adapters also ship for [Express](packages/msp-webhooks/README.md#express), [Fastify](packages/msp-webhooks/README.md#fastify), and [AWS Lambda](packages/msp-webhooks/README.md#aws-lambda).

## Repository layout

```
spec/1440-cloud-openapi.json   Source of truth — the OpenAPI 3.1 document
packages/msp-types             Generated types + curated aliases
packages/msp-api               The client, hand-written over those types
packages/msp-webhooks          Verification + adapters
integration                    Tests against the live API
examples                       Runnable snippets
```

## Working on the SDK

Node 20.10+ and npm workspaces (no pnpm needed).

```bash
npm install
npm run generate   # regenerate types from spec/1440-cloud-openapi.json
npm run build      # tsup dual ESM + CJS build for all three packages
npm test           # vitest — offline, no credentials needed
npm run typecheck  # tsc --noEmit per package, plus examples and integration
```

### Testing against the live API

`npm test` never touches the network. A separate suite in [`integration/`](integration) runs against a real org: it exercises the routes end to end and validates every live response against the OpenAPI schemas, so a run doubles as a drift check between production and the spec.

```bash
cp .env.example .env.local     # fill in your key — the file is gitignored
npm run integration:preflight  # shows exactly what a run would touch
npm run test:integration
```

Reads need only a key. Writing records, sending a real message, and initiating to a real phone each need their own opt-in flag, so a stale `.env.local` or a mistyped host cannot message a customer by accident. See [integration/README.md](integration/README.md).

### When the API changes

1. Drop the new OpenAPI document at `spec/1440-cloud-openapi.json`.
2. `npm run generate` — `packages/msp-types/src/openapi.ts` is regenerated wholesale. Never hand-edit it.
3. `npm run typecheck`. Anything the spec changed underneath the client surfaces here as a type error.
4. Adjust the hand-written resource methods for genuinely new or renamed routes, add a changeset, and release.

CI runs `npm run generate` and fails if the committed output differs from what the spec produces, so drift cannot land silently.

### Releasing

Versions are managed with [Changesets](https://github.com/changesets/changesets), and the three packages are versioned together.

```bash
npm run changeset        # describe the change
npm run version-packages # apply versions + changelogs
npm run release          # build, then publish
```

## Design notes

- **The spec is the source of truth.** Types are generated; the client is hand-written over them, so the ergonomics are ours and the shapes are the server's.
- **Idempotency is on by default.** Sends and invitations both mint a UUIDv7 `requestMessageId`, which is what makes it safe for the client to retry a failed write. Supply your own key when a retry may span process restarts.
- **Raw bytes reach the verifier.** Every webhook adapter passes the exact request body through — a JSON parser upstream breaks the HMAC, so the Express and Fastify adapters say so loudly rather than failing mysteriously.
- **No runtime dependencies.** Both runtime packages depend only on `@1440io/msp-types`, which is types plus a handful of frozen arrays.

## License

MIT
