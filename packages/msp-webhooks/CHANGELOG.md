# @1440io/msp-webhooks

## 0.5.0

### Minor Changes

- Add Apple Pay payment requests and typing indicators, from the current MSP API spec. Everything else is additive — no existing call changes.

  **`messaging.requestPayment({ conversationId, merchantSession, paymentRequest, receivedMessage, replyMessage, images? })`** requests an Apple Pay payment. It needs the new `RequestPayments` permission on top of `SendMessages`, plus platform approval and business enablement; without them it is a 403 or an `apple_pay_unavailable` rejection. The `merchantSession` comes from Apple via your own merchant backend — 1440 passes it through and never mints one — and the customer's Apple Pay token goes to your payment gateway rather than through 1440, so a success here confirms delivery, not settlement.

  This call is deliberately **not retried automatically**, unlike every other idempotent write in the client. Identical bytes replay the persisted result, but the spec warns an uncertain send can still reach the provider more than once and create a second payable bubble, so your gateway must deduplicate on `requestMessageId` and the SDK will not quietly retry something that could bill a customer twice.

  **`messaging.sendTyping({ conversationId, state })`** shows or clears a typing indicator — `start` or `end`, answering `204` with no body. Transient and best effort: one provider attempt with a two-second timeout, no persistence, no retries, no idempotency. Also not retried, since a stale indicator is worse than none. Treat it as decoration, never as a precondition for sending.

  **Reading payment responses.** A customer's reply arrives as the new `amb.payment_response` content kind. `paymentState(content)` returns the opaque `state` you supplied, echoed back — the correlation key that ties a response to its order — and `paymentRequestOf(content)` returns the currency, total, and line items they were asked to approve.

  **New types**: `RequestPaymentBody`, `RequestPaymentError`, `ApplePayMerchantSession`, `ApplePayPaymentRequest`, `InboundPaymentResponse`, `OutboundPayment`, `TypingState`, `MessagingInvitationPersistenceUnconfirmed`, `MessagingInvitationErrorCode`, and a `PERMISSION_KEYS` vocabulary so a future permission addition fails the build rather than drifting. `amb.payment_response` joins `INBOUND_CONTENT_KINDS`.

  **Worth knowing if you branch on invitation errors.** `MessagingInvitationError` moved its stable reason from `error` to a new required `code`, with `error` now carrying the human-readable message, and dropped `request_in_progress` from the set. Code reading `body.error === 'messaging_invitation_unavailable'` should read `body.code` instead. `BusinessSettings` also dropped `isActive`.

### Patch Changes

- Updated dependencies
  - @1440io/msp-types@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [0fb3980]
  - @1440io/msp-types@0.4.0

## 0.3.0

### Minor Changes

- Regenerate against the current MSP API spec. Paths, parameters, request bodies, and response shapes are unchanged — this revision renames things and extracts previously-inline shapes into named schemas — so no call you make changes. The curated exports keep their names and were repointed underneath, so ordinary use of the client is unaffected.

  **Named types for every message-content variant.** The content unions used to be anonymous shapes reachable only by indexing into an event type. Each variant is now a named schema, and `@1440io/msp-types` exports them: `InboundText`, `InboundOptOut`, `InboundQuickReplyResponse`, `InboundListPickerResponse`, `InboundTimePickerResponse`, `InboundFormResponse`, `InboundAuthenticationResponse`, `InboundImessageAppResponse`, `InboundInvitationResponse`, `InboundUnrecognizedInteractiveResponse`, plus `OutboundContent`, `RawContent`, and `…OfKind` helpers for both. Annotating a function parameter with the exact variant it handles no longer needs an `Extract<>` incantation.

  **Redaction is a discriminated union.** `redacted: false` now implies `content` is present and `redacted: true` implies it is null, so `isRedacted(message)` and the new `isVisible(message)` are type guards: after `isVisible`, `message.content` is non-null with no check. Every content reader accepts `null | undefined` and returns an empty result, so a redacted message needs no special casing.

  **`ConversationMessage` and `ConversationMessageAttachment` are named schemas**, exported directly rather than derived by indexing into the conversation-detail response.

  **`ApiError` is the spec's name for the error envelope**, exported alongside the existing `ErrorResponse` — both identical, neither removed. It now documents `missingPermission`, which production has been returning on a 403 since at least August.

  **`RICH_REASON_CODES` narrowed from 27 codes to 19.** The send-pipeline codes (`capability_not_supported`, `channel_gateway_failed`, `duplicate_request_conflict`, `construct_payload_failed`, `wire_constraint_violated`, `conversation_not_eligible`, `template_type_mismatch`, `block_field_unsupported`) left the enum; the reason set is now scoped to template and asset authoring, matching send errors having moved to `issues`. Production has been observed returning codes outside the declared set, so keep treating an unrecognized code as a generic rejection.

  Note for anyone using the raw escape hatches: `Schemas['…']` keys and `operations['…']` ids both moved. Renamed schemas include `ErrorResponse`→`ApiError`, `ConversationListItem`→`Conversation`, `ConversationListResponse`→`ConversationList`, `ConversationDetailResponse`→`ConversationDetail`, `ChannelListResponse`→`ChannelList`, `IntegrationTokenResponse`→`IntegrationTokenResult`, `MediaUploadSuccess`→`MediaUploadResult`, `MediaAccessUrlSuccess`→`MediaAccessUrlResult`, `SendMessageSuccess`→`SendMessageResult`, `CreateMessagingInvitation`→`CreateMessagingInvitationBody`, and the two delete results merged into `DeleteResult`. The ten admin template and asset operations moved to verb-first ids (`adminListRichTemplates`→`listAdminRichTemplates`).

### Patch Changes

- Updated dependencies
  - @1440io/msp-types@0.3.0

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
