/**
 * `@1440io/msp-types` — types for the 1440 Apple Messages for Business MSP API.
 *
 * `./openapi` holds the raw generated surface (`paths`, `webhooks`, `components`,
 * `operations`), regenerated from `spec/1440-cloud-openapi.json` by `npm run generate`.
 * This module re-exports it and adds the short, stable aliases the SDK and its
 * consumers actually reach for, plus the runtime enum vocabularies the spec
 * declares as string unions.
 */
import type { components, operations } from './openapi.js';

export type { components, operations, paths, webhooks } from './openapi.js';

/** Every named schema in the spec, keyed by its OpenAPI name. */
export type Schemas = components['schemas'];

/** Look a schema up by its OpenAPI name: `Schema<'ConversationListItem'>`. */
export type Schema<K extends keyof Schemas> = Schemas[K];

/** Look an operation up by `operationId`: `Operation<'sendConversationMessage'>`. */
export type Operation<K extends keyof operations> = operations[K];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Canonical error envelope returned by every non-2xx response. */
export type ErrorResponse = Schemas['ErrorResponse'];
/** Error envelope for the send route, carrying rich-messaging reject reasons. */
export type SendMessageError = Schemas['SendMessageError'];
/** A stable machine-readable rich-messaging reject reason. */
export type RichReason = Schemas['RichReason'];
/** Error envelope carrying only rich reasons (template/asset conflicts). */
export type RichReasonsError = Schemas['RichReasonsError'];
/** Error envelope for the conversation-initiation routes. */
export type ConversationInitiationError = Schemas['ConversationInitiationError'];

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Result of exchanging an integration API key for a short-lived access JWT. */
export type IntegrationTokenResponse = Schemas['IntegrationTokenResponse'];
/** The display-only authorization grant carried alongside a minted token. */
export type ActorGrant = Schemas['ActorGrant'];

// ---------------------------------------------------------------------------
// Conversations & messages
// ---------------------------------------------------------------------------

/** A conversation summary row, as returned by the conversation list endpoint. */
export type Conversation = Schemas['ConversationListItem'];
/** A conversation together with its window of messages. */
export type ConversationDetail = Schemas['ConversationDetailResponse'];
/** A cursor-paginated page of conversation summaries. */
export type ConversationListResponse = Schemas['ConversationListResponse'];
/** A stored message on a conversation. */
export type ConversationMessage = Schemas['ConversationMessage'];
/** An attachment on a stored message. */
export type ConversationMessageAttachment = Schemas['ConversationMessageAttachment'];
/** Body for renaming a conversation's customer. */
export type UpdateConversationNameBody = Schemas['UpdateConversationNameBody'];

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Outbound message request — a `text` or a `template` send. */
export type SendMessageBody = Schemas['SendMessageBody'];
/** Free-form text and/or attachment send. */
export type SendTextMessageBody = Schemas['SendTextMessageBody'];
/** Send from a published rich template. */
export type SendTemplateMessageBody = Schemas['SendTemplateMessageBody'];
/** Result of a synchronous send. */
export type SendMessageSuccess = Schemas['SendMessageSuccess'];
/** Channel-native (Apple MSP) passthrough send. */
export type SendRawChannelPayloadBody = Schemas['SendRawChannelPayloadBody'];

/** Per-send value for a declared template variable. */
export type TemplateVariableValue = NonNullable<
  SendTemplateMessageBody['message']['variables']
>[string];

// ---------------------------------------------------------------------------
// Initiations
// ---------------------------------------------------------------------------

/** A business-initiated conversation request. */
export type ConversationInitiation = Schemas['ConversationInitiation'];
/** Body for initiating a conversation with a customer. */
export type CreateConversationInitiation = Schemas['CreateConversationInitiation'];
/** A cursor-paginated page of initiations. */
export type ConversationInitiationList = Schemas['ConversationInitiationList'];

// ---------------------------------------------------------------------------
// Templates & rich assets
// ---------------------------------------------------------------------------

/** Summary row for a rich template. */
export type RichTemplateSummary = Schemas['RichTemplateSummary'];
/** Full rich template, including its definition. */
export type RichTemplateDetail = Schemas['RichTemplateDetail'];
/** The authored body of a rich template. */
export type RichTemplateDefinition = Schemas['RichTemplateDefinition'];
/** A page of rich templates. */
export type RichTemplateList = Schemas['RichTemplateList'];
/** Body for creating or editing a rich template. */
export type RichTemplateWriteBody = Schemas['RichTemplateWriteBody'];
/** Per-channel readiness of a template. */
export type RichChannelReadiness = Schemas['RichChannelReadiness'];
/** An uploaded rich-message asset. */
export type RichAssetItem = Schemas['RichAssetItem'];
/** A page of rich-message assets. */
export type RichAssetList = Schemas['RichAssetList'];

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** Result of streaming a media asset to storage. */
export type MediaUploadSuccess = Schemas['MediaUploadSuccess'];
/** A short-lived signed read URL for an attachment. */
export type MediaAccessUrlSuccess = Schemas['MediaAccessUrlSuccess'];

// ---------------------------------------------------------------------------
// Channels & admin
// ---------------------------------------------------------------------------

/** An active channel configured for the org. */
export type Channel = Schemas['Channel'];
/** The set of active channels for the org. */
export type ChannelListResponse = Schemas['ChannelListResponse'];
/** The authenticated business-admin context. */
export type AdminBusinessContext = Schemas['AdminBusinessContext'];
/** A messaging channel as seen by business admins. */
export type AdminBusinessChannel = Schemas['AdminBusinessChannel'];
/** Body for connecting a messaging channel to the business. */
export type AdminCreateBusinessChannelBody = Schemas['AdminCreateBusinessChannelBody'];
/** A member of the business. */
export type AdminBusinessMember = Schemas['AdminBusinessMember'];
/** A sandbox organization under the parent business. */
export type AdminSandboxListItem = Schemas['AdminSandboxListItem'];
/** Sandbox listing with its cap and current count. */
export type AdminSandboxList = Schemas['AdminSandboxList'];
/** Result of resyncing sandbox memberships from the parent org. */
export type AdminSandboxMemberSyncResult = Schemas['AdminSandboxMemberSyncResult'];
/** Business-level settings. */
export type BusinessSettings = Schemas['BusinessSettings'];
/** An integration (machine actor) belonging to the business. */
export type Integration = Schemas['Integration'];
/** An API key issued to an integration. */
export type IntegrationApiKey = Schemas['IntegrationApiKey'];
/** A webhook delivery attempt logged against an integration. */
export type IntegrationDelivery = Schemas['IntegrationDelivery'];
/** A named permission set. */
export type PermissionSetView = Schemas['PermissionSetView'];
/** Body for creating or updating a permission set. */
export type PermissionSetBody = Schemas['PermissionSetBody'];
/** A permission in the live catalog. */
export type CatalogPermission = Schemas['CatalogPermission'];
/** TikTok channel connection status. */
export type TikTokChannelStatus = Schemas['TikTokChannelStatus'];
/** Preview of a pending invitation. */
export type InvitationPreview = Schemas['InvitationPreview'];

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

/** `message.received` — a customer sent an inbound message. */
export type WebhookMessageReceivedEvent = Schemas['WebhookMessageReceivedEvent'];
/** The inbound message carried by a `message.received` event. */
export type WebhookMessageSummary = Schemas['WebhookMessageSummary'];
/** An attachment on an inbound webhook message. */
export type WebhookAttachment = Schemas['WebhookAttachment'];
/** `initiation.updated` — an initiation changed status. */
export type WebhookInitiationUpdatedEvent = Schemas['WebhookInitiationUpdatedEvent'];

/** Plain-text inbound content (`messageType: 'text'`). */
export type WebhookContentText = Schemas['WebhookContentText'];
/** Interactive-response content (`messageType: 'interactive'`). */
export type WebhookContentInteractiveResponse = Schemas['WebhookContentInteractiveResponse'];
/** One item a customer chose from a quick reply, list picker, or time picker. */
export type WebhookContentInteractiveSelectedItem =
  Schemas['WebhookContentInteractiveSelectedItem'];
/** One submitted page of a form response. */
export type WebhookContentInteractiveFormPageValue =
  Schemas['WebhookContentInteractiveFormPageValue'];
/** Tapback content (`messageType: 'tapback'`). */
export type WebhookContentTapback = Schemas['WebhookContentTapback'];
/** Opt-out content (`messageType: 'opt_out'`). */
export type WebhookContentOptOut = Schemas['WebhookContentOptOut'];
/** Typing content (`messageType: 'typing'` — reserved, not currently emitted). */
export type WebhookContentTyping = Schemas['WebhookContentTyping'];

/**
 * The `content` shape that goes with a given `messageType`.
 *
 * The spec discriminates `content` by its *sibling* `messageType`, which
 * TypeScript cannot narrow on its own — hence this mapping and the guards in
 * `@1440io/msp-webhooks` built over it.
 */
export type WebhookContentFor<T extends WebhookMessageType> = T extends 'text'
  ? WebhookContentText
  : T extends 'interactive'
    ? WebhookContentInteractiveResponse
    : T extends 'tapback'
      ? WebhookContentTapback
      : T extends 'opt_out'
        ? WebhookContentOptOut
        : T extends 'typing'
          ? WebhookContentTyping
          : never;

/** An inbound message narrowed to one `messageType`, with `content` to match. */
export type WebhookMessageOfType<T extends WebhookMessageType> = Omit<
  WebhookMessageSummary,
  'messageType' | 'content'
> & {
  messageType: T;
  content: WebhookContentFor<T>;
};

/** An inbound plain-text message. */
export type WebhookTextMessage = WebhookMessageOfType<'text'>;
/** A customer's reply to a rich message — quick reply, list picker, time picker, or form. */
export type WebhookInteractiveMessage = WebhookMessageOfType<'interactive'>;
/** A reaction to a message the business sent. */
export type WebhookTapbackMessage = WebhookMessageOfType<'tapback'>;
/** An opt-out. */
export type WebhookOptOutMessage = WebhookMessageOfType<'opt_out'>;

/** Which interactive prompt a customer answered. */
export type InteractiveResponseType = WebhookContentInteractiveResponse['responseType'];

/** Every interactive response type the spec declares. */
export const INTERACTIVE_RESPONSE_TYPES = [
  'quick_reply',
  'list_picker',
  'time_picker',
  'form',
  'invitation_accept',
  'other',
] as const satisfies readonly InteractiveResponseType[];

/** A stable rich-messaging reject reason code. */
export type RichReasonCode = RichReason['code'];

/**
 * Every rich-messaging reason code the spec declares.
 *
 * Production has been observed returning codes outside this set (for example
 * `message_type_mismatch` from the raw-send validator), so branch on the ones
 * you handle and treat an unrecognized code as a generic rejection rather than
 * assuming the list is exhaustive.
 */
export const RICH_REASON_CODES = [
  'duplicate_template_name',
  'template_not_found',
  'template_not_published',
  'template_archived',
  'template_delete_forbidden',
  'invalid_template_definition',
  'undeclared_variable_reference',
  'unsatisfiable_variable_type',
  'block_type_unsupported',
  'block_field_unsupported',
  'missing_asset',
  'payload_limit_exceeded',
  'conversation_not_eligible',
  'capability_not_supported',
  'missing_variable_value',
  'invalid_variable_value',
  'asset_load_failed',
  'construct_payload_failed',
  'wire_constraint_violated',
  'channel_gateway_failed',
  'duplicate_request_conflict',
  'asset_format_unsupported',
  'asset_format_mismatch',
  'asset_too_large',
  'asset_invalid_dimensions',
  'asset_in_use',
] as const satisfies readonly RichReasonCode[];

/** Every native message type a reason can be attributed to. */
export const RICH_NATIVE_TYPES = [
  'text',
  'quick_reply',
  'list_picker',
  'rich_link',
  'time_picker',
  'form',
  'imessage_app',
  'app_clip_rich_link',
] as const;

/** The native message shape a template resolves to on a channel. */
export type RichNativeType = NonNullable<RichChannelReadiness['resolvedNativeType']>;

/** Any webhook event the platform delivers, discriminated by `type`. */
export type WebhookEvent = WebhookMessageReceivedEvent | WebhookInitiationUpdatedEvent;

/** The `type` discriminator of a delivered webhook event. */
export type WebhookEventType = WebhookEvent['type'];

/** Narrow a {@link WebhookEvent} to one `type`. */
export type WebhookEventOfType<T extends WebhookEventType> = Extract<WebhookEvent, { type: T }>;

/** Map of event type to its event shape — handy for handler maps. */
export interface WebhookEventMap {
  'message.received': WebhookMessageReceivedEvent;
  'initiation.updated': WebhookInitiationUpdatedEvent;
}

// ---------------------------------------------------------------------------
// Enum vocabularies (runtime values for the spec's string unions)
// ---------------------------------------------------------------------------

/** The channel platform a conversation is carried over. */
export type ChannelPlatform = Conversation['channelPlatform'];

/** Every channel platform the spec declares, in spec order. */
export const CHANNEL_PLATFORMS = [
  'amb',
  'tiktok',
  'whatsapp',
  'rcs',
  'sms',
  'instagram',
  'facebook_messenger',
  'telegram',
  'line',
  'wechat',
  'email',
  'custom',
] as const satisfies readonly ChannelPlatform[];

/** Lifecycle status of a conversation. */
export type ConversationStatus = Conversation['status'];

/** Every conversation status the spec declares. */
export const CONVERSATION_STATUSES = [
  'active',
  'closed',
  'opted_out',
] as const satisfies readonly ConversationStatus[];

/** Who is currently handling a conversation. */
export type AgentStatus = Conversation['agentStatus'];

/** Every agent status the spec declares. */
export const AGENT_STATUSES = ['bot', 'live', 'closed'] as const satisfies readonly AgentStatus[];

/** Lifecycle status of a conversation initiation. */
export type InitiationStatus = ConversationInitiation['status'];

/** Every initiation status the spec declares. */
export const INITIATION_STATUSES = [
  'submitting',
  'submitted',
  'provider_rejected',
  'error',
  'accepted',
  'declined',
] as const satisfies readonly InitiationStatus[];

/** Initiation statuses that are terminal — no further transitions follow. */
export const TERMINAL_INITIATION_STATUSES = [
  'provider_rejected',
  'error',
  'accepted',
  'declined',
] as const satisfies readonly InitiationStatus[];

/** True when an initiation has reached a terminal status. */
export function isTerminalInitiationStatus(status: InitiationStatus): boolean {
  return (TERMINAL_INITIATION_STATUSES as readonly InitiationStatus[]).includes(status);
}

/** Machine-readable terminal reason on a failed initiation. */
export type InitiationReasonCode = ConversationInitiation['reasonCode'];

/** Publication state of a rich template. */
export type RichTemplateStatus = NonNullable<
  operations['adminListRichTemplates']['parameters']['query']
>['status'];

/** Every rich-template status the spec declares. */
export const RICH_TEMPLATE_STATUSES = ['draft', 'published', 'archived'] as const;

/** Rich-message usage slot an asset can fill. */
export type RichAssetUsage = NonNullable<
  operations['adminListRichAssets']['parameters']['query']
>['usage'];

/** Every rich-asset usage slot the spec declares. */
export const RICH_ASSET_USAGES = [
  'interactive_image',
  'rich_link_image',
  'imessage_app_icon',
  'app_clip_image',
] as const;

/** Channel-native message types accepted by the raw-payload send route. */
export type RawChannelMessageType = SendRawChannelPayloadBody['messageType'];

/** Every raw-payload message type the spec declares. */
export const RAW_CHANNEL_MESSAGE_TYPES = [
  'text',
  'quick_reply',
  'list_picker',
  'time_picker',
  'form',
  'imessage_app',
  'rich_link',
] as const satisfies readonly RawChannelMessageType[];

/** Message types that can arrive on a `message.received` webhook. */
export type WebhookMessageType = WebhookMessageSummary['messageType'];

/** Every inbound webhook message type the spec declares. */
export const WEBHOOK_MESSAGE_TYPES = [
  'text',
  'interactive',
  'tapback',
  'opt_out',
  'typing',
] as const satisfies readonly WebhookMessageType[];
