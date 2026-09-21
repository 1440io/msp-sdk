# Lovable prompt — Apple URL payloads

A follow-up prompt for a project already built from `lovable-template-prompt.md`.
Paste everything below the rule as a new message in that Lovable project.

Requires `@1440io/msp-api@0.4.0` or newer.

---

Add **Send a link** to the composer. Apple Messages can turn a bare URL into a rich link card — artwork, title, the lot — but only for URLs Apple knows how to render: Apple Music, Apple Maps, and App Clips. We hand Apple the URL and it builds the card at send time. There is no template to author, no image to upload, and nothing to publish first.

## The call

One new branch in `msp-send`. It is a raw send, not a template send:

```ts
await client.messaging.sendRaw({
  conversationId,
  requestMessageId,          // same uuidv7 discipline as every other send
  content: {
    kind: "amb.url_payload",
    url: "https://maps.apple.com/?q=coffee",
    storeRegion: "GB",       // App Clips only; omit for Apple's US default
  },
});
```

`storeRegion` is exactly two characters, an App Store region code. Omit it entirely rather than sending `""` or `null` — the field is optional and Apple defaults to US.

## The integration key needs a second permission

This is the step that will waste an afternoon if it is missed. Every send so far used `sendText` or `sendTemplate`, which need only `SendMessages`. The raw route additionally requires **`SendRawChannelPayloads`**, and a key without it fails every URL send with a `403` carrying `code: "PERMISSION_DENIED"` and the missing key in `missingPermission`.

Handle it in two places:

- **Setup screen:** add a check that the configured key actually holds `SendRawChannelPayloads`. The client caches its token internally and never hands the grant back, so ask for it explicitly:

  ```ts
  const { grant } = await client.auth.exchangeIntegrationToken(Deno.env.get("MSP_API_KEY")!);
  const canSendRaw = grant.permissionKeys.includes("SendRawChannelPayloads");
  ```

  Surface that as its own checklist row — "link sending unavailable: your integration key is missing `SendRawChannelPayloads`" — rather than letting an agent discover it mid-conversation. Cache the result; this mints a token, so do not call it per keystroke.
- **Composer:** when the grant lacks it, hide or disable the link tab with that reason attached. Do not offer an action that is guaranteed to fail.

## Validate before you send

The API enforces these; catching them in the composer turns a `400` into an inline hint.

- **`https` only.** Not `http`, not `maps://`, not a relative path.
- **Printable ASCII, up to 8,192 bytes.** Measure bytes, not characters — a pasted URL with an em dash or a smart quote is longer than it looks and is not ASCII at all.
- **`storeRegion`, when present, is exactly two characters.**

What you cannot validate locally is whether Apple will actually render the URL. A perfectly well-formed link to a site Apple has no rich treatment for comes back as a `422`, rejected before delivery. Say so plainly in the UI: *Apple could not build a preview for this link.* Do not retry it — the answer will not change.

## Do not gate this on `capability_list`

The capability list (`QUICK`, `LIST`, `TIME`, `AUTH`, `AUTH2`, `FORM`) covers interactive message types. Rich links are not in it. The existing rule — check the capability list before offering a rich template — does **not** apply here, and applying it anyway would hide the link tab from every device that never happened to advertise a capability.

## It comes back as a different kind than you sent

`amb.url_payload` is a send-time input, not a stored content kind. Once Apple builds the card, conversation history stores the message as **`amb.rich_link`**. There is no `amb.url_payload` case to write in the message renderer, and adding one produces dead code.

Worse, you cannot count on reading your own URL back. Stored rich-link content carries `richLinkDataRef`, whose `title` and `url` are both optional — the reference describes Apple's constructed payload, and provider content URLs are omitted rather than echoed. A link you sent can come back with nothing useful to display.

So **persist what you sent**. Extend `outbound_log`:

- `kind` gains `url_payload` alongside `text`, `template`, and `raw`
- a new `target_url text` column, written before the send

Render outbound link bubbles from `outbound_log.target_url`, falling back to `richLinkDataRef.title`/`url` when present. That way the thread shows the agent the link they actually sent, whatever the API hands back.

## Failure modes are genuinely ambiguous here

Two statuses do not tell you whether the customer received anything, and the UI must not claim otherwise:

- **`502`** means either Apple's construction failed, in which case nothing was sent, or the send itself failed, in which case acceptance is unknown. One status, two very different outcomes.
- **`500`** means persistence could not be confirmed *after* the channel may already have accepted the message.

Neither proves non-delivery. Mark the `outbound_log` row `uncertain` rather than `failed`, and show it as *may have been delivered — check with the customer before resending*. The SDK retries both automatically under the same `requestMessageId`, which is the documented recovery, but duplicate prevention is best effort and a retry can deliver a second copy. Do not add your own retry loop on top of the client's.

`410` still means the conversation is opted out, and `409` still means that `requestMessageId` was reused with different bytes.

## Composer

A **Link** tab beside text and template. One URL field, an optional region selector shown only when the URL looks like an App Clip, and a short line naming what Apple supports: Apple Music, Apple Maps, App Clips. Inline validation for the three rules above, on blur rather than on every keystroke.

No preview card. We do not know what Apple will build until it builds it, and a mocked-up preview that does not match what the customer sees is worse than no preview.

## Done means

- An agent with a key missing `SendRawChannelPayloads` sees a disabled link tab explaining exactly that, and Setup says the same thing before they ever open a conversation.
- A non-HTTPS URL, a non-ASCII URL, and a 9,000-byte URL are each refused in the composer with a specific message, without a network round trip.
- A link Apple cannot render surfaces the `422` as a plain-language explanation and is not retried.
- A sent link renders in the thread from `outbound_log.target_url`, and still renders when `richLinkDataRef` comes back empty.
- A `502` or `500` shows as uncertain, never as a clean failure, and the UI does not offer a one-click resend that could double-send.
- Nothing in the message renderer switches on `amb.url_payload` — stored link messages are `amb.rich_link`.
