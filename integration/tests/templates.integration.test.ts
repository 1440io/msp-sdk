import { expect, it } from 'vitest';
import { isMspApiError, MspNotFoundError } from '@1440io/msp-api';
import { RICH_TEMPLATE_STATUSES } from '@1440io/msp-types';
import { describeApi, describeWrites } from '../gates.ts';
import { resourceName } from '../env.ts';
import { testClient } from '../client.ts';
import { assertEachMatchesSchema, assertMatchesSchema } from '../schema.ts';

/** A minimal canonical template with one required variable. */
function draftDefinition() {
  return {
    mode: 'canonical' as const,
    block: {
      kind: 'text' as const,
      body: 'Hello {{customerName}} — this is an SDK integration test draft.',
    },
    variables: [
      { name: 'customerName', type: 'text' as const, required: true, itemSchema: null },
    ],
  };
}

describeApi('templates: reading published templates', () => {
  it('lists published templates in the documented envelope', async () => {
    const page = await testClient().templates.list({ count: 5 });

    assertMatchesSchema('RichTemplateList', page, 'GET /api/v0/templates');
    assertEachMatchesSchema('RichTemplateSummary', page.templates, 'templates');
    console.log(
      `   ${page.templates.length} published template(s), nextCursor=${page.nextCursor}`,
    );
  });

  it('only lists templates that are actually published', async () => {
    const page = await testClient().templates.list({ count: 25 });

    for (const template of page.templates) {
      // The v0 route is the sending surface; a draft here would be sendable
      // before it was ever published.
      expect(template.status).toBe('published');
    }
  });

  it('gets one published template with its definition and readiness', async () => {
    const client = testClient();
    const page = await client.templates.list({ count: 1 });
    const summary = page.templates[0];

    if (!summary) {
      console.log('   no published templates — detail test skipped');
      return;
    }

    const detail = await client.templates.get(summary.id);

    assertMatchesSchema('RichTemplateDetail', detail, `GET /templates/${summary.id}`);
    expect(detail.id).toBe(summary.id);
    assertEachMatchesSchema('RichChannelReadiness', detail.readiness, 'readiness');
    const ready = detail.readiness.filter((r) => r.status === 'ready').map((r) => r.channel);
    console.log(`   "${detail.name}" ready on: ${ready.join(', ') || '(none)'}`);
  });

  it('reports blocked readiness with machine-readable reasons', async () => {
    const client = testClient();
    const page = await client.templates.list({ count: 10 });

    for (const summary of page.templates.slice(0, 5)) {
      const detail = await client.templates.get(summary.id);
      for (const readiness of detail.readiness) {
        if (readiness.status !== 'blocked') continue;
        // A blocked channel with no reason gives a caller nothing to act on.
        expect(readiness.reasons.length).toBeGreaterThan(0);
        assertEachMatchesSchema('RichReason', readiness.reasons, 'blocked reasons');
      }
    }
  });

  it('404s on a template id that does not exist', async () => {
    await expect(
      testClient().templates.get('01890000-0000-7000-8000-00000000beef'),
    ).rejects.toBeInstanceOf(MspNotFoundError);
  });
});

describeApi('templates: admin listing', () => {
  it('lists drafts, published, and archived templates', async () => {
    const client = testClient();

    for (const status of RICH_TEMPLATE_STATUSES) {
      const page = await client.admin.templates.list({ status, count: 5 }).catch((error: unknown) => {
        if (isMspApiError(error) && error.status === 403) return null;
        throw error;
      });
      if (!page) {
        console.log('   admin template listing not permitted — skipped');
        return;
      }
      assertMatchesSchema('RichTemplateList', page, `status=${status}`);
      for (const template of page.templates) expect(template.status).toBe(status);
    }
  });

  it('lists rich assets with their channel and usage', async () => {
    const page = await testClient()
      .admin.templates.listAssets({ count: 5 })
      .catch((error: unknown) => {
        if (isMspApiError(error) && error.status === 403) return null;
        throw error;
      });
    if (!page) return;

    assertMatchesSchema('RichAssetList', page, 'GET /admin/businesses/templates/assets');
    assertEachMatchesSchema('RichAssetItem', page.assets, 'assets');
  });
});

describeWrites('templates: draft lifecycle', () => {
  it('creates, edits, publishes, archives, and cleans up a template', async () => {
    const client = testClient();
    const name = resourceName('template');
    let templateId: string | undefined;

    try {
      const created = await client.admin.templates.create({
        name,
        definition: draftDefinition(),
        slotBindings: [],
      });
      templateId = created.id;
      assertMatchesSchema('RichTemplateDetail', created, 'POST /admin/businesses/templates');
      expect(created.name).toBe(name);
      expect(created.status).toBe('draft');

      const fetched = await client.admin.templates.get(templateId);
      expect(fetched.id).toBe(templateId);
      expect(fetched.status).toBe('draft');

      // A fresh draft must not be visible on the sending surface yet.
      const published = await client.templates.list({ count: 100 });
      expect(published.templates.some((t) => t.id === templateId)).toBe(false);

      const edited = await client.admin.templates.update(templateId, {
        name,
        definition: {
          ...draftDefinition(),
          block: { kind: 'text', body: 'Edited by the SDK integration suite: {{customerName}}.' },
        },
        slotBindings: [],
      });
      assertMatchesSchema('RichTemplateDetail', edited, 'PUT /admin/businesses/templates/{id}');

      const publishedTemplate = await client.admin.templates.publish(templateId);
      assertMatchesSchema('RichTemplateDetail', publishedTemplate, 'POST .../publish');
      expect(publishedTemplate.status).toBe('published');

      const archived = await client.admin.templates.archive(templateId);
      assertMatchesSchema('RichTemplateDetail', archived, 'POST .../archive');
      expect(archived.status).toBe('archived');
    } finally {
      if (templateId) {
        // Archived templates may not be deletable; a 409 here is the documented
        // answer, not a failure worth failing the run over.
        await client.admin.templates.delete(templateId).catch((error: unknown) => {
          if (isMspApiError(error)) {
            console.log(`   cleanup: template ${templateId} not deleted (${error.status})`);
            return;
          }
          throw error;
        });
      }
    }
  });

  it('rejects a second template with the same name', async () => {
    const client = testClient();
    const name = resourceName('dupe');
    let firstId: string | undefined;

    try {
      const first = await client.admin.templates.create({
        name,
        definition: draftDefinition(),
        slotBindings: [],
      });
      firstId = first.id;

      const error = await client.admin.templates
        .create({ name, definition: draftDefinition(), slotBindings: [] })
        .catch((e: unknown) => e);

      // Names are documented as unique within the organization.
      expect(isMspApiError(error)).toBe(true);
      expect(isMspApiError(error) && [400, 409].includes(error.status)).toBe(true);
    } finally {
      if (firstId) await client.admin.templates.delete(firstId).catch(() => undefined);
    }
  });

  it('rejects a definition missing its required parts', async () => {
    const error = await testClient()
      .admin.templates.create({
        name: resourceName('invalid'),
        // @ts-expect-error — deliberately malformed, to prove the API validates.
        definition: { mode: 'canonical' },
        slotBindings: [],
      })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && error.status).toBeGreaterThanOrEqual(400);
    expect(isMspApiError(error) && error.status).toBeLessThan(500);
  });
});
