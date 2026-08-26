import { expect, it } from 'vitest';
import { MspConfigError, MAX_TIKTOK_UPLOAD_BYTES, isMspApiError } from '@1440io/msp-api';
import { describeApi, describeWrites } from '../gates.ts';
import { resourceName } from '../env.ts';
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

  it('mints a signed, short-lived read URL for an uploaded asset', async () => {
    const client = testClient();
    const { mediaAssetId } = await client.media.upload({
      body: ONE_PIXEL_PNG,
      filename: `${resourceName('readable')}.png`,
      contentType: 'image/png',
    });

    const access = await client.media.getAccessUrl(mediaAssetId);

    assertMatchesSchema('MediaAccessUrlSuccess', access, 'GET .../access-url');
    expect(access.attachmentId).toBe(mediaAssetId);
    expect(access.url).toMatch(/^https:\/\//);
    // Documented as short-lived and signed — an unsigned or eternal URL would
    // mean attachment bytes are effectively public.
    expect(access.url).toMatch(/X-Amz-Signature|Signature=|token=/i);
    expect(Date.parse(access.expiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(access.expiresAt)).toBeLessThan(Date.now() + 24 * 60 * 60 * 1000);
  });

  it('serves the exact bytes back through the signed URL', async () => {
    const client = testClient();
    const { mediaAssetId } = await client.media.upload({
      body: ONE_PIXEL_PNG,
      filename: `${resourceName('roundtrip')}.png`,
      contentType: 'image/png',
    });

    const { url } = await client.media.getAccessUrl(mediaAssetId);
    const response = await fetch(url);
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(bytes.length).toBe(ONE_PIXEL_PNG.length);
    expect([...bytes]).toEqual([...ONE_PIXEL_PNG]);
  });

  it('rejects a TikTok-destined asset that is not JPEG or PNG', async () => {
    const error = await testClient()
      .media.upload({
        body: new TextEncoder().encode('not an image'),
        filename: `${resourceName('bad')}.txt`,
        contentType: 'text/plain',
        targetChannel: 'tiktok',
      })
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect(isMspApiError(error) && error.status).toBe(400);
  });

  it('refuses an oversized TikTok asset before spending the upload', async () => {
    // Client-side ceiling check — no request should leave the process.
    await expect(
      testClient().media.upload({
        body: ONE_PIXEL_PNG,
        filename: 'huge.png',
        targetChannel: 'tiktok',
        contentLength: MAX_TIKTOK_UPLOAD_BYTES + 1,
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
        usage: 'interactive_image',
        displayName,
        file: ONE_PIXEL_PNG,
        filename: `${displayName}.png`,
        contentType: 'image/png',
      });
      assetId = asset.id;

      assertMatchesSchema('RichAssetItem', asset, 'POST /admin/businesses/templates/assets');
      expect(asset.displayName).toBe(displayName);
      expect(asset.channel).toBe('amb');
      expect(asset.usage).toBe('interactive_image');
      expect(asset.sizeBytes).toBe(ONE_PIXEL_PNG.length);

      const page = await client.admin.templates.listAssets({
        channel: 'amb',
        usage: 'interactive_image',
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
