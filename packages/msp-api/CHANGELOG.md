# @1440io/msp-api

## 0.1.0

Initial release.

- Typed client covering every documented route: conversations, messaging, initiations, templates, media, channels, invitations, and the business-admin surface.
- Integration API key exchanged for a short-lived JWT automatically, with single-flight refresh, refresh ahead of expiry, and one refresh-and-retry on a 401. Bring your own token or token provider instead if you prefer.
- `Paginator` over cursor-based and `before`-based lists: await it for one page, `for await` for every item, `toArray(limit)` to stop early. Implements `then`/`catch`/`finally`.
- Typed errors carrying the canonical `{ error, code }` envelope plus rich-messaging `reasons` — `MspValidationError`, `MspAuthenticationError`, `MspPermissionError`, `MspNotFoundError`, `MspConflictError`, `MspRateLimitError`, `MspServerError`, and more.
- Retries with jittered backoff for GETs and idempotent writes, honouring `Retry-After`. Sends mint a UUIDv7 `requestMessageId`, and a retry reuses it, so a retried send cannot double-deliver.
- Media upload with client-side size ceilings, and `messaging.sendRaw` for channel-native Apple payloads.
