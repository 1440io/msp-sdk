/**
 * Where `payment:send` records the request it just made, so `payment:watch`
 * can correlate the customer's reply to *that* request rather than to whatever
 * payment response happens to be most recent in history.
 */
import { resolve } from 'node:path';

export const MARKER = resolve(import.meta.dirname, '../.payment-last.json');

export interface PaymentMarker {
  requestMessageId: string;
  messageId: string;
  sentAt: string;
}
