import type { IntegrationTokenResponse } from '@1440io/msp-types';
import { MspConfigError } from './errors.js';

/** A bearer token together with the instant it stops being accepted. */
export interface AccessToken {
  token: string;
  /** ISO-8601 expiry, or `undefined` for a token whose lifetime is unknown. */
  expiresAt?: string | undefined;
}

/** Supplies the bearer token sent on every `jwt` route. */
export interface TokenProvider {
  /** Return a usable token, minting or refreshing one if needed. */
  getToken(options?: { signal?: AbortSignal }): Promise<string>;
  /**
   * Discard the cached token after the server rejected it with a 401, so the
   * next {@link TokenProvider.getToken} mints a fresh one.
   */
  invalidate(): void;
}

/** A token provider that always returns the same caller-supplied token. */
export class StaticTokenProvider implements TokenProvider {
  #token: string;

  constructor(token: string) {
    if (!token) throw new MspConfigError('A token is required');
    this.#token = token;
  }

  async getToken(): Promise<string> {
    return this.#token;
  }

  /** No-op — a static token has nothing to refresh. */
  invalidate(): void {}
}

/**
 * A token provider backed by a caller-supplied function.
 *
 * The function is called whenever the cached value is missing or has been
 * invalidated; return an {@link AccessToken} to have the SDK cache it until
 * `expiresAt`, or a bare string to have it fetched on every request.
 */
export class CallbackTokenProvider implements TokenProvider {
  readonly #fetchToken: (options: { signal?: AbortSignal }) => Promise<string | AccessToken>;
  readonly #skewMs: number;
  #cached: AccessToken | undefined;
  #inFlight: Promise<string> | undefined;

  constructor(
    fetchToken: (options: { signal?: AbortSignal }) => Promise<string | AccessToken>,
    options: { refreshSkewMs?: number } = {},
  ) {
    this.#fetchToken = fetchToken;
    this.#skewMs = options.refreshSkewMs ?? 60_000;
  }

  async getToken(options: { signal?: AbortSignal } = {}): Promise<string> {
    if (this.#cached && !isExpiring(this.#cached, this.#skewMs)) return this.#cached.token;
    // Collapse concurrent refreshes onto one in-flight call.
    this.#inFlight ??= (async () => {
      try {
        const result = await this.#fetchToken({ signal: options.signal });
        const token = typeof result === 'string' ? { token: result } : result;
        // A bare string carries no expiry, so it is never cached.
        this.#cached = typeof result === 'string' ? undefined : token;
        return token.token;
      } finally {
        this.#inFlight = undefined;
      }
    })();
    return this.#inFlight;
  }

  invalidate(): void {
    this.#cached = undefined;
  }
}

/** How an {@link ApiKeyTokenProvider} reaches the token endpoint. */
export interface TokenExchange {
  (apiKey: string, options: { signal?: AbortSignal }): Promise<IntegrationTokenResponse>;
}

/**
 * Exchanges a long-lived integration API key (`msp_…`) for the short-lived
 * business access JWT the API expects, caching it until shortly before expiry.
 *
 * Concurrent callers share a single in-flight exchange, so a burst of requests
 * on a cold client mints one token rather than one per request.
 */
export class ApiKeyTokenProvider implements TokenProvider {
  readonly #apiKey: string;
  readonly #exchange: TokenExchange;
  readonly #skewMs: number;
  #cached: AccessToken | undefined;
  #inFlight: Promise<string> | undefined;

  constructor(apiKey: string, exchange: TokenExchange, options: { refreshSkewMs?: number } = {}) {
    if (!apiKey) throw new MspConfigError('An integration API key is required');
    this.#apiKey = apiKey;
    this.#exchange = exchange;
    this.#skewMs = options.refreshSkewMs ?? 60_000;
  }

  /** The currently cached token, if one is held. Exposed for diagnostics. */
  get cachedToken(): AccessToken | undefined {
    return this.#cached;
  }

  async getToken(options: { signal?: AbortSignal } = {}): Promise<string> {
    if (this.#cached && !isExpiring(this.#cached, this.#skewMs)) return this.#cached.token;
    this.#inFlight ??= (async () => {
      try {
        const response = await this.#exchange(this.#apiKey, { signal: options.signal });
        this.#cached = { token: response.token, expiresAt: response.expiresAt };
        return response.token;
      } finally {
        this.#inFlight = undefined;
      }
    })();
    return this.#inFlight;
  }

  invalidate(): void {
    this.#cached = undefined;
  }
}

/** True when the token is missing an expiry or falls inside the refresh skew. */
function isExpiring(token: AccessToken, skewMs: number): boolean {
  if (!token.expiresAt) return false;
  const expiresAt = Date.parse(token.expiresAt);
  if (Number.isNaN(expiresAt)) return false;
  return expiresAt - skewMs <= Date.now();
}
