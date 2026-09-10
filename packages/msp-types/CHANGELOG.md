# @1440io/msp-types

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

## 0.1.0

Initial release.

- Types generated from the 1440 MSP API OpenAPI 3.1 document with `openapi-typescript`, covering all 143 schemas, 43 operations, and both webhook events.
- Curated aliases (`Conversation`, `SendMessageBody`, `WebhookEvent`, and friends) alongside the raw `paths` / `operations` / `components` surface, also exported at `@1440io/msp-types/openapi`.
- Runtime vocabularies for the spec's string unions — `CHANNEL_PLATFORMS`, `CONVERSATION_STATUSES`, `INITIATION_STATUSES`, `RICH_REASON_CODES`, `INTERACTIVE_RESPONSE_TYPES`, and others — each `satisfies` its type, so a spec change that adds a value fails the build instead of drifting.
- `WebhookContentFor` / `WebhookMessageOfType`, which map a message's `messageType` to the `content` shape that goes with it.
