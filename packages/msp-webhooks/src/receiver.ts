import type { WebhookEvent } from '@1440io/msp-types';
import { WebhookVerificationError, isWebhookVerificationError } from './errors.js';
import { dispatchEvent, type WebhookEventContext, type WebhookHandlers } from './events.js';
import type { HeadersLike } from './headers.js';
import type { ReplayCache } from './replay.js';
import { WebhookVerifier, type RawBody, type WebhookVerifierOptions } from './verify.js';

export interface WebhookReceiverOptions extends Omit<WebhookVerifierOptions, 'replayCache'> {
  /** Per-event-type handlers. */
  on?: WebhookHandlers;
  /** Handler for every verified event, called before the per-type handler. */
  onEvent?: (event: WebhookEvent, context: WebhookEventContext) => void | Promise<void>;
  /** Called for a verified event no handler covers — a newly added type. */
  onUnhandledEvent?: (event: WebhookEvent, context: WebhookEventContext) => void | Promise<void>;
  /**
   * Called when verification fails or a handler throws. Use it for logging;
   * the HTTP status is decided by the receiver either way.
   */
  onError?: (error: unknown) => void | Promise<void>;
  /** Suppresses retries of an event already handled. */
  replayCache?: ReplayCache;
}

/** What the receiver decided the HTTP response should be. */
export interface WebhookResult {
  /** Status to return: 2xx acknowledges, anything else asks for a retry. */
  status: number;
  /** JSON-serializable body. */
  body: { ok: true } | { ok: false; error: string; code?: string };
  /** The verified event, when verification succeeded. */
  event?: WebhookEvent;
}

/**
 * Framework-agnostic core: verify a delivery, dispatch it, and decide the
 * response. Every adapter in this package is a thin wrapper over it.
 *
 * The status mapping follows the platform's retry rules:
 *
 * - `200` — verified and handled, or a duplicate we have already handled.
 * - `400` — failed verification. Retrying will not help, but the platform
 *   still retries; the request is rejected identically each time.
 * - `500` — a handler threw. The platform retries with backoff, which is the
 *   behavior you want for a transient failure in your own code.
 */
export class WebhookReceiver {
  readonly #verifier: WebhookVerifier;
  readonly #options: WebhookReceiverOptions;

  constructor(options: WebhookReceiverOptions) {
    const { on, onEvent, onUnhandledEvent, onError, replayCache, ...verifierOptions } = options;
    this.#verifier = new WebhookVerifier({
      ...verifierOptions,
      ...(replayCache ? { replayCache } : {}),
    });
    this.#options = options;
  }

  /** Verify a delivery and run the matching handlers. */
  async handle(input: { headers: HeadersLike; body: RawBody }): Promise<WebhookResult> {
    let verified: Awaited<ReturnType<WebhookVerifier['verify']>>;
    try {
      verified = await this.#verifier.verify(input);
    } catch (error) {
      await this.#options.onError?.(error);
      if (isWebhookVerificationError(error) && error.code === 'duplicate') {
        // Already handled — acknowledge so the platform stops retrying.
        return { status: 200, body: { ok: true } };
      }
      const code = isWebhookVerificationError(error) ? error.code : 'invalid_payload';
      return {
        status: 400,
        body: { ok: false, error: describe(error), code },
      };
    }

    const context: WebhookEventContext = { id: verified.id, timestamp: verified.timestamp };
    try {
      await this.#options.onEvent?.(verified.event, context);
      const handled = await dispatchEvent(this.#options.on ?? {}, verified.event, context);
      if (!handled) await this.#options.onUnhandledEvent?.(verified.event, context);
    } catch (error) {
      await this.#options.onError?.(error);
      // Non-2xx so the platform retries — the event is real, our side failed.
      return { status: 500, body: { ok: false, error: describe(error) }, event: verified.event };
    }

    return { status: 200, body: { ok: true }, event: verified.event };
  }
}

function describe(error: unknown): string {
  if (error instanceof WebhookVerificationError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
