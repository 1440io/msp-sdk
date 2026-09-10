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
   * The channel-native content, tagged by `kind` — `text`, `amb.quick_reply`,
   * `amb.list_picker`, and the rest. The platform validates documented hard
   * constraints only, so the shape is yours to get right.
   */
  content: SendRawMessageBody['content'];
  /** Idempotency key. Generated as a UUIDv7 when omitted. */
  requestMessageId?: string;
}

/**
 * Outbound messaging.
 *
 * Every send carries a `requestMessageId` idempotency key, so retrying a send
 * that may already have landed returns the original result (`duplicate: true`)
 * rather than delivering a second message.
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
      idempotent: true, // requestMessageId makes a retry safe.
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * Send a channel-native payload straight through, bypassing templates.
   *
   * Idempotency hashes the canonical content after identifier injection: an
   * identical replay returns the original result, a changed payload conflicts.
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
