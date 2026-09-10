import type {
  RichTemplateDetail,
  RichTemplateList,
  RichTemplateSummary,
  RichTemplateType,
} from '@1440io/msp-types';
import { Paginator } from '../pagination.js';
import { Resource, type RequestOverrides } from './base.js';

export interface ListTemplatesParams extends RequestOverrides {
  /** Only templates producing this kind of message. */
  templateType?: RichTemplateType;
  /** Page size, capped at 100. */
  count?: number;
  /** Return templates older than this template id. */
  before?: string;
}

/** Published rich templates, as a sending integration sees them. */
export class TemplatesResource extends Resource {
  /** List published templates. */
  list(params: ListTemplatesParams = {}): Paginator<RichTemplateSummary, RichTemplateList> {
    const fetchPage = (before?: string) =>
      this.http.request<RichTemplateList>({
        method: 'GET',
        path: '/api/v0/templates',
        query: {
          templateType: params.templateType,
          count: params.count,
          before: before ?? params.before,
        },
        headers: params.headers,
        signal: params.signal,
        timeoutMs: params.timeoutMs,
      });

    return new Paginator({
      first: fetchPage(),
      fetchNext: (cursor) => fetchPage(cursor),
      getItems: (page) => page.templates,
      getCursor: (page) => page.nextCursor,
    });
  }

  /** Get one published template, including its definition and readiness. */
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
