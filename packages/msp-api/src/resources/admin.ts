import type {
  AdminBusinessChannel,
  BusinessSettings,
  RichAssetItem,
  RichAssetList,
  RichAssetUsage,
  RichTemplateDetail,
  RichTemplateList,
  RichTemplateStatus,
  RichTemplateSummary,
  RichTemplateType,
  RichTemplateWriteBody,
  Schemas,
  TikTokChannelStatus,
} from '@1440io/msp-types';
import { Paginator } from '../pagination.js';
import { Resource, type RequestOverrides } from './base.js';

const ADMIN = '/api/admin/businesses';

/**
 * Business-admin routes, as documented in the spec.
 *
 * Requires the `admin` membership tier. Earlier versions of this SDK also
 * exposed members, sandboxes, integrations, permission sets, and the business
 * context; those routes are no longer part of the published API surface and
 * were removed in 0.2.0.
 */
export class AdminResource extends Resource {
  /** Rich templates and their asset library. */
  readonly templates = new AdminTemplatesResource(this.http);
  /** Connected messaging channels. */
  readonly channels = new AdminChannelsResource(this.http);

  /** Get business-level settings. */
  async settings(options: RequestOverrides = {}): Promise<BusinessSettings> {
    return this.http.request<BusinessSettings>({
      method: 'GET',
      path: `${ADMIN}/settings`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}

/** Messaging channels connected to the business. */
export class AdminChannelsResource extends Resource {
  /** List connected channels. Capped at 100 per call; no cursor. */
  async list(params: RequestOverrides & { count?: number } = {}): Promise<AdminBusinessChannel[]> {
    return this.http.request<AdminBusinessChannel[]>({
      method: 'GET',
      path: `${ADMIN}/channels`,
      query: { count: params.count },
      headers: params.headers,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });
  }

  /** Get the TikTok channel's connection status. */
  async tiktokStatus(options: RequestOverrides = {}): Promise<TikTokChannelStatus> {
    return this.http.request<TikTokChannelStatus>({
      method: 'GET',
      path: `${ADMIN}/channels/tiktok`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}

export interface AdminListTemplatesParams extends RequestOverrides {
  /** Only templates in this publication state. */
  status?: RichTemplateStatus;
  /** Only templates producing this kind of message. */
  templateType?: RichTemplateType;
  /** Page size, capped at 100. */
  count?: number;
  /** Return templates older than this template id. */
  before?: string;
}

export interface AdminListAssetsParams extends RequestOverrides {
  /** Only assets for this channel. */
  channel?: 'amb';
  /** Only assets filling this rich-message slot. */
  usage?: RichAssetUsage;
  /** Page size, capped at 100. */
  count?: number;
  /** Return assets older than this asset id. */
  before?: string;
}

export interface UploadRichAssetParams extends RequestOverrides {
  /** Channel the asset belongs to. */
  channel: 'amb';
  /** Rich-message usage slot the asset fills. */
  usage: NonNullable<RichAssetUsage>;
  /** Library display name. */
  displayName: string;
  /** PNG image bytes. */
  file: Blob | Uint8Array | ArrayBuffer;
  /** File name recorded with the upload. Defaults to `displayName`. */
  filename?: string;
  /** MIME type of `file`. Defaults to `image/png`. */
  contentType?: string;
}

/** Authoring, publishing, and archiving rich templates. */
export class AdminTemplatesResource extends Resource {
  /** List templates in any state (draft, published, archived). */
  list(params: AdminListTemplatesParams = {}): Paginator<RichTemplateSummary, RichTemplateList> {
    const fetchPage = (before?: string) =>
      this.http.request<RichTemplateList>({
        method: 'GET',
        path: `${ADMIN}/templates`,
        query: {
          status: params.status,
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

  /** Get one template, in any state. */
  async get(templateId: string, options: RequestOverrides = {}): Promise<RichTemplateDetail> {
    return this.http.request<RichTemplateDetail>({
      method: 'GET',
      path: `${ADMIN}/templates/${encodeURIComponent(templateId)}`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /** Create a draft template. */
  async create(
    body: RichTemplateWriteBody,
    options: RequestOverrides = {},
  ): Promise<RichTemplateDetail> {
    return this.http.request<RichTemplateDetail>({
      method: 'POST',
      path: `${ADMIN}/templates`,
      body,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /** Replace a draft template's name, definition, and slot bindings. */
  async update(
    templateId: string,
    body: RichTemplateWriteBody,
    options: RequestOverrides = {},
  ): Promise<RichTemplateDetail> {
    return this.http.request<RichTemplateDetail>({
      method: 'PUT',
      path: `${ADMIN}/templates/${encodeURIComponent(templateId)}`,
      body,
      idempotent: true,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /** Delete a never-published draft. Published templates can only be archived. */
  async delete(
    templateId: string,
    options: RequestOverrides = {},
  ): Promise<Schemas['RichTemplateDeleteResult']> {
    return this.http.request<Schemas['RichTemplateDeleteResult']>({
      method: 'DELETE',
      path: `${ADMIN}/templates/${encodeURIComponent(templateId)}`,
      idempotent: true,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /** Publish a draft, making it sendable. */
  async publish(templateId: string, options: RequestOverrides = {}): Promise<RichTemplateDetail> {
    return this.http.request<RichTemplateDetail>({
      method: 'POST',
      path: `${ADMIN}/templates/${encodeURIComponent(templateId)}/publish`,
      idempotent: true,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /** Archive a published template, retiring it from sends. */
  async archive(templateId: string, options: RequestOverrides = {}): Promise<RichTemplateDetail> {
    return this.http.request<RichTemplateDetail>({
      method: 'POST',
      path: `${ADMIN}/templates/${encodeURIComponent(templateId)}/archive`,
      idempotent: true,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /** List rich-message assets in the library. */
  listAssets(params: AdminListAssetsParams = {}): Paginator<RichAssetItem, RichAssetList> {
    const fetchPage = (before?: string) =>
      this.http.request<RichAssetList>({
        method: 'GET',
        path: `${ADMIN}/templates/assets`,
        query: {
          channel: params.channel,
          usage: params.usage,
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
      getItems: (page) => page.assets,
      getCursor: (page) => page.nextCursor,
    });
  }

  /** Upload a PNG into the asset library, scoped to a channel and usage slot. */
  async uploadAsset(params: UploadRichAssetParams): Promise<RichAssetItem> {
    const form = new FormData();
    form.set('channel', params.channel);
    form.set('usage', params.usage);
    form.set('displayName', params.displayName);
    form.set(
      'file',
      toBlob(params.file, params.contentType ?? 'image/png'),
      params.filename ?? params.displayName,
    );

    return this.http.request<RichAssetItem>({
      method: 'POST',
      path: `${ADMIN}/templates/assets`,
      rawBody: form, // fetch sets the multipart boundary itself.
      headers: params.headers,
      signal: params.signal,
      timeoutMs: params.timeoutMs ?? 120_000,
    });
  }

  /** Delete an asset. Rejected with 409 while a template still binds it. */
  async deleteAsset(
    assetId: string,
    options: RequestOverrides = {},
  ): Promise<Schemas['RichAssetDeleteResult']> {
    return this.http.request<Schemas['RichAssetDeleteResult']>({
      method: 'DELETE',
      path: `${ADMIN}/templates/assets/${encodeURIComponent(assetId)}`,
      idempotent: true,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}

function toBlob(file: Blob | Uint8Array | ArrayBuffer, contentType: string): Blob {
  if (typeof Blob !== 'undefined' && file instanceof Blob) return file;
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file as ArrayBuffer);
  return new Blob([bytes as BlobPart], { type: contentType });
}
