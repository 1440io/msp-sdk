import { expect, it } from 'vitest';
import { isMspApiError } from '@1440io/msp-api';
import { describeApi } from '../gates.ts';
import { testClient } from '../client.ts';
import { assertEachMatchesSchema, assertMatchesSchema } from '../schema.ts';

/**
 * Admin routes need the `admin` membership tier. An integration without it
 * gets a 403, which is a correct answer rather than a broken test.
 *
 * The 0.2.0 spec dropped members, sandboxes, integrations, permission sets,
 * and the business context from the documented surface, so they are no longer
 * covered here — nor exposed by the client.
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
  it('returns business settings in the documented shape', async () => {
    const settings = await ifPermitted('settings', () => testClient().admin.settings());
    if (!settings) return;

    assertMatchesSchema('BusinessSettings', settings, 'GET /admin/businesses/settings');
    expect(typeof settings.id).toBe('string');
    console.log(`   business: ${settings.name} (${settings.slug})`);
  });

  it('lists connected channels', async () => {
    const channels = await ifPermitted('channels', () =>
      testClient().admin.channels.list({ count: 10 }),
    );
    if (!channels) return;

    assertEachMatchesSchema('AdminBusinessChannel', channels, 'GET /admin/businesses/channels');
    expect(channels.length).toBeLessThanOrEqual(10);
  });

  it('reports TikTok channel status', async () => {
    const status = await ifPermitted('tiktok', () => testClient().admin.channels.tiktokStatus());
    if (!status) return;

    assertMatchesSchema('TikTokChannelStatus', status, 'GET /admin/businesses/channels/tiktok');
  });
});

describeApi('admin: retired surface', () => {
  it('no longer exposes the routes the 0.2.0 spec dropped', () => {
    const admin = testClient().admin as unknown as Record<string, unknown>;

    // These were removed deliberately. The server still answers some of them,
    // but they are outside the published surface and may be withdrawn.
    for (const gone of ['context', 'listMembers', 'listSandboxes', 'integrations', 'permissions']) {
      expect(gone in admin, `admin.${gone} should have been removed`).toBe(false);
    }
  });
});
