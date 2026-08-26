# @1440io/msp-api

Typed client for the [1440](https://1440.io) Apple Messages for Business MSP API.

```bash
npm install @1440io/msp-api
```

Node 20.10+. Ships ESM and CJS. Zero runtime dependencies beyond `@1440io/msp-types`.

## Authenticating

The API uses a long-lived integration API key (`msp_…`) to mint a short-lived (~15 minute) business access JWT. Hand the client the key and it handles the rest — minting on first use, caching until a minute before expiry, collapsing concurrent refreshes onto one exchange, and retrying once if a token is rejected early.

```ts
import { MspClient } from '@1440io/msp-api';

const client = new MspClient({ apiKey: process.env.MSP_API_KEY! });
```

An API key is a server-side credential. Never ship one to a browser.

Other ways in:

```ts
// A pre-minted JWT you manage yourself.
new MspClient({ token: process.env.MSP_TOKEN! });

// A token you fetch from your own service. Return `expiresAt` and the client caches it.
new MspClient({
  getToken: async () => {
    const { token, expiresAt } = await myVault.getMspToken();
    return { token, expiresAt };
  },
});

// From MSP_API_KEY / MSP_TOKEN / MSP_BASE_URL.
MspClient.fromEnv();
```

### Client options

| Option | Default | Notes |
| --- | --- | --- |
| `apiKey` / `token` / `getToken` | — | Exactly one is required. |
| `baseUrl` | `https://1440.cloud` | Point at a sandbox or staging host. |
| `timeoutMs` | `30000` | Per request. Uploads default to `120000`. |
| `retry` | `{ maxRetries: 2, initialDelayMs: 500, maxDelayMs: 8000 }` | Applies to GETs and idempotent writes. |
| `refreshSkewMs` | `60000` | Refresh this long before the token expires. |
| `headers` | — | Merged into every request. |
| `fetch` | global `fetch` | Swap in a proxy-aware fetch, or a stub in tests. |
| `onRequest` / `onResponse` | — | Called per attempt, retries included. Good hooks for logging and metrics. |

## Conversations

`list()` returns a paginator. Await it for one page, `for await` over it to walk them all.

```ts
const page = await client.conversations.list({ count: 50, status: 'active' });
page.conversations; // ConversationListItem[]
page.nextCursor;    // string | null

for await (const conversation of client.conversations.list({ platform: 'amb' })) {
  // Cursors are followed for you.
}

const recent = await client.conversations.list().toArray(200); // stop after 200

const detail = await client.conversations.get(conversationId, { count: 50 });
detail.messages;

await client.conversations.updateName(conversationId, {
  firstName: 'Ada',
  lastName: 'Lovelace',
});
```

## Sending

Every send carries a `requestMessageId` idempotency key. Omit it and the client mints a UUIDv7; a replay returns the original result with `duplicate: true` rather than sending twice.

```ts
await client.messaging.sendText({
  conversationId,
  body: 'Your appointment is confirmed for 2pm tomorrow.',
});

const { mediaAssetId } = await client.media.upload({
  body: await fs.readFile('receipt.jpg'),
  filename: 'receipt.jpg',
  contentType: 'image/jpeg',
  targetChannel: 'amb',
});

await client.messaging.sendText({
  conversationId,
  body: 'Here is your receipt.',
  attachmentIds: [mediaAssetId],
});

await client.messaging.sendTemplate({
  conversationId,
  templateId,
  variables: {
    customerName: 'Ada',
    slots: [{ id: 'slot-1', startTime: '2026-08-26T14:00:00Z', durationSeconds: 1800 }],
  },
});

// Channel-native passthrough, when a template will not do.
await client.messaging.sendRaw({
  conversationId,
  channel: 'amb',
  messageType: 'list_picker',
  payload: { /* Apple MSP payload, minus the server-owned fields */ },
});
```

Supply your own `requestMessageId` when a retry might span a process restart — store it with the work item, and a redelivery collapses onto the original send.

## Initiations

Reaching a customer first. Creation is asynchronous: the initiation starts at `submitting` and lands on `accepted`, `declined`, `provider_rejected`, or `error`. Watch the `initiation.updated` webhook instead of polling where you can.

```ts
const initiation = await client.initiations.create({
  channel: 'amb',
  phoneNumber: '+15551234567',
  idempotencyKey: `case-${caseId}-attempt-1`,
  targetFirstName: 'Ada',
  targetAgentStatus: 'live',
});

for await (const item of client.initiations.list({ status: 'submitted' })) {
  // …
}
```

## Media

```ts
const { mediaAssetId } = await client.media.upload({
  body: bytes,              // Uint8Array | ArrayBuffer | Blob | ReadableStream | string
  filename: 'photo.jpg',
  contentType: 'image/jpeg',
  targetChannel: 'amb',     // 'tiktok' tightens to JPG/PNG and a 3 MiB ceiling
});

const { url, expiresAt } = await client.media.getAccessUrl(attachmentId);
```

The size ceiling (100 MiB, or 3 MiB for TikTok) is checked client-side whenever the length is known, so an oversized upload fails before the transfer rather than after it. Pass `contentLength` when streaming to get the same early check.

## Templates and channels

```ts
for await (const template of client.templates.list()) {
  // Published templates, ready to send.
}

const channels = await client.channels.list();
```

## Admin

Business-admin routes live under `client.admin` and require the `admin` membership tier.

```ts
await client.admin.context();
await client.admin.settings();
await client.admin.listMembers();
await client.admin.listSandboxes();

await client.admin.channels.list();
await client.admin.channels.create({ platform: 'amb', externalId: 'amb-acct-7f3c9a21' });
await client.admin.channels.tiktokStatus();

const draft = await client.admin.templates.create({ name: 'Appointment picker', definition, slotBindings: [] });
await client.admin.templates.publish(draft.id);
await client.admin.templates.uploadAsset({
  channel: 'amb',
  usage: 'interactive_image',
  displayName: 'Hero image',
  file: pngBytes,
});

await client.admin.integrations.list();
await client.admin.integrations.listDeliveries(integrationId); // webhook delivery log

await client.admin.permissions.catalog();
await client.admin.permissions.createSet({
  name: 'Front-desk Agent',
  permissions: ['ViewConversations', 'SendMessages'],
});
```

## Errors

Every non-2xx becomes a typed error carrying the server's canonical `{ error, code }` envelope.

```ts
import { MspApiError, MspNotFoundError, MspRateLimitError, isMspApiError } from '@1440io/msp-api';

try {
  await client.messaging.sendText({ conversationId, body: 'Hi' });
} catch (error) {
  if (error instanceof MspNotFoundError) {
    // The conversation does not belong to this business.
  } else if (error instanceof MspRateLimitError) {
    await sleep(error.retryAfterMs ?? 1000);
  } else if (isMspApiError(error)) {
    error.status;   // 422
    error.code;     // 'capability_not_supported'
    error.reasons;  // rich-messaging reject reasons, when the send pipeline rejected it
  }
}
```

`MspApiError` subclasses: `MspValidationError` (400/422), `MspAuthenticationError` (401), `MspPermissionError` (403), `MspNotFoundError` (404), `MspConflictError` (409), `MspPayloadTooLargeError` (413), `MspRateLimitError` (429), `MspServerError` (5xx). Transport failures raise `MspTimeoutError` or `MspConnectionError`; bad arguments raise `MspConfigError`.

## Retries

GETs and idempotent writes retry on 408, 429, 5xx, and connection failures, with exponential backoff, full jitter, and `Retry-After` honoured. A retried send reuses its original `requestMessageId`, so a retry can never double-send. Non-idempotent calls are never retried. Set `retry: { maxRetries: 0 }` to opt out.

## Testing against it

Inject `fetch` and no network is touched:

```ts
const client = new MspClient({
  token: 'test',
  fetch: async (url, init) => new Response(JSON.stringify({ channels: [] }), { status: 200 }),
});
```

## License

MIT
