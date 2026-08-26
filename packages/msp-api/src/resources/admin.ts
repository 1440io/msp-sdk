import type {
  AdminBusinessChannel,
  AdminBusinessContext,
  AdminBusinessMember,
  AdminCreateBusinessChannelBody,
  AdminSandboxList,
  AdminSandboxMemberSyncResult,
  BusinessSettings,
  CatalogPermission,
  Integration,
  IntegrationApiKey,
  IntegrationDelivery,
  PermissionSetBody,
  PermissionSetView,
  RichAssetItem,
  RichAssetList,
  RichAssetUsage,
  RichTemplateDetail,
  RichTemplateList,
  RichTemplateStatus,
  RichTemplateSummary,
  RichTemplateWriteBody,
  Schemas,
  TikTokChannelStatus,
} from '@1440io/msp-types';
import { Paginator } from '../pagination.js';
import { Resource, type RequestOverrides } from './base.js';

const ADMIN = '/api/admin/businesses';

/** Business-admin routes. All of them require the `admin` membership tier. */
export class AdminResource extends Resource {
  /** Rich templates and their asset library. */
  readonly templates = new AdminTemplatesResource(this.http);
  /** Integrations, their API keys, and their webhook delivery log. */
  readonly integrations = new AdminIntegrationsResource(this.http);
  /** Permission sets and the permission catalog. */
  readonly permissions = new AdminPermissionsResource(this.http);
  /** Connected messaging channels. */
  readonly channels = new AdminChannelsResource(this.http);

  /** Get the authenticated member's business-admin context. */
  async context(options: RequestOverrides = {}): Promise<AdminBusinessContext> {
    return this.http.request<AdminBusinessContext>({
      method: 'GET',
      path: `${ADMIN}/context`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

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

  /** List the business's members. Capped at 100 per call; no cursor yet. */
  async listMembers(
    params: RequestOverrides & { count?: number } = {},
  ): Promise<AdminBusinessMember[]> {
    return this.http.request<AdminBusinessMember[]>({
      method: 'GET',
      path: `${ADMIN}/members`,
      query: { count: params.count },
      headers: params.headers,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });
  }

  /** List sandbox organizations under the parent business, with the cap. */
  async listSandboxes(options: RequestOverrides = {}): Promise<AdminSandboxList> {
    return this.http.request<AdminSandboxList>({
      method: 'GET',
      path: `${ADMIN}/sandboxes`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /** Resync sandbox memberships from the parent org. */
  async syncSandboxMembers(
    options: RequestOverrides = {},
  ): Promise<AdminSandboxMemberSyncResult> {
    return this.http.request<AdminSandboxMemberSyncResult>({
      method: 'POST',
      path: `${ADMIN}/sandboxes/member-sync`,
      idempotent: true,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}

/** Messaging channels connected to the business. */
export class AdminChannelsResource extends Resource {
  /** List connected channels. Capped at 100 per call; no cursor yet. */
  async list(
    params: RequestOverrides & { count?: number } = {},
  ): Promise<AdminBusinessChannel[]> {
    return this.http.request<AdminBusinessChannel[]>({
      method: 'GET',
      path: `${ADMIN}/channels`,
      query: { count: params.count },
      headers: params.headers,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });
  }

  /** Connect a messaging channel to the business. */
  async create(
    body: AdminCreateBusinessChannelBody,
    options: RequestOverrides = {},
  ): Promise<AdminBusinessChannel> {
    return this.http.request<AdminBusinessChannel>({
      method: 'POST',
      path: `${ADMIN}/channels`,
      body,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
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
  /** Page size. */
  count?: number;
  /** Return templates older than this template id. */
  before?: string;
}

export interface AdminListAssetsParams extends RequestOverrides {
  /** Only assets for this channel. */
  channel?: 'amb' | 'tiktok';
  /** Only assets filling this rich-message slot. */
  usage?: RichAssetUsage;
  /** Page size. */
  count?: number;
  /** Return assets older than this asset id. */
  before?: string;
}

export interface UploadRichAssetParams extends RequestOverrides {
  /** Channel the asset belongs to. */
  channel: 'amb' | 'tiktok';
  /** Rich-message usage slot the asset fills. */
  usage: NonNullable<RichAssetUsage>;
  /** Library display name, 1–200 characters. */
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
        query: { status: params.status, count: params.count, before: before ?? params.before },
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

  /** Delete a draft template. Published templates must be archived instead. */
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
      getCursor: (page) => (page.hasMore ? page.nextCursor : null),
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

/** Integrations, their API keys, and their webhook delivery log. */
export class AdminIntegrationsResource extends Resource {
  /** List integrations. Capped at 100 per call; no cursor yet. */
  async list(params: RequestOverrides & { count?: number } = {}): Promise<Integration[]> {
    return this.http.request<Integration[]>({
      method: 'GET',
      path: `${ADMIN}/integrations`,
      query: { count: params.count },
      headers: params.headers,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });
  }

  /** Get one integration. */
  async get(integrationId: string, options: RequestOverrides = {}): Promise<Integration> {
    return this.http.request<Integration>({
      method: 'GET',
      path: `${ADMIN}/integrations/${encodeURIComponent(integrationId)}`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /** List an integration's API keys. Secrets are never returned. */
  async listApiKeys(
    integrationId: string,
    params: RequestOverrides & { count?: number } = {},
  ): Promise<IntegrationApiKey[]> {
    return this.http.request<IntegrationApiKey[]>({
      method: 'GET',
      path: `${ADMIN}/integrations/${encodeURIComponent(integrationId)}/keys`,
      query: { count: params.count },
      headers: params.headers,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });
  }

  /** Read the webhook delivery log for an integration. */
  async listDeliveries(
    integrationId: string,
    options: RequestOverrides = {},
  ): Promise<IntegrationDelivery[]> {
    return this.http.request<IntegrationDelivery[]>({
      method: 'GET',
      path: `${ADMIN}/integrations/${encodeURIComponent(integrationId)}/deliveries`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}

/** Permission sets and the permission catalog they draw from. */
export class AdminPermissionsResource extends Resource {
  /** List the live (non-deprecated) permission catalog. */
  async catalog(options: RequestOverrides = {}): Promise<CatalogPermission[]> {
    return this.http.request<CatalogPermission[]>({
      method: 'GET',
      path: `${ADMIN}/permissions`,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /** List permission sets defined for the business. */
  async listSets(
    params: RequestOverrides & { count?: number } = {},
  ): Promise<PermissionSetView[]> {
    return this.http.request<PermissionSetView[]>({
      method: 'GET',
      path: `${ADMIN}/permission-sets`,
      query: { count: params.count },
      headers: params.headers,
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });
  }

  /** Create a permission set. */
  async createSet(
    body: PermissionSetBody,
    options: RequestOverrides = {},
  ): Promise<PermissionSetView> {
    return this.http.request<PermissionSetView>({
      method: 'POST',
      path: `${ADMIN}/permission-sets`,
      body,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /** Update a permission set. `permissions` fully replaces the prior list. */
  async updateSet(
    permissionSetId: string,
    body: PermissionSetBody,
    options: RequestOverrides = {},
  ): Promise<PermissionSetView> {
    return this.http.request<PermissionSetView>({
      method: 'PATCH',
      path: `${ADMIN}/permission-sets/${encodeURIComponent(permissionSetId)}`,
      body,
      idempotent: true,
      headers: options.headers,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /** Delete a permission set. */
  async deleteSet(
    permissionSetId: string,
    options: RequestOverrides = {},
  ): Promise<Schemas['PermissionSetDeleteResult']> {
    return this.http.request<Schemas['PermissionSetDeleteResult']>({
      method: 'DELETE',
      path: `${ADMIN}/permission-sets/${encodeURIComponent(permissionSetId)}`,
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
