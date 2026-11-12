/**
 * Upload a video and send it as an attachment into the AMB test conversation.
 *
 * Two things worth remembering here:
 *  - upload returns a MEDIA ASSET id; attaching it mints a separate ATTACHMENT
 *    id, and only the latter works with media.getAccessUrl.
 *  - attachment sends have a documented ~17s budget for media transfer plus the
 *    Apple send, so a timeout leaves delivery genuinely uncertain. One send,
 *    fixed requestMessageId, no blind retry.
 */
import { readFileSync, statSync } from 'node:fs';
import { MspClient, isMspApiError, uuidv7 } from '@1440io/msp-api';
import { env } from '../env.ts';

const path = process.argv[2]!;
const conversationId = process.argv[3] ?? env.conversationId!;
const bytes = readFileSync(path);
const size = statSync(path).size;

const client = new MspClient({ apiKey: env.apiKey!, baseUrl: env.baseUrl });

console.log(`\n  file:         ${path.split('/').pop()}  (${(size / 1048576).toFixed(2)} MiB)`);
console.log(`  conversation: ${conversationId}\n`);

let assetId: string;
const t0 = Date.now();
try {
  const up = await client.media.upload({
    body: bytes,
    filename: path.split('/').pop()!,
    contentType: 'video/mp4',
    targetChannel: 'amb',
    contentLength: size,
    timeoutMs: 300_000,
  }) as unknown as Record<string, any>;
  assetId = (up['mediaAssetId'] ?? up['id']) as string;
  console.log(`  ✓ uploaded in ${((Date.now() - t0) / 1000).toFixed(1)}s — media asset ${assetId}`);
} catch (e) {
  if (!isMspApiError(e)) throw e;
  const b = e.body as { code?: string; error?: string; missingPermission?: string } | undefined;
  console.log(`  ✗ upload failed: ${e.status} ${b?.code ?? ''} ${b?.error ?? ''}`);
  if (b?.missingPermission) console.log(`    missingPermission: ${b.missingPermission}`);
  process.exit(1);
}

const requestMessageId = uuidv7();
console.log(`\n  sending… requestMessageId=${requestMessageId}`);
const t1 = Date.now();
try {
  const r = await client.messaging.sendText({
    conversationId,
    requestMessageId,
    body: 'Hertz × Decagon — S26 walkthrough',
    attachmentIds: [assetId],
    timeoutMs: 60_000,
  });
  console.log(`  ✓ accepted in ${((Date.now() - t1) / 1000).toFixed(1)}s — messageId ${r.messageId}  duplicate ${r.duplicate}\n`);
} catch (e) {
  if (!isMspApiError(e)) throw e;
  const b = e.body as { code?: string; error?: string; issues?: unknown[] } | undefined;
  console.log(`  ✗ send: ${e.status} ${b?.code ?? ''} ${b?.error ?? ''}  (after ${((Date.now() - t1) / 1000).toFixed(1)}s)`);
  if (b?.issues) console.log(`    issues ${JSON.stringify(b.issues).slice(0, 400)}`);
  if (e.status >= 500) console.log('\n    5xx on an attachment send: delivery is UNKNOWN, not failed. Check the\n    thread before resending — a retry can deliver a second copy.\n');
  process.exit(1);
}
