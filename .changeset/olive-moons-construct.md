---
'@1440io/msp-types': minor
'@1440io/msp-api': minor
---

Update to the current MSP API spec. The changes are additive — no call you make today changes shape, and nothing was removed.

**Apple can now build a rich link from a URL: `amb.url_payload`.** A new member of the `RawMessageContent` union, so `client.messaging.sendRaw` accepts it with no new method:

```ts
await client.messaging.sendRaw({
  conversationId,
  content: { kind: 'amb.url_payload', url: 'https://maps.apple.com/?q=coffee' },
});
```

Give it an Apple Music, Apple Maps, or App Clip URL and Apple constructs the payload at send time — no template, no asset bindings, nothing to publish first. `url` must be an absolute HTTPS URL in printable ASCII up to 8,192 bytes; `storeRegion` is an optional two-character App Store region for App Clips, defaulting to US. Apple decides which URLs it supports. `@1440io/msp-types` exports the shape as `RawContentOfKind<'amb.url_payload'>` and `Schema<'RawMessageContentAmbUrlPayload'>`.

**App Clip rich-link templates no longer take `title` or `imageSlot`.** The `app_clip_rich_link` block in `RichTemplateDefinition` is now just `{ kind, url, storeRegion }`, all required, because Apple constructs the link rather than rendering authored content. Publication validates the construction inputs instead of rendered content. Existing App Clip templates authored with the old fields will no longer typecheck against the new definition.

**The send routes document a `500`.** `POST /api/v0/messaging/send` and `/send-raw` can now return 500, meaning persistence could not be confirmed *after* the channel may already have accepted the message. The 502 description also sharpened: channel preparation or sending failed, and a timeout or connection failure leaves acceptance unknown. For `amb.url_payload` specifically, a 502 is either a construction failure, where nothing was sent, or a send failure, where acceptance is unknown.

**Idempotency is documented as best effort, and the client's docs now say so.** Replaying a `requestMessageId` with identical bytes still returns the persisted result with `duplicate: true`, and differing bytes are still rejected with 409. But concurrent requests can both reach Apple before either is persisted — including conflicting ones, where both can land before one returns 409 — and a provider timeout or persistence failure leaves the outcome genuinely uncertain. The spec's recovery is to retry the identical bytes under the same `requestMessageId`, which `@1440io/msp-api` already does automatically, accepting that a retry can deliver another copy. No behavior changed here; the previous JSDoc and README promised a guarantee the API does not make. `MspServerError` and `MspApiError.retryable` now spell out what a 500 and a 502 do and do not tell you about delivery.

**Attachment sends have a documented time budget.** Media transfers plus the final Apple send must finish within 17 seconds of route entry, against a 19-second response target including persistence; waiting for transfer capacity counts against it. A timeout cannot undo provider acceptance.

**`richLinkDataRef.url` is optional** on stored outbound rich-link content — the field carries the original destination when known, and provider content URLs are omitted — so readers must handle it being absent.
