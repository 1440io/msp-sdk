import type { RichTemplateWriteBody } from '@1440io/msp-types';

/**
 * Builders for rich templates and Apple MSP payloads.
 *
 * Kept here rather than inline so the same definitions drive the validation,
 * template-lifecycle, send, and round-trip suites.
 */

/** The balloon plugin id every AMB interactive payload carries. */
export const AMB_INTERACTIVE_BID =
  'com.apple.messages.MSMessageExtensionBalloonPlugin:0000000000:com.apple.icloud.apps.messages.business.extension';

const bubble = (title: string, subtitle: string | null = null) => ({
  style: 'small' as const,
  title,
  subtitle,
  imageSlot: null,
});

/** Canonical quick reply — renders on every channel that supports one. */
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
        sections: [
          { title: 'Options', multipleSelection: false, items: null, itemsVariable },
        ],
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

/** A template binding an image slot with no asset behind it — must be rejected. */
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

// ── Raw Apple MSP payloads ───────────────────────────────────────────────────

/**
 * A well-formed AMB quick reply payload.
 *
 * The subtype marker is `quick-reply` — hyphenated, unlike `listPicker`. The
 * camelCase spelling is rejected with `message_type_mismatch`, which is easy
 * to mistake for a problem with the items.
 *
 * Item count: the spec says 1–5, but Apple rejects a single-item quick reply
 * with a gateway 400 (surfaced as a 502 `provider_rejected`). Use two or more.
 */
export function rawQuickReply(
  items = [
    { identifier: 'yes', title: 'Yes' },
    { identifier: 'no', title: 'No' },
  ],
) {
  return {
    type: 'interactive',
    interactiveData: {
      bid: AMB_INTERACTIVE_BID,
      data: {
        version: '1.0',
        'quick-reply': { summaryText: 'Integration test — pick one', items },
      },
    },
  };
}

/** The camelCase spelling of the quick-reply marker, which the platform rejects. */
export function rawQuickReplyWrongMarker() {
  return {
    type: 'interactive',
    interactiveData: {
      bid: AMB_INTERACTIVE_BID,
      data: {
        version: '1.0',
        quickReply: {
          summaryText: 'Integration test — pick one',
          items: [{ identifier: 'yes', title: 'Yes' }],
        },
      },
    },
  };
}

/** A well-formed AMB list picker payload. */
export function rawListPicker() {
  return {
    type: 'interactive',
    interactiveData: {
      bid: AMB_INTERACTIVE_BID,
      data: {
        version: '1.0',
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
        received: { style: 'small', title: 'Choose an option' },
        reply: { style: 'small', title: 'You chose' },
      },
    },
  };
}

/**
 * The documented pitfall: a list picker section using `listPickerItem` instead
 * of `items`. The platform has a capture-backed guard for exactly this.
 */
export function rawListPickerWithWrongItemKey() {
  const payload = rawListPicker();
  const section = payload.interactiveData.data.listPicker!.sections[0] as Record<string, unknown>;
  section['listPickerItem'] = section['items'];
  delete section['items'];
  return payload;
}

/** A plain AMB text payload. */
export function rawText(body: string) {
  return { type: 'text', body };
}
