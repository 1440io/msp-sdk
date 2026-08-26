import type {
  WebhookContentInteractiveFormPageValue,
  WebhookContentInteractiveResponse,
  WebhookInteractiveMessage,
  WebhookMessageSummary,
  WebhookOptOutMessage,
  WebhookTapbackMessage,
  WebhookTextMessage,
} from '@1440io/msp-types';

/**
 * Narrowing helpers for inbound messages.
 *
 * The spec discriminates a message's `content` by its sibling `messageType`,
 * which TypeScript will not narrow on its own — `message.content.responseType`
 * is an error even inside `if (message.messageType === 'interactive')`. These
 * guards do the narrowing so handling a rich reply needs no casts.
 */

/** Narrow to a plain-text message, exposing `content.body`. */
export function isTextMessage(message: WebhookMessageSummary): message is WebhookTextMessage {
  return message.messageType === 'text';
}

/**
 * Narrow to a customer's reply to a rich message, exposing `content.selections`,
 * `content.formValues`, `content.selectedStartTime`, and `content.requestIdentifier`.
 */
export function isInteractiveMessage(
  message: WebhookMessageSummary,
): message is WebhookInteractiveMessage {
  return message.messageType === 'interactive';
}

/** Narrow to a tapback, exposing `content.kind` and `content.targetMessageId`. */
export function isTapbackMessage(message: WebhookMessageSummary): message is WebhookTapbackMessage {
  return message.messageType === 'tapback';
}

/** Narrow to an opt-out, exposing `content.reason`. */
export function isOptOutMessage(message: WebhookMessageSummary): message is WebhookOptOutMessage {
  return message.messageType === 'opt_out';
}

/**
 * The ids the customer chose, in order.
 *
 * Covers quick replies (one item), list pickers (one or more), and time
 * pickers (the chosen slot). Empty for a form submission.
 */
export function selectedIds(response: WebhookContentInteractiveResponse): string[] {
  return response.selections.map((selection) => selection.id);
}

/** The titles the customer saw for what they chose, where the channel echoed them. */
export function selectedTitles(response: WebhookContentInteractiveResponse): string[] {
  return response.selections
    .map((selection) => selection.title)
    .filter((title): title is string => title !== null);
}

/** Form submissions keyed by page id, for the common single-value-per-page case. */
export function formValuesByPage(
  response: WebhookContentInteractiveResponse,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const page of response.formValues as WebhookContentInteractiveFormPageValue[]) {
    out[page.pageId] = page.values;
  }
  return out;
}

/**
 * Parse an Apple time-picker timestamp into a `Date`.
 *
 * The spec types `selectedStartTime` as an RFC 3339 `date-time`, but the value
 * that actually arrives is Apple's basic format — `2026-08-25T23:55+0000`,
 * with no seconds and no colon in the offset. V8's `Date` happens to accept
 * it, so plain JavaScript gets away with `new Date(value)`; strict parsers
 * (`Temporal.Instant.from`, `date-fns/parseISO`, Go's `time.RFC3339`, Java's
 * `Instant.parse`, Python's `fromisoformat`) reject it outright.
 *
 * Use this rather than trusting the declared format, especially before handing
 * the value to another system.
 *
 * @returns the instant, or null when there is nothing parseable to return.
 */
export function parseAppleTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;

  // Normalize the basic form to RFC 3339: add seconds when absent, and put the
  // colon into a four-digit offset.
  const normalized = value
    .replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?=$|[+\-Z])/, '$1:00')
    .replace(/([+\-])(\d{2})(\d{2})$/, '$1$2:$3');

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The instant a customer chose from a time picker, or null for other replies. */
export function selectedStartTime(response: WebhookContentInteractiveResponse): Date | null {
  return parseAppleTimestamp(response.selectedStartTime);
}

/**
 * Correlate a reply with the rich message that prompted it.
 *
 * The platform echoes the originating send's request identifier, so a bot
 * holding several prompts open at once can tell which one was answered. Null
 * when the channel did not recognize the originating message — custom iMessage
 * apps carry no correlation promise at all.
 */
export function respondsTo(message: WebhookMessageSummary): string | null {
  if (isInteractiveMessage(message)) {
    return message.content.requestIdentifier ?? message.richRequestIdentifier ?? null;
  }
  return message.richRequestIdentifier ?? null;
}
