import { MspClient } from '@1440io/msp-api';
import { env } from '../env.ts';
const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });
const target = process.argv[2]!;
const assetId = process.argv[3];
for (let i = 0; i < 6; i++) {
  const d = await client.conversations.get(env.conversationId!, { count: 8 });
  const rows = (d.messages ?? []) as unknown as Record<string, any>[];
  const m = rows.find(r => r['id'] === target);
  if (m) {
    const att = (m['attachments'] ?? []) as Record<string, any>[];
    console.log(`\n  ${m['createdAt']}  kind=${m['content']?.['kind']}  body=${JSON.stringify(m['content']?.['body'])}`);
    for (const a of att) {
      console.log(`  attachment ${a['id']}`);
      console.log(`    status=${a['status']}  mime=${a['mimeType']}  size=${a['sizeBytes']}  name=${a['originalFileName']}`);
      console.log(`    accessUrl=${a['accessUrl'] ? 'present' : 'null'}`);
      if (assetId) console.log(`    same id as the uploaded media asset? ${a['id'] === assetId ? 'YES' : 'NO — they are different ids'}`);
    }
    if (att.every(a => a['status'] === 'ready')) { console.log(); process.exit(0); }
  }
  await new Promise(r => setTimeout(r, 5000));
}
console.log('\n  still not ready after 30s\n');
