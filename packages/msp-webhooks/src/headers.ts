/** Any shape a framework hands you request headers in. */
export type HeadersLike =
  | Headers
  | Record<string, string | string[] | undefined>
  | Map<string, string>
  | { get(name: string): string | null };

/** The three signature headers on every delivery. */
export interface WebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

/**
 * Read one header, case-insensitively, out of whatever the framework gave us.
 * Repeated headers collapse to the first value.
 */
export function getHeader(headers: HeadersLike, name: string): string | undefined {
  const lower = name.toLowerCase();

  if (typeof (headers as { get?: unknown }).get === 'function') {
    const value = (headers as { get(n: string): string | null }).get(lower);
    return value ?? undefined;
  }

  const record = headers as Record<string, string | string[] | undefined>;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0];
    return value ?? undefined;
  }
  return undefined;
}

/** Pull the `Webhook-Id`, `Webhook-Timestamp`, and `Webhook-Signature` headers. */
export function extractWebhookHeaders(headers: HeadersLike): Partial<WebhookHeaders> {
  const result: Partial<WebhookHeaders> = {};
  const id = getHeader(headers, 'webhook-id');
  const timestamp = getHeader(headers, 'webhook-timestamp');
  const signature = getHeader(headers, 'webhook-signature');
  if (id !== undefined) result.id = id;
  if (timestamp !== undefined) result.timestamp = timestamp;
  if (signature !== undefined) result.signature = signature;
  return result;
}
