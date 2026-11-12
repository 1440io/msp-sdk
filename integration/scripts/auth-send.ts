/**
 * AMB OAuth authentication request, with the brand logo attached.
 *
 * The oauth2 block carries NO client id and NO authorization endpoint — Apple
 * holds that configuration for the business. We supply only what varies per
 * request: scope, redirect, state, and the artwork.
 */
import { readFileSync } from 'node:fs';
import { MspClient, isMspApiError, uuidv7 } from '@1440io/msp-api';
import { env } from '../env.ts';

const logo = readFileSync(process.env['BRAND_LOGO']!).toString('base64');
const state = `auth-${Date.now()}`;

const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });
const content = {
  kind: 'amb.authentication',
  data: {
    authenticate: {
      oauth2: {
        responseType: 'code',
        scope: ['openid', 'profile', 'email'],
        redirectURI: 'https://msp.1440.co/functions/v1/amb-auth-callback',
        state,
      },
    },
    images: [{ identifier: 'brand-logo', data: logo, description: 'Brand logo' }],
  },
  receivedMessage: { title: 'Sign in to continue', subtitle: 'Securely verify your account', style: 'icon', imageIdentifier: 'brand-logo' },
  replyMessage: { title: 'Signed in', style: 'icon', imageIdentifier: 'brand-logo' },
} as never;

console.log(`\n  state: ${state}`);
console.log(`  logo:  ${Math.round(logo.length * 0.75)} decoded bytes (limit 200,000)\n`);

try {
  const r = await client.messaging.sendRaw({
    conversationId: process.argv[2] ?? env.conversationId!, requestMessageId: uuidv7(), content,
  });
  console.log(`  ✓ accepted — messageId ${r.messageId}  duplicate ${r.duplicate}\n`);
} catch (e) {
  if (!isMspApiError(e)) throw e;
  const b = e.body as { code?: string; error?: string; issues?: unknown[]; missingPermission?: string } | undefined;
  console.log(`  ✗ ${e.status} ${b?.code ?? ''} ${b?.error ?? ''}`);
  if (b?.missingPermission) console.log(`    missingPermission: ${b.missingPermission}`);
  if (b?.issues) console.log(`    issues: ${JSON.stringify(b.issues).slice(0, 500)}`);
  console.log();
}
