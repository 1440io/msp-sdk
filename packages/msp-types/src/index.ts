/**
 * `@1440io/msp-types` — types for the 1440 Apple Messages for Business MSP API.
 *
 * `./openapi` holds the raw generated surface (`paths`, `webhooks`, `components`,
 * `operations`), regenerated from `spec/1440-cloud-openapi.json` by
 * `npm run generate`. This module re-exports it and adds the short, stable
 * aliases the SDK and its consumers reach for, plus runtime vocabularies for
 * the spec's string unions.
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

/** Canonical error envelope returned by most non-2xx responses. */
export type ErrorResponse = Schemas['ErrorResponse'];
/** Error envelope for the messaging send routes. */
export type SendMessageError = Schemas['SendMessageError'];
/** A stable machine-readable rich-messaging reject reason. */
export type RichReason = Schemas['RichReason'];
/** Error envelope carrying rich reasons (template and asset conflicts). */
export type RichReasonsError = Schemas['RichReasonsError'];

/** One field-level problem from a `validation_failed` send rejection. */
export interface ValidationIssue {
  path: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Result of exchanging an integration API key for a short-lived access JWT. */
export type IntegrationTokenResponse = Schemas['IntegrationTokenResponse'];
/** The display-only authorization grant carried alongside a minted token. */
export type ActorGrant = Schemas['ActorGrant'];

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/** A conversation summary row. */
export type Conversation = Schemas['ConversationListItem'];
/** A conversation together with its window of messages. */
export type ConversationDetail = Schemas['ConversationDetailResponse'];
/** A cursor-paginated page of conversation summaries. */
export type ConversationListResponse = Schemas['ConversationListResponse'];
/** Body for renaming a conversation's customer. */
export type UpdateConversationNameBody = Schemas['UpdateConversationNameBody'];

/** A stored message, as the conversation-detail route returns it. */
export type ConversationMessage = NonNullable<ConversationDetail['messages']>[number];

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Outbound message request — `text`, `template`, or `authentication`. */
export type SendMessageBody = Schemas['SendMessageBody'];
/** Free-form text and/or attachment send. */
export type SendTextMessageBody = Schemas['SendTextMessageBody'];
/** Send from a published rich template. */
export type SendTemplateMessageBody = Schemas['SendTemplateMessageBody'];
/** Send an authentication (OAuth) request from a published template. */
export type SendAuthenticationMessageBody = Schemas['SendAuthenticationMessageBody'];
/** Channel-native passthrough send. */
export type SendRawMessageBody = Schemas['SendRawMessageBody'];
/** Result of a send. */
export type SendMessageSuccess = Schemas['SendMessageSuccess'];

/** Per-send value for a declared template variable. */
export type TemplateVariableValue = NonNullable<SendTemplateMessageBody['variables']>[string];

// ---------------------------------------------------------------------------
// Messaging invitations
// ---------------------------------------------------------------------------

/** A business-initiated messaging invitation. */
export type MessagingInvitation = Schemas['MessagingInvitation'];
/** Body for inviting a customer into a conversation. */
export type CreateMessagingInvitation = Schemas['CreateMessagingInvitation'];
/** A cursor-paginated page of messaging invitations. */
export type MessagingInvitationList = Schemas['MessagingInvitationList'];
/** Error envelope for the invitation routes. */
export type MessagingInvitationError = Schemas['MessagingInvitationError'];
/** Validation error for an invitation request. */
export type MessagingInvitationRequestError = Schemas['MessagingInvitationRequestError'];
/** The invitation body exceeded its size cap. */
export type MessagingInvitationBodyCapError = Schemas['MessagingInvitationBodyCapError'];
/** The channel refused or failed to deliver the invitation. */
export type MessagingInvitationSendFailure = Schemas['MessagingInvitationSendFailure'];

/** Lifecycle status of a messaging invitation. */
export type InvitationStatus = MessagingInvitation['status'];

/** Every invitation status the spec declares. */
export const INVITATION_STATUSES = [
  'submitting',
  'submitted',
  'provider_rejected',
  'error',
  'accepted',
  'declined',
] as const satisfies readonly InvitationStatus[];

/** Invitation statuses that are terminal — no further transitions follow. */
export const TERMINAL_INVITATION_STATUSES = [
  'provider_rejected',
  'error',
  'accepted',
  'declined',
] as const satisfies readonly InvitationStatus[];

/** True when an invitation has reached a terminal status. */
export function isTerminalInvitationStatus(status: InvitationStatus): boolean {
  return (TERMINAL_INVITATION_STATUSES as readonly InvitationStatus[]).includes(status);
}

/** Machine-readable terminal reason on a failed invitation. */
export type InvitationReasonCode = MessagingInvitation['reasonCode'];

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

/** Publication state of a rich template. */
export type RichTemplateStatus = RichTemplateSummary['status'];

/** Every rich-template status the spec declares. */
export const RICH_TEMPLATE_STATUSES = [
  'draft',
  'published',
  'archived',
] as const satisfies readonly RichTemplateStatus[];

/** The kind of message a template produces. */
export type RichTemplateType = NonNullable<
  operations['adminListRichTemplates']['parameters']['query']
>['templateType'];

/** Every template type the spec declares. */
export const RICH_TEMPLATE_TYPES = [
  'text',
  'quick_reply',
  'list_picker',
  'rich_link',
  'time_picker',
  'form',
  'imessage_app',
  'app_clip_rich_link',
  'authentication',
] as const;

/** Rich-message usage slot an asset can fill. */
export type RichAssetUsage = RichAssetItem['usage'];

/** Every rich-asset usage slot the spec declares. */
export const RICH_ASSET_USAGES = [
  'rich_image_200',
  'rich_icon_15',
] as const satisfies readonly RichAssetUsage[];

/** A stable rich-messaging reject reason code. */
export type RichReasonCode = RichReason['code'];

/**
 * Every rich-messaging reason code the spec declares.
 *
 * Treat an unrecognized code as a generic rejection: production has been seen
 * returning codes outside this set.
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
  'template_type_mismatch',
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

// ---------------------------------------------------------------------------
// Media, channels, admin
// ---------------------------------------------------------------------------

/** Result of streaming a media asset to storage. */
export type MediaUploadSuccess = Schemas['MediaUploadSuccess'];
/** A short-lived signed read URL for an attachment. */
export type MediaAccessUrlSuccess = Schemas['MediaAccessUrlSuccess'];
/** An active channel configured for the org. */
export type Channel = Schemas['Channel'];
/** The set of active channels for the org. */
export type ChannelListResponse = Schemas['ChannelListResponse'];
/** A messaging channel as business admins see it. */
export type AdminBusinessChannel = Schemas['AdminBusinessChannel'];
/** Business-level settings. */
export type BusinessSettings = Schemas['BusinessSettings'];
/** TikTok channel connection status. */
export type TikTokChannelStatus = Schemas['TikTokChannelStatus'];

/**
 * The channel platform a conversation is carried over.
 *
 * Conversations are AMB-only in this spec revision, even though the channel
 * registry still recognizes more platforms — see {@link ChannelListPlatform}.
 */
export type ChannelPlatform = Conversation['channelPlatform'];

/** A platform the channel registry recognizes. */
export type ChannelListPlatform = Channel['platform'];

/** Every platform the channel registry declares. */
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
] as const satisfies readonly ChannelListPlatform[];

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

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

/** `message.received` — a customer sent an inbound message. */
export type WebhookMessageReceivedEvent = Schemas['WebhookMessageReceivedEvent'];
/** `messaging_invitation.updated` — an invitation changed status. */
export type WebhookMessagingInvitationUpdatedEvent =
  Schemas['WebhookMessagingInvitationUpdatedEvent'];

/** Any webhook event the platform delivers, discriminated by `type`. */
export type WebhookEvent = WebhookMessageReceivedEvent | WebhookMessagingInvitationUpdatedEvent;

/** The `type` discriminator of a delivered webhook event. */
export type WebhookEventType = WebhookEvent['type'];

/** Narrow a {@link WebhookEvent} to one `type`. */
export type WebhookEventOfType<T extends WebhookEventType> = Extract<WebhookEvent, { type: T }>;

/** Map of event type to its event shape — handy for handler maps. */
export interface WebhookEventMap {
  'message.received': WebhookMessageReceivedEvent;
  'messaging_invitation.updated': WebhookMessagingInvitationUpdatedEvent;
}

/** The invitation transition carried by a `messaging_invitation.updated` event. */
export type InvitationTransition = WebhookMessagingInvitationUpdatedEvent['messagingInvitation'];

/** The inbound message carried by a `message.received` event. */
export type InboundMessage = WebhookMessageReceivedEvent['message'];

/** An attachment on an inbound message. */
export type InboundAttachment = NonNullable<InboundMessage['attachments']>[number];

/**
 * Inbound message content, discriminated by `kind`.
 *
 * Unlike the previous spec, `content` is now a proper tagged union, so
 * `content.kind === 'text'` narrows on its own.
 */
export type InboundContent = InboundMessage['content'];

/** The `kind` tag on inbound content. */
export type InboundContentKind = NonNullable<InboundContent>['kind'];

/** Narrow inbound content to one `kind`. */
export type InboundContentOfKind<K extends InboundContentKind> = Extract<
  NonNullable<InboundContent>,
  { kind: K }
>;

/** Every inbound content kind the spec declares. */
export const INBOUND_CONTENT_KINDS = [
  'text',
  'opt_out',
  'amb.quick_reply_response',
  'amb.list_picker_response',
  'amb.time_picker_response',
  'amb.form_response',
  'amb.authentication_response',
  'amb.imessage_app_response',
  'amb.invitation_response',
  'amb.unrecognized_interactive_response',
] as const;

/** The kinds that represent a customer answering a rich message. */
export const INTERACTIVE_CONTENT_KINDS = [
  'amb.quick_reply_response',
  'amb.list_picker_response',
  'amb.time_picker_response',
  'amb.form_response',
  'amb.authentication_response',
  'amb.imessage_app_response',
  'amb.invitation_response',
  'amb.unrecognized_interactive_response',
] as const;

/**
 * A rich-messaging capability the customer's device has advertised.
 *
 * Carried on `message.received` as `capabilityList`. Sending a rich message a
 * device has not advertised support for is rejected, so this is the signal to
 * check before choosing a template.
 */
export type DeviceCapability = NonNullable<WebhookMessageReceivedEvent['capabilityList']>[number];

/** Every device capability the spec declares. */
export const DEVICE_CAPABILITIES = [
  'QUICK',
  'LIST',
  'TIME',
  'AUTH',
  'AUTH2',
  'FORM',
] as const satisfies readonly DeviceCapability[];

/** Outcome of an authentication (OAuth) request. */
export type AuthenticationStatus = 'success' | 'failure' | 'cancel' | 'unknown';
