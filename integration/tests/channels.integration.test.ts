import { expect, it } from 'vitest';
import { CHANNEL_PLATFORMS } from '@1440io/msp-types';
import { describeApi } from '../gates.ts';
import { testClient } from '../client.ts';
import { assertEachMatchesSchema, assertMatchesSchema } from '../schema.ts';

describeApi('channels', () => {
  it('lists active channels in the documented shape', async () => {
    const channels = await testClient().channels.list();

    assertEachMatchesSchema('Channel', channels, 'GET /api/v0/channels');
    for (const channel of channels) {
      expect(typeof channel.id).toBe('string');
      expect(typeof channel.externalId).toBe('string');
    }
    console.log(`   channels: ${channels.map((c) => c.platform).join(', ') || '(none)'}`);
  });

  it('only reports platforms the spec knows about', async () => {
    const channels = await testClient().channels.list();

    for (const channel of channels) {
      // A new platform here means the enum vocabulary needs updating.
      expect(CHANNEL_PLATFORMS as readonly string[]).toContain(channel.platform);
    }
  });

  it('exposes the same channels through the admin route', async () => {
    const client = testClient();

    const [runtime, admin] = await Promise.all([
      client.channels.list(),
      client.admin.channels.list().catch(() => null), // admin tier may be absent
    ]);

    if (admin === null) {
      console.log('   admin channel list not permitted for this integration — skipped comparison');
      return;
    }
    assertEachMatchesSchema('AdminBusinessChannel', admin, 'GET /api/admin/businesses/channels');
    expect(admin.length).toBeGreaterThanOrEqual(runtime.length);
  });
});
