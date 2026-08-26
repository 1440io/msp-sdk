# Examples

Runnable from the repo root after `npm install && npm run build`:

```bash
MSP_API_KEY=msp_… node --experimental-strip-types examples/list-conversations.ts
MSP_API_KEY=msp_… node --experimental-strip-types examples/send-message.ts <conversationId>
MSP_API_KEY=msp_… MSP_WEBHOOK_SECRET=whsec_… node --experimental-strip-types examples/webhook-server.ts
```

Node 22.6+ strips types natively; on Node 20 run them through `tsx`.

| File | Shows |
| --- | --- |
| `list-conversations.ts` | Cursor pagination and typed errors |
| `send-message.ts` | Text sends, attachments, idempotency |
| `initiate-conversation.ts` | Initiating a conversation and following its status |
| `webhook-server.ts` | A verified webhook endpoint on `node:http`, replying with the client |
