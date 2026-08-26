import type {
  RawChannelMessageType,
  SendMessageBody,
  SendMessageSuccess,
  SendRawChannelPayloadBody,
  TemplateVariableValue,
} from '@1440io/msp-types';
import { uuidv7 } from '../uuid.js';
import { Resource, type RequestOverrides } from './base.js';

export interface SendTextParams extends RequestOverrides {
  /** Conversation to send into. */
  conversationId: string;
  /** Text body. At least one of `body` or `attachmentIds` must be present. */
  body?: string;
  /** Media asset ids from {@link MediaResource.upload}. Max 10 per message. */
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

export interface SendRawParams extends RequestOverrides {
  /** Conversation to send into. */
  conversationId: string;
  /** Currently only `amb` accepts a channel-native payload. */
  channel: SendRawChannelPayloadBody['channel'];
  /** Which Apple MSP message shape `payload` carries. */
  messageType: RawChannelMessageType;
  /**
   * The Apple MSP payload, minus the server-owned `sourceId`, `destinationId`,
   * `id`, and `v` fields.
   */
  payload: Record<string, unknown>;
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
  /** Send a free-form text message, attachments, or both. */
  async sendText(params: SendTextParams): Promise<SendMessageSuccess> {
    const message: { body?: string; attachmentIds?: string[] } = {};
    if (params.body !== undefined) message.body = params.body;
    if (params.attachmentIds !== undefined) message.attachmentIds = params.attachmentIds;

    return this.send(
      {
        requestMessageId: params.requestMessageId ?? uuidv7(),
        conversationId: params.conversationId,
        type: 'text',
        message,
      },
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
        message: {
          templateId: params.templateId,
          ...(params.variables ? { variables: params.variables } : {}),
        },
      },
      params,
    );
  }

  /** Send a pre-built {@link SendMessageBody}, for callers assembling it themselves. */
  async send(
    body: SendMessageBody,
    options: RequestOverrides = {},
  ): Promise<SendMessageSuccess> {
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
   * The platform validates only the documented hard constraints, so the shape
   * of `payload` is yours to get right.
   *
   * The spec leaves this response untyped. In practice it comes back in the
   * same shape as a normal send, which is the default here — pass a type
   * argument if you find otherwise on your channel.
   */
  async sendRaw<T = SendMessageSuccess>(params: SendRawParams): Promise<T> {
    const body: SendRawChannelPayloadBody = {
      requestMessageId: params.requestMessageId ?? uuidv7(),
      conversationId: params.conversationId,
      channel: params.channel,
      messageType: params.messageType,
      payload: params.payload,
    };

    return this.http.request<T>({
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
