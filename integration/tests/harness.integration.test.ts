import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertMatchesSchema, checkSchema } from '../schema.ts';
import { env, hasCredentials } from '../env.ts';

/**
 * Self-test for the integration harness. Needs no credentials, so it always
 * runs: a broken validator would otherwise let every live test pass vacuously.
 */
describe('harness: schema validation', () => {
  const spec = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../spec/1440-cloud-openapi.json'), 'utf8'),
  ) as {
    components: { schemas: Record<string, { example?: unknown }> };
    webhooks: Record<string, { post: { requestBody: { content: Record<string, { example?: unknown; schema: { $ref: string } }> } } }>;
  };

  it('validates every example the spec documents against its own schema', () => {
    const failures: string[] = [];
    let checked = 0;

    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      if (schema.example === undefined) continue;
      checked += 1;
      const { violations } = checkSchema(name, schema.example);
      if (violations.length > 0) failures.push(`${name}: ${violations.join('; ')}`);
    }

    // This revision inlines most shapes and carries few standalone examples,
    // so the count is reported rather than floored at a number that would go
    // stale with the next spec drop.
    console.log(`   ${checked} schema example(s) checked`);
    // A spec whose own examples contradict its schemas cannot be trusted as the
    // yardstick the live tests measure production against.
    expect(failures).toEqual([]);
  });

  it('validates the documented webhook payloads', () => {
    for (const [type, item] of Object.entries(spec.webhooks)) {
      const content = item.post.requestBody.content['application/json'];
      if (!content?.example) continue; // not every event ships an example
      const schemaName = content.schema.$ref.split('/').pop()!;
      assertMatchesSchema(schemaName, content.example, `webhook ${type}`);
    }
  });

  it('rejects a payload missing a required field', () => {
    const { violations } = checkSchema('MediaUploadResult', {});

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join(' ')).toContain('mediaAssetId');
  });

  it('rejects a value outside a declared enum', () => {
    const { violations } = checkSchema('Channel', {
      id: '018f1a2b-0000-7000-8000-000000000001',
      platform: 'carrier-pigeon',
      externalId: 'x',
    });

    expect(violations.length).toBeGreaterThan(0);
  });

  it('reports an undocumented property separately from a real violation', () => {
    const { violations, undocumented } = checkSchema('CreateMessagingInvitationBody', {
      channel: 'amb',
      phoneNumber: '+15551234567',
      purpose: 'connect',
      requestMessageId: '018f1a2b-3c4d-7e8f-9012-3456789abcde',
      surpriseField: true,
    });

    // Additive server changes are warnings; contradictions are failures.
    expect(violations).toEqual([]);
    expect(undocumented.join(' ')).toContain('surpriseField');
  });

  it('throws with the offending payload when a live response contradicts the spec', () => {
    expect(() => assertMatchesSchema('MediaUploadResult', { wrong: 1 }, 'unit')).toThrow(
      /does not match the OpenAPI schema/,
    );
  });
});

describe('harness: configuration', () => {
  it('reports which tiers this run has enabled', () => {
    console.log(
      `   credentials=${hasCredentials} writes=${env.allowWrites} send=${env.allowSend} ` +
        `initiate=${env.allowInitiate} secret=${env.webhookSecret !== undefined}`,
    );
    expect(env.baseUrl).toMatch(/^https?:\/\//);
  });

  it('keeps destructive tiers off unless explicitly enabled', () => {
    // Enabling a tier must take a deliberate env var, never a default.
    for (const [name, value] of Object.entries({
      MSP_TEST_ALLOW_WRITES: env.allowWrites,
      MSP_TEST_ALLOW_SEND: env.allowSend,
      MSP_TEST_ALLOW_INITIATE: env.allowInitiate,
    })) {
      if (value) expect(process.env[name]).toBeDefined();
    }
  });
});
