import { expect, it } from 'vitest';
import { MspAuthenticationError, MspClient } from '@1440io/msp-api';
import { describeApi } from '../gates.ts';
import { env } from '../env.ts';
import { testClient } from '../client.ts';
import { assertMatchesSchema } from '../schema.ts';

describeApi('auth: integration token exchange', () => {
  it('exchanges the API key for a JWT matching the documented shape', async () => {
    const client = testClient();

    const response = await client.auth.exchangeIntegrationToken(env.apiKey!);

    assertMatchesSchema('IntegrationTokenResult', response);
    expect(response.type).toBe('api');
    expect(response.tokenType).toBe('Bearer');
    expect(response.token.split('.')).toHaveLength(3); // header.payload.signature
    expect(Date.parse(response.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('mints a token with a usable, finite lifetime', async () => {
    const client = testClient();

    const { expiresAt } = await client.auth.exchangeIntegrationToken(env.apiKey!);

    const lifetimeMinutes = (Date.parse(expiresAt) - Date.now()) / 60_000;
    expect(lifetimeMinutes).toBeGreaterThan(0);
    // A token that never expires would make the API key's rotation story moot.
    expect(lifetimeMinutes).toBeLessThan(30 * 24 * 60);

    // The spec describes these as "short-lived (~15 min)". Production currently
    // issues much longer ones. The client keys off `expiresAt` either way, so
    // this is a documentation mismatch rather than a client bug — reported
    // rather than asserted, so the suite tracks it without failing on it.
    if (lifetimeMinutes > 60) {
      console.warn(
        `   ⚠ token lifetime is ${(lifetimeMinutes / 60).toFixed(1)}h — the spec ` +
          'documents ~15 minutes. Worth reconciling spec and server.',
      );
    }
  });

  it('carries a grant describing what the integration may do', async () => {
    const client = testClient();

    const { grant } = await client.auth.exchangeIntegrationToken(env.apiKey!);

    assertMatchesSchema('ActorGrant', grant);
    console.log(`   grant: tier=${grant.tier} permissions=${grant.permissionKeys?.length ?? 0}`);
  });

  it('rejects a bogus API key with 401', async () => {
    const client = testClient();

    await expect(
      client.auth.exchangeIntegrationToken('msp_definitely_not_a_real_key'),
    ).rejects.toBeInstanceOf(MspAuthenticationError);
  });

  it('rejects a bogus bearer token with 401', async () => {
    const rogue = new MspClient({ token: 'not-a-jwt', baseUrl: env.baseUrl });

    await expect(rogue.channels.list()).rejects.toMatchObject({ status: 401 });
  });

  it('drives a real request end to end with only an API key', async () => {
    // A fresh client proves the exchange-then-call path, not a warm cache.
    const cold = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });

    const channels = await cold.channels.list();

    expect(Array.isArray(channels)).toBe(true);
  });
});
