import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against a live API, so they are deliberately serial:
 * shared org state, real rate limits, and cleanup that must not race.
 *
 * Kept out of `vitest.config.ts` so `npm test` stays offline and fast.
 */
export default defineConfig({
  test: {
    include: ['integration/tests/**/*.integration.test.ts'],
    setupFiles: ['integration/setup.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    sequence: { concurrent: false },
    retry: 0,
    reporters: ['verbose'],
  },
});
