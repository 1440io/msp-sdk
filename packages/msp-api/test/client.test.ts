import { describe, expect, it } from 'vitest';
import { MspClient, MspConfigError, DEFAULT_BASE_URL } from '../src/index.js';
import { stubFetch, tokenResponse } from './helpers.js';

describe('MspClient construction', () => {
  it('requires exactly one credential', () => {
    expect(() => new MspClient()).toThrow(MspConfigError);
    expect(() => new MspClient({ apiKey: 'msp_x', token: 'jwt' })).toThrow(MspConfigError);
  });

  it('defaults to the production host and trims a trailing slash', () => {
    expect(new MspClient({ token: 'jwt' }).baseUrl).toBe(DEFAULT_BASE_URL);
    expect(new MspClient({ token: 'jwt', baseUrl: 'https://staging.1440.cloud/' }).baseUrl).toBe(
      'https://staging.1440.cloud',
    );
  });
});

describe('authentication', () => {
  it('exchanges an API key once and reuses the token across calls', async () => {
    const { fetch, requests } = stubFetch([
      tokenResponse('jwt-1'),
      { body: { channels: [] } },
      { body: { channels: [] } },
    ]);
    const client = new MspClient({ apiKey: 'msp_secret', fetch });

    await client.channels.list();
    await client.channels.list();

    expect(requests).toHaveLength(3);
    expect(requests[0]!.url).toBe(`${DEFAULT_BASE_URL}/api/auth/integration/token`);
    expect(requests[0]!.headers['authorization']).toBe('Bearer msp_secret');
    expect(requests[1]!.headers['authorization']).toBe('Bearer jwt-1');
    expect(requests[2]!.headers['authorization']).toBe('Bearer jwt-1');
  });

  it('collapses a burst of cold requests onto a single exchange', async () => {
    const { fetch, requests } = stubFetch([
      tokenResponse('jwt-1'),
      { body: { channels: [] } },
      { body: { channels: [] } },
      { body: { channels: [] } },
    ]);
    const client = new MspClient({ apiKey: 'msp_secret', fetch });

    await Promise.all([client.channels.list(), client.channels.list(), client.channels.list()]);

    const exchanges = requests.filter((r) => r.url.endsWith('/api/auth/integration/token'));
    expect(exchanges).toHaveLength(1);
  });

  it('re-exchanges when the cached token is inside the refresh skew', async () => {
    const { fetch, requests } = stubFetch([
      tokenResponse('jwt-short', 10), // expires inside the 60s skew
      { body: { channels: [] } },
      tokenResponse('jwt-fresh'),
      { body: { channels: [] } },
    ]);
    const client = new MspClient({ apiKey: 'msp_secret', fetch });

    await client.channels.list();
    await client.channels.list();

    expect(requests.filter((r) => r.url.endsWith('/token'))).toHaveLength(2);
    expect(requests[3]!.headers['authorization']).toBe('Bearer jwt-fresh');
  });

  it('refreshes once and retries after a 401', async () => {
    const { fetch, requests } = stubFetch([
      tokenResponse('jwt-stale'),
      { status: 401, body: { error: 'Unauthorized' } },
      tokenResponse('jwt-new'),
      { body: { channels: [{ id: 'c1', platform: 'amb', externalId: 'urn:mbid:x' }] } },
    ]);
    const client = new MspClient({ apiKey: 'msp_secret', fetch });

    const channels = await client.channels.list();

    expect(channels).toHaveLength(1);
    expect(requests[3]!.headers['authorization']).toBe('Bearer jwt-new');
  });

  it('does not loop when the refreshed token is rejected too', async () => {
    const { fetch } = stubFetch([
      tokenResponse('jwt-1'),
      { status: 401, body: { error: 'Unauthorized' } },
      tokenResponse('jwt-2'),
      { status: 401, body: { error: 'Unauthorized' } },
    ]);
    const client = new MspClient({ apiKey: 'msp_secret', fetch });

    await expect(client.channels.list()).rejects.toMatchObject({ status: 401 });
  });

  it('sends a static token without any exchange', async () => {
    const { fetch, requests } = stubFetch([{ body: { channels: [] } }]);
    const client = new MspClient({ token: 'preminted', fetch });

    await client.channels.list();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers['authorization']).toBe('Bearer preminted');
  });
});
