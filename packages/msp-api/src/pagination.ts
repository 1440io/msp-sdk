/**
 * A lazily-paginating view over a list endpoint.
 *
 * Await it (or read `.items`) for just the first page, `for await` over it to
 * walk every item across pages, or iterate `.pages()` to handle whole pages.
 *
 * ```ts
 * for await (const conversation of client.conversations.list({ status: 'active' })) {
 *   console.log(conversation.id);
 * }
 * ```
 */
export class Paginator<TItem, TPage> implements AsyncIterable<TItem> {
  readonly #first: Promise<TPage>;
  readonly #fetchNext: (cursor: string) => Promise<TPage>;
  readonly #getItems: (page: TPage) => TItem[];
  readonly #getCursor: (page: TPage) => string | null | undefined;

  constructor(init: {
    first: Promise<TPage>;
    fetchNext: (cursor: string) => Promise<TPage>;
    getItems: (page: TPage) => TItem[];
    getCursor: (page: TPage) => string | null | undefined;
  }) {
    this.#first = init.first;
    this.#fetchNext = init.fetchNext;
    this.#getItems = init.getItems;
    this.#getCursor = init.getCursor;
  }

  /** The first page, exactly as the API returned it. */
  page(): Promise<TPage> {
    return this.#first;
  }

  /** The items on the first page only. */
  async items(): Promise<TItem[]> {
    return this.#getItems(await this.#first);
  }

  /** Walk whole pages, following cursors until the last one. */
  async *pages(): AsyncGenerator<TPage, void, undefined> {
    let page = await this.#first;
    for (;;) {
      yield page;
      const cursor = this.#getCursor(page);
      if (!cursor) return;
      page = await this.#fetchNext(cursor);
    }
  }

  /** Walk every item across every page. */
  async *[Symbol.asyncIterator](): AsyncGenerator<TItem, void, undefined> {
    for await (const page of this.pages()) {
      yield* this.#getItems(page);
    }
  }

  /** Collect every item across every page. Beware of unbounded result sets. */
  async toArray(limit?: number): Promise<TItem[]> {
    const out: TItem[] = [];
    for await (const item of this) {
      out.push(item);
      if (limit !== undefined && out.length >= limit) break;
    }
    return out;
  }

  /** Await the paginator itself to get the first page. */
  then<TResult1 = TPage, TResult2 = never>(
    onfulfilled?: ((value: TPage) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.#first.then(onfulfilled, onrejected);
  }

  /** Handle a failure fetching the first page, as on any promise. */
  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<TPage | TResult> {
    return this.#first.catch(onrejected);
  }

  /** Run a callback once the first page settles, as on any promise. */
  finally(onfinally?: (() => void) | null): Promise<TPage> {
    return this.#first.finally(onfinally);
  }
}
