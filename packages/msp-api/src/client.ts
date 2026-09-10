import type { AccessToken, TokenProvider } from './auth.js';
import { ApiKeyTokenProvider, CallbackTokenProvider, StaticTokenProvider } from './auth.js';
import { MspConfigError } from './errors.js';
import { HttpClient, type FetchLike, type RequestHook, type ResponseHook, type RetryOptions } from './http.js';
import { AdminResource } from './resources/admin.js';
import { AuthResource } from './resources/auth.js';
import { ChannelsResource } from './resources/channels.js';
import { ConversationsResource } from './resources/conversations.js';
import { InvitationsResource } from './resources/invitations.js';
import { MediaResource } from './resources/media.js';
import { MessagingResource } from './resources/messaging.js';
import { TemplatesResource } from './resources/templates.js';

/** The 1440 production host. */
export const DEFAULT_BASE_URL = 'https://1440.cloud';

export interface MspClientOptions {
  /**
   * A long-lived integration API key (`msp_…`). The client exchanges it for a
   * short-lived access JWT and refreshes that token on your behalf.
   *
   * Server-side only — an API key must never reach a browser.
   */
  apiKey?: string;
  /**
   * A pre-minted access JWT, for callers managing token lifetime themselves.
   * Mutually exclusive with `apiKey`.
   */
  token?: string | AccessToken;
  /**
   * A function returning an access JWT, called whenever the cached one is
   * missing or near expiry. Return an {@link AccessToken} to have the result
   * cached until `expiresAt`. Mutually exclusive with `apiKey` and `token`.
   */
  getToken?: (options: { signal?: AbortSignal }) => Promise<string | AccessToken>;
  /** API host. Defaults to {@link DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Per-request timeout in ms. Default 30000 (uploads default to 120000). */
  timeoutMs?: number;
  /** Retry policy for GETs and idempotent writes. */
  retry?: RetryOptions;
  /** Refresh the token this many ms before it expires. Default 60000. */
  refreshSkewMs?: number;
  /** Headers merged into every request. Per-call headers win. */
  headers?: Record<string, string>;
  /** Value sent as `user-agent`. */
  userAgent?: string;
  /** Custom fetch implementation — useful for proxies, mocks, and tests. */
  fetch?: FetchLike;
  /** Called before each attempt, including retries. */
  onRequest?: RequestHook;
  /** Called after each response, including ones that will be retried. */
  onResponse?: ResponseHook;
}

/**
 * Client for the 1440 Apple Messages for Business MSP API.
 *
 * ```ts
 * const client = new MspClient({ apiKey: process.env.MSP_API_KEY! });
 *
 * for await (const conversation of client.conversations.list({ status: 'active' })) {
 *   await client.messaging.sendText({
 *     conversationId: conversation.id,
 *     body: 'Thanks for reaching out — an agent is on the way.',
 *   });
 * }
 * ```
 */
export class MspClient {
  /** Authentication routes (token exchange). */
  readonly auth: AuthResource;
  /** Conversations and their message windows. */
  readonly conversations: ConversationsResource;
  /** Outbound messaging. */
  readonly messaging: MessagingResource;
  /** Messaging invitations — reaching a customer first. */
  readonly invitations: InvitationsResource;
  /** Published rich templates. */
  readonly templates: TemplatesResource;
  /** Media attachments. */
  readonly media: MediaResource;
  /** Active channels. */
  readonly channels: ChannelsResource;
  /** Business-admin routes. */
  readonly admin: AdminResource;

  readonly #http: HttpClient;
  readonly #tokenProvider: TokenProvider;

  constructor(options: MspClientOptions = {}) {
    const credentials = [options.apiKey, options.token, options.getToken].filter(Boolean);
    if (credentials.length === 0) {
      throw new MspConfigError(
        'Provide one of `apiKey`, `token`, or `getToken` to authenticate the client',
      );
    }
    if (credentials.length > 1) {
      throw new MspConfigError(
        'Provide exactly one of `apiKey`, `token`, or `getToken` — they are mutually exclusive',
      );
    }

    this.#http = new HttpClient({
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      fetch: options.fetch,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.retry ? { retry: options.retry } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.userAgent ? { userAgent: options.userAgent } : {}),
      onRequest: options.onRequest,
      onResponse: options.onResponse,
    });

    this.auth = new AuthResource(this.#http);

    const skew = options.refreshSkewMs ?? 60_000;
    if (options.apiKey) {
      this.#tokenProvider = new ApiKeyTokenProvider(
        options.apiKey,
        (apiKey, requestOptions) => this.auth.exchangeIntegrationToken(apiKey, requestOptions),
        { refreshSkewMs: skew },
      );
    } else if (options.getToken) {
      this.#tokenProvider = new CallbackTokenProvider(options.getToken, { refreshSkewMs: skew });
    } else if (typeof options.token === 'string') {
      this.#tokenProvider = new StaticTokenProvider(options.token);
    } else {
      const supplied = options.token as AccessToken;
      this.#tokenProvider = new CallbackTokenProvider(async () => supplied, {
        refreshSkewMs: skew,
      });
    }
    this.#http.setTokenProvider(this.#tokenProvider);

    this.conversations = new ConversationsResource(this.#http);
    this.messaging = new MessagingResource(this.#http);
    this.invitations = new InvitationsResource(this.#http);
    this.templates = new TemplatesResource(this.#http);
    this.media = new MediaResource(this.#http);
    this.channels = new ChannelsResource(this.#http);
    this.admin = new AdminResource(this.#http);
  }

  /**
   * Build a client from the environment: `MSP_API_KEY` (or `MSP_TOKEN`) and an
   * optional `MSP_BASE_URL`. Explicit options win over the environment.
   */
  static fromEnv(options: Omit<MspClientOptions, 'apiKey' | 'token'> = {}): MspClient {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env;
    const apiKey = env?.['MSP_API_KEY'];
    const token = env?.['MSP_TOKEN'];
    const baseUrl = options.baseUrl ?? env?.['MSP_BASE_URL'];

    if (!apiKey && !token) {
      throw new MspConfigError('Set MSP_API_KEY (or MSP_TOKEN) to build a client from the environment');
    }
    return new MspClient({
      ...options,
      ...(baseUrl ? { baseUrl } : {}),
      ...(apiKey ? { apiKey } : { token: token! }),
    });
  }

  /** The host every request is sent to. */
  get baseUrl(): string {
    return this.#http.baseUrl;
  }

  /**
   * Force the next request to mint a fresh token. Rarely needed — the client
   * already refreshes before expiry and retries once on a 401.
   */
  invalidateToken(): void {
    this.#tokenProvider.invalidate();
  }

  /** Get a currently valid access token, minting one if needed. */
  async getAccessToken(options: { signal?: AbortSignal } = {}): Promise<string> {
    return this.#tokenProvider.getToken(options);
  }
}
