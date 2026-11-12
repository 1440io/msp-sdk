/** What rich objects does each conversation's device actually support? */
import { MspClient } from '@1440io/msp-api';
import { env } from '../env.ts';
const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });
const page = await client.conversations.list({ count: 12 });
const rows = ((page as unknown as Record<string, any>)['conversations'] ?? []) as Record<string, any>[];
console.log();
for (const c of rows) {
  const caps = (c['capabilityList'] ?? null) as string[] | null;
  const auth2 = caps?.includes('AUTH2') ? 'AUTH2 ✓' : caps ? 'AUTH2 ✗' : 'no list';
  console.log(`  ${c['id']}  ${auth2.padEnd(9)}  caps: ${caps ? caps.join(',') : '(null)'}  biz ${String(c['organizationId'] ?? '').slice(0, 8)}`);
}
console.log();
