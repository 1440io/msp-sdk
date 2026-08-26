/**
 * Remembers event ids that have already been handled, so a retry — which
 * reuses the same `Webhook-Id` — is not processed twice.
 */
export interface ReplayCache {
  /** True when this id has been seen before. Records it either way. */
  seen(id: string): boolean | Promise<boolean>;
}

/**
 * An in-process replay cache with a bounded size and TTL.
 *
 * Good enough for a single long-lived process. Across several instances, or
 * anywhere the process is short-lived (Lambda, edge), back it with something
 * shared — Redis, a database, whatever you already run.
 */
export class MemoryReplayCache implements ReplayCache {
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #entries = new Map<string, number>();

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    // Retries run over several minutes; an hour covers them comfortably.
    this.#ttlMs = options.ttlMs ?? 60 * 60 * 1000;
    this.#maxEntries = options.maxEntries ?? 10_000;
  }

  seen(id: string): boolean {
    const now = Date.now();
    const expiresAt = this.#entries.get(id);
    if (expiresAt !== undefined && expiresAt > now) {
      return true;
    }

    this.#entries.set(id, now + this.#ttlMs);
    if (this.#entries.size > this.#maxEntries) this.#evict(now);
    return false;
  }

  /** Number of ids currently retained. */
  get size(): number {
    return this.#entries.size;
  }

  /** Forget every recorded id. */
  clear(): void {
    this.#entries.clear();
  }

  #evict(now: number): void {
    for (const [id, expiresAt] of this.#entries) {
      if (expiresAt <= now) this.#entries.delete(id);
    }
    // Still over the cap: drop oldest-inserted first (Map preserves order).
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) break;
      this.#entries.delete(oldest.value);
    }
  }
}
