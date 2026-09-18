import { describe, expect, it } from 'vitest';
import type { InboundContent, InboundMessage } from '@1440io/msp-types';
import {
  authenticationStatus,
  formAnswers,
  isInteractiveResponse,
  isKind,
  isPrivateForm,
  isRedacted,
  isVisible,
  parseAppleTimestamp,
  respondsTo,
  selectedIds,
  selectedTimeslot,
  selectedTitles,
  sessionOf,
  textBody,
} from '../src/index.js';

/** An inbound message with the boilerplate filled in. */
function message(
  content: unknown,
  overrides: Record<string, unknown> = {},
): InboundMessage {
  return {
    id: '0196f1f8-4a2b-7a31-8f5c-0d9e7b6a9012',
    channel: 'amb',
    externalId: 'urn:mbid:AQAAY',
    createdAt: '2026-07-20T14:30:00.000Z',
    attachments: [],
    actor: { type: 'customer' },
    redacted: false,
    content,
    ...overrides,
  } as InboundMessage;
}

const content = (c: unknown) => message(c).content as InboundContent;

describe('content narrowing', () => {
  it('narrows text natively on the kind tag', () => {
    const c = content({ kind: 'text', body: 'I need help', subject: 'Order 12' });

    // The union is discriminated by `kind`, so no guard is needed for this.
    expect(c?.kind).toBe('text');
    if (c?.kind === 'text') expect(c.body).toBe('I need help');
    expect(textBody(c)).toBe('I need help');
  });

  it('returns null from textBody for non-text content', () => {
    expect(textBody(content({ kind: 'opt_out' }))).toBeNull();
  });

  it('recognizes an opt-out', () => {
    expect(isKind(content({ kind: 'opt_out' }), 'opt_out')).toBe(true);
  });

  it('separates interactive replies from plain messages', () => {
    expect(isInteractiveResponse(content({ kind: 'text', body: 'x' }))).toBe(false);
    expect(isInteractiveResponse(content({ kind: 'opt_out' }))).toBe(false);
    expect(
      isInteractiveResponse(content({ kind: 'amb.quick_reply_response', data: {} })),
    ).toBe(true);
  });

  it('narrows a redacted message, and tells the compiler content is null', () => {
    const visible = message({ kind: 'text', body: 'x' });
    const withheld = message(null, { redacted: true });

    expect(isRedacted(visible)).toBe(false);
    expect(isRedacted(withheld)).toBe(true);

    // `redacted` and `content` move together, so narrowing on one settles the
    // other — no null check needed after the guard.
    if (isVisible(visible)) expect(visible.content.kind).toBe('text');
    if (isRedacted(withheld)) expect(withheld.content).toBeNull();
  });

  it('keeps the readers safe on a redacted message', () => {
    const withheld = message(null, { redacted: true });

    expect(textBody(withheld.content)).toBeNull();
    expect(selectedIds(withheld.content)).toEqual([]);
    expect(respondsTo(withheld.content)).toBeNull();
    expect(formAnswers(withheld.content)).toEqual({});
  });
});

describe('quick reply responses', () => {
  const reply = content({
    kind: 'amb.quick_reply_response',
    sessionIdentifier: 'sess-1',
    data: {
      requestIdentifier: 'req-1',
      'quick-reply': {
        selectedIndex: 1,
        selectedIdentifier: 'no',
        items: [
          { identifier: 'yes', title: 'Yes please' },
          { identifier: 'no', title: 'No thanks' },
        ],
      },
    },
  });

  it('reads the chosen id out of the hyphenated Apple key', () => {
    expect(selectedIds(reply)).toEqual(['no']);
  });

  it('resolves the title by matching the selected identifier', () => {
    // The payload lists every item, not just the chosen one.
    expect(selectedTitles(reply)).toEqual(['No thanks']);
  });

  it('correlates back to the originating send', () => {
    expect(respondsTo(reply)).toBe('req-1');
    expect(sessionOf(reply)).toBe('sess-1');
  });

  it('survives a payload with no selection', () => {
    expect(selectedIds(content({ kind: 'amb.quick_reply_response', data: {} }))).toEqual([]);
    expect(selectedTitles(content({ kind: 'amb.quick_reply_response', data: {} }))).toEqual([]);
  });
});

describe('list picker responses', () => {
  it('flattens selections across sections, in order', () => {
    const c = content({
      kind: 'amb.list_picker_response',
      data: {
        requestIdentifier: 'req-2',
        listPicker: {
          sections: [
            { title: 'Sizes', items: [{ identifier: 'small', title: 'Small' }] },
            { title: 'Extras', items: [{ identifier: 'olives', title: 'Olives' }, { identifier: 'basil' }] },
          ],
        },
      },
    });

    expect(selectedIds(c)).toEqual(['small', 'olives', 'basil']);
    // The item with no title is dropped rather than stringified.
    expect(selectedTitles(c)).toEqual(['Small', 'Olives']);
  });
});

describe('time picker responses', () => {
  const c = content({
    kind: 'amb.time_picker_response',
    data: {
      requestIdentifier: 'req-3',
      event: {
        identifier: 'evt-1',
        title: 'Appointment',
        timeslots: [{ identifier: 'slot-2', startTime: '2026-08-25T23:55+0000', duration: 1800 }],
      },
    },
  });

  it('returns the chosen slot as a real instant', () => {
    const slot = selectedTimeslot(c);

    expect(slot?.id).toBe('slot-2');
    expect(slot?.startsAt.toISOString()).toBe('2026-08-25T23:55:00.000Z');
    expect(slot?.durationSeconds).toBe(1800);
  });

  it('exposes the slot id through selectedIds too', () => {
    expect(selectedIds(c)).toEqual(['slot-2']);
  });

  it('returns null for content carrying no slot', () => {
    expect(selectedTimeslot(content({ kind: 'text', body: 'x' }))).toBeNull();
    expect(selectedTimeslot(content({ kind: 'amb.time_picker_response', data: {} }))).toBeNull();
  });
});

describe('form responses', () => {
  const c = content({
    kind: 'amb.form_response',
    data: {
      requestIdentifier: 'req-4',
      dynamic: {
        version: '1.2',
        template: 'messageForms',
        private: false,
        selections: [
          {
            pageIdentifier: 'name',
            items: [{ identifier: 'full', type: 'input', title: 'Name', value: 'Ada Lovelace' }],
          },
          {
            pageIdentifier: 'toppings',
            items: [
              { identifier: 'a', type: 'select', title: 'Olives', value: 'yes' },
              { identifier: 'b', type: 'select', title: 'Basil', value: 'no' },
            ],
          },
        ],
      },
    },
  });

  it('groups answers by page identifier', () => {
    const answers = formAnswers(c);

    expect(Object.keys(answers)).toEqual(['name', 'toppings']);
    expect(answers['name']).toEqual([
      { id: 'full', title: 'Name', value: 'Ada Lovelace', type: 'input' },
    ]);
    expect(answers['toppings']).toHaveLength(2);
  });

  it('flags a private form so its values are not logged', () => {
    expect(isPrivateForm(c)).toBe(false);
    const privateForm = content({
      kind: 'amb.form_response',
      data: { dynamic: { version: '1.2', template: 'messageForms', private: true, selections: [] } },
    });
    expect(isPrivateForm(privateForm)).toBe(true);
  });

  it('returns an empty map for non-form content', () => {
    expect(formAnswers(content({ kind: 'text', body: 'x' }))).toEqual({});
  });
});

describe('authentication responses', () => {
  it('reports the OAuth outcome', () => {
    const c = content({
      kind: 'amb.authentication_response',
      data: { requestIdentifier: 'req-5', authenticate: { status: 'success' } },
    });

    expect(authenticationStatus(c)).toBe('success');
    expect(respondsTo(c)).toBe('req-5');
  });

  it('reports a failure with its error code intact', () => {
    const c = content({
      kind: 'amb.authentication_response',
      data: { authenticate: { status: 'failure', error_code: 'access_denied' } },
    });

    expect(authenticationStatus(c)).toBe('failure');
  });

  it('returns null for content that is not an authentication reply', () => {
    expect(authenticationStatus(content({ kind: 'text', body: 'x' }))).toBeNull();
  });
});

describe('invitation responses', () => {
  it('correlates from the top level rather than from data', () => {
    const c = content({
      kind: 'amb.invitation_response',
      result: 'accepted',
      requestIdentifier: 'req-6',
      sessionIdentifier: null,
    });

    // This variant puts requestIdentifier on the content, not under data.
    expect(respondsTo(c)).toBe('req-6');
    expect(sessionOf(c)).toBeNull();
  });
});

describe('correlation edge cases', () => {
  it('returns null when the channel made no correlation promise', () => {
    expect(respondsTo(content({ kind: 'text', body: 'x' }))).toBeNull();
    expect(respondsTo(content({ kind: 'amb.imessage_app_response', bid: 'com.example' }))).toBeNull();
  });

  it('returns null for redacted content', () => {
    expect(respondsTo(null as unknown as InboundContent)).toBeNull();
  });
});

describe('Apple time-picker timestamps', () => {
  it('parses the format the spec now pins', () => {
    // The spec documents ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\+0000$ — not RFC 3339.
    expect(parseAppleTimestamp('2026-08-25T23:55+0000')!.toISOString()).toBe(
      '2026-08-25T23:55:00.000Z',
    );
  });

  it('parses a non-UTC basic offset', () => {
    expect(parseAppleTimestamp('2026-08-25T18:55-0500')!.toISOString()).toBe(
      '2026-08-25T23:55:00.000Z',
    );
  });

  it('still parses proper RFC 3339, in case the server changes', () => {
    expect(parseAppleTimestamp('2026-08-25T23:55:30Z')!.toISOString()).toBe(
      '2026-08-25T23:55:30.000Z',
    );
  });

  it('produces a string strict parsers accept', () => {
    expect(parseAppleTimestamp('2026-08-25T23:55+0000')!.toISOString()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('returns null rather than an Invalid Date', () => {
    for (const bad of [null, undefined, '', 'not a timestamp']) {
      expect(parseAppleTimestamp(bad)).toBeNull();
    }
  });
});
