/** Recent conversations, newest first — to find the live AMB thread to test against. */
import { MspClient } from '@1440io/msp-api';
import { env } from '../env.ts';
const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });
const page = await client.conversations.list({ count: 12 });
const rows = (page as unknown as Record<string, any>)['conversations'] ?? [];
for (const c of rows as Record<string, any>[]) {
  const mark = c['id'] === env.conversationId ? '  ← the one we have been testing' : '';
  console.log(`  ${c['id']}  ${String(c['status'] ?? '').padEnd(10)} ${String(c['channel'] ?? c['platform'] ?? '')}  upd ${c['updatedAt'] ?? c['createdAt'] ?? ''}${mark}`);
}
