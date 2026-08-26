import { MspClient } from '@1440io/msp-api';
import { env, hasCredentials } from './env.ts';

let shared: MspClient | undefined;

/**
 * The client every test shares, so one token is minted for the whole run
 * rather than one per file.
 */
export function testClient(): MspClient {
  if (!hasCredentials) {
    throw new Error('MSP_API_KEY is not set — this test should have been skipped');
  }
  shared ??= new MspClient({
    apiKey: env.apiKey!,
    baseUrl: env.baseUrl,
    userAgent: '@1440io/msp-api integration-tests',
    // Live tests should surface a flaky API rather than paper over it, but a
    // single retry keeps a transient blip from failing the whole run.
    retry: { maxRetries: 1, initialDelayMs: 750 },
    timeoutMs: 30_000,
    ...(env.verbose
      ? {
          onRequest: ({ method, url, attempt }) =>
            console.log(`→ ${method} ${url}${attempt > 1 ? ` (attempt ${attempt})` : ''}`),
          onResponse: ({ status, durationMs }) => console.log(`← ${status} in ${durationMs}ms`),
        }
      : {}),
  });
  return shared;
}
