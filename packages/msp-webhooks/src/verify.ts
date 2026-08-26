import type { WebhookEvent } from '@1440io/msp-types';
import { WebhookVerificationError } from './errors.js';
import { extractWebhookHeaders, type HeadersLike } from './headers.js';
import type { ReplayCache } from './replay.js';

/** The exact bytes of the request body, or the exact string they decode to. */
export type RawBody = string | Uint8Array | ArrayBuffer;

export interface WebhookVerifierOptions {
  /**
   * The signing secret shown once when the integration was created, in
   * `whsec_<base64>` form. Pass several to accept both sides of a rotation.
   */
  secret: string | string[];
  /**
   * How far the `Webhook-Timestamp` may sit from now, in seconds. Default 300,
   * matching the platform's stated tolerance.
   */
  toleranceSeconds?: number;
  /**
   * Records handled event ids so a retry is not processed twice. Supply one
   * backed by shared storage if you run more than one instance.
   */
  replayCache?: ReplayCache;
  /** Clock injection point, for tests. Returns epoch milliseconds. */
  now?: () => number;
}

export interface VerifyInput {
  /** The request headers, in any shape. */
  headers: HeadersLike;
  /**
   * The raw request body — the exact bytes the platform signed. Do not parse
   * and re-serialize it first: key order and whitespace both break the HMAC.
   */
  body: RawBody;
}

export interface VerifyResult<TEvent extends WebhookEvent = WebhookEvent> {
  /** The parsed, verified event. */
  event: TEvent;
  /** The event id, equal to the `Webhook-Id` header. */
  id: string;
  /** The signing timestamp, as epoch seconds. */
  timestamp: number;
}

/**
 * Verifies webhook deliveries: HMAC-SHA256 over `{id}.{timestamp}.{rawBody}`,
 * a five-minute timestamp tolerance, and optional replay suppression.
 *
 * Built on Web Crypto, so the same code runs on Node 20+, Cloudflare Workers,
 * Vercel Edge, Deno, and Bun.
 *
 * ```ts
 * const verifier = new WebhookVerifier({ secret: process.env.MSP_WEBHOOK_SECRET! });
 * const { event } = await verifier.verify({ headers: req.headers, body: rawBody });
 * ```
 */
export class WebhookVerifier {
  readonly #keyBytes: Uint8Array[];
  readonly #toleranceMs: number;
  readonly #replayCache: ReplayCache | undefined;
  readonly #now: () => number;
  #keys: Promise<CryptoKey[]> | undefined;

  constructor(options: WebhookVerifierOptions) {
    const secrets = Array.isArray(options.secret) ? options.secret : [options.secret];
    if (secrets.length === 0) {
      throw new WebhookVerificationError('invalid_secret', 'At least one signing secret is required');
    }
    // Decode eagerly so a bad secret fails at construction, not mid-delivery.
    this.#keyBytes = secrets.map((secret) => decodeSecret(secret));
    this.#toleranceMs = (options.toleranceSeconds ?? 300) * 1000;
    this.#replayCache = options.replayCache;
    this.#now = options.now ?? (() => Date.now());
  }

  /**
   * Verify a delivery and return the parsed event.
   *
   * Throws {@link WebhookVerificationError} for anything that does not check
   * out. A `duplicate` code means the event was already handled — acknowledge
   * with a 2xx rather than treating it as a failure.
   */
  async verify<TEvent extends WebhookEvent = WebhookEvent>(
    input: VerifyInput,
  ): Promise<VerifyResult<TEvent>> {
    const { id, timestamp, signature } = extractWebhookHeaders(input.headers);
    if (!id || !timestamp || !signature) {
      throw new WebhookVerificationError(
        'missing_headers',
        'Missing one of Webhook-Id, Webhook-Timestamp, or Webhook-Signature',
      );
    }

    if (!/^\d+$/.test(timestamp)) {
      throw new WebhookVerificationError(
        'malformed_timestamp',
        `Webhook-Timestamp is not unix seconds: ${timestamp}`,
      );
    }

    const timestampMs = Number(timestamp) * 1000;
    const skewMs = Math.abs(this.#now() - timestampMs);
    if (skewMs > this.#toleranceMs) {
      throw new WebhookVerificationError(
        'stale_timestamp',
        `Webhook-Timestamp is ${Math.round(skewMs / 1000)}s from now, outside the ` +
          `${this.#toleranceMs / 1000}s tolerance`,
      );
    }

    const presented = parseSignatureHeader(signature);
    if (presented.length === 0) {
      throw new WebhookVerificationError(
        'invalid_signature_header',
        'Webhook-Signature carried no v1 token',
      );
    }

    const bodyBytes = toBytes(input.body);
    const signedContent = concatBytes(
      new TextEncoder().encode(`${id}.${timestamp}.`),
      bodyBytes,
    );

    let matched = false;
    for (const key of await this.#importKeys()) {
      const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, signedContent as BufferSource));
      // Compare against every presented token so rotation keeps working.
      for (const candidate of presented) {
        if (timingSafeEqual(candidate, expected)) matched = true;
      }
    }
    if (!matched) {
      throw new WebhookVerificationError('invalid_signature', 'No Webhook-Signature token matched');
    }

    let event: TEvent;
    try {
      event = JSON.parse(new TextDecoder().decode(bodyBytes)) as TEvent;
    } catch (cause) {
      throw new WebhookVerificationError('invalid_payload', 'Body is not valid JSON', { cause });
    }
    if (!event || typeof event !== 'object' || typeof (event as { type?: unknown }).type !== 'string') {
      throw new WebhookVerificationError('invalid_payload', 'Body is not a webhook event envelope');
    }

    // Dedupe last: only a delivery that verified is worth remembering.
    if (this.#replayCache && (await this.#replayCache.seen(id))) {
      throw new WebhookVerificationError('duplicate', `Event ${id} has already been handled`);
    }

    return { event, id, timestamp: Number(timestamp) };
  }

  /** Import the HMAC keys once and reuse them across deliveries. */
  #importKeys(): Promise<CryptoKey[]> {
    this.#keys ??= Promise.all(
      this.#keyBytes.map((bytes) =>
        crypto.subtle.importKey(
          'raw',
          bytes as BufferSource,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        ),
      ),
    );
    return this.#keys;
  }
}

/**
 * One-shot verification, for callers who would rather not hold a verifier.
 *
 * Prefer {@link WebhookVerifier} on a hot path — it imports the HMAC key once
 * instead of on every delivery.
 */
export async function verifyWebhook<TEvent extends WebhookEvent = WebhookEvent>(
  input: VerifyInput & Omit<WebhookVerifierOptions, 'replayCache'>,
): Promise<VerifyResult<TEvent>> {
  const { headers, body, ...options } = input;
  return new WebhookVerifier(options).verify<TEvent>({ headers, body });
}

/** Turn a `whsec_<base64>` secret into raw HMAC key bytes. */
function decodeSecret(secret: string): Uint8Array {
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new WebhookVerificationError('invalid_secret', 'Signing secret must be a non-empty string');
  }
  const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  try {
    return base64ToBytes(encoded);
  } catch (cause) {
    throw new WebhookVerificationError(
      'invalid_secret',
      'Signing secret is not base64 after the whsec_ prefix',
      { cause },
    );
  }
}

/**
 * Split the header into candidate signatures.
 *
 * The header is a space-delimited list of `v1,<base64>` tokens; unknown
 * versions and unparseable tokens are dropped rather than failing the whole
 * delivery, so a future scheme version alongside a v1 token still verifies.
 */
function parseSignatureHeader(header: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const token of header.split(' ')) {
    if (token === '') continue;
    const separator = token.indexOf(',');
    const [version, encoded] =
      separator === -1 ? ['v1', token] : [token.slice(0, separator), token.slice(separator + 1)];
    if (version !== 'v1' || !encoded) continue;
    try {
      out.push(base64ToBytes(encoded));
    } catch {
      // A malformed token is simply not a match.
    }
  }
  return out;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBytes(body: RawBody): Uint8Array {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(body);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Compare two byte arrays without leaking where they first differ. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
