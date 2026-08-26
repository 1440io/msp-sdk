import type {
  ConversationInitiation,
  ConversationInitiationList,
  InitiationStatus,
} from '@1440io/msp-types';
import { Paginator } from '../pagination.js';
import { Resource, type RequestOverrides } from './base.js';

export interface ListInitiationsParams extends RequestOverrides {
  /** Page size. Default 25. */
  count?: number;
  /** Cursor from a previous page's `nextCursor`. */
  cursor?: string;
  /** Only initiations in this status. */
  status?: InitiationStatus;
}

export interface CreateInitiationParams extends RequestOverrides {
  /** Channel adapter to initiate over. */
  channel: 'amb' | 'tiktok';
  /** E.164 phone number of the customer to reach. */
  phoneNumber: string;
  /** Only `connect` is defined today. Defaults to `connect`. */
  purpose?: 'connect';
  /** Idempotency key — replaying it returns the original initiation. */
  idempotencyKey: string;
  /** Your own reference, echoed back on the initiation and its webhook. */
  callerReference?: string | null;
  /** Whether the resulting conversation starts on a bot or a live agent. */
  targetAgentStatus?: 'bot' | 'live';
  /** Customer first name to seed the conversation with. */
  targetFirstName?: string;
  /** Customer last name to seed the conversation with. */
  targetLastName?: string;
}

/**
 * Business-initiated conversations.
 *
 * Creation is asynchronous: the initiation starts at `submitting` and reaches
 * `accepted`, `declined`, `provider_rejected`, or `error`. Watch the
 * `initiation.updated` webhook rather than polling where you can.
 */
export class InitiationsResource extends Resource {
  /** List initiations, newest first. */
  list(
    params: ListInitiationsParams = {},
  ): Paginator<ConversationInitiation, ConversationInitiationList> {
    const fetchPage = (cursor?: string) =>
      this.http.request<ConversationInitiationList>({
        method: 'GET',
        path: '/api/v0/messaging/initiations',
        query: { count: params.count, cursor: cursor ?? params.cursor, status: params.status },
        headers: params.headers,
        signal: params.signal,
        timeoutMs: params.timeoutMs,
      });

    return new Paginator({
      first: fetchPage(),
      fetchNext: (cursor) => fetchPage(cursor),
      getItems: (page) => page.initiations,
      getCursor: (page) => page.nextCursor,
    });
  }

  /** Initiate a conversation with a customer by phone number. */
  async create(params: CreateInitiationParams): Promise<ConversationInitiation> {
    const { signal, timeoutMs, headers, ...body } = params;
    return this.http.request<ConversationInitiation>({
      method: 'POST',
      path: '/api/v0/messaging/initiations',
      body: { purpose: 'connect', ...body },
      idempotent: true, // idempotencyKey makes a retry safe.
      headers,
      signal,
      timeoutMs,
    });
  }

  /** Get one initiation by id. */
  async get(
    initiationId: string,
    options: RequestOverrides = {},
  ): Promise<ConversationInitiation> {
    return this.http.request<ConversationInitiation>({
      method: 'GET',
      path: `/api/v0/messaging/initiations/${encodeURIComponent(initiationId)}`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}
