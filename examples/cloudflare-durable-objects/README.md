# AMB on Cloudflare — Worker + Durable Object spike

A working spike: 1440 webhooks verified at the edge, then routed to one
Durable Object per conversation.

```bash
npm install
npx wrangler dev
node test/drive.mjs     # in another terminal
```

## What it demonstrates

| | Result |
| --- | --- |
| Signature verified at the edge with Web Crypto | tampered body → `400` before it reaches any region |
| Dedupe on `Webhook-Id` | a retried delivery returns `duplicate: true`, handler runs once |
| Ordering of outbound sends | a slow send completes before a fast one that started later |
| Prompt → tap correlation, with a follow-up alarm | reply matched by `requestIdentifier`, alarm cleared on answer |
| Per-conversation isolation | a different conversation is a different object with its own state |

## The thing worth knowing

**Durable Objects do not serialize whole request handlers.** This is the most
commonly repeated misunderstanding about them, and the spike was built on it
before the test disproved it.

What DOs actually give you is the **input gate**: while a storage operation is
in flight, other events are not delivered, which makes read-modify-write on
storage atomic without a lock. That is what makes the dedupe in `onEvent`
correct — two simultaneous deliveries of the same event cannot both miss the
seen-check.

It does *not* mean a handler runs to completion before the next begins. While a
handler awaits something that is not storage — an HTTP call to the 1440 API,
say — another request runs. The first version of this spike interleaved two
sends exactly that way:

```
A:start → B:start → B:end → A:end        # what actually happened
```

Apple does not guarantee ordering and the 1440 docs say to await each send
before starting the next, so ordering has to be arranged explicitly. Here that
is a promise chain (`serialize()` in `conversation.ts`) covering outbound sends
only — inbound events stay off it so they never queue behind a slow send:

```
A:start → A:end → B:start → B:end        # after the fix
```

The chain is in memory, so it orders sends within an object's lifetime.
Ordering across an eviction needs a queue in storage drained by an alarm.

## Why a Durable Object per conversation

The object is addressed by the conversation id 1440 already assigns
(`idFromName(conversationId)`), so there is no mapping table. Dedupe state,
which rich prompt is outstanding, and the follow-up timer all live in the one
place that owns the conversation, instead of a cache, a table, and a cron job.

Idle conversations hibernate and cost nothing, which suits a workload where
most conversations are asleep most of the time.
