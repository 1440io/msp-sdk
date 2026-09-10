# @1440io/msp-webhooks

## 0.2.0

### Minor Changes

- Update to the current MSP API spec. This revision moves a lot, and the changes are breaking.

  **Initiations are now messaging invitations.** `client.initiations` is gone; use `client.invitations`. The old route returns 404 server-side, so this is a rename you have to make. `idempotencyKey` became `requestMessageId`, invitations accept `branding` (brand name and logo), and the webhook event is `messaging_invitation.updated` rather than `initiation.updated`.

  **Send bodies are flat.** `sendText` and `sendTemplate` no longer nest under `message`: `{ body, subject, attachmentIds }` and `{ templateId, variables }` sit at the top level. `SendMessageSuccess` no longer carries `channelMessageId`.

  **The webhook envelope changed shape.** `id` → `eventId`, `specVersion` → `v`, `data.message` → `message`, and `dataVersion`/`occurredAt`/`clientId` are gone. New top-level fields carry `channelAddress`, `intentId`, `groupId`, `locale`, and `capabilityList` — the rich-messaging capabilities the customer's device advertised. The verifier now also rejects a delivery whose `Webhook-Id` disagrees with the envelope `eventId`.

  **Inbound content is a tagged union.** `content` is discriminated by `kind` (`text`, `opt_out`, `amb.quick_reply_response`, and the rest), so TypeScript narrows it natively and the old message-level guards are unnecessary. The payloads are Apple-native, so new readers do the normalizing: `textBody`, `selectedIds`, `selectedTitles`, `selectedTimeslot`, `formAnswers`, `authenticationStatus`, `respondsTo`, `sessionOf`, `isRedacted`, `isKind`. `isTextMessage`, `isInteractiveMessage`, `isTapbackMessage`, `isOptOutMessage`, `formValuesByPage`, and `selectedStartTime` are removed. There is no `tapback` kind — reactions arrive as text.

  **Authentication messages.** `messaging.sendAuthentication({ conversationId, templateId, state })` starts an OAuth flow on the device; the result arrives as an `amb.authentication_response`.

  **`sendRaw` takes typed content.** `{ content: { kind, data, … } }` replaces `{ channel, messageType, payload }`, and it returns `SendMessageSuccess` instead of `unknown`. Quick replies are pinned to 2–5 items, matching what Apple actually enforces.

  **Pagination is cursor-only.** `hasMore` is gone from every list; follow `nextCursor` until it is null.

  **Send errors report `issues`, not `reasons`.** A `validation_failed` send carries `issues: [{ path, message }]` with real field paths. `MspApiError` exposes both, since template and asset routes still use `reasons`.

  **Removed with the documented surface**: `admin.context`, `admin.listMembers`, `admin.listSandboxes`, `admin.syncSandboxMembers`, `admin.channels.create`, `admin.integrations.*`, `admin.permissions.*`, and `invitations.getByToken`. Several still answer on the server but are no longer published, so they are out of the client. `MAX_TIKTOK_UPLOAD_BYTES` is gone — uploads have a single 100 MiB ceiling and only `amb` is an accepted target channel. Rich-asset usages are now `rich_image_200` and `rich_icon_15`.

### Patch Changes

- Updated dependencies
  - @1440io/msp-types@0.2.0

## 0.1.0

Initial release.

- Webhook signature verification on Web Crypto — Node 20+, Cloudflare Workers, Vercel Edge, Deno, and Bun from one implementation. Raw-byte HMAC over `{id}.{timestamp}.{body}`, a five-minute timestamp tolerance, multi-token acceptance for key rotation, and replay suppression.
- `WebhookReceiver` mapping outcomes onto the platform's retry rules: 2xx acknowledges, a handler that throws returns 500 so the delivery is retried, and a duplicate acknowledges without running handlers twice.
- Adapters for Express, Fastify, Fetch (Next.js App Router, Hono, Workers, Deno), and AWS Lambda. Each passes the exact request bytes through, and the Express adapter fails loudly when a JSON parser has already consumed the body.
- Narrowing helpers for customer replies. A message's `content` is discriminated by its sibling `messageType`, which TypeScript cannot narrow on its own, so `isTextMessage`, `isInteractiveMessage`, `isTapbackMessage`, and `isOptOutMessage` do it — with `selectedIds`, `selectedTitles`, `formValuesByPage`, and `respondsTo` for reading the result.
- `parseAppleTimestamp` / `selectedStartTime` for time-picker replies, whose `selectedStartTime` arrives in Apple's basic format (`2026-08-25T23:55+0000`) rather than the RFC 3339 the spec declares. JavaScript's `Date` accepts it; stricter parsers do not.
