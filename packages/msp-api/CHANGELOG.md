# @1440io/msp-api

## 0.4.0

### Minor Changes

- 0fb3980: Update to the current MSP API spec. The changes are additive — no call you make today changes shape, and nothing was removed.

  **Apple can now build a rich link from a URL: `amb.url_payload`.** A new member of the `RawMessageContent` union, so `client.messaging.sendRaw` accepts it with no new method:

  ```ts
  await client.messaging.sendRaw({
  	conversationId,
  	content: { kind: "amb.url_payload", url: "https://maps.apple.com/?q=coffee" }
  });
  ```

  Give it an Apple Music, Apple Maps, or App Clip URL and Apple constructs the payload at send time — no template, no asset bindings, nothing to publish first. `url` must be an absolute HTTPS URL in printable ASCII up to 8,192 bytes; `storeRegion` is an optional two-character App Store region for App Clips, defaulting to US. Apple decides which URLs it supports. `@1440io/msp-types` exports the shape as `RawContentOfKind<'amb.url_payload'>` and `Schema<'RawMessageContentAmbUrlPayload'>`.

  **App Clip rich-link templates no longer take `title` or `imageSlot`.** The `app_clip_rich_link` block in `RichTemplateDefinition` is now just `{ kind, url, storeRegion }`, all required, because Apple constructs the link rather than rendering authored content. Publication validates the construction inputs instead of rendered content. Existing App Clip templates authored with the old fields will no longer typecheck against the new definition.

  **The send routes document a `500`.** `POST /api/v0/messaging/send` and `/send-raw` can now return 500, meaning persistence could not be confirmed _after_ the channel may already have accepted the message. The 502 description also sharpened: channel preparation or sending failed, and a timeout or connection failure leaves acceptance unknown. For `amb.url_payload` specifically, a 502 is either a construction failure, where nothing was sent, or a send failure, where acceptance is unknown.

  **Idempotency is documented as best effort, and the client's docs now say so.** Replaying a `requestMessageId` with identical bytes still returns the persisted result with `duplicate: true`, and differing bytes are still rejected with 409. But concurrent requests can both reach Apple before either is persisted — including conflicting ones, where both can land before one returns 409 — and a provider timeout or persistence failure leaves the outcome genuinely uncertain. The spec's recovery is to retry the identical bytes under the same `requestMessageId`, which `@1440io/msp-api` already does automatically, accepting that a retry can deliver another copy. No behavior changed here; the previous JSDoc and README promised a guarantee the API does not make. `MspServerError` and `MspApiError.retryable` now spell out what a 500 and a 502 do and do not tell you about delivery.

  **Attachment sends have a documented time budget.** Media transfers plus the final Apple send must finish within 17 seconds of route entry, against a 19-second response target including persistence; waiting for transfer capacity counts against it. A timeout cannot undo provider acceptance.

  **`richLinkDataRef.url` is optional** on stored outbound rich-link content — the field carries the original destination when known, and provider content URLs are omitted — so readers must handle it being absent.

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

- Typed client covering every documented route: conversations, messaging, initiations, templates, media, channels, invitations, and the business-admin surface.
- Integration API key exchanged for a short-lived JWT automatically, with single-flight refresh, refresh ahead of expiry, and one refresh-and-retry on a 401. Bring your own token or token provider instead if you prefer.
- `Paginator` over cursor-based and `before`-based lists: await it for one page, `for await` for every item, `toArray(limit)` to stop early. Implements `then`/`catch`/`finally`.
- Typed errors carrying the canonical `{ error, code }` envelope plus rich-messaging `reasons` — `MspValidationError`, `MspAuthenticationError`, `MspPermissionError`, `MspNotFoundError`, `MspConflictError`, `MspRateLimitError`, `MspServerError`, and more.
- Retries with jittered backoff for GETs and idempotent writes, honouring `Retry-After`. Sends mint a UUIDv7 `requestMessageId`, and a retry reuses it, so a retried send cannot double-deliver.
- Media upload with client-side size ceilings, and `messaging.sendRaw` for channel-native Apple payloads.
