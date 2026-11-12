import type { Conversation, ConversationDetail, ConversationListResponse, ConversationStatus, UpdateConversationBody } from '@1440io/msp-types';
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
   * Update a conversation's customer name, its handling status, or both.
   *
   * Answers `204` with no body — there is nothing to read back. Call
   * {@link ConversationsResource.get} if you need the updated record.
   *
   * `status` accepts `bot`, `agent` and `closed` only. `agent_requested` is
   * reachable solely through {@link ConversationsResource.requestAgent}; the
   * server rejects it here with a `400`.
   */
  async update(
    conversationId: string,
    changes: UpdateConversationBody,
    options: RequestOverrides = {},
  ): Promise<void> {
    await this.http.request<void>({
      method: 'PATCH',
      path: `/api/v0/conversations/${encodeURIComponent(conversationId)}`,
      body: changes,
      idempotent: true,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * Replace the customer name stored on a conversation. Pass `null` to clear
   * a field.
   *
   * @deprecated Use {@link ConversationsResource.update}, which can also set
   * the handling status. This method previously declared a `Conversation`
   * return type, but the route has always answered `204` with no body, so the
   * promise resolved to `undefined` at runtime.
   */
  async updateName(
    conversationId: string,
    name: { firstName: string | null; lastName: string | null },
    options: RequestOverrides = {},
  ): Promise<void> {
    await this.update(conversationId, name, options);
  }

  /**
   * Ask for a human agent on this conversation, moving it to
   * `agent_requested`.
   *
   * Requires the `RequestAgent` permission, and answers `204` with no body.
   * The conversation keeps routing to bot integrations until someone takes it
   * up and sets `agent` — `agent_requested` records the ask, not the handover.
   */
  async requestAgent(conversationId: string, options: RequestOverrides = {}): Promise<void> {
    await this.http.request<void>({
      method: 'POST',
      path: `/api/v0/conversations/${encodeURIComponent(conversationId)}/request-agent`,
      idempotent: true,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}
