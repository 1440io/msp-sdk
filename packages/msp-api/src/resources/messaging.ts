import type {
  ApplePayMerchantSession,
  ApplePayPaymentRequest,
  RequestPaymentBody,
  SendAuthenticationMessageBody,
  SendMessageBody,
  SendMessageSuccess,
  SendRawMessageBody,
  TemplateVariableValue,
  TypingState,
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

export interface RequestPaymentParams extends RequestOverrides {
  /** Conversation to request payment in. */
  conversationId: string;
  /**
   * The Apple merchant session, obtained from Apple by your own merchant
   * backend. 1440 passes it through; it never mints one for you.
   */
  merchantSession: ApplePayMerchantSession;
  /** What is being charged — currency, total, and any line items. */
  paymentRequest: ApplePayPaymentRequest;
  /** The bubble the customer sees before paying. */
  receivedMessage: RequestPaymentBody['receivedMessage'];
  /** The bubble shown after they respond. */
  replyMessage: RequestPaymentBody['replyMessage'];
  /** Images referenced by the bubbles. */
  images?: RequestPaymentBody['images'];
  /**
   * Request key. Identical bytes return the persisted result; differing bytes
   * conflict. Generated as a UUIDv7 when omitted — but see the warning on
   * {@link MessagingResource.requestPayment} about retries.
   */
  requestMessageId?: string;
}

export interface SendTypingParams extends RequestOverrides {
  /** Conversation to show the indicator in. */
  conversationId: string;
  /** Whether typing starts or ends. */
  state: TypingState;
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
   * Request an Apple Pay payment in a conversation.
   *
   * Requires the `RequestPayments` permission on top of `SendMessages`, plus
   * platform approval and business enablement — otherwise this is a 403 or an
   * `apple_pay_unavailable` rejection.
   *
   * The `merchantSession` comes from Apple via your own merchant backend; 1440
   * passes it through and never mints one. The customer's Apple Pay token goes
   * to your payment gateway rather than through 1440, so a success here only
   * confirms the request was delivered, not that money moved.
   *
   * **Not retried automatically.** Identical bytes replay the persisted
   * result, but the spec warns an uncertain send can still reach the provider
   * more than once and create multiple payable bubbles — so your gateway must
   * deduplicate on `requestMessageId`, and this SDK will not quietly retry a
   * request that could bill someone twice.
   */
  async requestPayment(params: RequestPaymentParams): Promise<SendMessageSuccess> {
    const body: RequestPaymentBody = {
      requestMessageId: params.requestMessageId ?? uuidv7(),
      conversationId: params.conversationId,
      merchantSession: params.merchantSession,
      paymentRequest: params.paymentRequest,
      receivedMessage: params.receivedMessage,
      replyMessage: params.replyMessage,
      ...(params.images !== undefined ? { images: params.images } : {}),
    };

    return this.http.request<SendMessageSuccess>({
      method: 'POST',
      path: '/api/v0/messaging/request-payment',
      body,
      idempotent: false,
      headers: params.headers,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });
  }

  /**
   * Show or clear a typing indicator in a conversation.
   *
   * Transient and best effort: one provider attempt with a two-second timeout,
   * no persistence, no retries, no idempotency. A provider failure is logged
   * and does not affect later sends, so this is decoration — never await it as
   * a precondition for messaging. Independent of any automatic typing the
   * platform does on its own.
   */
  async sendTyping(params: SendTypingParams): Promise<void> {
    await this.http.request<void>({
      method: 'POST',
      path: '/api/v0/messaging/typing',
      body: { conversationId: params.conversationId, state: params.state },
      idempotent: false, // transient; replaying it means nothing
      headers: params.headers,
      signal: params.signal,
      timeoutMs: params.timeoutMs ?? 10_000,
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
