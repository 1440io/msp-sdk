import { WebhookReceiver, type WebhookReceiverOptions } from '../receiver.js';

/** The bits of a Fastify request this adapter touches. */
export interface FastifyLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

/** The bits of a Fastify reply this adapter touches. */
export interface FastifyLikeReply {
  code(status: number): FastifyLikeReply;
  send(body: unknown): unknown;
}

/** The slice of the Fastify instance this adapter registers against. */
export interface FastifyLikeInstance {
  addContentTypeParser(
    contentType: string,
    options: { parseAs: 'buffer' },
    parser: (req: unknown, body: Buffer, done: (err: Error | null, body?: unknown) => void) => void,
  ): void;
  post(path: string, handler: (request: FastifyLikeRequest, reply: FastifyLikeReply) => unknown): void;
}

export interface FastifyWebhookPluginOptions extends WebhookReceiverOptions {
  /** Route to mount the handler on. Default `/webhooks/1440`. */
  path?: string;
  /**
   * Register a buffer content-type parser for `application/json` on this
   * instance. Default true. Set false when you have already arranged for the
   * raw body yourself (e.g. `fastify-raw-body`) — Fastify's default JSON
   * parser destroys the exact bytes the signature covers.
   */
  registerContentTypeParser?: boolean;
}

/**
 * A Fastify route handler for the webhook endpoint.
 *
 * Fastify's default JSON parser replaces the raw body, so register this on an
 * instance whose `application/json` parser keeps the buffer — which
 * {@link fastifyMspWebhooks} does for you.
 */
export function createFastifyWebhookHandler(
  options: WebhookReceiverOptions,
): (request: FastifyLikeRequest, reply: FastifyLikeReply) => Promise<unknown> {
  const receiver = new WebhookReceiver(options);

  return async (request, reply) => {
    const body = request.body;
    if (!(body instanceof Uint8Array) && typeof body !== 'string') {
      return reply.code(500).send({
        ok: false,
        error:
          'The webhook body was parsed before it reached the handler. Register the raw-body ' +
          'content-type parser (see fastifyMspWebhooks) so the exact signed bytes survive.',
      });
    }
    const result = await receiver.handle({ headers: request.headers, body });
    return reply.code(result.status).send(result.body);
  };
}

/**
 * A Fastify plugin that registers a raw-body parser and mounts the webhook
 * route.
 *
 * ```ts
 * import Fastify from 'fastify';
 * import { fastifyMspWebhooks } from '@1440io/msp-webhooks/fastify';
 *
 * const app = Fastify();
 * // Register inside its own scope so the raw parser applies to this route only.
 * await app.register(fastifyMspWebhooks, {
 *   path: '/webhooks/1440',
 *   secret: process.env.MSP_WEBHOOK_SECRET!,
 *   on: { 'message.received': async (event) => { await enqueue(event); } },
 * });
 * ```
 *
 * Register it with a `prefix`, or inside an encapsulated scope, so the buffer
 * parser does not leak onto routes that expect parsed JSON.
 */
export async function fastifyMspWebhooks(
  fastify: FastifyLikeInstance,
  options: FastifyWebhookPluginOptions,
): Promise<void> {
  if (options.registerContentTypeParser !== false) {
    fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });
  }
  fastify.post(options.path ?? '/webhooks/1440', createFastifyWebhookHandler(options));
}
