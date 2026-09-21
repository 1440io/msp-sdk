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

## Non-negotiable: the whole app is an admin portal behind a login

This is an internal agent console holding customer PII — names, phone numbers, email addresses, and the full text of private conversations. There is no public surface. Every route, every screen, and every piece of data requires an authenticated, **authorized** session.

Use **Supabase Auth** with email/password plus magic link. Then get the three things right that a login page alone does not give you:

**1. Unauthenticated users see only the sign-in page.** A single route guard, applied at the router level rather than per-page, so a new screen is protected by default. No conversation, no message, no customer name renders before a session resolves — not even briefly while loading. On sign-out, clear all cached data.

**2. Authenticated is not authorized.** Supabase projects allow public sign-up by default, so `auth.uid() is not null` would let anyone who finds the URL create an account and read every conversation. Gate on membership instead:

```sql
create table portal_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'agent' check (role in ('agent', 'admin')),
  created_at timestamptz not null default now()
);

-- Every policy on every table checks membership, never just a session.
create policy "portal members read conversations" on conversations for select
  using (exists (select 1 from portal_users where user_id = auth.uid()));
```

Apply that same `exists (…)` predicate to `conversations`, `messages`, `webhook_events`, and `outbound_log`. Writes stay service-role only. In Supabase Auth settings, **turn public sign-up off** — members are invited.

Bootstrapping: the first account to sign up becomes `admin` if `portal_users` is empty, and every account after that must already have a row. Show the Setup screen this state so a cloner understands why their second colleague cannot get in yet.

**3. Edge functions verify the caller, not just the token.** `msp-send` runs with `verify_jwt` on, which proves the JWT is valid — it does not prove the holder belongs to this portal. Resolve the user from the JWT and confirm a `portal_users` row before touching the 1440 API, or a stranger's valid Supabase token from any project sends messages as your business.

**The one public endpoint is `msp-webhook`**, and deliberately so: 1440 authenticates with an HMAC signature rather than a Supabase JWT, so it runs with `verify_jwt = false` and is protected by signature verification instead. Do not put it behind the login — that breaks every delivery with a 401.

Roles: `admin` sees Setup and can invite members; `agent` sees the inbox and can send. Keep the distinction thin but real.

## Packages

The official SDK, imported with `npm:` specifiers (verified working on Deno — no Node built-ins, Web Crypto only):

```ts
import { MspClient, uuidv7, isMspApiError } from "npm:@1440io/msp-api@0.4.0";
import {
  WebhookReceiver, textBody, isInteractiveResponse, isKind, isRedacted,
  selectedIds, selectedTitles, selectedTimeslot, formAnswers,
  authenticationStatus, respondsTo, parseAppleTimestamp,
  type ReplayCache,
} from "npm:@1440io/msp-webhooks@0.4.0";
```

Read the key explicitly — `MspClient.fromEnv()` reads `process.env` and does nothing under Deno:

```ts
const client = new MspClient({ apiKey: Deno.env.get("MSP_API_KEY")! });
```

If a build fails with *"blocked by the minimum dependency age policy"*, that is Deno declining npm packages published within the last 24 hours. Pass `--min-dep-age 0`, or wait a day.

## Data model

Postgres, RLS on every table. Reads require a `portal_users` row for `auth.uid()` — not merely a session (see above); only the service role (edge functions) writes.

**conversations** — `id` uuid pk (the 1440 conversation id), `channel_platform`, `first_name`, `last_name`, `status`, `agent_status`, `opted_out` bool, `capability_list` text[] (the rich features the customer's device advertised, from the last inbound event), `last_message_at`, `last_message_preview`, `unread_count`, `created_at`, `updated_at`

**messages** — `id` uuid pk (the 1440 message id), `conversation_id` fk, `direction` (`inbound`|`outbound`), `content_kind` text (the `kind` tag: `text`, `amb.quick_reply_response`, …), `content` jsonb, `attachments` jsonb, `request_identifier` text null, `redacted` bool, `occurred_at`, `created_at`

**webhook_events** — `id` uuid pk (the `Webhook-Id` header, equal to the envelope's `eventId`), `event_type`, `payload` jsonb, `received_at`. Doubles as the replay cache: retries reuse the id, so a primary-key conflict *is* "already handled".

**outbound_log** — `request_message_id` uuid pk, `conversation_id`, `kind` (`text`|`template`|`raw`|`url_payload`), `target_url` text null (the link an agent sent, see the URL-payload quirk below), `status`, `error_code`, `issues` jsonb, `sent_by` uuid (the `portal_users.user_id` who sent it), `created_at`. Lets the UI explain a rejected send, and says which agent sent what — the audit trail an internal console handling customer conversations needs.

**portal_users** — as defined above. The allowlist every read policy checks.

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

Keep `verify_jwt` on, then **authorize** the caller: read the user id from the JWT, confirm a `portal_users` row exists for it, and return 403 if not. A valid JWT alone only proves the token came from some Supabase project. Record the sender in `outbound_log.sent_by`. Accepts `{ conversationId, body?, attachmentIds?, templateId?, variables?, url?, storeRegion? }` and calls `sendText`, `sendTemplate`, or — for `url` — `sendRaw`:

```ts
await client.messaging.sendRaw({
  conversationId,
  requestMessageId,
  content: { kind: "amb.url_payload", url, ...(storeRegion ? { storeRegion } : {}) },
});
```

Apple builds a rich link card from the URL at send time, for the services it knows: Apple Music, Apple Maps, and App Clips. No template to author, no image to upload, nothing to publish first. `storeRegion` is a two-character App Store region for App Clips — omit the key entirely rather than sending `""` or `null`, and Apple defaults to US.

**The raw route needs a second permission.** `sendText` and `sendTemplate` need only `SendMessages`; `sendRaw` additionally requires **`SendRawChannelPayloads`**. A key without it fails every link send with a `403` carrying `code: "PERMISSION_DENIED"` and the missing key in `missingPermission` — nothing that mentions links. Check it at Setup rather than mid-conversation.

Mint the `requestMessageId` with `uuidv7()` and write it to `outbound_log` **before** sending; reuse it on retry. That key is what collapses a retry rather than double-sending — the API returns the original result with `duplicate: true`. Treat that as best effort rather than a guarantee: concurrent sends can both reach Apple before either is persisted, so a retry after an uncertain failure can still deliver a second copy.

Catch `isMspApiError(error)` and return `{ status, code, reasons }` so the UI can say *why* a rich send was refused instead of failing blankly.

### `msp-sync` — backfills history

Uses the SDK's paginator so a fresh clone shows real conversations immediately:

```ts
for await (const conversation of client.conversations.list({ status: "active" })) { /* upsert */ }
```

Triggered from Setup, and once automatically after secrets are first configured.

## Screens

**Sign in** — the only route reachable without a session. Email/password and magic link, a clear error when an account exists but is not a portal member ("your account is not authorized for this console — ask an admin to invite you"), and nothing else on the page: no customer data, no counts, no hint of what is inside.

**Inbox** — conversation list: customer name (or the channel address when unnamed), last-message preview, relative time, unread badge. Filter by status; conversations are AMB-only in this API revision, so a channel filter has nothing to filter. Search included. Updates live via Realtime.

**Conversation** — the thread, with each content kind rendered as itself, never as raw JSON. `content` is tagged by `kind`, so switch on it:
- `text` → a bubble (`textBody(content)`), with the subject shown above it when present
- `amb.quick_reply_response` / `amb.list_picker_response` → a small labelled card, "Chose: Large", via `selectedTitles`/`selectedIds`
- `amb.time_picker_response` → the booked slot from `selectedTimeslot(content)`, which returns `{ id, startsAt: Date, durationSeconds }`
- `amb.form_response` → a definition list from `formAnswers(content)`, keyed by page identifier; hide the values when `isPrivateForm(content)`
- `amb.authentication_response` → the outcome from `authenticationStatus(content)` (`success` / `failure` / `cancel` / `unknown`)
- `amb.rich_link` → a link card. This is also what a sent URL payload comes back as (see the quirks below), so render it from `outbound_log.target_url` when `richLinkDataRef` is empty
- `opt_out` → a persistent banner, and the composer disabled
- `isRedacted(message)` → say the body was withheld rather than rendering an empty bubble
- attachments → thumbnails; each carries `status` (`pending` / `ready` / `failed`), `accessUrl`, and `accessUrlExpiresAt`

Outbound messages show delivery state from `outbound_log`, including the reject reason when there is one.

**Composer** — text plus attachments, and a rich tab for sending a published template with its variables filled in. Read each template's `readiness` and **disable send when it is blocked on this conversation's channel**, showing the reason codes. Catching that before the send is the difference between a helpful UI and a mystery 422.

Also check the conversation's stored `capability_list` before offering a rich template: a device that never advertised `LIST` cannot render a list picker, and sending one anyway is a reject you could have predicted.

A third **Link** tab sends a URL for Apple to render: one URL field, an optional region selector shown only when the URL looks like an App Clip, and a line naming what Apple supports. Validate `https` only, printable ASCII, and at most 8,192 **bytes** — measure bytes, not characters, since a pasted em dash or smart quote is both longer than it looks and not ASCII. Validate on blur, not per keystroke.

Do not gate the Link tab on `capability_list`. That list covers interactive types (`QUICK`, `LIST`, `TIME`, `AUTH`, `AUTH2`, `FORM`); rich links are not in it, and applying the capability rule here would hide the feature from every device that never advertised one. Gate it on the `SendRawChannelPayloads` permission instead.

No preview card. We do not know what Apple will build until it builds it, and a mock that does not match what the customer sees is worse than showing nothing.

**Templates** — gallery of published templates with per-channel readiness badges, filterable by `templateType` (`text`, `quick_reply`, `list_picker`, `time_picker`, `form`, `rich_link`, `imessage_app`, `app_clip_rich_link`, `authentication`). Empty state matters: a new org has none, so say so and link to where they are authored.

`app_clip_rich_link` templates are now `{ kind, url, storeRegion }` only — the `title` and `imageSlot` fields were removed, because Apple constructs the card rather than rendering authored content. If all you want is to send an App Clip link, the Link tab does it with no template at all.

**Setup** (admin only) — the screen that makes this a template. Non-admins get a clear "ask an admin" message rather than a blank page. A checklist showing: whether public sign-up is disabled and how many portal members exist; whether `MSP_API_KEY` and `MSP_WEBHOOK_SECRET` are set; whether the key carries `SendRawChannelPayloads`, without which link sending is unavailable; the exact webhook URL to paste into the 1440 console (this project's deployed `msp-webhook` URL, with a copy button); a "Run backfill" button; a live tail of recent `webhook_events` so someone can watch a delivery land and know it works; and an invite form that adds a `portal_users` row for a colleague.

The permission row needs its own call — the client caches its token internally and never hands the grant back. Cache the answer rather than checking per render, because this mints a token:

```ts
const { grant } = await client.auth.exchangeIntegrationToken(Deno.env.get("MSP_API_KEY")!);
const canSendRaw = grant.permissionKeys.includes("SendRawChannelPayloads");
```

## Demo mode

Demo data lives **behind the login like everything else** — the sign-in page never previews it. Once signed in with no secrets configured, seed realistic sample conversations — including an interactive reply and an attachment — so a fresh clone looks alive instead of broken. Show an unmistakable "Demo data" banner linking to Setup. Real data replaces it after the first backfill.

## Apple Messages quirks — confirmed against the live platform

Each of these produces a confusing failure if ignored:

- **Quick replies need 2–5 items**, which the schema now enforces. A one-item reply used to pass validation and get rejected by Apple as a `502` that said nothing about item counts.
- **The quick-reply payload key is hyphenated** — `data['quick-reply']` — while list picker is `data.listPicker`. This asymmetry runs through the inbound payloads too, which is why the reader helpers exist.
- **Time-picker times are not RFC 3339.** They arrive as `2026-08-25T23:55+0000`: no seconds, no colon in the offset. JavaScript's `Date` accepts it, so the bug hides until the value reaches a stricter parser. Use `selectedTimeslot()` or `parseAppleTimestamp()`, never the raw string.
- **Reactions arrive as text.** A "Liked" reaction comes through as `kind: 'text'` with the body `"Liked 1 Business Message"`. There is no tapback kind to narrow to.
- **Correlate replies with `respondsTo(content)`**, which may be null — custom iMessage apps carry no correlation promise.
- **Opt-out is binding.** Once `opted_out` is true, block sending in the UI, not just at the API.
- **`mediaAssetId` is not an `attachmentId`.** Uploading returns a media asset id; attaching it to a message mints a *separate* attachment with its own id. Read URLs (`media.getAccessUrl`) take that second id, from message history or an inbound webhook. Passing the upload's id is a `404`, despite what the API docs say.
- **A sent URL payload comes back as a different kind.** You send `kind: 'amb.url_payload'`, but there is no such *stored* kind — history records it as `amb.rich_link`. A renderer case for `amb.url_payload` is dead code that will never match.
- **You cannot rely on reading your own link back.** Stored rich-link content carries `richLinkDataRef`, whose `title` and `url` are both optional; the reference describes Apple's constructed payload, and provider content URLs are omitted rather than echoed. Persist the URL you sent in `outbound_log.target_url` and render outbound link bubbles from that, falling back to `richLinkDataRef` when it is populated.
- **A link Apple cannot render is a `422`, not a `400`.** Nothing local can predict it — a perfectly well-formed URL to a service Apple has no rich treatment for is rejected before delivery. Say "Apple could not build a preview for this link" and do not retry; the answer will not change.
- **`502` and `500` on a send do not mean the message was not delivered.** `502` is either construction failing, where nothing was sent, or sending failing, where acceptance is unknown. `500` means persistence could not be confirmed after the channel may already have accepted. Mark these `uncertain` rather than `failed`, say "may have been delivered — check before resending", and do not offer a one-click resend. The SDK already retries both under the same `requestMessageId`; do not wrap it in a retry loop of your own.
- **Unknown fields are rejected on a request body but ignored inside `content`.** A typo in a raw Apple payload renders wrong rather than erroring, so validate your own content shapes.

## Design

A calm, dense agent console — a tool, not a landing page. Two panes: conversation list left, thread right. System font stack, generous line height in the thread, subtle borders rather than heavy shadows. Full light and dark support. Inbound and outbound differ by alignment and a restrained background, not loud color. Timestamps quiet and secondary. The interface should feel like something an agent stares at for eight hours.

## Done means

- Signing out and visiting any URL directly lands on the sign-in page, with no customer data rendered first.
- An account that signs up but has no `portal_users` row can authenticate and still read nothing — verify by querying a table directly with that session's token, not just by looking at the UI.
- `msp-send` refuses a valid JWT whose user is not a portal member.
- `msp-webhook` still accepts a signed delivery with no Supabase session at all.
- No secret appears in frontend source or the network tab.
- A tampered or unsigned delivery is rejected with 400; a delivery sent twice is stored once.
- Sending a message shows it in the thread, and a customer's reply arrives live with no refresh.
- A blocked rich template cannot be sent, and the UI says why.
- With a key lacking `SendRawChannelPayloads`, the Link tab is disabled with that exact reason and Setup says the same thing before a conversation is ever opened.
- A non-HTTPS link, a non-ASCII link, and a 9,000-byte link are each refused in the composer with a specific message and no network round trip.
- A sent link renders in the thread from `outbound_log.target_url`, and still renders when `richLinkDataRef` comes back empty.
- Nothing in the message renderer switches on `amb.url_payload`; stored link messages are `amb.rich_link`.
- A clone with no secrets still renders demo data and a Setup checklist that explains exactly what to do next.
