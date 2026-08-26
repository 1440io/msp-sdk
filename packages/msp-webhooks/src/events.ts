import type {
  WebhookEvent,
  WebhookInitiationUpdatedEvent,
  WebhookMessageReceivedEvent,
} from '@1440io/msp-types';

/** Narrow an event to `message.received`. */
export function isMessageReceived(event: WebhookEvent): event is WebhookMessageReceivedEvent {
  return event.type === 'message.received';
}

/** Narrow an event to `initiation.updated`. */
export function isInitiationUpdated(event: WebhookEvent): event is WebhookInitiationUpdatedEvent {
  return event.type === 'initiation.updated';
}

/** Context handed to every event handler. */
export interface WebhookEventContext {
  /** Event id, equal to the `Webhook-Id` header. Retries reuse it. */
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
  'initiation.updated'?: WebhookEventHandler<WebhookInitiationUpdatedEvent>;
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
  if (isInitiationUpdated(event)) {
    const handler = handlers['initiation.updated'];
    if (!handler) return false;
    await handler(event, context);
    return true;
  }
  return false;
}
