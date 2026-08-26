import type { RichTemplateDetail, RichTemplateList, RichTemplateSummary } from '@1440io/msp-types';
import { Paginator } from '../pagination.js';
import { Resource, type RequestOverrides } from './base.js';

export interface ListTemplatesParams extends RequestOverrides {
  /** Page size. */
  count?: number;
  /** Return templates older than this template id. */
  before?: string;
}

/** Published rich templates, as seen by a sending integration. */
export class TemplatesResource extends Resource {
  /** List published templates. */
  list(params: ListTemplatesParams = {}): Paginator<RichTemplateSummary, RichTemplateList> {
    const fetchPage = (before?: string) =>
      this.http.request<RichTemplateList>({
        method: 'GET',
        path: '/api/v0/templates',
        query: { count: params.count, before: before ?? params.before },
        headers: params.headers,
        signal: params.signal,
        timeoutMs: params.timeoutMs,
      });

    return new Paginator({
      first: fetchPage(),
      fetchNext: (cursor) => fetchPage(cursor),
      getItems: (page) => page.templates,
      getCursor: (page) => (page.hasMore ? page.nextCursor : null),
    });
  }

  /** Get one published template, including its definition. */
  async get(templateId: string, options: RequestOverrides = {}): Promise<RichTemplateDetail> {
    return this.http.request<RichTemplateDetail>({
      method: 'GET',
      path: `/api/v0/templates/${encodeURIComponent(templateId)}`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}
