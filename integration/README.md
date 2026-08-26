# Integration tests

These run against a **live** 1440 MSP API. They exist to answer questions unit tests structurally cannot:

- Does the real API key exchange for a token, and does that token open the routes the SDK calls?
- Do live responses still match `spec/1440-cloud-openapi.json` — the document these packages are generated from?
- Does idempotency actually collapse a replayed send, rather than delivering twice?
- Does the real signing secret verify a real signature?

Every live response is validated against its OpenAPI schema, so a run doubles as a drift check between production and the spec.

## Setup

```bash
cp .env.example .env.local
```

Fill in `.env.local` — it is gitignored, and nothing in this suite ever prints a credential. Then look before you leap:

```bash
npm run integration:preflight
```

Preflight exchanges your key, prints the business, channels, and grant it resolved, and lists exactly which tiers a run would exercise — including naming the conversation a send would land in and the number an initiation would ring. Run it first, every time, especially against production.

```bash
npm run test:integration
```

## Tiers

Credentials alone unlock reads. Everything with a side effect needs its own opt-in, because a mistyped `MSP_BASE_URL` or a stale `.env.local` should not be able to message a customer.

| Tier | Flag | What it does |
| --- | --- | --- |
| Read | `MSP_API_KEY` | Token exchange, conversations, templates, channels, initiations, admin reads, delivery log. No side effects. |
| Write | `MSP_TEST_ALLOW_WRITES=1` | Creates and deletes template drafts, rich assets, and permission sets; renames a conversation and restores the old name. All cleaned up in `finally`. |
| Send | `MSP_TEST_ALLOW_SEND=1` + `MSP_TEST_CONVERSATION_ID` | **Delivers real messages.** A person may read them. Each is prefixed `[SDK integration test <run id>]`. |
| Initiate | `MSP_TEST_ALLOW_INITIATE=1` + `MSP_TEST_PHONE_NUMBER` | **Rings a real device** with an Apple Messages request. |

A skipped tier says so by name in the output, so a run that quietly did less than you expected is visible rather than silent.

## What each file covers

| File | Covers |
| --- | --- |
| `harness.integration.test.ts` | Self-test — validates the spec's own examples and proves the validator catches violations. Needs no credentials, so it always runs. |
| `auth.integration.test.ts` | Token exchange, JWT shape, short lifetime, grant, 401 on a bad key and a bad bearer token. |
| `channels.integration.test.ts` | Active channels, platform vocabulary, admin/runtime agreement. |
| `conversations.integration.test.ts` | Pagination across real cursors, filters, message windowing, cross-tenant 404s, name round-trip. |
| `templates.integration.test.ts` | Published listing, readiness reasons, and the full draft → publish → archive → delete lifecycle. |
| `media.integration.test.ts` | Upload, signed read URL, **byte-for-byte round trip**, TikTok content-type rejection, asset library lifecycle. |
| `messaging.integration.test.ts` | Real sends, idempotent replay, 409 on a reused key with different content, attachments, template sends, readback. |
| `initiations.integration.test.ts` | Listing, status vocabulary, and a real initiation followed to a terminal status. |
| `rich-payloads.integration.test.ts` | Apple payload rules — envelope-field rejection, quick-reply item bounds, the `listPickerItem` pitfall, marker mismatches, the 5 MiB cap. **Non-destructive**: targets a conversation that cannot exist, so nothing is ever delivered. |
| `rich-templates.integration.test.ts` | Authoring quick replies, list pickers (static and dynamic), and time pickers; readiness and `resolvedNativeType`; reject reason codes. |
| `rich-send.integration.test.ts` | Real rich sends, per-send collection variables, variable validation, raw payload idempotency and conflict. |
| `rich-responses.integration.test.ts` | Replies as the read API stored them — response shapes, correlation, time parsing, and how reactions really arrive. Read tier, no tap needed. |
| `rich-roundtrip.integration.test.ts` | Prompt → human taps → reply, correlated by `requestIdentifier` and parsed with the narrowing helpers. |
| `webhooks-secret.integration.test.ts` | The real signing secret: format, verification, tampering, rotation, replay dedupe. |
| `webhooks-deliveries.integration.test.ts` | The delivery log — event types, attempt history, endpoint configuration. |
| `webhooks-live.integration.test.ts` | A real platform delivery over the network, verified by this SDK. |

## Testing rich messages and replies

Rich messaging is a round trip, and only one half can be automated. It splits three ways here:

1. **Payload rules** (`rich-payloads`) run with no tier enabled at all. Every send targets a conversation id that cannot exist, so a payload that passes validation gets a 404 instead of being delivered — which also makes 404 a *useful* assertion: it proves validation passed. The spec promises a documented set of rejections happen before conversation lookup, so for those a 404 means the guard did not fire.
2. **Authoring and sending** (`rich-templates`, `rich-send`) build real templates of each native kind, check what `readiness` says they resolve to, and send them.
3. **The reply** (`rich-roundtrip`) cannot be synthesized — no API produces a customer tap. The test sends a quick reply carrying its own `requestIdentifier`, then waits for the inbound response that echoes it, and asserts the correlation and the parsed selections. Someone has to tap the device while it waits.

## Live webhook test

The only event you can provoke on demand is `initiation.updated`, so with the initiate tier on, the live test creates an initiation and waits for its webhook. Otherwise it waits passively and asks you to message the business from a device.

```bash
npm run webhook:listen                              # terminal 1
cloudflared tunnel --url http://localhost:3000      # terminal 2
```

Point the integration's webhook endpoint at `<public-url>/webhooks/1440`, then set `MSP_TEST_WEBHOOK_LIVE=1` and run the suite. `webhook:listen` on its own is also the fastest way to eyeball real traffic — it prints every verified event and shouts about every rejection.

## Spec drift

Live responses are checked against their schemas. The two outcomes are treated differently on purpose:

- **A violation fails the test** — a missing required field, a wrong type, an enum value the spec does not list. The SDK's types are wrong about production, and someone will hit it.
- **An undocumented property warns** — the server is ahead of the spec, which is routine and additive. Warnings are collected and printed once at the end of the run.

`MSP_TEST_STRICT_SCHEMA=1` promotes warnings to failures, which is what you want in a job that guards the spec.

### Known drift

`integration/schema.ts` carries a short `KNOWN_DRIFT` list: deviations confirmed against production and deliberately tracked as warnings rather than failures, each with a note on what to do about it. Today it holds one entry — time-picker `selectedStartTime` arriving in Apple's basic format instead of the RFC 3339 the spec declares. Reconcile the spec or the server and the entry comes out.

## After a crash

Everything the suite creates is named `msp-it-*`. If a run dies before its cleanup:

```bash
npm run integration:cleanup            # dry run — lists what it would delete
npm run integration:cleanup -- --apply
```

## Notes

- Tests run **serially**. Shared org state and real rate limits make parallelism a liability here.
- The suite retries once on a transport blip; a genuinely flaky API is reported rather than hidden.
- Tests degrade rather than fail when the org lacks data — no conversations, no published templates, an integration without the admin tier all log the reason and move on.
- These do not run in CI by default. Wiring them to a schedule needs the secrets in the CI environment, and the destructive tiers left off unless the target is disposable.
