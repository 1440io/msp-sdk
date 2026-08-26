/**
 * Check credentials and print exactly what a run would touch, before anything
 * is sent. Run this first — especially against production.
 */
import { isMspApiError, MspClient } from '@1440io/msp-api';
import { env, hasCredentials, RUN_ID } from '../env.ts';

const check = (ok: boolean) => (ok ? '✓' : '✗');

if (!hasCredentials) {
  console.error('✗ MSP_API_KEY is not set. Copy .env.example to .env.local and fill it in.');
  process.exit(1);
}

console.log(`\n1440 MSP integration preflight — run ${RUN_ID}`);
console.log(`  host: ${env.baseUrl}\n`);

const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });

const token = await client.auth.exchangeIntegrationToken(env.apiKey!).catch((error: unknown) => {
  console.error(
    `✗ Token exchange failed: ${isMspApiError(error) ? `${error.status} ${error.message}` : String(error)}`,
  );
  process.exit(1);
});

console.log(`${check(true)} API key exchanges for a JWT (expires ${token.expiresAt})`);
console.log(`  tier: ${token.grant.tier}`);
console.log(`  permissions: ${token.grant.permissionKeys?.join(', ') || '(none listed)'}`);

const context = await client.admin.context().catch(() => undefined);
if (context) {
  console.log(`\n  business: ${context.business.name} (${context.business.slug})`);
  console.log(`  business id: ${context.business.id}`);
} else {
  console.log('\n  business context unavailable (integration lacks the admin tier)');
}

const channels = await client.channels.list().catch(() => []);
console.log(`  channels: ${channels.map((c) => `${c.platform}`).join(', ') || '(none)'}`);

const conversations = await client.conversations.list({ count: 1 }).catch(() => undefined);
console.log(`  conversations reachable: ${conversations ? 'yes' : 'no'}`);

console.log('\nTiers enabled for this run:');
console.log(`  ${check(true)} read-only routes`);
console.log(
  `  ${check(env.allowWrites)} writes — create/delete templates, assets, permission sets` +
    (env.allowWrites ? '' : '  (MSP_TEST_ALLOW_WRITES=1)'),
);
console.log(
  `  ${check(env.allowSend && !!env.conversationId)} REAL SENDS into ${env.conversationId ?? '(no conversation set)'}` +
    (env.allowSend ? '' : '  (MSP_TEST_ALLOW_SEND=1 + MSP_TEST_CONVERSATION_ID)'),
);
console.log(
  `  ${check(env.allowInitiate && !!env.phoneNumber)} REAL INITIATIONS to ${env.phoneNumber ?? '(no number set)'}` +
    (env.allowInitiate ? '' : '  (MSP_TEST_ALLOW_INITIATE=1 + MSP_TEST_PHONE_NUMBER)'),
);
console.log(`  ${check(!!env.webhookSecret)} webhook signature tests`);
console.log(`  ${check(!!env.integrationId)} delivery-log tests`);
console.log(`  ${check(env.webhookLive)} live webhook test (port ${env.webhookPort})`);

if (env.conversationId) {
  const target = await client.conversations.get(env.conversationId, { count: 1 }).catch(() => undefined);
  if (!target) {
    console.warn(`\n⚠ MSP_TEST_CONVERSATION_ID ${env.conversationId} is not readable — send tests will fail.`);
  } else {
    const name = [target.firstName, target.lastName].filter(Boolean).join(' ') || '(unnamed)';
    console.log(`\n  send target: ${name} · ${target.channelPlatform} · status ${target.status}`);
    if (target.optedOut) console.warn('  ⚠ this customer has opted out of messaging');
  }
}

const destructive = (env.allowSend && env.conversationId) || (env.allowInitiate && env.phoneNumber);
if (destructive) {
  console.warn(
    '\n⚠ This run will contact real people on ' +
      `${env.baseUrl}. Messages land in a live conversation and initiations ring a real device.`,
  );
}

console.log('\nRun the suite with: npm run test:integration\n');
