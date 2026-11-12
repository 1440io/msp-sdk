interface Env {
  CONVERSATION: DurableObjectNamespace<import('./conversation.js').Conversation>;
  MSP_WEBHOOK_SECRET: string;
  MSP_API_KEY?: string;
}
