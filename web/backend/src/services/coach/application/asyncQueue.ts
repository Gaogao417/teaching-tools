import type { EventStream } from "../ports/TextCoachEngine";

/**
 * A bounded async queue that bridges push-based producers (provider callbacks,
 * child-process stdout) to the pull-based {@link EventStream} the application
 * consumes. It enforces backpressure: when the buffered item count exceeds
 * `capacity`, `push` returns false so the producer can pause or drop instead of
 * growing without bound. A terminal error rejects the next pull.
 */
export class AsyncQueue<T> implements EventStream<T> {
  private readonly pending: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private readonly roomWaiters: Array<() => void> = [];
  private settled = false;
  private failure: Error | undefined;
  private bufferedBytes = 0;

  constructor(private readonly capacity = 256) {}

  get size(): number { return this.pending.length; }
  get bytes(): number { return this.bufferedBytes; }
  get closed(): boolean { return this.settled && this.pending.length === 0; }

  /** Resolve once the queue has drained below capacity. Used by producers to
   *  apply backpressure instead of buffering without bound. */
  whenRoom(): Promise<void> {
    if (this.pending.length < this.capacity || this.settled) return Promise.resolve();
    return new Promise<void>((resolve) => this.roomWaiters.push(resolve));
  }

  /** Enqueue an item. Returns false when over capacity so the producer can apply
   *  backpressure (the item is still enqueued; the caller decides to drop next). */
  push(item: T, byteSize = 0): boolean {
    if (this.settled) return false;
    this.pending.push(item);
    this.bufferedBytes += byteSize;
    const waiter = this.waiters.shift();
    if (waiter) {
      const value = this.pending.shift()!;
      this.bufferedBytes -= byteSize;
      waiter({ value, done: false });
      this.notifyRoom();
    }
    return this.pending.length < this.capacity;
  }

  /** Mark the stream complete; pending items are still delivered. */
  complete(): void {
    if (this.settled) return;
    this.settled = true;
    while (this.waiters.length) this.waiters.shift()!({ value: undefined, done: true });
    while (this.roomWaiters.length) this.roomWaiters.shift()!();
  }

  /** Fail the stream; the next pull rejects and remaining items are discarded. */
  error(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.failure = error;
    this.pending.length = 0;
    while (this.waiters.length) this.waiters.shift()!({ value: undefined, done: true });
    while (this.roomWaiters.length) this.roomWaiters.shift()!();
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.pending.length) {
      const value = this.pending.shift()!;
      this.notifyRoom();
      return { value, done: false };
    }
    if (this.failure) { const err = this.failure; this.failure = undefined; throw err; }
    if (this.settled) return { value: undefined, done: true };
    return new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
  }

  private notifyRoom(): void {
    if (this.roomWaiters.length && this.pending.length < this.capacity) {
      const resolve = this.roomWaiters.shift()!;
      resolve();
    }
  }
}
