import { describe, expect, it } from 'vitest';
import type { WebhookMessageSummary } from '@1440io/msp-types';
import {
  formValuesByPage,
  isInteractiveMessage,
  isOptOutMessage,
  isTapbackMessage,
  isTextMessage,
  parseAppleTimestamp,
  respondsTo,
  selectedIds,
  selectedStartTime,
  selectedTitles,
} from '../src/index.js';

/** Build a message summary with the boilerplate filled in. */
function message(overrides: Partial<WebhookMessageSummary>): WebhookMessageSummary {
  return {
    id: '0196f1f8-4a2b-7a31-8f5c-0d9e7b6a9012',
    conversationId: '0196f1f8-4a2b-7a31-8f5c-0d9e7b6a5678',
    channelPlatform: 'amb',
    messageType: 'text',
    content: { body: 'hello' },
    timestamp: '2026-07-20T14:30:00.000Z',
    intentId: null,
    groupId: null,
    locale: 'en-US',
    richRequestIdentifier: null,
    attachments: [],
    ...overrides,
  } as WebhookMessageSummary;
}

const interactive = (
  content: Partial<Extract<WebhookMessageSummary['content'], { responseType: string }>>,
) =>
  message({
    messageType: 'interactive',
    content: {
      responseType: 'quick_reply',
      requestIdentifier: null,
      sessionIdentifier: null,
      selections: [],
      selectedStartTime: null,
      formValues: [],
      private: false,
      ...content,
    },
  } as Partial<WebhookMessageSummary>);

describe('message narrowing', () => {
  it('narrows a text message to its body', () => {
    const msg = message({ messageType: 'text', content: { body: 'I need help' } });

    expect(isTextMessage(msg)).toBe(true);
    if (isTextMessage(msg)) {
      // The whole point: no cast needed to reach content.body.
      expect(msg.content.body).toBe('I need help');
    }
    expect(isInteractiveMessage(msg)).toBe(false);
  });

  it('narrows an interactive reply to its response fields', () => {
    const msg = interactive({ responseType: 'list_picker' });

    expect(isInteractiveMessage(msg)).toBe(true);
    if (isInteractiveMessage(msg)) {
      expect(msg.content.responseType).toBe('list_picker');
      expect(msg.content.selections).toEqual([]);
    }
  });

  it('narrows a tapback to its target', () => {
    const msg = message({
      messageType: 'tapback',
      content: { kind: 'love', targetMessageId: 'abc' },
    } as Partial<WebhookMessageSummary>);

    expect(isTapbackMessage(msg)).toBe(true);
    if (isTapbackMessage(msg)) {
      expect(msg.content.targetMessageId).toBe('abc');
      expect(msg.content.kind).toBe('love');
    }
  });

  it('narrows an opt-out to its reason', () => {
    const msg = message({
      messageType: 'opt_out',
      content: { reason: 'unsubscribe' },
    } as Partial<WebhookMessageSummary>);

    expect(isOptOutMessage(msg)).toBe(true);
    if (isOptOutMessage(msg)) expect(msg.content.reason).toBe('unsubscribe');
  });

  it('keeps the guards mutually exclusive', () => {
    const msg = interactive({});

    expect([isTextMessage(msg), isTapbackMessage(msg), isOptOutMessage(msg)]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('quick reply responses', () => {
  it('reads the single chosen item', () => {
    const msg = interactive({
      responseType: 'quick_reply',
      requestIdentifier: 'req-1',
      selections: [{ id: 'yes', title: 'Yes, please' }],
    });

    if (!isInteractiveMessage(msg)) throw new Error('expected interactive');
    expect(selectedIds(msg.content)).toEqual(['yes']);
    expect(selectedTitles(msg.content)).toEqual(['Yes, please']);
    expect(respondsTo(msg)).toBe('req-1');
  });
});

describe('list picker responses', () => {
  it('reads several chosen items in order', () => {
    const msg = interactive({
      responseType: 'list_picker',
      selections: [
        { id: 'sku-1', title: 'Small' },
        { id: 'sku-3', title: 'Large' },
      ],
    });

    if (!isInteractiveMessage(msg)) throw new Error('expected interactive');
    expect(selectedIds(msg.content)).toEqual(['sku-1', 'sku-3']);
  });

  it('survives a channel that echoes no titles', () => {
    const msg = interactive({
      responseType: 'list_picker',
      selections: [
        { id: 'sku-1', title: null },
        { id: 'sku-2', title: 'Medium' },
      ],
    });

    if (!isInteractiveMessage(msg)) throw new Error('expected interactive');
    expect(selectedIds(msg.content)).toEqual(['sku-1', 'sku-2']);
    expect(selectedTitles(msg.content)).toEqual(['Medium']); // nulls dropped, not stringified
  });
});

describe('time picker responses', () => {
  it('exposes the chosen slot and its start time', () => {
    const msg = interactive({
      responseType: 'time_picker',
      selections: [{ id: 'slot-2', title: 'Tue 2:00 PM' }],
      selectedStartTime: '2026-08-26T14:00:00.000Z',
    });

    if (!isInteractiveMessage(msg)) throw new Error('expected interactive');
    expect(selectedIds(msg.content)).toEqual(['slot-2']);
    expect(Date.parse(msg.content.selectedStartTime!)).toBeGreaterThan(0);
  });
});

describe('form responses', () => {
  it('groups submitted values by page', () => {
    const msg = interactive({
      responseType: 'form',
      formValues: [
        { pageId: 'name', values: ['Ada Lovelace'] },
        { pageId: 'toppings', values: ['olives', 'basil'] },
      ],
    });

    if (!isInteractiveMessage(msg)) throw new Error('expected interactive');
    // Forms carry no selections — the values are the answer.
    expect(selectedIds(msg.content)).toEqual([]);
    expect(formValuesByPage(msg.content)).toEqual({
      name: ['Ada Lovelace'],
      toppings: ['olives', 'basil'],
    });
  });

  it('flags a private form response', () => {
    const msg = interactive({ responseType: 'form', private: true });

    if (!isInteractiveMessage(msg)) throw new Error('expected interactive');
    // Private responses are access-restricted on read surfaces — callers need
    // to know before they log or forward the values.
    expect(msg.content.private).toBe(true);
  });
});

describe('correlation', () => {
  it('prefers the response identifier over the message-level one', () => {
    const msg = interactive({ requestIdentifier: 'from-content' });
    const withBoth = { ...msg, richRequestIdentifier: 'from-message' } as WebhookMessageSummary;

    expect(respondsTo(withBoth)).toBe('from-content');
  });

  it('falls back to the message-level identifier', () => {
    const msg = interactive({ requestIdentifier: null });
    const withMessageLevel = {
      ...msg,
      richRequestIdentifier: 'from-message',
    } as WebhookMessageSummary;

    expect(respondsTo(withMessageLevel)).toBe('from-message');
  });

  it('returns null when the channel made no correlation promise', () => {
    // Custom iMessage apps are documented as having no correlation at all.
    expect(respondsTo(interactive({ requestIdentifier: null }))).toBeNull();
  });
});

describe('Apple time-picker timestamps', () => {
  it('parses the basic format production actually sends', () => {
    // Confirmed against production: no seconds, no colon in the offset.
    const parsed = parseAppleTimestamp('2026-08-25T23:55+0000');

    expect(parsed).not.toBeNull();
    expect(parsed!.toISOString()).toBe('2026-08-25T23:55:00.000Z');
  });

  it('parses a non-UTC basic offset', () => {
    const parsed = parseAppleTimestamp('2026-08-25T18:55-0500');

    expect(parsed!.toISOString()).toBe('2026-08-25T23:55:00.000Z');
  });

  it('still parses proper RFC 3339, in case the server is fixed', () => {
    expect(parseAppleTimestamp('2026-08-25T23:55:00Z')!.toISOString()).toBe(
      '2026-08-25T23:55:00.000Z',
    );
    expect(parseAppleTimestamp('2026-08-25T23:55:30+00:00')!.toISOString()).toBe(
      '2026-08-25T23:55:30.000Z',
    );
  });

  it('produces a string strict parsers accept', () => {
    const parsed = parseAppleTimestamp('2026-08-25T23:55+0000')!;

    // The whole point: hand downstream systems something RFC 3339-shaped.
    expect(parsed.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('returns null rather than an Invalid Date', () => {
    expect(parseAppleTimestamp(null)).toBeNull();
    expect(parseAppleTimestamp(undefined)).toBeNull();
    expect(parseAppleTimestamp('')).toBeNull();
    expect(parseAppleTimestamp('not a timestamp')).toBeNull();
  });

  it('reads the chosen slot straight off a time-picker reply', () => {
    const msg = interactive({
      responseType: 'time_picker',
      selections: [{ id: 'slot-1', title: null }],
      selectedStartTime: '2026-08-25T23:55+0000',
    });

    if (!isInteractiveMessage(msg)) throw new Error('expected interactive');
    expect(selectedStartTime(msg.content)!.toISOString()).toBe('2026-08-25T23:55:00.000Z');
  });

  it('returns null for replies that carry no time', () => {
    const msg = interactive({ responseType: 'quick_reply' });

    if (!isInteractiveMessage(msg)) throw new Error('expected interactive');
    expect(selectedStartTime(msg.content)).toBeNull();
  });
});
