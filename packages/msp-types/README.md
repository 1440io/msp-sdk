# @1440io/msp-types

TypeScript types for the [1440](https://1440.io) Apple Messages for Business MSP API, generated from the OpenAPI 3.1 document with [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript).

```bash
npm install --save-dev @1440io/msp-types
```

You usually do not need to install this directly — [`@1440io/msp-api`](../msp-api) and [`@1440io/msp-webhooks`](../msp-webhooks) both depend on it and re-export what they use. Install it when you want the raw spec types in code that does not use either client.

## Curated aliases

The short names for the shapes you actually touch:

```ts
import type {
  Conversation,
  ConversationMessage,
  SendMessageBody,
  SendMessageSuccess,
  MessagingInvitation,
  RichTemplateDetail,
  WebhookEvent,
  WebhookMessageReceivedEvent,
  InboundMessage,
  InboundContent,
  InboundContentOfKind,
} from '@1440io/msp-types';
```

## Raw generated surface

Everything the spec declares, unmodified:

```ts
import type { components, operations, paths, webhooks } from '@1440io/msp-types';

type Conversation = components['schemas']['ConversationListItem'];
type SendParams = operations['sendConversationMessage'];
```

Or by name, through the helpers:

```ts
import type { Schema, Operation } from '@1440io/msp-types';

type Detail = Schema<'RichTemplateDetail'>;
type Send = Operation<'sendConversationMessage'>;
```

The complete generated module is also exported at `@1440io/msp-types/openapi`.

## Enum vocabularies

The spec declares its enums as string unions, which vanish at runtime. This package pairs each with a frozen array you can iterate, validate against, or drive a UI from:

```ts
import {
  CHANNEL_PLATFORMS,
  CONVERSATION_STATUSES,
  AGENT_STATUSES,
  INVITATION_STATUSES,
  TERMINAL_INVITATION_STATUSES,
  RICH_TEMPLATE_STATUSES,
  RICH_TEMPLATE_TYPES,
  RICH_ASSET_USAGES,
  RICH_REASON_CODES,
  INBOUND_CONTENT_KINDS,
  INTERACTIVE_CONTENT_KINDS,
  DEVICE_CAPABILITIES,
  isTerminalInvitationStatus,
} from '@1440io/msp-types';

if (isTerminalInvitationStatus(invitation.status)) {
  // No further transitions are coming.
}
```

Each array is `satisfies readonly T[]`, so if the spec adds a value and the array is not updated, the build fails rather than drifting quietly.

## Regenerating

```bash
npm run generate   # from the repo root
```

`src/openapi.ts` is generated wholesale from `spec/1440-cloud-openapi.json` — never hand-edit it. Curated aliases live in `src/index.ts`.

## License

MIT
