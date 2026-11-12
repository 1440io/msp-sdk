# Build: Apple Pay in Apple Messages for Business

A brief for the team implementing payment requests on top of the 1440 MSP SDK.
Everything below has been validated end to end against the live MSP — the
gotchas are observed behaviour, not guesses.

## What you are building

A customer messaging with the business in Messages receives a **payable
bubble**. They approve with Face ID, Apple encrypts a payment token, and that
token goes **to our payment gateway — never through 1440**. 1440 carries the
bubble and the customer's response; it does not touch money.

That split drives the whole design:

```
  our backend ──(1) mint merchant session──▶ Apple
  our backend ──(2) requestPayment────────▶ 1440 ──▶ customer's device
  customer approves
  device ──────(3) encrypted token───────▶ our payment gateway endpoint
  1440 ────────(4) amb.payment_response──▶ our webhook   (outcome, no token)
  our gateway ─(5) charge────────────────▶ PSP          (the actual money)
```

Steps 1, 3 and 5 are **ours to build**. The SDK covers 2 and 4.

## Packages

```
@1440io/msp-api       0.6.0   client — messaging.requestPayment()
@1440io/msp-webhooks  0.6.0   inbound verification + content readers
@1440io/msp-types     0.6.0   generated types and runtime vocabularies
```

## Service 1 — merchant validation (we own this)

Apple requires a freshly minted **merchant session** for each payment request.
We mint it from a backend holding the Apple Pay **merchant identity
certificate**, then hand it to 1440 as an opaque blob.

Request to Apple must use the messaging initiative:

```jsonc
{
  "merchantIdentifier": "<the 64-hex merchant hash>",
  "displayName":        "<business name>",
  "initiative":         "messaging",          // NOT "web"
  "initiativeContext":  "https://<our-domain>/<gateway-path>",
  "domainName":         "<our-domain>"
}
```

Requirements:

- **Register the domain with Apple** and serve the association file (below).
- **Cache the session.** Observed lifetime is roughly **two hours**, not the
  five minutes the web Apple Pay docs imply. Minting one per request is
  wasteful and adds a failure mode; mint on demand, cache, refresh before
  expiry. The minted session's `expiresAt` is echoed on the outbound bubble,
  so staleness is observable.
- **Never expose this endpoint to the browser** and never ship the certificate
  anywhere near a client.
- Protect it with an API key or mTLS. Treat a leak as certificate compromise.

### The domain association file — four ways we got this wrong

1. Apple fetches it **without a file extension**:
   `/.well-known/apple-developer-merchantid-domain-association`.
   Serving only the `.txt` variant fails verification. Serve both.
2. The file content is **base64url** — it legitimately contains `-` and `_`.
   It is not corrupt. Do not "repair" it with a standard-base64 decoder.
3. Serve the **exact bytes**. A pretty-printer or template that introduces
   indentation or a trailing newline breaks verification.
4. The file is **per-domain**. The one generated for `example.io` will not
   verify `example.co`.

Apple's registration is **eventually consistent**: the first session mint
shortly after registering may fail, and the identical retry succeeds. Observed
twice. Build a single bounded retry; do not treat the first failure as fatal.

## Service 2 — the payment gateway endpoint (we own this)

The URL in `initiativeContext` must be a real endpoint we control. On approval
Apple posts the **encrypted payment token** there. It must:

- Decrypt using the Apple Pay **payment processing certificate** (a different
  certificate from the merchant identity one).
- Hand the result to our PSP to actually charge.
- Be idempotent — assume Apple may deliver twice.
- **Never log the token or the decrypted PAN.** This endpoint is in PCI scope;
  everything upstream of it is not. Keep it that way.

If we use a PSP that accepts Apple Pay tokens directly, it can hold the
processing certificate and we forward the token without decrypting — strongly
preferred, as it keeps PAN data out of our systems entirely.

## Sending the request

```ts
import { MspClient, uuidv7, isMspApiError } from '@1440io/msp-api';

const client = new MspClient({ apiKey: process.env.MSP_API_KEY! });

const requestMessageId = uuidv7();          // keep it — see "Correlation"
const result = await client.messaging.requestPayment({
  requestMessageId,
  conversationId,
  merchantSession,                          // opaque, from Service 1
  paymentRequest: {
    currencyCode: 'USD',
    countryCode:  'US',
    total: { label: 'Order #1234', amount: '24.99', type: 'final' },
  },
  receivedMessage: { title: 'Order #1234', style: 'large' },  // before paying
  replyMessage:    { title: 'Thank you',   style: 'large' },  // after replying
});
// result.messageId, result.duplicate
```

**`requestPayment` is deliberately not auto-retried.** A retry on an uncertain
send risks a second payable bubble in front of the customer. Supply a stable
`requestMessageId` and retry explicitly only when you have decided that is
correct. Identical bytes replay the stored result; differing bytes conflict.

Optionally show a typing indicator with `client.messaging.sendTyping(...)`.
It is best effort, unpersisted and unretried — decoration. Never await it as a
precondition for sending.

## Receiving the outcome

The customer's reply arrives as a `message.received` webhook carrying
`amb.payment_response`:

```ts
import { WebhookReceiver, paymentState, paymentRequestOf, respondsTo }
  from '@1440io/msp-webhooks';

receiver.on('message.received', ({ message }) => {
  const content = message.content;
  if (content?.kind !== 'amb.payment_response') return;

  const requestId = respondsTo(content);    // === the requestMessageId we sent
  const state     = paymentState(content);  // Apple's status string
  const charged   = paymentRequestOf(content);
});
```

### Correlation — get this right

The response carries `data.requestIdentifier`, which equals the
`requestMessageId` we sent. **Correlate on that**, via `respondsTo()`.

Do not correlate by "the most recent payment response on the conversation."
We shipped exactly that bug in a test harness and it cheerfully reported a
*previous* request's outcome as the answer to a new one. With several requests
open on a conversation, timestamp proximity is not correlation.

### `state` is Apple's word, not ours

There is no caller-supplied `state` field on the request. `state` is Apple's
status for the transaction — e.g. `paymentNotCompleted` when the customer
dismissed or failed the sheet. Do not treat the set as closed; read it as an
opaque string and branch on known values with a default.

### A response does not mean money moved

`amb.payment_response` means **the customer acted**. The token went to our
gateway, not to 1440, so 1440 cannot know whether the charge succeeded.
**Settlement is confirmed with the PSP.** Any "paid" state in our product must
be driven by the PSP's confirmation, with the messaging response used only for
UX. Never mark an order paid off the webhook alone.

### Echoed values are normalised

Apple reformats what it echoes back: `"1.00"` comes back as `"1"`, and
`type: "final"` comes back as `"Final"`. Never string-compare the echoed
amount against what you sent. Compare numerically, or trust your own record.

## Error ladder

`requestPayment` surfaces these in order as configuration is fixed. All four
were hit during bring-up:

| Code | Meaning | Fix |
|---|---|---|
| `apple_pay_unavailable` | Apple Pay not enabled for the business | Enable it in the MSP; confirm the `RequestPayments` permission is granted |
| `apple_pay_session_expired` | Session elapsed between minting and sending | Check cache refresh; check clock skew |
| `apple_pay_merchant_mismatch` | Session's merchant id ≠ the one configured in 1440 | **1440 must hold the 64-hex merchant hash Apple returns, not the `merchant.…` identifier.** This one cost us the most time |
| `apple_pay_gateway_mismatch` | Gateway in the session ≠ the one configured in 1440 | Align `initiativeContext` with the gateway URL configured in the MSP |

Handle them explicitly — they are configuration faults, not transient errors,
and retrying without a change will fail identically.

## Acceptance criteria

- [ ] Merchant validation endpoint mints with `initiative: "messaging"`, is
      not reachable from the browser, and is authenticated.
- [ ] Sessions are cached and refreshed before expiry; a single bounded retry
      covers Apple's eventual consistency.
- [ ] Association file served at both the extensionless and `.txt` paths, byte
      exact, for the exact domain; Apple shows the domain verified.
- [ ] Payment gateway endpoint decrypts (or forwards) and is idempotent; no
      token or PAN reaches any log.
- [ ] `requestPayment` sends with a persisted `requestMessageId`; retries are
      explicit, never automatic.
- [ ] Webhook handler correlates via `respondsTo()`, never by recency.
- [ ] Order state transitions to paid **only** on PSP confirmation.
- [ ] All four `apple_pay_*` codes have explicit handling and operator-legible
      messages.
- [ ] End-to-end run on a real device: bubble appears, approval charges at the
      PSP, response correlates to the right request.

## Reference scripts

The SDK repo has runnable bring-up scripts under `integration/scripts/`:
`payment-readiness.ts` (config preflight), `payment-send.ts` (send one request),
`payment-watch.ts` (await and correlate the response).
