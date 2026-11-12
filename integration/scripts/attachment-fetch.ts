/** Resolve an attachment's access URL via the API and download the bytes. */
import { writeFileSync } from 'node:fs';
import { MspClient } from '@1440io/msp-api';
import { env } from '../env.ts';
const [attachmentId, out] = process.argv.slice(2);
const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });
const r = await client.media.getAccessUrl(attachmentId!) as unknown as Record<string, any>;
const url = r['accessUrl'] ?? r['url'];
console.log(`  access url resolved, expires ${r['accessUrlExpiresAt'] ?? r['expiresAt'] ?? '(n/a)'}`);
const res = await fetch(url);
console.log(`  download ${res.status} ${res.headers.get('content-type')}`);
const buf = Buffer.from(await res.arrayBuffer());
writeFileSync(out!, buf);
console.log(`  wrote ${out} (${buf.length} bytes)`);
