import { describe } from 'vitest';
import { env, hasCredentials } from './env.ts';

/** Skip a whole file unless the condition holds, saying why in the run output. */
export function describeIf(condition: boolean, reason: string) {
  return (name: string, fn: () => void): void => {
    if (condition) describe(name, fn);
    else describe.skip(`${name} — skipped: ${reason}`, fn);
  };
}

/** Read-only routes. Needs credentials and nothing else. */
export const describeApi = describeIf(hasCredentials, 'set MSP_API_KEY in .env.local');

/** Creates and deletes real records; everything is cleaned up afterwards. */
export const describeWrites = describeIf(
  hasCredentials && env.allowWrites,
  'set MSP_TEST_ALLOW_WRITES=1 to let tests create and delete records',
);

/** Delivers a real message a person may read. */
export const describeSend = describeIf(
  hasCredentials && env.allowSend && env.conversationId !== undefined,
  'set MSP_TEST_ALLOW_SEND=1 and MSP_TEST_CONVERSATION_ID to send a real message',
);

/** Rings a real device with an Apple Messages request. */
export const describeInitiate = describeIf(
  hasCredentials && env.allowInitiate && env.phoneNumber !== undefined,
  'set MSP_TEST_ALLOW_INITIATE=1 and MSP_TEST_PHONE_NUMBER to initiate for real',
);

/** Signature tests that need the real signing secret. */
export const describeWebhookSecret = describeIf(
  env.webhookSecret !== undefined,
  'set MSP_WEBHOOK_SECRET in .env.local',
);

/** The tunnel-backed live webhook test. */
export const describeWebhookLive = describeIf(
  hasCredentials && env.webhookSecret !== undefined && env.webhookLive,
  'set MSP_TEST_WEBHOOK_LIVE=1 (and expose the local receiver) for the live test',
);
