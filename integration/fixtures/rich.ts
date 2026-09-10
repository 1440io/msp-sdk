import type { RichTemplateWriteBody, SendRawMessageBody } from '@1440io/msp-types';

/**
 * Builders for rich templates and channel content.
 *
 * Shared by the payload-validation, template-lifecycle, send, and round-trip
 * suites so one definition drives them all.
 */

const bubble = (title: string, subtitle: string | null = null) => ({
  style: 'small' as const,
  title,
  subtitle,
  imageSlot: null,
});

/** Canonical quick reply — renders on any channel that supports one. */
export function quickReplyTemplate(name: string): RichTemplateWriteBody {
  return {
    name,
    definition: {
      mode: 'canonical',
      block: {
        kind: 'quick_reply',
        summaryText: 'How did we do?',
        items: [
          { id: 'great', title: 'Great' },
          { id: 'ok', title: 'OK' },
          { id: 'poor', title: 'Poor' },
        ],
      },
      variables: [],
    },
    slotBindings: [],
  };
}

/** Canonical text with one required variable. */
export function textTemplate(name: string, variableName = 'customerName'): RichTemplateWriteBody {
  return {
    name,
    definition: {
      mode: 'canonical',
      block: { kind: 'text', body: `Hello {{${variableName}}} — integration test.` },
      variables: [{ name: variableName, type: 'text', required: true, itemSchema: null }],
    },
    slotBindings: [],
  };
}

/** Native AMB list picker whose items are supplied per send. */
export function listPickerTemplate(name: string, itemsVariable = 'options'): RichTemplateWriteBody {
  return {
    name,
    definition: {
      mode: 'native',
      channel: 'amb',
      content: {
        kind: 'list_picker',
        receivedBubble: bubble('Choose an option', 'Integration test'),
        replyBubble: bubble('You chose'),
        sections: [{ title: 'Options', multipleSelection: false, items: null, itemsVariable }],
      },
      variables: [
        { name: itemsVariable, type: 'collection', required: true, itemSchema: 'list_picker_item' },
      ],
    },
    slotBindings: [],
  };
}

/** Native AMB list picker with fixed items baked into the definition. */
export function staticListPickerTemplate(name: string): RichTemplateWriteBody {
  return {
    name,
    definition: {
      mode: 'native',
      channel: 'amb',
      content: {
        kind: 'list_picker',
        receivedBubble: bubble('Pick a size'),
        replyBubble: bubble('You picked'),
        sections: [
          {
            title: 'Sizes',
            multipleSelection: false,
            items: [
              { id: 'small', title: 'Small', subtitle: null, imageSlot: null },
              { id: 'large', title: 'Large', subtitle: null, imageSlot: null },
            ],
            itemsVariable: null,
          },
        ],
      },
      variables: [],
    },
    slotBindings: [],
  };
}

/** Native AMB time picker whose slots are supplied per send. */
export function timePickerTemplate(
  name: string,
  timeslotsVariable = 'slots',
): RichTemplateWriteBody {
  return {
    name,
    definition: {
      mode: 'native',
      channel: 'amb',
      content: {
        kind: 'time_picker',
        receivedBubble: bubble('Pick a time'),
        replyBubble: bubble('Booked'),
        event: { title: 'Integration test appointment', timezoneOffset: 0, location: null },
        timeslots: null,
        timeslotsVariable,
      },
      variables: [
        { name: timeslotsVariable, type: 'collection', required: true, itemSchema: 'timeslot' },
      ],
    },
    slotBindings: [],
  };
}

/**
 * Native AMB authentication template — new in this spec revision.
 *
 * Sending one starts an OAuth flow on the device; the outcome arrives as an
 * `amb.authentication_response`.
 */
export function authenticationTemplate(name: string): RichTemplateWriteBody {
  return {
    name,
    definition: {
      mode: 'native',
      channel: 'amb',
      content: {
        kind: 'authentication',
        receivedBubble: bubble('Sign in to continue'),
        replyBubble: bubble('Signed in'),
        scope: ['openid'],
        redirectURI: 'https://example.com/oauth/callback',
      },
      variables: [],
    },
    slotBindings: [],
  } as RichTemplateWriteBody;
}

/** A template referencing a variable it never declares — must be rejected. */
export function undeclaredVariableTemplate(name: string): RichTemplateWriteBody {
  return {
    name,
    definition: {
      mode: 'canonical',
      block: { kind: 'text', body: 'Hello {{neverDeclared}}.' },
      variables: [],
    },
    slotBindings: [],
  };
}

/** A template binding an image slot with no asset behind it. */
export function missingAssetTemplate(name: string): RichTemplateWriteBody {
  return {
    name,
    definition: {
      mode: 'native',
      channel: 'amb',
      content: {
        kind: 'list_picker',
        receivedBubble: { style: 'large', title: 'With a hero image', subtitle: null, imageSlot: 'hero' },
        replyBubble: bubble('Chosen'),
        sections: [
          {
            title: 'Options',
            multipleSelection: false,
            items: [{ id: 'a', title: 'A', subtitle: null, imageSlot: null }],
            itemsVariable: null,
          },
        ],
      },
      variables: [],
    },
    slotBindings: [], // `hero` is referenced but never bound
  };
}

// ── Channel content for the raw send route ───────────────────────────────────

type RawContent = SendRawMessageBody['content'];

/** Plain text channel content. */
export function rawText(body: string, subject?: string): RawContent {
  return { kind: 'text', body, ...(subject ? { subject } : {}) } as RawContent;
}

/**
 * A quick reply.
 *
 * The spec pins items to 2–5 — a bound that used to be documented as 1–5 while
 * Apple rejected a single item with a gateway 400.
 */
export function rawQuickReply(
  items = [
    { identifier: 'yes', title: 'Yes' },
    { identifier: 'no', title: 'No' },
  ],
  summaryText = 'Integration test — pick one',
): RawContent {
  return { kind: 'amb.quick_reply', data: { 'quick-reply': { summaryText, items } } } as RawContent;
}

/**
 * A list picker with one section.
 *
 * `receivedMessage` and `replyMessage` are required siblings of `data` on this
 * kind — the bubbles are no longer nested inside the Apple payload.
 */
export function rawListPicker(): RawContent {
  return {
    kind: 'amb.list_picker',
    data: {
      listPicker: {
        sections: [
          {
            title: 'Options',
            order: 0,
            multipleSelection: false,
            items: [
              { identifier: 'one', title: 'Option one', order: 0 },
              { identifier: 'two', title: 'Option two', order: 1 },
            ],
          },
        ],
      },
    },
    receivedMessage: { style: 'small', title: 'Choose an option' },
    replyMessage: { style: 'small', title: 'You chose' },
  } as RawContent;
}
