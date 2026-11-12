import type {
  WebhookEvent,
  WebhookMessageReceivedEvent,
  WebhookMessagingInvitationUpdatedEvent,
} from '@1440io/msp-types';

/** Narrow an event to `message.received`. */
export function isMessageReceived(event: WebhookEvent): event is WebhookMessageReceivedEvent {
  return event.type === 'message.received';
}

/** Narrow an event to `messaging_invitation.updated`. */
export function isMessagingInvitationUpdated(
  event: WebhookEvent,
): event is WebhookMessagingInvitationUpdatedEvent {
  return event.type === 'messaging_invitation.updated';
}

/** Context handed to every event handler. */
export interface WebhookEventContext {
  /** Event id, equal to the `Webhook-Id` header and the envelope `eventId`. */
  id: string;
  /** Signing timestamp, as epoch seconds. */
  timestamp: number;
}

/** Handler for one event type. */
export type WebhookEventHandler<TEvent extends WebhookEvent> = (
  event: TEvent,
  context: WebhookEventContext,
) => void | Promise<void>;

/** Per-type handler map. Every entry is optional. */
export interface WebhookHandlers {
  'message.received'?: WebhookEventHandler<WebhookMessageReceivedEvent>;
  'messaging_invitation.updated'?: WebhookEventHandler<WebhookMessagingInvitationUpdatedEvent>;
}

/**
 * Dispatch a verified event to its handler.
 *
 * Returns false when no handler was registered for the event's type, which
 * includes event types added to the platform after this SDK was built.
 *
 * @internal
 */
export async function dispatchEvent(
  handlers: WebhookHandlers,
  event: WebhookEvent,
  context: WebhookEventContext,
): Promise<boolean> {
  if (isMessageReceived(event)) {
    const handler = handlers['message.received'];
    if (!handler) return false;
    await handler(event, context);
    return true;
  }
  if (isMessagingInvitationUpdated(event)) {
    const handler = handlers['messaging_invitation.updated'];
    if (!handler) return false;
    await handler(event, context);
    return true;
  }
  return false;
}
