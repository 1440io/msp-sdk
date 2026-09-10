# Lovable prompt — AMB Agent Console

A cloneable Lovable template for Apple Messages for Business, built on the `@1440io` npm packages.
Paste everything below the rule as the initial message for a new Lovable project.

---

Build **AMB Agent Console**: a live agent inbox for Apple Messages for Business, powered by 1440's MSP API.

Someone remixes this project, adds two secrets, pastes one URL into their 1440 console, and is talking to customers within a few minutes. Optimize for that first-run experience as much as for the app itself.

## Non-negotiable: credentials never reach the browser

The 1440 integration API key (`msp_…`) and webhook signing secret (`whsec_…`) are server-side credentials. A leaked key lets anyone message that business's customers.

- Store both as **Supabase edge function secrets**. Never as a `VITE_` variable, never in a table the client can read, never in frontend source.
- The browser talks **only to Supabase**. It never calls `1440.cloud` directly.
- Every 1440 API call and every webhook receipt happens in an edge function.

If a step seems to need the key in the frontend, that step belongs in an edge function instead.

## Packages

The official SDK, imported with `npm:` specifiers (verified working on Deno — no Node built-ins, Web Crypto only):

```ts
import { MspClient, uuidv7, isMspApiError } from "npm:@1440io/msp-api@0.2.0";
import {
  WebhookReceiver, textBody, isInteractiveResponse, isKind, isRedacted,
  selectedIds, selectedTitles, selectedTimeslot, formAnswers,
  authenticationStatus, respondsTo, parseAppleTimestamp,
  type ReplayCache,
} from "npm:@1440io/msp-webhooks@0.2.0";
```

Read the key explicitly — `MspClient.fromEnv()` reads `process.env` and does nothing under Deno:

```ts
const client = new MspClient({ apiKey: Deno.env.get("MSP_API_KEY")! });
```

If a build fails with *"blocked by the minimum dependency age policy"*, that is Deno declining npm packages published within the last 24 hours. Pass `--min-dep-age 0`, or wait a day.

## Data model

Postgres, RLS on every table: authenticated users of the project read; only the service role (edge functions) writes.

**conversations** — `id` uuid pk (the 1440 conversation id), `channel_platform`, `first_name`, `last_name`, `status`, `agent_status`, `opted_out` bool, `capability_list` text[] (the rich features the customer's device advertised, from the last inbound event), `last_message_at`, `last_message_preview`, `unread_count`, `created_at`, `updated_at`

**messages** — `id` uuid pk (the 1440 message id), `conversation_id` fk, `direction` (`inbound`|`outbound`), `content_kind` text (the `kind` tag: `text`, `amb.quick_reply_response`, …), `content` jsonb, `attachments` jsonb, `request_identifier` text null, `redacted` bool, `occurred_at`, `created_at`

**webhook_events** — `id` uuid pk (the `Webhook-Id` header, equal to the envelope's `eventId`), `event_type`, `payload` jsonb, `received_at`. Doubles as the replay cache: retries reuse the id, so a primary-key conflict *is* "already handled".

**outbound_log** — `request_message_id` uuid pk, `conversation_id`, `kind` (`text`|`template`|`raw`), `status`, `error_code`, `reasons` jsonb, `created_at`. Lets the UI explain a rejected send.

Turn on **Realtime** for `messages` and `conversations` so the inbox updates without polling.

## Edge functions

### `msp-webhook` — receives deliveries from 1440

Set `verify_jwt = false` for this function in `supabase/config.toml`. 1440 authenticates with its own HMAC signature, not a Supabase JWT; leaving JWT verification on rejects every delivery with a 401.

```ts
const replayCache: ReplayCache = {
  async seen(id) {
    const { error } = await supabase.from("webhook_events").insert({ id, event_type: "", payload: {} });
    return error?.code === "23505"; // unique_violation → already handled
  },
};

const receiver = new WebhookReceiver({
  secret: Deno.env.get("MSP_WEBHOOK_SECRET")!,
  replayCache,
  on: {
    "message.received": async (event) => { /* upsert conversation, insert message */ },
    "messaging_invitation.updated": async (event) => {
      const { messagingInvitationId, status, reasonCode } = event.messagingInvitation;
      /* update the invitation's status */
    },
  },
});

const result = await receiver.handle({
  headers: req.headers,
  body: new Uint8Array(await req.arrayBuffer()),   // raw bytes — see below
});
return new Response(JSON.stringify(result.body), { status: result.status });
```

Two things to get right:

- **Pass the raw bytes.** The signature covers the exact body. Calling `req.json()` and re-serializing changes key order and breaks verification. Never parse before verifying.
- **Return the receiver's status unchanged.** 2xx acknowledges; 500 tells 1440 to retry. Swallowing a storage failure into a 200 loses the message permanently.

### `msp-send` — sends on behalf of a signed-in agent

Keep `verify_jwt` on; this one is called by the app. Accepts `{ conversationId, body?, attachmentIds?, templateId?, variables? }` and calls `sendText` or `sendTemplate`.

Mint the `requestMessageId` with `uuidv7()` and write it to `outbound_log` **before** sending; reuse it on retry. That key is what makes a retry safe rather than a double-send — the API returns the original result with `duplicate: true`.

Catch `isMspApiError(error)` and return `{ status, code, reasons }` so the UI can say *why* a rich send was refused instead of failing blankly.

### `msp-sync` — backfills history

Uses the SDK's paginator so a fresh clone shows real conversations immediately:

```ts
for await (const conversation of client.conversations.list({ status: "active" })) { /* upsert */ }
```

Triggered from Setup, and once automatically after secrets are first configured.

## Screens

**Inbox** — conversation list: customer name (or the channel address when unnamed), last-message preview, relative time, unread badge. Filter by status; conversations are AMB-only in this API revision, so a channel filter has nothing to filter. Search included. Updates live via Realtime.

**Conversation** — the thread, with each content kind rendered as itself, never as raw JSON. `content` is tagged by `kind`, so switch on it:
- `text` → a bubble (`textBody(content)`), with the subject shown above it when present
- `amb.quick_reply_response` / `amb.list_picker_response` → a small labelled card, "Chose: Large", via `selectedTitles`/`selectedIds`
- `amb.time_picker_response` → the booked slot from `selectedTimeslot(content)`, which returns `{ id, startsAt: Date, durationSeconds }`
- `amb.form_response` → a definition list from `formAnswers(content)`, keyed by page identifier; hide the values when `isPrivateForm(content)`
- `amb.authentication_response` → the outcome from `authenticationStatus(content)` (`success` / `failure` / `cancel` / `unknown`)
- `opt_out` → a persistent banner, and the composer disabled
- `isRedacted(message)` → say the body was withheld rather than rendering an empty bubble
- attachments → thumbnails; each carries `status` (`pending` / `ready` / `failed`), `accessUrl`, and `accessUrlExpiresAt`

Outbound messages show delivery state from `outbound_log`, including the reject reason when there is one.

**Composer** — text plus attachments, and a rich tab for sending a published template with its variables filled in. Read each template's `readiness` and **disable send when it is blocked on this conversation's channel**, showing the reason codes. Catching that before the send is the difference between a helpful UI and a mystery 422.

Also check the conversation's stored `capability_list` before offering a rich template: a device that never advertised `LIST` cannot render a list picker, and sending one anyway is a reject you could have predicted.

**Templates** — gallery of published templates with per-channel readiness badges, filterable by `templateType` (`text`, `quick_reply`, `list_picker`, `time_picker`, `form`, `rich_link`, `imessage_app`, `app_clip_rich_link`, `authentication`). Empty state matters: a new org has none, so say so and link to where they are authored.

**Setup** — the screen that makes this a template. A checklist showing: whether `MSP_API_KEY` and `MSP_WEBHOOK_SECRET` are set; the exact webhook URL to paste into the 1440 console (this project's deployed `msp-webhook` URL, with a copy button); a "Run backfill" button; and a live tail of recent `webhook_events` so someone can watch a delivery land and know it works.

## Demo mode

With no secrets configured, seed realistic sample conversations — including an interactive reply and an attachment — so a fresh clone looks alive instead of broken. Show an unmistakable "Demo data" banner linking to Setup. Real data replaces it after the first backfill.

## Apple Messages quirks — confirmed against the live platform

Each of these produces a confusing failure if ignored:

- **Quick replies need 2–5 items**, which the schema now enforces. A one-item reply used to pass validation and get rejected by Apple as a `502` that said nothing about item counts.
- **The quick-reply payload key is hyphenated** — `data['quick-reply']` — while list picker is `data.listPicker`. This asymmetry runs through the inbound payloads too, which is why the reader helpers exist.
- **Time-picker times are not RFC 3339.** They arrive as `2026-08-25T23:55+0000`: no seconds, no colon in the offset. JavaScript's `Date` accepts it, so the bug hides until the value reaches a stricter parser. Use `selectedTimeslot()` or `parseAppleTimestamp()`, never the raw string.
- **Reactions arrive as text.** A "Liked" reaction comes through as `kind: 'text'` with the body `"Liked 1 Business Message"`. There is no tapback kind to narrow to.
- **Correlate replies with `respondsTo(content)`**, which may be null — custom iMessage apps carry no correlation promise.
- **Opt-out is binding.** Once `opted_out` is true, block sending in the UI, not just at the API.
- **`mediaAssetId` is not an `attachmentId`.** Uploading returns a media asset id; attaching it to a message mints a *separate* attachment with its own id. Read URLs (`media.getAccessUrl`) take that second id, from message history or an inbound webhook. Passing the upload's id is a `404`, despite what the API docs say.
- **Unknown fields are rejected on a request body but ignored inside `content`.** A typo in a raw Apple payload renders wrong rather than erroring, so validate your own content shapes.

## Design

A calm, dense agent console — a tool, not a landing page. Two panes: conversation list left, thread right. System font stack, generous line height in the thread, subtle borders rather than heavy shadows. Full light and dark support. Inbound and outbound differ by alignment and a restrained background, not loud color. Timestamps quiet and secondary. The interface should feel like something an agent stares at for eight hours.

## Done means

- No secret appears in frontend source or the network tab.
- A tampered or unsigned delivery is rejected with 400; a delivery sent twice is stored once.
- Sending a message shows it in the thread, and a customer's reply arrives live with no refresh.
- A blocked rich template cannot be sent, and the UI says why.
- A clone with no secrets still renders demo data and a Setup checklist that explains exactly what to do next.
