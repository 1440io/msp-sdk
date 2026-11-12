import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

/**
 * Load `.env.local` into `process.env` without a dependency.
 *
 * Values already present in the environment win, so CI secrets and one-off
 * `MSP_TEST_ALLOW_SEND=1 npm run test:integration` overrides both work.
 */
function loadEnvFile(filename: string): void {
  let contents: string;
  try {
    contents = readFileSync(resolve(REPO_ROOT, filename), 'utf8');
  } catch {
    return; // Absent is fine — the environment may already carry everything.
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile('.env.local');

function str(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

function flag(name: string): boolean {
  const value = str(name)?.toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function int(name: string, fallback: number): number {
  const value = Number(str(name));
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Every knob the integration suite reads.
 *
 * The tiers are deliberately separate: credentials alone unlock nothing beyond
 * reads, and each escalation — writing records, sending a message a person will
 * see, ringing a real phone — needs its own explicit opt-in.
 */
export const env = {
  /** Integration API key (`msp_…`). Without it the whole suite skips. */
  apiKey: str('MSP_API_KEY'),
  /** Host under test. */
  baseUrl: str('MSP_BASE_URL') ?? 'https://1440.cloud',
  /** Webhook signing secret (`whsec_…`), for the verification tests. */
  webhookSecret: str('MSP_WEBHOOK_SECRET'),

  /** Tier 1 — create and delete real records (templates, assets, permission sets). */
  allowWrites: flag('MSP_TEST_ALLOW_WRITES'),
  /** Tier 2 — deliver a real message into `conversationId`. A person may read it. */
  allowSend: flag('MSP_TEST_ALLOW_SEND'),
  /** Tier 3 — initiate to `phoneNumber`. A real device gets an Apple Messages request. */
  allowInitiate: flag('MSP_TEST_ALLOW_INITIATE'),

  /** Conversation the send tests target. Required by tier 2. */
  conversationId: str('MSP_TEST_CONVERSATION_ID'),
  /** E.164 number the initiation tests target. Required by tier 3. */
  phoneNumber: str('MSP_TEST_PHONE_NUMBER'),
  /** Integration whose delivery log the webhook tests read. */
  integrationId: str('MSP_TEST_INTEGRATION_ID'),
  /** Channel used where a test has to pick one. */
  channel: (str('MSP_TEST_CHANNEL') ?? 'amb') as 'amb' | 'tiktok',

  /** Run the tunnel-backed live webhook test. */
  webhookLive: flag('MSP_TEST_WEBHOOK_LIVE'),
  /** Port the live receiver listens on. */
  webhookPort: int('MSP_TEST_WEBHOOK_PORT', 3000),
  /** How long the live test waits for a delivery to arrive. */
  webhookTimeoutMs: int('MSP_TEST_WEBHOOK_TIMEOUT_MS', 120_000),

  /**
   * Treat an undocumented property in a live response as a failure rather than
   * a warning. Off by default: the server running ahead of the spec additively
   * is normal, while a missing required field or a bad enum never is.
   */
  strictSchema: flag('MSP_TEST_STRICT_SCHEMA'),

  /** Print every request and response the suite makes. */
  verbose: flag('MSP_TEST_VERBOSE'),
} as const;

/** True when the suite has credentials to talk to the API at all. */
export const hasCredentials = env.apiKey !== undefined;

/**
 * A per-run marker stamped into everything this suite creates, so orphans left
 * by a crashed run are obvious and `npm run integration:cleanup` can sweep them.
 */
export const RUN_ID = `msp-it-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

/** Prefix every test-created record carries. */
export const RESOURCE_PREFIX = 'msp-it-';

/** Name a test-created record so the cleanup sweep can find it later. */
export function resourceName(label: string): string {
  return `${RESOURCE_PREFIX}${label}-${RUN_ID.slice(-6)}`;
}
