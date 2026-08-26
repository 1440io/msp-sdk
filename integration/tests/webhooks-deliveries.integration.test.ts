import { expect, it } from 'vitest';
import { isMspApiError } from '@1440io/msp-api';
import { describeDeliveries } from '../gates.ts';
import { env } from '../env.ts';
import { testClient } from '../client.ts';
import { assertEachMatchesSchema, assertMatchesSchema } from '../schema.ts';

describeDeliveries('webhooks: the delivery log', () => {
  it('returns recorded deliveries in the documented shape', async () => {
    const deliveries = await testClient().admin.integrations.listDeliveries(env.integrationId!);

    assertEachMatchesSchema('IntegrationDelivery', deliveries, 'GET .../deliveries');
    console.log(`   ${deliveries.length} delivery record(s)`);
  });

  it('only records event types this SDK knows how to parse', async () => {
    const deliveries = await testClient().admin.integrations.listDeliveries(env.integrationId!);

    for (const delivery of deliveries) {
      // A type outside this set means the SDK's WebhookEvent union is stale.
      expect(['message.received', 'initiation.updated']).toContain(delivery.eventType);
    }
  });

  it('reports a coherent attempt history', async () => {
    const deliveries = await testClient().admin.integrations.listDeliveries(env.integrationId!);

    for (const delivery of deliveries) {
      expect(delivery.attemptCount).toBeGreaterThanOrEqual(1);
      if (delivery.status === 'delivered') {
        // A delivery marked successful must carry the 2xx that earned it.
        expect(delivery.lastHttpStatus).toBeGreaterThanOrEqual(200);
        expect(delivery.lastHttpStatus).toBeLessThan(300);
      }
      if (delivery.status === 'failed' || delivery.status === 'dead') {
        // A failure with no diagnosis is not actionable.
        expect(delivery.failureCode ?? delivery.failureMessage ?? delivery.lastHttpStatus).not.toBe(
          null,
        );
      }
      if (delivery.status === 'dead') {
        // Abandoned only after the documented retry schedule ran out.
        expect(delivery.attemptCount).toBeGreaterThan(1);
      }
    }
  });

  it('surfaces the integration that owns the log, with its subscribed events', async () => {
    const integration = await testClient().admin.integrations.get(env.integrationId!);

    assertMatchesSchema('Integration', integration, 'GET /integrations/{id}');
    expect(integration.id).toBe(env.integrationId);
    console.log(
      `   ${integration.name}: outbound=${integration.outboundEnabled} ` +
        `events=${(integration.subscribedEvents ?? []).join(',') || '(none)'} ` +
        `endpoint=${integration.endpointUrl ?? '(unset)'}`,
    );

    if (integration.outboundEnabled) {
      // Deliveries cannot arrive anywhere without an endpoint configured.
      expect(integration.endpointUrl).not.toBeNull();
    }
    if (integration.autoDisabledAt !== null) {
      console.warn(
        `   ⚠ outbound delivery was auto-disabled at ${integration.autoDisabledAt} ` +
          '(a 410 Gone is terminal — re-enable it in the console)',
      );
    }
  });

  it('404s on an integration id that does not exist', async () => {
    const error = await testClient()
      .admin.integrations.get('01890000-0000-7000-8000-0000000000aa')
      .catch((e: unknown) => e);

    expect(isMspApiError(error)).toBe(true);
    expect([403, 404]).toContain(isMspApiError(error) ? error.status : 0);
  });
});
