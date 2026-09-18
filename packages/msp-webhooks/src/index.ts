/**
 * `@1440io/msp-webhooks` — verify and route 1440 MSP API webhook deliveries.
 *
 * ```ts
 * import { WebhookReceiver } from '@1440io/msp-webhooks';
 *
 * const receiver = new WebhookReceiver({
 *   secret: process.env.MSP_WEBHOOK_SECRET!,
 *   on: {
 *     'message.received': async (event) => {
 *       console.log(event.conversationId, event.data.message.messageType);
 *     },
 *   },
 * });
 * ```
 *
 * Verification runs on Web Crypto, so the same code works on Node 20+,
 * Cloudflare Workers, Vercel Edge, Deno, and Bun. Framework adapters live at
 * `@1440io/msp-webhooks/express`, `/fastify`, `/fetch`, and `/lambda`.
 */
export {
  WebhookVerificationError,
  isWebhookVerificationError,
  type WebhookVerificationErrorCode,
} from './errors.js';

export {
  WebhookVerifier,
  verifyWebhook,
  type RawBody,
  type VerifyInput,
  type VerifyResult,
  type WebhookVerifierOptions,
} from './verify.js';

export {
  WebhookReceiver,
  type WebhookReceiverOptions,
  type WebhookResult,
} from './receiver.js';

export {
  dispatchEvent,
  isMessageReceived,
  isMessagingInvitationUpdated,
  type WebhookEventContext,
  type WebhookEventHandler,
  type WebhookHandlers,
} from './events.js';

export {
  authenticationStatus,
  contentOf,
  formAnswers,
  isInteractiveResponse,
  isKind,
  isPrivateForm,
  isRedacted,
  isVisible,
  messageOf,
  parseAppleTimestamp,
  respondsTo,
  selectedIds,
  selectedTimeslot,
  selectedTitles,
  sessionOf,
  textBody,
} from './messages.js';

export { MemoryReplayCache, type ReplayCache } from './replay.js';
export { extractWebhookHeaders, getHeader, type HeadersLike, type WebhookHeaders } from './headers.js';

export type {
  AuthenticationStatus,
  InboundAttachment,
  InboundContent,
  InboundContentKind,
  InboundContentOfKind,
  InboundMessage,
  InboundMessageRedacted,
  InboundMessageVisible,
  WebhookEvent,
  WebhookEventMap,
  WebhookEventType,
  WebhookMessageReceivedEvent,
  WebhookMessagingInvitationUpdatedEvent,
} from '@1440io/msp-types';
