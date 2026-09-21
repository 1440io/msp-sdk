import type {
  SendAuthenticationMessageBody,
  SendMessageBody,
  SendMessageSuccess,
  SendRawMessageBody,
  TemplateVariableValue,
} from '@1440io/msp-types';
import { uuidv7 } from '../uuid.js';
import { Resource, type RequestOverrides } from './base.js';

export interface SendTextParams extends RequestOverrides {
  /** Conversation to send into. */
  conversationId: string;
  /** The text body. Required — an empty send is rejected. */
  body: string;
  /** Optional subject line. */
  subject?: string;
  /** Media asset ids from {@link MediaResource.upload}. */
  attachmentIds?: string[];
  /**
   * Idempotency key. Generated as a UUIDv7 when omitted — supply your own to
   * make a retry across process restarts collapse onto the original send.
   */
  requestMessageId?: string;
}

export interface SendTemplateParams extends RequestOverrides {
  /** Conversation to send into. */
  conversationId: string;
  /** A published template id, ready on the conversation's channel. */
  templateId: string;
  /** Values for the template's declared variables. */
  variables?: Record<string, TemplateVariableValue>;
  /** Idempotency key. Generated as a UUIDv7 when omitted. */
  requestMessageId?: string;
}

export interface SendAuthenticationParams extends RequestOverrides {
  /** Conversation to send into. */
  conversationId: string;
  /** A published `authentication` template id. */
  templateId: string;
  /**
   * Opaque state echoed back on the authentication response, so you can tie
   * the customer's result to the request you made.
   */
  state: string;
  /** Idempotency key. Generated as a UUIDv7 when omitted. */
  requestMessageId?: string;
}

export interface SendRawParams extends RequestOverrides {
  /** Conversation to send into. */
  conversationId: string;
  /**
   * The content to send, tagged by `kind` — `text`, `amb.quick_reply`,
   * `amb.list_picker`, and the rest. The platform validates documented hard
   * constraints only, so the shape is yours to get right.
   *
   * `amb.url_payload` is the exception: you supply an Apple Music, Apple Maps,
   * or App Clip URL and Apple builds the rich link at send time, so no template
   * and no asset bindings are involved. Apple decides which URLs it supports.
   */
  content: SendRawMessageBody['content'];
  /** Idempotency key. Generated as a UUIDv7 when omitted. */
  requestMessageId?: string;
}

/**
 * Outbound messaging.
 *
 * Every send carries a `requestMessageId` request key, scoped to the
 * conversation. Replaying it with identical bytes returns the persisted result
 * with `duplicate: true` rather than sending again, and differing bytes are
 * rejected with 409.
 *
 * Duplicate prevention is best effort, not a guarantee. Concurrent requests can
 * both reach Apple before either is persisted, and a provider timeout or a
 * persistence failure (502, or 500 on the send routes) leaves the outcome
 * genuinely unknown — the channel may already have accepted the message. The
 * documented recovery is to retry the identical bytes under the same
 * `requestMessageId`, which this client does automatically, accepting that a
 * retry can deliver another copy. Pass your own `requestMessageId` to keep that
 * collapse working across process restarts.
 */
export class MessagingResource extends Resource {
  /** Send a text message, with an optional subject and attachments. */
  async sendText(params: SendTextParams): Promise<SendMessageSuccess> {
    return this.send(
      {
        requestMessageId: params.requestMessageId ?? uuidv7(),
        conversationId: params.conversationId,
        type: 'text',
        body: params.body,
        ...(params.subject !== undefined ? { subject: params.subject } : {}),
        ...(params.attachmentIds !== undefined ? { attachmentIds: params.attachmentIds } : {}),
      } as SendMessageBody,
      params,
    );
  }

  /** Send a message built from a published rich template. */
  async sendTemplate(params: SendTemplateParams): Promise<SendMessageSuccess> {
    return this.send(
      {
        requestMessageId: params.requestMessageId ?? uuidv7(),
        conversationId: params.conversationId,
        type: 'template',
        templateId: params.templateId,
        ...(params.variables ? { variables: params.variables } : {}),
      } as SendMessageBody,
      params,
    );
  }

  /**
   * Send an authentication request from a published `authentication` template.
   *
   * The customer completes an OAuth flow on their device; the outcome arrives
   * as an `amb.authentication_response` on the `message.received` webhook,
   * carrying the `state` you supplied here.
   */
  async sendAuthentication(params: SendAuthenticationParams): Promise<SendMessageSuccess> {
    return this.send(
      {
        requestMessageId: params.requestMessageId ?? uuidv7(),
        conversationId: params.conversationId,
        type: 'authentication',
        templateId: params.templateId,
        state: params.state,
      } as unknown as SendMessageBody,
      params,
    );
  }

  /** Send a pre-built {@link SendMessageBody}, for callers assembling it themselves. */
  async send(body: SendMessageBody, options: RequestOverrides = {}): Promise<SendMessageSuccess> {
    return this.http.request<SendMessageSuccess>({
      method: 'POST',
      path: '/api/v0/messaging/send',
      body,
      idempotent: true, // Same requestMessageId on retry; dedup is best effort.
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * Send channel content straight through, bypassing templates.
   *
   * Idempotency hashes the canonical content after identifier injection: an
   * identical replay returns the original result, a changed payload conflicts.
   * As with every send, that collapse is best effort — see the class docs.
   *
   * Pass `{ kind: 'amb.url_payload', url }` to have Apple construct a rich link
   * from an Apple Music, Apple Maps, or App Clip URL. A 502 on that kind means
   * either construction failed, in which case nothing was sent, or the send
   * itself failed, in which case acceptance is unknown.
   */
  async sendRaw(params: SendRawParams): Promise<SendMessageSuccess> {
    const body: SendRawMessageBody = {
      requestMessageId: params.requestMessageId ?? uuidv7(),
      conversationId: params.conversationId,
      content: params.content,
    };

    return this.http.request<SendMessageSuccess>({
      method: 'POST',
      path: '/api/v0/messaging/send-raw',
      body,
      idempotent: true,
      headers: params.headers,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });
  }
}

export type { SendAuthenticationMessageBody };
