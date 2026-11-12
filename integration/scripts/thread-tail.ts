/** Last N messages on a conversation: who, what kind, text, attachments. */
import { MspClient } from '@1440io/msp-api';
import { env } from '../env.ts';
const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });
const conv = process.argv[2] ?? env.conversationId!;
const n = Number(process.argv[3] ?? 14);
const d = await client.conversations.get(conv, { count: 50 });
const rows = ((d.messages ?? []) as unknown as Record<string, any>[])
  .sort((a,b)=>String(a['createdAt']).localeCompare(String(b['createdAt'])));
console.log();
for (const m of rows.slice(-n)) {
  const c = m['content'] ?? {};
  const att = (m['attachments'] ?? []) as any[];
  const who = m['actor']?.['type'] ?? '?';
  const body = c['body'] ?? c['data']?.['text'] ?? '';
  const txt = typeof body === 'string' ? body.replace(/\s+/g,' ').slice(0,96) : '';
  console.log(`${String(m['createdAt']).slice(11,19)} ${String(who).padEnd(8)} ${String(c['kind']??'-').padEnd(26)} att:${att.length} ${JSON.stringify(txt)}`);
}
console.log();
