import type {
  CreateMessagingInvitation,
  InvitationStatus,
  MessagingInvitation,
  MessagingInvitationList,
} from '@1440io/msp-types';
import { Paginator } from '../pagination.js';
import { Resource, type RequestOverrides } from './base.js';

export interface ListInvitationsParams extends RequestOverrides {
  /** Page size. Default 25, capped at 100. */
  count?: number;
  /** Cursor from a previous page's `nextCursor`. */
  cursor?: string;
  /** Only invitations in this status. */
  status?: InvitationStatus;
}

export interface CreateInvitationParams extends RequestOverrides {
  /** E.164 phone number of the customer to invite. */
  phoneNumber: string;
  /** Channel to invite over. Defaults to `amb`. */
  channel?: 'amb';
  /** Only `connect` is defined today. Defaults to `connect`. */
  purpose?: 'connect';
  /**
   * Idempotency key. Replaying it returns the original invitation rather than
   * inviting the customer twice. Generated when omitted.
   */
  requestMessageId?: string;
  /** Your own reference, echoed back on the invitation and its webhook. */
  callerReference?: string | null;
  /** Whether the resulting conversation starts on a bot or a live agent. */
  targetAgentStatus?: 'bot' | 'live';
  /** Customer first name to seed the conversation with. */
  targetFirstName?: string;
  /** Customer last name to seed the conversation with. */
  targetLastName?: string;
  /** Brand name and logo shown to the customer in the invitation. */
  branding?: CreateMessagingInvitation['branding'];
}

/**
 * Messaging invitations — reaching a customer first.
 *
 * Creation is asynchronous: an invitation starts at `submitting` and settles on
 * `accepted`, `declined`, `provider_rejected`, or `error`. Watch the
 * `messaging_invitation.updated` webhook rather than polling where you can.
 */
export class InvitationsResource extends Resource {
  /** List invitations, newest first. */
  list(params: ListInvitationsParams = {}): Paginator<MessagingInvitation, MessagingInvitationList> {
    const fetchPage = (cursor?: string) =>
      this.http.request<MessagingInvitationList>({
        method: 'GET',
        path: '/api/v0/messaging/invitations',
        query: { count: params.count, cursor: cursor ?? params.cursor, status: params.status },
        headers: params.headers,
        signal: params.signal,
        timeoutMs: params.timeoutMs,
      });

    return new Paginator({
      first: fetchPage(),
      fetchNext: (cursor) => fetchPage(cursor),
      getItems: (page) => page.messagingInvitations,
      getCursor: (page) => page.nextCursor,
    });
  }

  /** Invite a customer into a conversation by phone number. */
  async create(params: CreateInvitationParams): Promise<MessagingInvitation> {
    const { signal, timeoutMs, headers, requestMessageId, ...rest } = params;
    return this.http.request<MessagingInvitation>({
      method: 'POST',
      path: '/api/v0/messaging/invitations',
      body: {
        channel: 'amb',
        purpose: 'connect',
        requestMessageId: requestMessageId ?? crypto.randomUUID(),
        ...rest,
      },
      idempotent: true, // requestMessageId makes a retry safe.
      headers,
      signal,
      timeoutMs,
    });
  }

  /** Get one invitation by id. */
  async get(
    messagingInvitationId: string,
    options: RequestOverrides = {},
  ): Promise<MessagingInvitation> {
    return this.http.request<MessagingInvitation>({
      method: 'GET',
      path: `/api/v0/messaging/invitations/${encodeURIComponent(messagingInvitationId)}`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}
