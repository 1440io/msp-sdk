import { expect, it } from 'vitest';
import { isMspApiError } from '@1440io/msp-api';
import type { PermissionSetView } from '@1440io/msp-types';
import { describeApi, describeWrites } from '../gates.ts';
import { resourceName } from '../env.ts';
import { testClient } from '../client.ts';
import { assertEachMatchesSchema, assertMatchesSchema } from '../schema.ts';

/**
 * Admin routes need the `admin` membership tier. An integration without it
 * gets a 403, which is a correct answer rather than a broken test — these
 * helpers report that and move on.
 */
async function ifPermitted<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    if (isMspApiError(error) && (error.status === 403 || error.status === 404)) {
      console.log(`   ${label}: ${error.status} — this integration lacks the tier or route`);
      return undefined;
    }
    throw error;
  }
}

describeApi('admin: business', () => {
  it('returns the admin context in the documented shape', async () => {
    const context = await ifPermitted('context', () => testClient().admin.context());
    if (!context) return;

    assertMatchesSchema('AdminBusinessContext', context, 'GET /admin/businesses/context');
    expect(typeof context.business.id).toBe('string');
    console.log(`   business: ${context.business.name} (${context.business.slug})`);
  });

  it('returns business settings', async () => {
    const settings = await ifPermitted('settings', () => testClient().admin.settings());
    if (!settings) return;

    assertMatchesSchema('BusinessSettings', settings, 'GET /admin/businesses/settings');
  });

  it('lists members', async () => {
    const members = await ifPermitted('members', () => testClient().admin.listMembers({ count: 10 }));
    if (!members) return;

    assertEachMatchesSchema('AdminBusinessMember', members, 'GET /admin/businesses/members');
    expect(members.length).toBeLessThanOrEqual(10);
  });

  it('lists sandboxes with their cap', async () => {
    const sandboxes = await ifPermitted('sandboxes', () => testClient().admin.listSandboxes());
    if (!sandboxes) return;

    assertMatchesSchema('AdminSandboxList', sandboxes, 'GET /admin/businesses/sandboxes');
    expect(sandboxes.count).toBeLessThanOrEqual(sandboxes.cap);
  });

  it('reports TikTok channel status', async () => {
    const status = await ifPermitted('tiktok', () => testClient().admin.channels.tiktokStatus());
    if (!status) return;

    assertMatchesSchema('TikTokChannelStatus', status, 'GET /admin/businesses/channels/tiktok');
  });
});

describeApi('admin: integrations', () => {
  it('lists integrations without ever exposing a key secret', async () => {
    const integrations = await ifPermitted('integrations', () =>
      testClient().admin.integrations.list({ count: 10 }),
    );
    if (!integrations) return;

    assertEachMatchesSchema('Integration', integrations, 'GET /admin/businesses/integrations');

    const serialized = JSON.stringify(integrations);
    // A raw key or signing secret must never come back on a list route.
    expect(serialized).not.toMatch(/msp_[A-Za-z0-9]{16}/);
    expect(serialized).not.toMatch(/whsec_[A-Za-z0-9+/]{16}/);
    console.log(`   ${integrations.length} integration(s)`);
  });

  it('gets one integration and lists its keys', async () => {
    const client = testClient();
    const integrations = await ifPermitted('integrations', () =>
      client.admin.integrations.list({ count: 1 }),
    );
    const first = integrations?.[0];
    if (!first) return;

    const one = await client.admin.integrations.get(first.id);
    assertMatchesSchema('Integration', one, 'GET /admin/businesses/integrations/{id}');
    expect(one.id).toBe(first.id);

    const keys = await client.admin.integrations.listApiKeys(first.id, { count: 5 });
    assertEachMatchesSchema('IntegrationApiKey', keys, 'GET .../keys');
    expect(JSON.stringify(keys)).not.toMatch(/msp_[A-Za-z0-9]{16}/);
  });
});

describeApi('admin: permission catalog', () => {
  it('lists the live permission catalog', async () => {
    const catalog = await ifPermitted('permissions', () => testClient().admin.permissions.catalog());
    if (!catalog) return;

    assertEachMatchesSchema('CatalogPermission', catalog, 'GET /admin/businesses/permissions');
    expect(catalog.length).toBeGreaterThan(0);
  });

  it('lists permission sets built from catalog keys', async () => {
    const client = testClient();
    const catalog = await ifPermitted('permissions', () => client.admin.permissions.catalog());
    if (!catalog) return;

    const sets = await client.admin.permissions.listSets({ count: 10 });
    assertEachMatchesSchema('PermissionSetView', sets, 'GET /admin/businesses/permission-sets');

    const known = new Set(catalog.map((entry) => entry.key));
    for (const set of sets) {
      for (const permission of set.permissions ?? []) {
        // A set referencing a key outside the catalog means one was deprecated
        // without the catalog or the set being updated.
        expect(known.has(permission)).toBe(true);
      }
    }
  });
});

describeWrites('admin: permission set lifecycle', () => {
  it('creates, updates, and deletes a permission set', async () => {
    const client = testClient();
    const catalog = await ifPermitted('permissions', () => client.admin.permissions.catalog());
    if (!catalog || catalog.length === 0) return;

    const name = resourceName('permset');
    const firstKey = catalog[0]!.key;
    const secondKey = catalog[1]?.key ?? firstKey;

    let created: PermissionSetView | undefined;
    try {
      created = await client.admin.permissions.createSet({
        name,
        description: 'Created by the SDK integration suite. Safe to delete.',
        permissions: [firstKey],
      });
      assertMatchesSchema('PermissionSetView', created, 'POST /permission-sets');
      expect(created.name).toBe(name);
      expect(created.permissions).toEqual([firstKey]);

      const updated = await client.admin.permissions.updateSet(created.id, {
        name,
        description: 'Updated by the SDK integration suite.',
        permissions: [secondKey],
      });
      assertMatchesSchema('PermissionSetView', updated, 'PATCH /permission-sets/{id}');
      // The spec says permissions is a full replacement, not a merge.
      expect(updated.permissions).toEqual([secondKey]);

      const listed = await client.admin.permissions.listSets({ count: 100 });
      expect(listed.some((set) => set.id === created!.id)).toBe(true);
    } finally {
      if (created) {
        const result = await client.admin.permissions.deleteSet(created.id);
        assertMatchesSchema('PermissionSetDeleteResult', result, 'DELETE /permission-sets/{id}');
      }
    }
  });
});
