import { expect, it } from 'vitest';
import { isMspApiError, uuidv7 } from '@1440io/msp-api';
import { describeApi, describeSend } from '../gates.ts';
import { env, RUN_ID } from '../env.ts';
import { testClient } from '../client.ts';
import { assertMatchesSchema } from '../schema.ts';

const stamp = () => `[SDK integration test ${RUN_ID}]`;

describeSend('messaging: real outbound sends', () => {
  it('delivers a text message into the configured conversation', async () => {
    const client = testClient();

    const result = await client.messaging.sendText({
      conversationId: env.conversationId!,
      body: `${stamp()} Please ignore — automated test message.`,
    });

    assertMatchesSchema('SendMessageSuccess', result, 'POST /api/v0/messaging/send');
    expect(result.messageId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.duplicate).toBe(false);
    console.log(`   sent ${result.messageId} (channel id ${result.channelMessageId})`);
  });

  it('treats a replayed requestMessageId as a duplicate rather than a second send', async () => {
    const client = testClient();
    const requestMessageId = uuidv7();
    const body = `${stamp()} Idempotency check — you should see this once.`;

    const first = await client.messaging.sendText({
      conversationId: env.conversationId!,
      body,
      requestMessageId,
    });
    const replay = await client.messaging.sendText({
      conversationId: env.conversationId!,
      body,
      requestMessageId,
    });

    expect(first.duplicate).toBe(false);
    // The whole retry-safety story rests on this being true.
    expect(replay.duplicate).toBe(true);
    expect(replay.messageId).toBe(first.messageId);
  });

  it('rejects a replayed key carrying different content', async () => {
    const client = testClient();
    const requestMessageId = uuidv7();

    await client.messaging.sendText({
      conversationId: env.conversationId!,
      body: `${stamp()} Conflict check, original.`,
      requestMessageId,
    });

    const error = await client.messaging
      .sendText({
        conversationId: env.conversationId!,
        body: `${stamp()} Conflict check, DIFFERENT body.`,
        requestMessageId,
      })
      .catch((e: unknown) => e);

    // Documented as a 409 — silently accepting it would hide a caller bug.
    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && error.status).toBe(409);
  });

  it('sends a message with an uploaded attachment', async () => {
    const client = testClient();
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
          'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      ),
      (c) => c.charCodeAt(0),
    );

    const { mediaAssetId } = await client.media.upload({
      body: png,
      filename: 'integration-test-pixel.png',
      contentType: 'image/png',
      targetChannel: 'amb',
    });

    const result = await client.messaging.sendText({
      conversationId: env.conversationId!,
      body: `${stamp()} Attachment check.`,
      attachmentIds: [mediaAssetId],
    });

    assertMatchesSchema('SendMessageSuccess', result, 'send with attachment');
    expect(result.duplicate).toBe(false);
  });

  it('appears in the conversation afterwards', async () => {
    const client = testClient();
    const marker = `${stamp()} Readback ${uuidv7().slice(-8)}`;

    const sent = await client.messaging.sendText({
      conversationId: env.conversationId!,
      body: marker,
    });

    // Give the write a moment to land in the read model.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const detail = await client.conversations.get(env.conversationId!, { count: 25 });

    expect(detail.messages.some((message) => message.id === sent.messageId)).toBe(true);
  });

  it('sends from a published template when one is ready on the channel', async () => {
    const client = testClient();
    const conversation = await client.conversations.get(env.conversationId!, { count: 1 });
    const page = await client.templates.list({ count: 25 });

    let chosen: { id: string; variables: Record<string, string> } | undefined;
    for (const summary of page.templates) {
      const detail = await client.templates.get(summary.id);
      const ready = detail.readiness.some(
        (r) => r.channel === conversation.channelPlatform && r.status === 'ready',
      );
      if (!ready) continue;
      if (detail.definition.mode !== 'canonical') continue;

      const required = detail.definition.variables.filter((v) => v.required);
      // Only text variables can be filled with a safe placeholder here.
      if (required.some((v) => v.type !== 'text')) continue;

      chosen = {
        id: detail.id,
        variables: Object.fromEntries(required.map((v) => [v.name, 'Integration Test'])),
      };
      break;
    }

    if (!chosen) {
      console.log('   no text-only template ready on this channel — template send skipped');
      return;
    }

    const result = await client.messaging.sendTemplate({
      conversationId: env.conversationId!,
      templateId: chosen.id,
      variables: chosen.variables,
    });

    assertMatchesSchema('SendMessageSuccess', result, 'template send');
    expect(result.duplicate).toBe(false);
  });
});

describeApi('messaging: rejections that must not send anything', () => {
  it('rejects a send with neither body nor attachments', async () => {
    const error = await testClient()
      .messaging.sendText({ conversationId: env.conversationId ?? 'unused' })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && [400, 404, 422]).toContain(
      isMspApiError(error) ? error.status : 0,
    );
  });

  it('404s on a conversation that does not belong to this business', async () => {
    const error = await testClient()
      .messaging.sendText({
        conversationId: '01890000-0000-7000-8000-00000000dead',
        body: 'This must never be delivered.',
      })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && error.status).toBe(404);
  });

  it('rejects an unpublished template id', async () => {
    const error = await testClient()
      .messaging.sendTemplate({
        conversationId: env.conversationId ?? '01890000-0000-7000-8000-00000000dead',
        templateId: '01890000-0000-7000-8000-00000000beef',
      })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && error.status).toBeGreaterThanOrEqual(400);
  });
});
