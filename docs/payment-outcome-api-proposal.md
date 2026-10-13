# Proposal: payment outcome reporting

**Status:** draft for the MSP team · **Scope:** one inbound route, one webhook, no money movement

## The problem

1440 delivers a payable bubble and learns that the customer responded. It never learns whether they paid.

On approval, Apple posts the encrypted token to the payment gateway registered for the business, not to 1440. The inbound `amb.payment_response` carries only the opaque `state` the business supplied and an echo of the amount — no status, no token, no settlement signal. There is no payment-status route anywhere in the current spec.

So conversation state diverges from reality the moment money moves. An agent console shows "the customer responded" and cannot say whether that was a successful charge, a declined card, or a cancel. Every product built on the conversation inherits that blind spot, and each one solves it by reaching into the brand's PSP separately — or not at all.

This closes the loop without 1440 touching card data, holding keys, or taking settlement risk. The business's gateway already knows the outcome; it just has nowhere to put it.

## The route

```
POST /api/v0/messaging/payments/{requestMessageId}/outcome
```

**Auth:** business JWT. **Tier:** `member`. **Permission:** `RequestPayments` (the caller already needs it to have created the request; a separate `ReportPaymentOutcomes` is possible but looks like needless granularity).

Keyed on `requestMessageId` because that is what the business's gateway already holds — the spec instructs it to deduplicate on exactly that value — so no new correlation identifier enters the system.

### Request

```jsonc
{
  "status": "succeeded",              // required, see the state machine
  "occurredAt": "2026-10-13T14:02:11.000Z", // required: when the gateway observed it
  "amount": "42.00",                  // required for succeeded/refunded/partially_refunded
  "currencyCode": "USD",              // must match the original request
  "processorReference": "ch_3Qk…",    // optional: PSP charge/refund id, for reconciliation
  "failureCode": "card_declined",     // optional, failures only
  "failureMessage": "Card declined"   // optional, failures only
}
```

### Responses

| Code | Meaning |
| --- | --- |
| `200` | Recorded, or an idempotent replay of the same outcome. Returns the current `PaymentOutcome`. |
| `400` | `validation_failed` with field-level `issues`, matching the send routes. |
| `404` | No payment request with that `requestMessageId` for this business. |
| `409` | The transition is not allowed from the current status — returns the current one. |
| `422` | `currency_mismatch`, or `amount_exceeds_original` on a refund. |

## State machine

```
            ┌──────────────► failed
            │
  pending ──┼──────────────► cancelled
            │
            └──► succeeded ──┬──► refunded
                             ├──► partially_refunded ──► refunded
                             └──► disputed ──► refunded
```

- A payment starts at `pending` the moment `request-payment` succeeds — no report needed to reach it.
- Replaying the **same** status with the same `amount` and `processorReference` is a no-op returning `200`, so a gateway retry is safe.
- A transition not on the diagram is `409`, with the current status in the body, rather than silently overwriting. Terminal money states must not be reversible by a stray retry.
- `partially_refunded` may be reported repeatedly with increasing cumulative `amount`; it becomes `refunded` when the amount reaches the original total.
- Out-of-order reports are rejected on `occurredAt`: a report older than the one that produced the current status is a no-op, not a regression.

## Reading it back

```
GET /api/v0/messaging/payments/{requestMessageId}
```

Returns the `PaymentOutcome`: current status, amounts, timestamps, the conversation and message it belongs to, and the full transition history. History matters — "refunded at 14:30 after succeeding at 14:02" is the thing a support agent actually needs.

The stored `amb.payment` content on the conversation should carry the current status too, so rendering a thread needs no second call.

## The webhook

```
payment.updated
```

Envelope identical to the existing events, so nothing new is needed on the receiving side:

```jsonc
{
  "eventId": "…", "v": 0, "type": "payment.updated",
  "organizationId": "…", "conversationId": "…",
  "payment": {
    "requestMessageId": "…",
    "messageId": "…",
    "status": "succeeded",
    "previousStatus": "pending",
    "amount": "42.00",
    "currencyCode": "USD",
    "processorReference": "ch_3Qk…",
    "occurredAt": "2026-10-13T14:02:11.000Z"
  }
}
```

This is what makes the feature worth having: the agent console, the CRM sync, and any bot all learn the outcome without integrating with the brand's PSP individually.

## What this deliberately is not

**Not verification.** 1440 cannot check the claim — it has no PSP access and cannot decrypt the token. A reported outcome is the business asserting something about its own payment, which is appropriate for its own data, but 1440 should never present it to a third party as proof of settlement. Worth saying plainly in the route description so nobody builds a guarantee on top of it.

**Not money movement.** No card data, no keys, no decryption, no PCI scope beyond what exists today. That is the entire point of preferring this over a gateway or PSP integration.

**Not required.** A business that never reports simply leaves payments at `pending`, exactly as today. Nothing regresses for anyone who ignores it.

## Open questions for the MSP team

1. **Does the gateway actually receive `requestMessageId`?** The send route's description tells customer gateways to deduplicate on it, which implies yes — but if the correlation identifier Apple returns is something else, this should key on that instead. Worth confirming before building.
2. **Should `pending` be implicit or explicit?** Implicit is simpler; explicit lets a gateway acknowledge receipt of the token before charging, which distinguishes "never heard from Apple" from "charging now".
3. **Does `disputed` belong in v1?** Chargebacks arrive weeks later through a different channel. It may be cleaner to ship `succeeded`/`failed`/`cancelled`/`refunded` and add dispute states once someone asks.
4. **Retention.** How long does an outcome stay readable, and does it follow the conversation's retention or the message's?

## SDK impact once it lands

Small and additive:

- `client.payments.reportOutcome(requestMessageId, { status, … })` and `client.payments.get(requestMessageId)`
- A `payment.updated` handler in `WebhookReceiver`, alongside the two existing events
- `PaymentStatus` and `PAYMENT_STATUSES` vocabularies, with `isTerminalPaymentStatus()` matching the invitation helpers
- The existing `paymentState()` reader stays as the correlation key; outcome is separate

Roughly the size of the typing-indicator change — a day's work on the SDK side once the route exists.
