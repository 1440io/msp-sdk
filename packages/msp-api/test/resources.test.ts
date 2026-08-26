import { describe, expect, it } from 'vitest';
import { MAX_TIKTOK_UPLOAD_BYTES, MspClient, MspConfigError, uuidv7 } from '../src/index.js';
import { stubFetch } from './helpers.js';

function client(responses: Parameters<typeof stubFetch>[0]) {
  const stub = stubFetch(responses);
  return { ...stub, client: new MspClient({ token: 'jwt', fetch: stub.fetch }) };
}

const conversation = (id: string) => ({
  id,
  businessId: 'b1',
  firstName: null,
  lastName: null,
  email: null,
  optedOut: false,
  channelPlatform: 'amb',
  channelAddress: 'urn:mbid:x',
  status: 'active',
  agentStatus: 'bot',
  intentId: null,
  groupId: null,
  locale: null,
});

describe('pagination', () => {
  it('follows nextCursor across pages when iterated', async () => {
    const { client: c, requests } = client([
      { body: { conversations: [conversation('a'), conversation('b')], nextCursor: 'cur-2' } },
      { body: { conversations: [conversation('c')], nextCursor: null } },
    ]);

    const ids: string[] = [];
    for await (const item of c.conversations.list({ count: 2 })) ids.push(item.id);

    expect(ids).toEqual(['a', 'b', 'c']);
    expect(new URL(requests[1]!.url).searchParams.get('cursor')).toBe('cur-2');
  });

  it('fetches only the first page when awaited', async () => {
    const { client: c, requests } = client([
      { body: { conversations: [conversation('a')], nextCursor: 'cur-2' } },
    ]);

    const page = await c.conversations.list();

    expect(page.conversations).toHaveLength(1);
    expect(page.nextCursor).toBe('cur-2');
    expect(requests).toHaveLength(1);
  });

  it('stops early when toArray is given a limit', async () => {
    const { client: c, requests } = client([
      { body: { conversations: [conversation('a'), conversation('b')], nextCursor: 'cur-2' } },
    ]);

    const items = await c.conversations.list().toArray(2);

    expect(items).toHaveLength(2);
    expect(requests).toHaveLength(1);
  });

  it('treats hasMore:false as the end of a before-paginated list', async () => {
    const { client: c, requests } = client([
      { body: { templates: [{ id: 't1' }], hasMore: false, nextCursor: 't1' } },
    ]);

    const all = await c.templates.list().toArray();

    expect(all).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });
});

describe('messaging', () => {
  it('builds a text send and mints a UUIDv7 idempotency key', async () => {
    const { client: c, requests } = client([
      { body: { messageId: 'm1', channelMessageId: '123', duplicate: false } },
    ]);

    await c.messaging.sendText({
      conversationId: 'conv-1',
      body: 'Hello',
      attachmentIds: ['att-1'],
    });

    const body = JSON.parse(requests[0]!.body!) as Record<string, any>;
    expect(body.type).toBe('text');
    expect(body.conversationId).toBe('conv-1');
    expect(body.message).toEqual({ body: 'Hello', attachmentIds: ['att-1'] });
    expect(body.requestMessageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('honours a caller-supplied idempotency key', async () => {
    const { client: c, requests } = client([
      { body: { messageId: 'm1', channelMessageId: null, duplicate: true } },
    ]);
    const key = uuidv7();

    const result = await c.messaging.sendText({
      conversationId: 'conv-1',
      body: 'Hello',
      requestMessageId: key,
    });

    expect(JSON.parse(requests[0]!.body!).requestMessageId).toBe(key);
    expect(result.duplicate).toBe(true);
  });

  it('builds a template send with variables', async () => {
    const { client: c, requests } = client([
      { body: { messageId: 'm2', channelMessageId: null, duplicate: false } },
    ]);

    await c.messaging.sendTemplate({
      conversationId: 'conv-1',
      templateId: 'tpl-1',
      variables: { customerName: 'Ada' },
    });

    const body = JSON.parse(requests[0]!.body!) as Record<string, any>;
    expect(body.type).toBe('template');
    expect(body.message).toEqual({ templateId: 'tpl-1', variables: { customerName: 'Ada' } });
  });

  it('passes a channel-native payload through unchanged', async () => {
    const { client: c, requests } = client([{ body: { messageId: 'm3' } }]);

    await c.messaging.sendRaw({
      conversationId: 'conv-1',
      channel: 'amb',
      messageType: 'list_picker',
      payload: { interactiveData: { bid: 'com.apple.messages.MSMessageExtensionBalloonPlugin' } },
    });

    const body = JSON.parse(requests[0]!.body!) as Record<string, any>;
    expect(body.messageType).toBe('list_picker');
    expect(body.payload.interactiveData.bid).toContain('MSMessageExtensionBalloonPlugin');
  });
});

describe('initiations', () => {
  it('defaults purpose to connect and keeps the idempotency key', async () => {
    const { client: c, requests } = client([{ body: { id: 'init-1', status: 'submitting' } }]);

    await c.initiations.create({
      channel: 'amb',
      phoneNumber: '+15551234567',
      idempotencyKey: 'case-123-attempt-1',
      targetFirstName: 'Ada',
    });

    const body = JSON.parse(requests[0]!.body!) as Record<string, any>;
    expect(body).toEqual({
      purpose: 'connect',
      channel: 'amb',
      phoneNumber: '+15551234567',
      idempotencyKey: 'case-123-attempt-1',
      targetFirstName: 'Ada',
    });
  });
});

describe('media', () => {
  it('sends upload metadata as headers alongside the raw bytes', async () => {
    const { client: c, requests } = client([{ body: { mediaAssetId: 'asset-1' } }]);

    await c.media.upload({
      body: new Uint8Array([1, 2, 3, 4]),
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      targetChannel: 'amb',
    });

    const headers = requests[0]!.headers;
    expect(headers['x-original-filename']).toBe('photo.jpg');
    expect(headers['content-type']).toBe('image/jpeg');
    expect(headers['x-target-channel']).toBe('amb');
    expect(headers['content-length']).toBe('4');
  });

  it('rejects an oversized TikTok asset before uploading it', async () => {
    const { client: c, requests } = client([]);

    await expect(
      c.media.upload({
        body: new Uint8Array(4),
        filename: 'big.png',
        targetChannel: 'tiktok',
        contentLength: MAX_TIKTOK_UPLOAD_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(MspConfigError);
    expect(requests).toHaveLength(0);
  });
});

describe('admin', () => {
  it('replaces a permission set through PATCH', async () => {
    const { client: c, requests } = client([{ body: { id: 'ps-1', name: 'Front desk' } }]);

    await c.admin.permissions.updateSet('ps-1', {
      name: 'Front desk',
      permissions: ['ViewConversations', 'SendMessages'],
    });

    expect(requests[0]!.method).toBe('PATCH');
    expect(new URL(requests[0]!.url).pathname).toBe(
      '/api/admin/businesses/permission-sets/ps-1',
    );
  });

  it('publishes a template', async () => {
    const { client: c, requests } = client([{ body: { id: 'tpl-1', status: 'published' } }]);

    await c.admin.templates.publish('tpl-1');

    expect(requests[0]!.method).toBe('POST');
    expect(new URL(requests[0]!.url).pathname).toBe(
      '/api/admin/businesses/templates/tpl-1/publish',
    );
  });
});

describe('uuidv7', () => {
  it('produces version-7 variant-10 ids that sort by creation time', () => {
    const ids = Array.from({ length: 20 }, () => uuidv7());
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
    // Same millisecond or later — the timestamp prefix must never go backwards.
    const prefixes = ids.map((id) => id.slice(0, 13));
    expect([...prefixes].sort()).toEqual(prefixes);
  });
});
