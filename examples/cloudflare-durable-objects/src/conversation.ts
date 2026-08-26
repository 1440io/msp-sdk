import { DurableObject } from 'cloudflare:workers';
import {
  isInteractiveMessage,
  isTextMessage,
  respondsTo,
  selectedIds,
  selectedTitles,
} from '@1440io/msp-webhooks';
import type { WebhookEvent, WebhookMessageReceivedEvent } from '@1440io/msp-types';

/**
 * One Durable Object per AMB conversation.
 *
 * The object *is* the conversation: addressed by the conversation id 1440
 * already assigns, so no mapping table exists. Everything the conversation
 * needs — dedupe, ordering, which rich prompt is outstanding, follow-up
 * timers — lives here rather than in four separate services.
 */
export class Conversation extends DurableObject<Env> {
  /**
   * Serializes outbound sends.
   *
   * A common misreading of Durable Objects is that they serialize whole
   * request handlers. They do not. The input gate makes storage
   * read-modify-write atomic — which is what makes the dedupe below correct
   * without a lock — but while a handler awaits something that is *not*
   * storage, such as an HTTP call to the 1440 API, another request runs.
   *
   * Apple does not guarantee ordering and the API docs say to await each send
   * before starting the next, so outbound sends are chained explicitly. Inbound
   * events are deliberately left off this chain: they should not queue behind a
   * slow send.
   *
   * The chain lives in memory, so it orders sends within an object's lifetime.
   * Ordering across an eviction needs a stored queue drained by an alarm.
   */
  #sendChain: Promise<unknown> = Promise.resolve();

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#sendChain.then(work, work);
    this.#sendChain = next.catch(() => undefined);
    return next;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/event':
        return this.onEvent(await request.json<WebhookEvent>());
      case '/send': {
        const input = await request.json<{ label: string; delayMs?: number }>();
        return this.serialize(() => this.onSend(input));
      }
      case '/prompt':
        return this.onPrompt(await request.json<{ requestIdentifier: string; question: string }>());
      case '/state':
        return Response.json(await this.state());
      case '/reset':
        // Test hook only — wipes this conversation's state.
        await this.ctx.storage.deleteAll();
        return Response.json({ ok: true });
      default:
        return new Response('not found', { status: 404 });
    }
  }

  /**
   * Handle one inbound webhook event.
   *
   * Two deliveries of the same event cannot race here: a Durable Object runs
   * one request at a time, so the read-then-write on the seen-set is atomic
   * without a lock, a transaction, or a unique constraint.
   */
  private async onEvent(event: WebhookEvent): Promise<Response> {
    const seenKey = `seen:${event.id}`;
    if (await this.ctx.storage.get(seenKey)) {
      return Response.json({ ok: true, duplicate: true });
    }
    await this.ctx.storage.put(seenKey, event.occurredAt);

    if (event.type !== 'message.received') {
      return Response.json({ ok: true, handled: event.type });
    }

    const { message } = (event as WebhookMessageReceivedEvent).data;
    const log = (await this.ctx.storage.get<string[]>('log')) ?? [];

    if (isTextMessage(message)) {
      log.push(`text: ${message.content.body}`);
    } else if (isInteractiveMessage(message)) {
      const answered = respondsTo(message);
      const outstanding = await this.ctx.storage.get<{ requestIdentifier: string; question: string }>(
        'outstanding',
      );

      if (outstanding && answered === outstanding.requestIdentifier) {
        // The prompt this object was waiting on has been answered, so the
        // follow-up alarm is no longer wanted.
        await this.ctx.storage.delete('outstanding');
        await this.ctx.storage.deleteAlarm();
        log.push(
          `answered "${outstanding.question}" with ${JSON.stringify(selectedTitles(message.content))}`,
        );
      } else {
        log.push(`unmatched reply: ${JSON.stringify(selectedIds(message.content))}`);
      }
    }

    await this.ctx.storage.put('log', log);
    return Response.json({ ok: true, duplicate: false });
  }

  /**
   * Record a rich prompt and schedule a nudge.
   *
   * Apple gives no delivery deadline and customers wander off, so a prompt
   * that is never answered needs a timer. That is an alarm on this object, not
   * a cron sweeping a table.
   */
  private async onPrompt(prompt: { requestIdentifier: string; question: string }): Promise<Response> {
    await this.ctx.storage.put('outstanding', prompt);
    await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    return Response.json({ ok: true, alarmAt: await this.ctx.storage.getAlarm() });
  }

  /** Fires when a prompt went unanswered. */
  async alarm(): Promise<void> {
    const outstanding = await this.ctx.storage.get<{ question: string }>('outstanding');
    if (!outstanding) return;
    const log = (await this.ctx.storage.get<string[]>('log')) ?? [];
    log.push(`nudged: no answer to "${outstanding.question}"`);
    await this.ctx.storage.put('log', log);
  }

  /**
   * Outbound send, instrumented to expose ordering.
   *
   * Reached only through `serialize()`, so a second caller waits for this one
   * to finish rather than interleaving with it.
   */
  private async onSend(input: { label: string; delayMs?: number }): Promise<Response> {
    const seq = ((await this.ctx.storage.get<number>('seq')) ?? 0) + 1;
    const order = (await this.ctx.storage.get<string[]>('order')) ?? [];

    order.push(`${input.label}:start`);
    await this.ctx.storage.put('order', order);

    // A real send awaits the 1440 API here; the sleep stands in for that
    // latency so overlapping requests would be visible if they could overlap.
    if (input.delayMs) await scheduler.wait(input.delayMs);

    const after = (await this.ctx.storage.get<string[]>('order')) ?? [];
    after.push(`${input.label}:end`);
    await this.ctx.storage.put('order', after);
    await this.ctx.storage.put('seq', seq);

    return Response.json({ ok: true, seq });
  }

  private async state() {
    return {
      log: (await this.ctx.storage.get<string[]>('log')) ?? [],
      order: (await this.ctx.storage.get<string[]>('order')) ?? [],
      seq: (await this.ctx.storage.get<number>('seq')) ?? 0,
      outstanding: (await this.ctx.storage.get('outstanding')) ?? null,
      alarmAt: await this.ctx.storage.getAlarm(),
    };
  }
}
