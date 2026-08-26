# @1440io/msp-types

## 0.1.0

Initial release.

- Types generated from the 1440 MSP API OpenAPI 3.1 document with `openapi-typescript`, covering all 143 schemas, 43 operations, and both webhook events.
- Curated aliases (`Conversation`, `SendMessageBody`, `WebhookEvent`, and friends) alongside the raw `paths` / `operations` / `components` surface, also exported at `@1440io/msp-types/openapi`.
- Runtime vocabularies for the spec's string unions — `CHANNEL_PLATFORMS`, `CONVERSATION_STATUSES`, `INITIATION_STATUSES`, `RICH_REASON_CODES`, `INTERACTIVE_RESPONSE_TYPES`, and others — each `satisfies` its type, so a spec change that adds a value fails the build instead of drifting.
- `WebhookContentFor` / `WebhookMessageOfType`, which map a message's `messageType` to the `content` shape that goes with it.
