import { afterAll, beforeAll } from 'vitest';
import { env, RUN_ID, hasCredentials } from './env.ts';
import { reportSchemaWarnings } from './schema.ts';

beforeAll(() => {
  if (!hasCredentials) return;
  const tiers = [
    'read',
    env.allowWrites ? 'write' : null,
    env.allowSend ? 'SEND' : null,
    env.allowInitiate ? 'INITIATE' : null,
  ]
    .filter(Boolean)
    .join(' + ');
  console.log(`\n▸ ${env.baseUrl} · tiers: ${tiers} · run ${RUN_ID}`);
});

afterAll(() => {
  reportSchemaWarnings();
});
