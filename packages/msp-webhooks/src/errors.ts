/** Why a delivery was rejected. Every value is a rejection — never process the body. */
export type WebhookVerificationErrorCode =
  | 'missing_headers'
  | 'malformed_timestamp'
  | 'stale_timestamp'
  | 'invalid_signature_header'
  | 'invalid_signature'
  | 'invalid_secret'
  | 'invalid_payload'
  | 'duplicate';

/**
 * Thrown when a delivery fails verification.
 *
 * Treat every one of these as a rejection: respond 400 and do not process the
 * body. The one exception worth special-casing is `duplicate`, which means the
 * event was already handled — acknowledge it with a 2xx.
 */
export class WebhookVerificationError extends Error {
  readonly code: WebhookVerificationErrorCode;

  constructor(code: WebhookVerificationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WebhookVerificationError';
    this.code = code;
  }
}

/** Type guard for {@link WebhookVerificationError}. */
export function isWebhookVerificationError(value: unknown): value is WebhookVerificationError {
  return value instanceof WebhookVerificationError;
}
