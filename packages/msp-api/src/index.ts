/**
 * `@1440io/msp-api` — a typed client for the 1440 Apple Messages for Business
 * MSP API.
 *
 * ```ts
 * import { MspClient } from '@1440io/msp-api';
 *
 * const client = new MspClient({ apiKey: process.env.MSP_API_KEY! });
 * await client.messaging.sendText({ conversationId, body: 'Hello!' });
 * ```
 */
export { MspClient, DEFAULT_BASE_URL, type MspClientOptions } from './client.js';

export {
  ApiKeyTokenProvider,
  CallbackTokenProvider,
  StaticTokenProvider,
  type AccessToken,
  type TokenExchange,
  type TokenProvider,
} from './auth.js';

export {
  MspApiError,
  MspAuthenticationError,
  MspConfigError,
  MspConflictError,
  MspConnectionError,
  MspError,
  MspNotFoundError,
  MspPayloadTooLargeError,
  MspPermissionError,
  MspRateLimitError,
  MspServerError,
  MspTimeoutError,
  MspValidationError,
  isMspApiError,
  type MspApiErrorInit,
} from './errors.js';

export type { FetchLike, RequestHook, ResponseHook, RetryOptions } from './http.js';
export { Paginator } from './pagination.js';
export { uuidv7 } from './uuid.js';

export type { RequestOverrides } from './resources/base.js';
export { AuthResource } from './resources/auth.js';
export {
  ConversationsResource,
  type GetConversationParams,
  type ListConversationsParams,
} from './resources/conversations.js';
export {
  MessagingResource,
  type SendRawParams,
  type SendTemplateParams,
  type SendTextParams,
} from './resources/messaging.js';
export {
  InitiationsResource,
  type CreateInitiationParams,
  type ListInitiationsParams,
} from './resources/initiations.js';
export { TemplatesResource, type ListTemplatesParams } from './resources/templates.js';
export {
  MediaResource,
  MAX_TIKTOK_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  type UploadBody,
  type UploadMediaParams,
} from './resources/media.js';
export { ChannelsResource } from './resources/channels.js';
export { InvitationsResource } from './resources/invitations.js';
export {
  AdminChannelsResource,
  AdminIntegrationsResource,
  AdminPermissionsResource,
  AdminResource,
  AdminTemplatesResource,
  type AdminListAssetsParams,
  type AdminListTemplatesParams,
  type UploadRichAssetParams,
} from './resources/admin.js';

// Re-exported so consumers can type their own code without a second install.
export type * from '@1440io/msp-types';
