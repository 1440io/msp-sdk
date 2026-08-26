# @1440io/msp-webhooks

## 0.1.0

Initial release.

- Webhook signature verification on Web Crypto — Node 20+, Cloudflare Workers, Vercel Edge, Deno, and Bun from one implementation. Raw-byte HMAC over `{id}.{timestamp}.{body}`, a five-minute timestamp tolerance, multi-token acceptance for key rotation, and replay suppression.
- `WebhookReceiver` mapping outcomes onto the platform's retry rules: 2xx acknowledges, a handler that throws returns 500 so the delivery is retried, and a duplicate acknowledges without running handlers twice.
- Adapters for Express, Fastify, Fetch (Next.js App Router, Hono, Workers, Deno), and AWS Lambda. Each passes the exact request bytes through, and the Express adapter fails loudly when a JSON parser has already consumed the body.
- Narrowing helpers for customer replies. A message's `content` is discriminated by its sibling `messageType`, which TypeScript cannot narrow on its own, so `isTextMessage`, `isInteractiveMessage`, `isTapbackMessage`, and `isOptOutMessage` do it — with `selectedIds`, `selectedTitles`, `formValuesByPage`, and `respondsTo` for reading the result.
- `parseAppleTimestamp` / `selectedStartTime` for time-picker replies, whose `selectedStartTime` arrives in Apple's basic format (`2026-08-25T23:55+0000`) rather than the RFC 3339 the spec declares. JavaScript's `Date` accepts it; stricter parsers do not.
