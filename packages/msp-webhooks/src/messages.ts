import type {
  AuthenticationStatus,
  InboundContent,
  InboundContentOfKind,
  InboundMessage,
  WebhookMessageReceivedEvent,
} from '@1440io/msp-types';

/**
 * Readers for inbound message content.
 *
 * `content` is a tagged union discriminated by `kind`, so TypeScript narrows
 * `content.kind === 'text'` on its own — no guard needed for that. What these
 * helpers add is normalization: the interactive payloads arrive in Apple's
 * native shape, with hyphenated keys (`data['quick-reply']`), per-kind
 * nesting, and timestamps that are not RFC 3339. Reading them by hand is
 * where the bugs live.
 */

/** The content of an inbound message, or undefined for a redacted one. */
export function contentOf(message: InboundMessage): InboundContent {
  return message.content;
}

/** True when the message body was withheld (a private form response). */
export function isRedacted(message: InboundMessage): boolean {
  return message.redacted === true || message.content == null;
}

/** Narrow content to one `kind`. */
export function isKind<K extends NonNullable<InboundContent>['kind']>(
  content: InboundContent,
  kind: K,
): content is InboundContentOfKind<K> {
  return content?.kind === kind;
}

/** True when the content is a customer answering a rich message. */
export function isInteractiveResponse(content: InboundContent): boolean {
  return typeof content?.kind === 'string' && content.kind.startsWith('amb.');
}

/** The plain-text body, or null when this is not a text message. */
export function textBody(content: InboundContent): string | null {
  return isKind(content, 'text') ? content.body : null;
}

/**
 * The ids the customer chose, in order.
 *
 * Covers quick replies (one item), list pickers (one or more across sections),
 * and time pickers (the chosen slot). Empty for anything else.
 */
export function selectedIds(content: InboundContent): string[] {
  if (isKind(content, 'amb.quick_reply_response')) {
    const picked = content.data?.['quick-reply']?.selectedIdentifier;
    return picked ? [picked] : [];
  }
  if (isKind(content, 'amb.list_picker_response')) {
    return (content.data?.listPicker?.sections ?? []).flatMap((section) =>
      (section.items ?? []).map((item) => item.identifier),
    );
  }
  if (isKind(content, 'amb.time_picker_response')) {
    return (content.data?.event?.timeslots ?? []).map((slot) => slot.identifier);
  }
  return [];
}

/** The titles the customer saw for what they chose, where the channel echoed them. */
export function selectedTitles(content: InboundContent): string[] {
  if (isKind(content, 'amb.quick_reply_response')) {
    const qr = content.data?.['quick-reply'];
    const picked = qr?.selectedIdentifier;
    const match = (qr?.items ?? []).find((item) => item.identifier === picked);
    return match ? [match.title] : [];
  }
  if (isKind(content, 'amb.list_picker_response')) {
    return (content.data?.listPicker?.sections ?? []).flatMap((section) =>
      (section.items ?? [])
        .map((item) => item.title)
        .filter((title): title is string => typeof title === 'string'),
    );
  }
  return [];
}

/**
 * Form answers keyed by page identifier.
 *
 * A page can carry several inputs, so each entry is a list of `{id, title,
 * value}` rather than a bare string.
 */
export function formAnswers(
  content: InboundContent,
): Record<string, { id: string; title?: string; value?: string; type?: string }[]> {
  if (!isKind(content, 'amb.form_response')) return {};
  const out: Record<string, { id: string; title?: string; value?: string; type?: string }[]> = {};
  for (const page of content.data?.dynamic?.selections ?? []) {
    const key = page.pageIdentifier ?? '';
    out[key] = (page.items ?? []).map((item) => ({
      id: item.identifier,
      ...(item.title !== undefined ? { title: item.title } : {}),
      ...(item.value !== undefined ? { value: item.value } : {}),
      ...(item.type !== undefined ? { type: item.type } : {}),
    }));
  }
  return out;
}

/** True when a form response was marked private, so its values are restricted. */
export function isPrivateForm(content: InboundContent): boolean {
  return isKind(content, 'amb.form_response') && content.data?.dynamic?.private === true;
}

/** The outcome of an authentication (OAuth) request, or null for other content. */
export function authenticationStatus(content: InboundContent): AuthenticationStatus | null {
  if (!isKind(content, 'amb.authentication_response')) return null;
  return (content.data?.authenticate?.status ?? null) as AuthenticationStatus | null;
}

/**
 * Parse an Apple time-picker timestamp into a `Date`.
 *
 * The spec pins these to `YYYY-MM-DDTHH:mm+0000` — no seconds, no colon in the
 * offset — which is not RFC 3339. JavaScript's `Date` happens to accept it, so
 * the mismatch stays hidden until the value reaches a stricter parser
 * (`Temporal.Instant.from`, `date-fns/parseISO`, Go, Java, Python).
 *
 * @returns the instant, or null when there is nothing parseable to return.
 */
export function parseAppleTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value
    .replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?=$|[+\-Z])/, '$1:00')
    .replace(/([+\-])(\d{2})(\d{2})$/, '$1$2:$3');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The slot a customer chose from a time picker, as an instant and a duration. */
export function selectedTimeslot(
  content: InboundContent,
): { id: string; startsAt: Date; durationSeconds: number } | null {
  if (!isKind(content, 'amb.time_picker_response')) return null;
  const slot = content.data?.event?.timeslots?.[0];
  if (!slot) return null;
  const startsAt = parseAppleTimestamp(slot.startTime);
  if (!startsAt) return null;
  return { id: slot.identifier, startsAt, durationSeconds: slot.duration };
}

/**
 * Correlate a reply with the rich message that prompted it.
 *
 * The platform echoes the originating send's request identifier, so a bot
 * holding several prompts open at once can tell which was answered. Null when
 * the channel made no correlation promise — custom iMessage apps carry none.
 */
export function respondsTo(content: InboundContent): string | null {
  if (content == null) return null;
  const data = (content as { data?: { requestIdentifier?: string } }).data;
  if (typeof data?.requestIdentifier === 'string') return data.requestIdentifier;
  const direct = (content as { requestIdentifier?: string }).requestIdentifier;
  return typeof direct === 'string' ? direct : null;
}

/** The channel session an interactive reply belongs to, when it has one. */
export function sessionOf(content: InboundContent): string | null {
  if (content == null) return null;
  const session = (content as { sessionIdentifier?: string | null }).sessionIdentifier;
  return typeof session === 'string' ? session : null;
}

/** Convenience: read the message off a `message.received` event. */
export function messageOf(event: WebhookMessageReceivedEvent): InboundMessage {
  return event.message;
}
