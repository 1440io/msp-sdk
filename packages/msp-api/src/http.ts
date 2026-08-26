import type { TokenProvider } from './auth.js';
import {
  MspConnectionError,
  MspTimeoutError,
  createApiError,
  isMspApiError,
  parseErrorBody,
} from './errors.js';

/** The subset of `fetch` this SDK relies on. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Query values the SDK knows how to serialize. */
export type QueryValue = string | number | boolean | undefined | null | (string | number)[];

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, QueryValue> | undefined;
  /** JSON body. Mutually exclusive with `rawBody`. */
  body?: unknown;
  /** Pre-encoded body (binary upload, multipart). Sent as-is. */
  rawBody?: BodyInit | undefined;
  headers?: Record<string, string | undefined> | undefined;
  /** Send the bearer token. Defaults to true; the token route opts out. */
  auth?: boolean;
  /**
   * Whether retrying an identical request is safe. GETs are always retried;
   * a POST is retried only when the route carries an idempotency key.
   */
  idempotent?: boolean;
  /** Overrides the client-level timeout for this one request. */
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
}

/** Called before each attempt, including retries. */
export type RequestHook = (info: {
  method: string;
  url: string;
  headers: Record<string, string>;
  attempt: number;
}) => void | Promise<void>;

/** Called after each response, including ones that will be retried. */
export type ResponseHook = (info: {
  method: string;
  url: string;
  status: number;
  attempt: number;
  durationMs: number;
}) => void | Promise<void>;

export interface RetryOptions {
  /** Retry attempts after the initial one. Default 2. Set 0 to disable. */
  maxRetries?: number;
  /** Base backoff in ms; doubles per attempt. Default 500. */
  initialDelayMs?: number;
  /** Ceiling for a single backoff delay. Default 8000. */
  maxDelayMs?: number;
}

export interface HttpClientOptions {
  baseUrl: string;
  tokenProvider?: TokenProvider | undefined;
  fetch?: FetchLike | undefined;
  timeoutMs?: number;
  retry?: RetryOptions;
  /** Headers merged into every request. Per-request headers win. */
  headers?: Record<string, string>;
  userAgent?: string;
  onRequest?: RequestHook | undefined;
  onResponse?: ResponseHook | undefined;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The transport every resource goes through: URL building, auth headers,
 * timeouts, retries with jittered backoff, and error normalization.
 *
 * @internal
 */
export class HttpClient {
  readonly baseUrl: string;
  #tokenProvider: TokenProvider | undefined;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #initialDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #headers: Record<string, string>;
  readonly #userAgent: string;
  readonly #onRequest: RequestHook | undefined;
  readonly #onResponse: ResponseHook | undefined;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#tokenProvider = options.tokenProvider;
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxRetries = options.retry?.maxRetries ?? 2;
    this.#initialDelayMs = options.retry?.initialDelayMs ?? 500;
    this.#maxDelayMs = options.retry?.maxDelayMs ?? 8_000;
    this.#headers = options.headers ?? {};
    this.#userAgent = options.userAgent ?? '@1440io/msp-api';
    this.#onRequest = options.onRequest;
    this.#onResponse = options.onResponse;
  }

  /** Swap the token provider after construction (used by `client.auth`). */
  setTokenProvider(provider: TokenProvider | undefined): void {
    this.#tokenProvider = provider;
  }

  /** Perform a request and decode its JSON body. */
  async request<T>(options: RequestOptions): Promise<T> {
    const url = this.buildUrl(options.path, options.query);
    const method = options.method;
    const useAuth = options.auth !== false;
    const retryable = options.idempotent ?? method === 'GET';
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;

    let attempt = 0;
    let refreshedToken = false;

    for (;;) {
      attempt += 1;
      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': this.#userAgent,
        ...lowerCaseKeys(this.#headers),
        ...lowerCaseKeys(options.headers ?? {}),
      };

      let body: BodyInit | undefined;
      if (options.rawBody !== undefined) {
        body = options.rawBody;
      } else if (options.body !== undefined) {
        body = JSON.stringify(options.body);
        headers['content-type'] ??= 'application/json';
      }

      if (useAuth && this.#tokenProvider) {
        headers['authorization'] = `Bearer ${await this.#tokenProvider.getToken({
          ...(options.signal ? { signal: options.signal } : {}),
        })}`;
      }

      await this.#onRequest?.({ method, url, headers, attempt });

      const startedAt = Date.now();
      const { signal, dispose } = withTimeout(timeoutMs, options.signal);
      let response: Response;
      try {
        response = await this.#fetch(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
          signal,
          // Node streams a Readable/ReadableStream body only with duplex set.
          ...(isStream(body) ? { duplex: 'half' } : {}),
        } as RequestInit);
      } catch (cause) {
        dispose();
        const aborted = options.signal?.aborted === true;
        const error = aborted
          ? new MspTimeoutError(`${method} ${url} was aborted by the caller`, timeoutMs, { cause })
          : isAbortError(cause)
            ? new MspTimeoutError(`${method} ${url} timed out after ${timeoutMs}ms`, timeoutMs, {
                cause,
              })
            : new MspConnectionError(`${method} ${url} failed before a response: ${describe(cause)}`, {
                cause,
              });
        // A caller-triggered abort is final; a timeout or socket error may not be.
        if (aborted || !retryable || attempt > this.#maxRetries) throw error;
        await sleep(this.backoffMs(attempt));
        continue;
      }
      dispose();

      await this.#onResponse?.({
        method,
        url,
        status: response.status,
        attempt,
        durationMs: Date.now() - startedAt,
      });

      if (response.ok) return (await decodeBody(response)) as T;

      const payload = await decodeBody(response);
      const parsed = parseErrorBody(payload, response.status);
      const error = createApiError({
        status: response.status,
        message: parsed.message,
        code: parsed.code,
        reasons: parsed.reasons,
        body: payload,
        headers: headersToObject(response.headers),
        method,
        url,
      });

      // A 401 on a token we minted usually means it expired early — refresh once.
      if (response.status === 401 && useAuth && this.#tokenProvider && !refreshedToken) {
        refreshedToken = true;
        this.#tokenProvider.invalidate();
        continue;
      }

      if (retryable && isMspApiError(error) && error.retryable && attempt <= this.#maxRetries) {
        await sleep(error.retryAfterMs ?? this.backoffMs(attempt));
        continue;
      }

      throw error;
    }
  }

  /** Resolve a path and query into an absolute URL. */
  buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(path, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /** Exponential backoff with full jitter, capped at `maxDelayMs`. */
  private backoffMs(attempt: number): number {
    const ceiling = Math.min(this.#initialDelayMs * 2 ** (attempt - 1), this.#maxDelayMs);
    return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
  }
}

function lowerCaseKeys(headers: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) out[key.toLowerCase()] = value;
  }
  return out;
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function decodeBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (text === '') return undefined;
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/** Combine a timeout with the caller's signal, without leaking the timer. */
function withTimeout(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) onAbort();
    else callerSignal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onAbort);
    },
  };
}

function isAbortError(value: unknown): boolean {
  return (
    value instanceof Error && (value.name === 'AbortError' || value.name === 'TimeoutError')
  );
}

function isStream(body: BodyInit | undefined): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    !(body instanceof Uint8Array) &&
    !(body instanceof ArrayBuffer) &&
    !(typeof FormData !== 'undefined' && body instanceof FormData) &&
    !(typeof Blob !== 'undefined' && body instanceof Blob) &&
    !(typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) &&
    (Symbol.asyncIterator in (body as object) || 'getReader' in (body as object))
  );
}

function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
