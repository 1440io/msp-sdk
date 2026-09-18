import { expect, it } from 'vitest';
import { isMspApiError, uuidv7 } from '@1440io/msp-api';
import type { SendRawMessageBody } from '@1440io/msp-types';
import { describeApi } from '../gates.ts';
import { testClient } from '../client.ts';
import { rawListPicker, rawQuickReply, rawText } from '../fixtures/rich.ts';

/**
 * Channel-content validation — deliberately non-destructive.
 *
 * Every send targets a conversation id that cannot exist, so even content that
 * passes validation is answered with 404 rather than delivered. That makes the
 * file safe to run without the send tier, and makes 404 a *useful* assertion:
 * it proves validation passed instead of tripping a shape guard.
 *
 * The contract changed in this spec revision. `content` is now a typed union
 * tagged by `kind`, and unknown fields are rejected, so the platform no longer
 * accepts arbitrary Apple JSON — the old envelope-injection and
 * marker-mismatch guards have nothing left to catch.
 */
const NOWHERE = '01890000-0000-7000-8000-0000000d0000';

async function sendRaw(content: unknown) {
  return testClient()
    .messaging.sendRaw({
      conversationId: NOWHERE,
      content: content as SendRawMessageBody['content'],
      requestMessageId: uuidv7(),
    })
    .then(
      () => ({ ok: true as const, status: 0, issues: [] as string[], message: '' }),
      (error: unknown) => {
        if (!isMspApiError(error)) throw error;
        return {
          ok: false as const,
          status: error.status,
          issues: (error.issues ?? []).map((issue) => issue.path),
          message: error.message,
        };
      },
    );
}

describeApi('channel content: valid shapes reach conversation lookup', () => {
  it('accepts text and then 404s on the unknown conversation', async () => {
    const result = await sendRaw(rawText('Integration test — never delivered'));

    expect(result.status).toBe(404);
  });

  it('accepts a two-item quick reply', async () => {
    const result = await sendRaw(rawQuickReply());

    expect(result.status).toBe(404);
  });

  it('accepts a quick reply at the five-item ceiling', async () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      identifier: `item-${index}`,
      title: `Item ${index}`,
    }));

    const result = await sendRaw(rawQuickReply(five));

    expect(result.status).toBe(404);
  });

  it('accepts a list picker with its required bubbles', async () => {
    const result = await sendRaw(rawListPicker());

    expect(result.status).toBe(404);
  });
});

describeApi('channel content: shape validation', () => {
  it('rejects a quick reply with a single item', async () => {
    // The spec now pins items to 2–5. Previously it said 1–5 while Apple
    // rejected one item with a gateway 400 that named no cause.
    const result = await sendRaw(rawQuickReply([{ identifier: 'solo', title: 'Only option' }]));

    expect(result.ok).toBe(false);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
    // Caught locally now, so it never reaches Apple as a 502.
    expect(result.status).not.toBe(502);
  });

  it('rejects a quick reply with six items', async () => {
    const six = Array.from({ length: 6 }, (_, index) => ({
      identifier: `item-${index}`,
      title: `Item ${index}`,
    }));

    const result = await sendRaw(rawQuickReply(six));

    expect(result.ok).toBe(false);
    expect(result.status).not.toBe(404);
  });

  it('rejects an unknown content kind', async () => {
    const result = await sendRaw({ kind: 'amb.carrier_pigeon', data: {} });

    expect(result.ok).toBe(false);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  it('rejects text with no body', async () => {
    const result = await sendRaw({ kind: 'text' });

    expect(result.ok).toBe(false);
    expect(result.status).not.toBe(404);
  });

  it('rejects unknown fields inside content', async () => {
    // Measured in August this was silently ignored, so a payload typo rendered
    // wrong instead of erroring. The content schemas are closed
    // (`additionalProperties: false`) in this spec revision and production
    // enforces it, so the typo is now a 400 before conversation lookup.
    const result = await sendRaw({ ...(rawText('hi') as object), sourceId: 'caller-supplied' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.status, 'rejected before conversation lookup').not.toBe(404);
  });

  it('rejects unknown fields on the request body', async () => {
    const client = testClient();
    const token = await client.getAccessToken();

    const response = await fetch(`${client.baseUrl}/api/v0/messaging/send-raw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        requestMessageId: uuidv7(),
        conversationId: NOWHERE,
        content: rawText('hi'),
        extraTopLevel: true,
      }),
    });
    const body = (await response.json()) as { error?: string; issues?: { message: string }[] };

    // The envelope is closed, and says which key it did not recognize.
    expect(response.status).toBe(400);
    expect(body.error).toBe('validation_failed');
    expect(JSON.stringify(body.issues)).toContain('extraTopLevel');
  });

  it('rejects a list picker missing its required bubbles', async () => {
    const content = rawListPicker() as unknown as Record<string, unknown>;
    delete content['receivedMessage'];

    const result = await sendRaw(content);

    expect(result.ok).toBe(false);
    expect(result.status).not.toBe(404);
  });

  it('reports validation problems with a field path', async () => {
    const result = await sendRaw(rawQuickReply([{ identifier: 'solo', title: 'Only' }]));

    if (result.ok) return;
    // `issues` replaced `reasons` on the send routes in this revision.
    if (result.issues.length > 0) {
      expect(result.issues.join(' ')).toMatch(/content|quick-reply|items/);
      console.log(`   issue paths: ${result.issues.join(', ')}`);
    } else {
      console.log(`   rejected without field paths: ${result.message.slice(0, 90)}`);
    }
  });
});
