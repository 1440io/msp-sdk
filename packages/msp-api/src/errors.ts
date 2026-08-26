import type { ErrorResponse, RichReason } from '@1440io/msp-types';

/** Base class for every error this SDK throws. */
export class MspError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Thrown when the SDK is constructed or called with unusable arguments. */
export class MspConfigError extends MspError {}

/** Thrown when a request exceeds its timeout, or its signal is aborted. */
export class MspTimeoutError extends MspError {
  /** Milliseconds the request was allowed to run. */
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number, options?: { cause?: unknown }) {
    super(message, options);
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when the request never produced an HTTP response (DNS, TLS, socket). */
export class MspConnectionError extends MspError {}

export interface MspApiErrorInit {
  status: number;
  /** Human-readable `error` from the canonical error envelope. */
  message: string;
  /** Stable machine-readable reason code, when the failure has one. */
  code?: string | undefined;
  /** The parsed response body, whatever shape it arrived in. */
  body?: unknown;
  /** Response headers, lower-cased. */
  headers?: Record<string, string>;
  method: string;
  url: string;
  /** Machine-readable rich-messaging reject reasons, on send/template routes. */
  reasons?: RichReason[] | undefined;
}

/**
 * A non-2xx response from the API.
 *
 * Every documented failure uses the canonical `{ error, code? }` envelope, so
 * `message` is the server's `error` string and `code` its `code` when present.
 */
export class MspApiError extends MspError {
  /** HTTP status code. */
  readonly status: number;
  /** Stable machine-readable reason code, when the response carried one. */
  readonly code: string | undefined;
  /** The parsed response body. */
  readonly body: unknown;
  /** Lower-cased response headers. */
  readonly headers: Record<string, string>;
  /** HTTP method of the failed request. */
  readonly method: string;
  /** URL of the failed request, with the query string. */
  readonly url: string;
  /** Rich-messaging reject reasons, present on rich sends and 409 conflicts. */
  readonly reasons: RichReason[] | undefined;

  constructor(init: MspApiErrorInit) {
    super(`${init.method} ${init.url} failed with ${init.status}: ${init.message}`);
    this.status = init.status;
    this.code = init.code;
    this.body = init.body;
    this.headers = init.headers ?? {};
    this.method = init.method;
    this.url = init.url;
    this.reasons = init.reasons;
  }

  /** True when retrying the identical request could plausibly succeed. */
  get retryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }

  /**
   * `Retry-After` in milliseconds, when the server sent one. Handles both the
   * delay-seconds and the HTTP-date forms.
   */
  get retryAfterMs(): number | undefined {
    const raw = this.headers['retry-after'];
    if (!raw) return undefined;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(raw);
    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }
}

/** 401 — the credential is missing, malformed, revoked, expired, or disabled. */
export class MspAuthenticationError extends MspApiError {}

/** 403 — authenticated, but the actor lacks the permission the route requires. */
export class MspPermissionError extends MspApiError {}

/** 404 — the addressed resource does not exist for this business. */
export class MspNotFoundError extends MspApiError {}

/** 409 — an idempotency conflict, or a state conflict on a template or asset. */
export class MspConflictError extends MspApiError {}

/** 400 / 422 — the request was rejected by validation. */
export class MspValidationError extends MspApiError {}

/** 413 — the payload exceeded the route's size ceiling. */
export class MspPayloadTooLargeError extends MspApiError {}

/** 429 — the caller is being rate limited. See {@link MspApiError.retryAfterMs}. */
export class MspRateLimitError extends MspApiError {}

/** 5xx — the platform or a downstream channel failed. */
export class MspServerError extends MspApiError {}

/**
 * Build the most specific error class for a status code.
 *
 * @internal
 */
export function createApiError(init: MspApiErrorInit): MspApiError {
  switch (init.status) {
    case 400:
    case 422:
      return new MspValidationError(init);
    case 401:
      return new MspAuthenticationError(init);
    case 403:
      return new MspPermissionError(init);
    case 404:
    case 410:
      return init.status === 404 ? new MspNotFoundError(init) : new MspApiError(init);
    case 409:
      return new MspConflictError(init);
    case 413:
      return new MspPayloadTooLargeError(init);
    case 429:
      return new MspRateLimitError(init);
    default:
      return init.status >= 500 ? new MspServerError(init) : new MspApiError(init);
  }
}

/** Type guard for {@link MspApiError}. */
export function isMspApiError(value: unknown): value is MspApiError {
  return value instanceof MspApiError;
}

/**
 * Pull `error`, `code`, and `reasons` out of a parsed response body.
 *
 * Every documented error uses the canonical envelope, but a proxy or gateway in
 * front of the API can return something else entirely — hence the fallbacks.
 *
 * @internal
 */
export function parseErrorBody(
  body: unknown,
  status: number,
): { message: string; code?: string; reasons?: RichReason[] } {
  if (typeof body === 'string' && body.trim() !== '') {
    return { message: body.slice(0, 500) };
  }
  if (body && typeof body === 'object') {
    const envelope = body as Partial<ErrorResponse> & { reasons?: RichReason[] };
    const result: { message: string; code?: string; reasons?: RichReason[] } = {
      message: typeof envelope.error === 'string' ? envelope.error : `HTTP ${status}`,
    };
    if (typeof envelope.code === 'string') result.code = envelope.code;
    if (Array.isArray(envelope.reasons)) result.reasons = envelope.reasons;
    return result;
  }
  return { message: `HTTP ${status}` };
}
