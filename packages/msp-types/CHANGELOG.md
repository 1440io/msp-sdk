# @1440io/msp-types

## 0.3.0

### Minor Changes

- Regenerate against the current MSP API spec. Paths, parameters, request bodies, and response shapes are unchanged — this revision renames things and extracts previously-inline shapes into named schemas — so no call you make changes. The curated exports keep their names and were repointed underneath, so ordinary use of the client is unaffected.

  **Named types for every message-content variant.** The content unions used to be anonymous shapes reachable only by indexing into an event type. Each variant is now a named schema, and `@1440io/msp-types` exports them: `InboundText`, `InboundOptOut`, `InboundQuickReplyResponse`, `InboundListPickerResponse`, `InboundTimePickerResponse`, `InboundFormResponse`, `InboundAuthenticationResponse`, `InboundImessageAppResponse`, `InboundInvitationResponse`, `InboundUnrecognizedInteractiveResponse`, plus `OutboundContent`, `RawContent`, and `…OfKind` helpers for both. Annotating a function parameter with the exact variant it handles no longer needs an `Extract<>` incantation.

  **Redaction is a discriminated union.** `redacted: false` now implies `content` is present and `redacted: true` implies it is null, so `isRedacted(message)` and the new `isVisible(message)` are type guards: after `isVisible`, `message.content` is non-null with no check. Every content reader accepts `null | undefined` and returns an empty result, so a redacted message needs no special casing.

  **`ConversationMessage` and `ConversationMessageAttachment` are named schemas**, exported directly rather than derived by indexing into the conversation-detail response.

  **`ApiError` is the spec's name for the error envelope**, exported alongside the existing `ErrorResponse` — both identical, neither removed. It now documents `missingPermission`, which production has been returning on a 403 since at least August.

  **`RICH_REASON_CODES` narrowed from 27 codes to 19.** The send-pipeline codes (`capability_not_supported`, `channel_gateway_failed`, `duplicate_request_conflict`, `construct_payload_failed`, `wire_constraint_violated`, `conversation_not_eligible`, `template_type_mismatch`, `block_field_unsupported`) left the enum; the reason set is now scoped to template and asset authoring, matching send errors having moved to `issues`. Production has been observed returning codes outside the declared set, so keep treating an unrecognized code as a generic rejection.

  Note for anyone using the raw escape hatches: `Schemas['…']` keys and `operations['…']` ids both moved. Renamed schemas include `ErrorResponse`→`ApiError`, `ConversationListItem`→`Conversation`, `ConversationListResponse`→`ConversationList`, `ConversationDetailResponse`→`ConversationDetail`, `ChannelListResponse`→`ChannelList`, `IntegrationTokenResponse`→`IntegrationTokenResult`, `MediaUploadSuccess`→`MediaUploadResult`, `MediaAccessUrlSuccess`→`MediaAccessUrlResult`, `SendMessageSuccess`→`SendMessageResult`, `CreateMessagingInvitation`→`CreateMessagingInvitationBody`, and the two delete results merged into `DeleteResult`. The ten admin template and asset operations moved to verb-first ids (`adminListRichTemplates`→`listAdminRichTemplates`).

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
