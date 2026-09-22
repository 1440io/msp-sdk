# Sending a link

How to send an Apple-rendered link card into a conversation.

Written for whoever is calling the `msp-send` edge function from the [AMB Agent
Console](./lovable-template-prompt.md). If you are calling the SDK directly
instead, skip to [Calling the SDK directly](#calling-the-sdk-directly) at the
end — everything else on this page still applies.

Requires `@1440io/msp-api@0.4.0` or newer.

## What it does

You send a URL. Apple turns it into a rich card in the conversation — artwork,
title, tap-to-open — instead of a plain blue hyperlink.

There is no template to create, no image to upload, and nothing to publish
first. You hand over the URL and Apple builds the card when the message sends.

## Sending one

Call `msp-send` the same way you already do for text, but pass `url` instead of
`body`:

```ts
const { data, error } = await supabase.functions.invoke("msp-send", {
  body: {
    conversationId: "0190f3f0-0000-7000-8000-000000000012",
    url: "https://maps.apple.com/?q=Blue+Bottle+Coffee",
  },
});
```

That is the whole thing. The agent sees the link appear in the thread; the
customer gets a tappable card.

## What Apple can render

Three kinds of link, and only these three:

| Link type  | Example                                                     |
| ---------- | ----------------------------------------------------------- |
| Apple Maps | `https://maps.apple.com/?q=coffee`                          |
| Apple Music| `https://music.apple.com/us/album/abbey-road/1441164426`    |
| App Clip   | your App Clip URL                                           |

Anything else — your marketing site, a PDF, a YouTube video — comes back
rejected. Send those as ordinary text instead; they will still be tappable,
just not a card.

**For App Clips only**, you can add a region so the right App Store answers:

```ts
body: {
  conversationId,
  url: "https://appclip.example.com/order",
  storeRegion: "GB",          // two letters; leave it out entirely for US
}
```

Leave `storeRegion` out if you want the US default. Do not send `""` or `null`
— omit the field.

## Rules for the URL

Three things get rejected before the message ever leaves your app, so check
them in your form:

- **Must be `https`.** Not `http`, not `maps://`.
- **Plain ASCII only.** This one bites: a URL copied out of a document often
  has a smart quote or an em dash in it, which looks identical on screen but is
  not ASCII.
- **Under 8,192 bytes.** Count bytes, not characters — long tracking parameters
  add up faster than they look.

## What you get back

A success looks like any other send:

```json
{ "messageId": "0190f3f0-...", "duplicate": false }
```

One thing that surprises people: **you send a "url payload" but it is stored as
a "rich link."** When you read the conversation back, that message's kind is
`amb.rich_link`, not `amb.url_payload`. There is no such thing as a stored URL
payload — the payload is just how you *asked* for the card.

Related: **do not count on reading your own URL back out.** The stored message
describes the card Apple built, and it often will not include the link you
sent. If you want to show the agent what they sent, save the URL on your side
when you send it. The console does this in `outbound_log.target_url`.

## When it doesn't work

| What you see               | What it means                                         | What to do                                                        |
| -------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `403` — missing permission | Your API key cannot send links                        | One-time setup, see below                                         |
| `422`                      | Apple will not build a card for this URL              | Tell the user, send it as text instead. Retrying will not help    |
| `410`                      | Customer opted out                                    | Do not send. This is permanent                                    |
| `409`                      | Reused the same request ID with different content     | Use a fresh request ID                                            |
| `502` or `500`             | **Unknown whether it was delivered**                  | See below                                                         |

**About `502` and `500`** — these are the awkward ones. They do not mean
"failed." They mean the system lost track of what happened: the message may
have reached the customer, or it may not have. Show it as *"may have been
delivered"* rather than a red failure, and check with the customer before
resending. If you resend, they might get it twice.

## One-time setup

Link sending needs a permission that ordinary text and template sending does
not: **`SendRawChannelPayloads`**.

If your 1440 integration key was created before you started sending links, it
almost certainly does not have it, and every link send will fail with a `403`
that does not mention links at all. Add the permission to the integration in
your 1440 console.

The Setup screen shows whether your key has it, so check there first if links
are not working.

## Calling the SDK directly

Without the edge function, it is one call:

```ts
import { MspClient, uuidv7 } from "@1440io/msp-api";

const client = new MspClient({ apiKey: process.env.MSP_API_KEY! });

await client.messaging.sendRaw({
  conversationId,
  requestMessageId: uuidv7(),
  content: {
    kind: "amb.url_payload",
    url: "https://maps.apple.com/?q=Blue+Bottle+Coffee",
  },
});
```

Keep the `requestMessageId` if you retry — reusing it is what stops a retry
becoming a second card in the customer's thread. Note that this is best effort
rather than a guarantee, which is exactly why `502` and `500` are ambiguous
above.
