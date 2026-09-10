/** Drives the spike: dedupe, ordering, correlation, and signature rejection. */
const BASE = process.env.BASE ?? 'http://localhost:8787';
const SECRET = 'whsec_c3Bpa2UtdGVzdC1zZWNyZXQtbm90LWEtcmVhbC1vbmUtMzJi';
const CONV = '0196f1f8-4a2b-7a31-8f5c-0d9e7b6a5678';

async function sign(id, ts, body) {
  const key = await crypto.subtle.importKey(
    'raw', Uint8Array.from(atob(SECRET.replace(/^whsec_/, '')), c => c.charCodeAt(0)),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  return `v1,${btoa(String.fromCharCode(...mac))}`;
}

const envelope = (eventId, content) => ({
  eventId, v: 1, type: 'message.received', organizationId: 'org_1',
  conversationId: CONV, channelAddress: 'urn:mbid:AQAAY',
  intentId: null, groupId: null, locale: 'en-US', capabilityList: ['QUICK', 'LIST'],
  message: {
    id: crypto.randomUUID(), channel: 'amb', externalId: 'urn:mbid:AQAAY',
    createdAt: new Date().toISOString(), attachments: [],
    actor: { type: 'customer' }, redacted: false, content,
  },
});

async function deliver(event, { corrupt = false } = {}) {
  const body = JSON.stringify(event);
  const ts = Math.floor(Date.now() / 1000);
  const sig = await sign(event.eventId, ts, body);
  return fetch(`${BASE}/webhooks/1440`, { method: 'POST', body: corrupt ? body.replace('amb', 'xxx') : body,
    headers: { 'webhook-id': event.eventId, 'webhook-timestamp': String(ts), 'webhook-signature': sig } });
}
const conv = (action, payload) => fetch(`${BASE}/conv/${CONV}/${action}`, { method: 'POST', body: JSON.stringify(payload) });
const state = async () => (await conv('state', {})).json();

await conv('reset', {});   // start from a clean object

console.log('\n1. Signature verification at the edge');
const bad = await deliver(envelope(crypto.randomUUID(), { kind: 'text', body: 'x' }), { corrupt: true });
console.log(`   tampered body        -> ${bad.status} ${JSON.stringify((await bad.json()).error).slice(0, 48)}…`);

console.log('\n2. Dedupe — the same Webhook-Id delivered twice');
const dupEvent = envelope(crypto.randomUUID(), { kind: 'text', body: 'Hello from the edge' });
const d1 = await deliver(dupEvent); const d2 = await deliver(dupEvent);
console.log(`   first  -> ${d1.status} ${JSON.stringify(await d1.json())}`);
console.log(`   retry  -> ${d2.status} ${JSON.stringify(await d2.json())}`);

console.log('\n3. Ordering — two concurrent sends into one conversation');
await Promise.all([conv('send', { label: 'A', delayMs: 300 }), conv('send', { label: 'B', delayMs: 10 })]);
const s3 = await state();
console.log(`   order  -> ${s3.order.join(' → ')}`);
const interleaved = s3.order.some((v, i) => v.endsWith(':start') && s3.order[i + 1]?.endsWith(':start'));
console.log(`   interleaved? ${interleaved ? 'YES — handlers overlapped' : 'no — each send completed before the next began'}`);
console.log(`   note: A was given a 300ms delay and B only 10ms, so B finishing`);
console.log(`         after A is the proof, not an accident of timing.`);

console.log('\n4. Correlation — a rich prompt, then the tap that answers it');
const requestIdentifier = crypto.randomUUID();
const p = await conv('prompt', { requestIdentifier, question: 'Pick a size' });
console.log(`   prompt stored, follow-up alarm set: ${!!(await p.json()).alarmAt}`);
await deliver(envelope(crypto.randomUUID(), {
  kind: 'amb.list_picker_response',
  sessionIdentifier: null,
  data: {
    requestIdentifier,
    listPicker: { sections: [{ title: 'Sizes', items: [{ identifier: 'large', title: 'Large' }] }] },
  },
}));
const s4 = await state();
console.log(`   log    -> ${s4.log.join(' | ')}`);
console.log(`   alarm cleared after answer: ${s4.alarmAt === null}`);

console.log('\n5. Isolation — a different conversation is a different object');
const other = await fetch(`${BASE}/conv/11111111-2222-7333-8444-555555555555/state`, { method: 'POST', body: '{}' });
console.log(`   other conversation log length: ${(await other.json()).log.length} (expected 0)\n`);
