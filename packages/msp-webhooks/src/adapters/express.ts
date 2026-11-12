import { WebhookReceiver, type WebhookReceiverOptions } from '../receiver.js';

/** The bits of an Express/Connect request this adapter touches. */
export interface ExpressLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | string>;
}

/** The bits of an Express response this adapter touches. */
export interface ExpressLikeResponse {
  status(code: number): ExpressLikeResponse;
  json(body: unknown): unknown;
}

export type ExpressLikeNext = (error?: unknown) => void;

/**
 * An Express (or Connect) handler for the webhook endpoint.
 *
 * The signature is computed over the raw request bytes, so this route must not
 * go through `express.json()`. Either mount it before that middleware, or give
 * this one route a raw parser:
 *
 * ```ts
 * import express from 'express';
 * import { createExpressWebhookHandler } from '@1440io/msp-webhooks/express';
 *
 * const app = express();
 * app.post(
 *   '/webhooks/1440',
 *   express.raw({ type: '(*)/(*)' }),           // hands us a Buffer
 *   createExpressWebhookHandler({
 *     secret: process.env.MSP_WEBHOOK_SECRET!,
 *     on: { 'message.received': async (event) => { await enqueue(event); } },
 *   }),
 * );
 * app.use(express.json());                      // everything else, as usual
 * ```
 *
 * When no parser has run, the handler reads the raw stream itself — but a JSON
 * parser upstream destroys the exact bytes, and verification will fail.
 */
export function createExpressWebhookHandler(
  options: WebhookReceiverOptions,
): (req: ExpressLikeRequest, res: ExpressLikeResponse, next: ExpressLikeNext) => Promise<void> {
  const receiver = new WebhookReceiver(options);

  return async (req, res, next) => {
    try {
      const body = await readRawBody(req);
      const result = await receiver.handle({ headers: req.headers, body });
      res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  };
}

async function readRawBody(req: ExpressLikeRequest): Promise<Uint8Array | string> {
  const body = req.body;

  // express.raw() / body-parser leaves a Buffer, which is already a Uint8Array.
  if (body instanceof Uint8Array) return body;
  if (typeof body === 'string') return body;

  if (body !== undefined && body !== null && typeof body === 'object') {
    throw new Error(
      'The webhook body was parsed into an object before it reached the handler. ' +
        'Signature verification needs the raw bytes — mount this route before ' +
        'express.json(), or give it express.raw({ type: "*/*" }).',
    );
  }

  if (typeof req[Symbol.asyncIterator] !== 'function') {
    throw new Error('Request body is not readable — no parsed body and no readable stream');
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    chunks.push(bytes);
    total += bytes.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
