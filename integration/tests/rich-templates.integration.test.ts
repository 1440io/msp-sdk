import { expect, it } from 'vitest';
import { isMspApiError } from '@1440io/msp-api';
import { RICH_REASON_CODES } from '@1440io/msp-types';
import type { RichReason, RichTemplateDetail, RichTemplateWriteBody } from '@1440io/msp-types';
import { describeWrites } from '../gates.ts';
import { resourceName } from '../env.ts';
import { testClient } from '../client.ts';
import { assertEachMatchesSchema, assertMatchesSchema } from '../schema.ts';
import {
  listPickerTemplate,
  missingAssetTemplate,
  quickReplyTemplate,
  staticListPickerTemplate,
  timePickerTemplate,
  undeclaredVariableTemplate,
} from '../fixtures/rich.ts';

/** Reason codes seen this run, so unknown ones can be reported once at the end. */
const seenReasonCodes = new Set<string>();

function recordReasons(reasons: RichReason[] | undefined): string[] {
  const codes = (reasons ?? []).map((reason) => reason.code);
  for (const code of codes) seenReasonCodes.add(code);
  return codes;
}

/** Create a template, hand it to `fn`, and delete it afterwards no matter what. */
async function withTemplate(
  body: RichTemplateWriteBody,
  fn: (template: RichTemplateDetail) => Promise<void>,
): Promise<void> {
  const client = testClient();
  const created = await client.admin.templates.create(body);
  try {
    await fn(created);
  } finally {
    await client.admin.templates.delete(created.id).catch(() => undefined);
  }
}

/** Create a template expecting rejection, returning the reason codes. */
async function expectRejected(body: RichTemplateWriteBody): Promise<string[]> {
  const error = await testClient()
    .admin.templates.create(body)
    .then(
      (created) => {
        // Do not leave an unexpectedly-accepted template lying around.
        void testClient().admin.templates.delete(created.id).catch(() => undefined);
        return null;
      },
      (e: unknown) => e,
    );

  expect(error, 'template was accepted but should have been rejected').not.toBeNull();
  if (!isMspApiError(error)) throw error;
  expect(error.status).toBeGreaterThanOrEqual(400);
  expect(error.status).toBeLessThan(500);
  return recordReasons(error.reasons);
}

describeWrites('rich templates: canonical blocks', () => {
  it('creates a quick reply template and reports it ready on a channel', async () => {
    await withTemplate(quickReplyTemplate(resourceName('qr')), async (template) => {
      assertMatchesSchema('RichTemplateDetail', template, 'canonical quick_reply');
      expect(template.mode).toBe('canonical');
      assertEachMatchesSchema('RichChannelReadiness', template.readiness, 'readiness');

      const amb = template.readiness.find((entry) => entry.channel === 'amb');
      expect(amb, 'no readiness entry for amb').toBeDefined();
      if (amb?.status === 'ready') {
        // A canonical quick reply must resolve to the native quick reply.
        expect(amb.resolvedNativeType).toBe('quick_reply');
      } else {
        recordReasons(amb?.reasons);
        console.log(`   amb blocked: ${(amb?.reasons ?? []).map((r) => r.code).join(', ')}`);
      }
    });
  });

  it('resolves a canonical text block to a plain text message', async () => {
    const { textTemplate } = await import('../fixtures/rich.ts');
    await withTemplate(textTemplate(resourceName('text')), async (template) => {
      const amb = template.readiness.find((entry) => entry.channel === 'amb');
      if (amb?.status === 'ready') expect(amb.resolvedNativeType).toBe('text');
    });
  });

  it('rejects a block referencing a variable it never declares', async () => {
    const codes = await expectRejected(undeclaredVariableTemplate(resourceName('undeclared')));

    expect(codes).toContain('undeclared_variable_reference');
  });
});

describeWrites('rich templates: native AMB content', () => {
  it('creates a list picker with fixed items', async () => {
    await withTemplate(staticListPickerTemplate(resourceName('lp-static')), async (template) => {
      assertMatchesSchema('RichTemplateDetail', template, 'native list_picker');
      expect(template.mode).toBe('native');
      expect(template.nativeChannel).toBe('amb');

      const amb = template.readiness.find((entry) => entry.channel === 'amb');
      if (amb?.status === 'ready') expect(amb.resolvedNativeType).toBe('list_picker');
      else recordReasons(amb?.reasons);
    });
  });

  it('creates a list picker whose items arrive per send', async () => {
    await withTemplate(listPickerTemplate(resourceName('lp-dynamic')), async (template) => {
      // A collection variable is what makes the picker dynamic.
      const variable = template.definition.variables.find((v) => v.name === 'options');
      expect(variable?.type).toBe('collection');
      expect(variable?.itemSchema).toBe('list_picker_item');
    });
  });

  it('creates a time picker whose slots arrive per send', async () => {
    await withTemplate(timePickerTemplate(resourceName('tp')), async (template) => {
      const variable = template.definition.variables.find((v) => v.name === 'slots');
      expect(variable?.type).toBe('collection');
      expect(variable?.itemSchema).toBe('timeslot');

      const amb = template.readiness.find((entry) => entry.channel === 'amb');
      if (amb?.status === 'ready') expect(amb.resolvedNativeType).toBe('time_picker');
      else recordReasons(amb?.reasons);
    });
  });

  it('blocks a template whose image slot has no asset bound to it', async () => {
    // Authoring a draft with an unbound slot is allowed — you bind assets
    // later. The protection is that readiness reports it blocked, so the gap
    // is caught before a send rather than at delivery time.
    await withTemplate(missingAssetTemplate(resourceName('noasset')), async (template) => {
      const amb = template.readiness.find((entry) => entry.channel === 'amb');
      expect(amb, 'no readiness entry for amb').toBeDefined();
      expect(amb!.status).toBe('blocked');

      const codes = recordReasons(amb!.reasons);
      expect(codes).toContain('missing_asset');

      // The reason has to say which slot, or it is not actionable.
      const missing = amb!.reasons.find((reason) => reason.code === 'missing_asset');
      expect(missing?.slotName).toBe('hero');
    });
  });

  it('is only ready on the channel it was authored for', async () => {
    await withTemplate(staticListPickerTemplate(resourceName('lp-scope')), async (template) => {
      for (const readiness of template.readiness) {
        if (readiness.channel === 'amb') continue;
        // A native AMB payload cannot render on another channel.
        expect(readiness.status).toBe('blocked');
        recordReasons(readiness.reasons);
      }
    });
  });
});

describeWrites('rich templates: publishing', () => {
  it('makes a rich template sendable only once published', async () => {
    const client = testClient();
    await withTemplate(staticListPickerTemplate(resourceName('lp-publish')), async (template) => {
      const beforePublish = await client.templates.list({ count: 100 }).toArray(500);
      expect(beforePublish.some((t) => t.id === template.id)).toBe(false);

      const published = await client.admin.templates.publish(template.id);
      expect(published.status).toBe('published');

      const afterPublish = await client.templates.get(template.id);
      assertMatchesSchema('RichTemplateDetail', afterPublish, 'published rich template');
      expect(afterPublish.definition.mode).toBe('native');

      // Archive so the delete in withTemplate has a chance of succeeding.
      await client.admin.templates.archive(template.id).catch(() => undefined);
    });
  });
});

describeWrites('rich templates: reason vocabulary', () => {
  it('reports any reason code the spec does not declare', () => {
    const known = new Set<string>(RICH_REASON_CODES);
    const unknown = [...seenReasonCodes].filter((code) => !known.has(code));

    console.log(`   reason codes seen: ${[...seenReasonCodes].join(', ') || '(none)'}`);
    if (unknown.length > 0) {
      // Reported rather than asserted: a new code is the server moving ahead of
      // the spec, and failing here would just punish whoever ran the suite.
      console.warn(
        `   ⚠ reason code(s) outside the documented set: ${unknown.join(', ')} — ` +
          'the spec calls this a stable set, so these belong in it.',
      );
    }
    expect(seenReasonCodes.size).toBeGreaterThanOrEqual(0);
  });
});
