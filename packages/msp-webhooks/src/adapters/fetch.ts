import { WebhookReceiver, type WebhookReceiverOptions, type WebhookResult } from '../receiver.js';

export interface FetchWebhookHandlerOptions extends WebhookReceiverOptions {
  /** Build the response yourself, instead of the default JSON body. */
  toResponse?: (result: WebhookResult) => Response | Promise<Response>;
}

/**
 * A handler for any runtime that speaks the Fetch API: Next.js App Router
 * route handlers, Hono, Remix, Deno, Bun, Cloudflare Workers, Vercel Edge.
 *
 * ```ts
 * // app/api/webhooks/1440/route.ts
 * import { createFetchWebhookHandler } from '@1440io/msp-webhooks/fetch';
 *
 * export const POST = createFetchWebhookHandler({
 *   secret: process.env.MSP_WEBHOOK_SECRET!,
 *   on: {
 *     'message.received': async (event) => {
 *       await enqueue(event);
 *     },
 *   },
 * });
 * ```
 *
 * The request body is read with `arrayBuffer()`, so the exact signed bytes are
 * hashed — nothing re-parses or re-serializes the JSON first.
 */
export function createFetchWebhookHandler(
  options: FetchWebhookHandlerOptions,
): (request: Request) => Promise<Response> {
  const receiver = new WebhookReceiver(options);
  const toResponse = options.toResponse ?? defaultToResponse;

  return async (request: Request): Promise<Response> => {
    const body = new Uint8Array(await request.arrayBuffer());
    const result = await receiver.handle({ headers: request.headers, body });
    return toResponse(result);
  };
}

function defaultToResponse(result: WebhookResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });
}
