import { expect, it } from 'vitest';
import { MspConfigError, MAX_UPLOAD_BYTES, isMspApiError } from '@1440io/msp-api';
import { describeApi, describeWrites } from '../gates.ts';
import { env, resourceName } from '../env.ts';
import { testClient } from '../client.ts';
import { assertMatchesSchema } from '../schema.ts';

/** The smallest valid PNG: a 1x1 transparent pixel. */
const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
      'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

describeWrites('media: upload and access', () => {
  it('uploads bytes and returns a media asset id', async () => {
    const result = await testClient().media.upload({
      body: ONE_PIXEL_PNG,
      filename: `${resourceName('pixel')}.png`,
      contentType: 'image/png',
      targetChannel: 'amb',
    });

    assertMatchesSchema('MediaUploadSuccess', result, 'POST /api/v0/media/upload');
    expect(result.mediaAssetId).toMatch(/^[0-9a-f-]{36}$/i);
    console.log(`   uploaded ${result.mediaAssetId}`);
  });

  it('does not accept an uploaded mediaAssetId as an attachment id', async () => {
    const client = testClient();
    const { mediaAssetId } = await client.media.upload({
      body: ONE_PIXEL_PNG,
      filename: `${resourceName('readable')}.png`,
      contentType: 'image/png',
    });

    const error = await client.media.getAccessUrl(mediaAssetId).catch((e: unknown) => e);

    // The spec says to reference the returned mediaAssetId as the attachmentId
    // when minting a read URL — in both the upload description and on
    // MediaUploadSuccess. Measured against production it is a 404, before and
    // after the asset is attached to a message: uploading creates a media
    // asset, and attaching it mints a *separate* attachment with its own id.
    // Read that id off message history or an inbound webhook instead.
    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && error.status).toBe(404);
  });

  it('mints a signed, short-lived read URL for an attachment from history', async () => {
    const client = testClient();
    const detail = await client.conversations.get(
      env.conversationId ?? (await client.conversations.list({ count: 1 })).conversations[0]!.id,
      { count: 25 },
    );
    const attachment = (detail.messages ?? [])
      .flatMap((message) => message.attachments ?? [])
      .find((item) => item.status === 'ready');

    if (!attachment) {
      console.log('   no ready attachment in this conversation — skipped');
      return;
    }

    const access = await client.media.getAccessUrl(attachment.id);

    assertMatchesSchema('MediaAccessUrlSuccess', access, 'GET .../access-url');
    expect(access.attachmentId).toBe(attachment.id);
    expect(access.url).toMatch(/^https:\/\//);
    // Documented as short-lived and signed — an unsigned or eternal URL would
    // mean attachment bytes are effectively public.
    expect(access.url).toMatch(/X-Amz-Signature|Signature=|token=/i);
    expect(Date.parse(access.expiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(access.expiresAt)).toBeLessThan(Date.now() + 24 * 60 * 60 * 1000);

    const response = await fetch(access.url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(bytes.length).toBeGreaterThan(0);
    console.log(`   served ${bytes.length} bytes for attachment ${attachment.id}`);
  });

  it('refuses an oversized asset before spending the upload', async () => {
    // Client-side ceiling check — no request should leave the process.
    await expect(
      testClient().media.upload({
        body: ONE_PIXEL_PNG,
        filename: 'huge.png',
        contentLength: MAX_UPLOAD_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(MspConfigError);
  });
});

describeApi('media: access control', () => {
  it('404s on an attachment id that does not exist', async () => {
    const error = await testClient()
      .media.getAccessUrl('01890000-0000-7000-8000-00000000c0de')
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect([403, 404]).toContain(isMspApiError(error) ? error.status : 0);
  });
});

describeWrites('media: rich asset library', () => {
  it('uploads a library asset and deletes it again', async () => {
    const client = testClient();
    const displayName = resourceName('asset');
    let assetId: string | undefined;

    try {
      const asset = await client.admin.templates.uploadAsset({
        channel: 'amb',
        usage: 'rich_image_200',
        displayName,
        file: ONE_PIXEL_PNG,
        filename: `${displayName}.png`,
        contentType: 'image/png',
      });
      assetId = asset.id;

      assertMatchesSchema('RichAssetItem', asset, 'POST /admin/businesses/templates/assets');
      expect(asset.displayName).toBe(displayName);
      expect(asset.channel).toBe('amb');
      expect(asset.usage).toBe('rich_image_200');
      expect(asset.sizeBytes).toBe(ONE_PIXEL_PNG.length);

      const page = await client.admin.templates.listAssets({
        channel: 'amb',
        usage: 'rich_image_200',
        count: 100,
      });
      expect(page.assets.some((item) => item.id === assetId)).toBe(true);
    } finally {
      if (assetId) {
        const result = await client.admin.templates.deleteAsset(assetId);
        assertMatchesSchema('RichAssetDeleteResult', result, 'DELETE .../assets/{id}');
      }
    }
  });
});
