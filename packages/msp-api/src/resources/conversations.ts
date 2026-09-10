import type {
  Conversation,
  ConversationDetail,
  ConversationListResponse,
  ConversationStatus,
} from '@1440io/msp-types';
import { Paginator } from '../pagination.js';
import { Resource, type RequestOverrides } from './base.js';

export interface ListConversationsParams extends RequestOverrides {
  /** Page size. Default 25, capped server-side at 100. */
  count?: number;
  /** Cursor from a previous page's `nextCursor`. */
  cursor?: string;
  /** Only conversations in this lifecycle status. */
  status?: ConversationStatus;
}

export interface GetConversationParams extends RequestOverrides {
  /** How many messages to include in the window. */
  count?: number;
  /** Return messages older than this message id. */
  before?: string;
}

/** Conversations and their message windows. */
export class ConversationsResource extends Resource {
  /**
   * List conversations, newest activity first.
   *
   * Returns a {@link Paginator}: await it for the first page, or `for await`
   * over it to walk every conversation across pages.
   */
  list(params: ListConversationsParams = {}): Paginator<Conversation, ConversationListResponse> {
    const fetchPage = (cursor?: string) =>
      this.http.request<ConversationListResponse>({
        method: 'GET',
        path: '/api/v0/conversations',
        query: { count: params.count, cursor: cursor ?? params.cursor, status: params.status },
        headers: params.headers,
        signal: params.signal,
        timeoutMs: params.timeoutMs,
      });

    return new Paginator({
      first: fetchPage(),
      fetchNext: (cursor) => fetchPage(cursor),
      getItems: (page) => page.conversations,
      getCursor: (page) => page.nextCursor,
    });
  }

  /** Get one conversation together with a window of its messages. */
  async get(
    conversationId: string,
    params: GetConversationParams = {},
  ): Promise<ConversationDetail> {
    return this.http.request<ConversationDetail>({
      method: 'GET',
      path: `/api/v0/conversations/${encodeURIComponent(conversationId)}`,
      query: { count: params.count, before: params.before },
      headers: params.headers,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });
  }

  /**
   * Replace the customer name stored on a conversation. Both fields are
   * required; pass `null` to clear one.
   */
  async updateName(
    conversationId: string,
    name: { firstName: string | null; lastName: string | null },
    options: RequestOverrides = {},
  ): Promise<Conversation> {
    return this.http.request<Conversation>({
      method: 'PATCH',
      path: `/api/v0/conversations/${encodeURIComponent(conversationId)}`,
      body: name,
      idempotent: true,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}
