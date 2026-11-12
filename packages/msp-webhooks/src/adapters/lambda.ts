import { WebhookReceiver, type WebhookReceiverOptions, type WebhookResult } from '../receiver.js';

/** An API Gateway (REST or HTTP API) or Lambda Function URL event. */
export interface LambdaProxyEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  multiValueHeaders?: Record<string, string[] | undefined>;
}

/** The proxy response shape both API Gateway payload versions accept. */
export interface LambdaProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface LambdaWebhookHandlerOptions extends WebhookReceiverOptions {
  /** Build the proxy result yourself, instead of the default JSON body. */
  toResult?: (result: WebhookResult) => LambdaProxyResult;
}

/**
 * A handler for AWS Lambda behind API Gateway (payload format 1.0 or 2.0) or a
 * Lambda Function URL.
 *
 * ```ts
 * import { createLambdaWebhookHandler } from '@1440io/msp-webhooks/lambda';
 *
 * export const handler = createLambdaWebhookHandler({
 *   secret: process.env.MSP_WEBHOOK_SECRET!,
 *   on: { 'message.received': async (event) => { await enqueue(event); } },
 * });
 * ```
 *
 * Base64-encoded bodies are decoded to their exact bytes before hashing. Note
 * that a fresh execution environment starts with an empty in-memory replay
 * cache — back {@link WebhookReceiverOptions.replayCache} with DynamoDB or
 * Redis if you need deduplication across invocations.
 */
export function createLambdaWebhookHandler(
  options: LambdaWebhookHandlerOptions,
): (event: LambdaProxyEvent) => Promise<LambdaProxyResult> {
  const receiver = new WebhookReceiver(options);
  const toResult = options.toResult ?? defaultToResult;

  return async (event: LambdaProxyEvent): Promise<LambdaProxyResult> => {
    const headers: Record<string, string | string[] | undefined> = {
      ...(event.multiValueHeaders ?? {}),
      ...(event.headers ?? {}),
    };
    const body = decodeBody(event);
    const result = await receiver.handle({ headers, body });
    return toResult(result);
  };
}

function decodeBody(event: LambdaProxyEvent): Uint8Array {
  const raw = event.body ?? '';
  if (!event.isBase64Encoded) return new TextEncoder().encode(raw);
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function defaultToResult(result: WebhookResult): LambdaProxyResult {
  return {
    statusCode: result.status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result.body),
  };
}
