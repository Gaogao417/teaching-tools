import { sameVisualRenderIdentity, type VisualRenderIdentity, type VisualRenderReceipt } from "../../geometry/react/visualRenderTypes";

export type VisualCommitResult =
  | { status: "committed"; receipt: VisualRenderReceipt }
  | { status: "aborted" | "timeout" }
  | { status: "failed"; message: string };

interface Waiter {
  identity: VisualRenderIdentity;
  settle(result: VisualCommitResult): void;
}

/** Sub-port of the one WorkspaceCommitPort; no HTTP or action scheduling. */
export function createVisualCommitPort() {
  let generation = 0;
  let active = false;
  const notes = new Map<string, { identity: VisualRenderIdentity; result: VisualCommitResult }>();
  const waiters = new Set<Waiter>();
  const key = (identity: VisualRenderIdentity) => JSON.stringify(identity);
  const invalidate = () => {
    generation += 1;
    notes.clear();
    for (const waiter of [...waiters]) waiter.settle({ status: "aborted" });
  };
  const publish = (identity: VisualRenderIdentity, result: VisualCommitResult) => {
    if (!active || identity.surfaceGeneration !== generation) return;
    notes.set(key(identity), { identity, result });
    for (const waiter of [...waiters]) {
      if (sameVisualRenderIdentity(waiter.identity, identity)) waiter.settle(result);
    }
  };
  return {
    mountSurface(): { generation: number; unmount(): void } {
      invalidate();
      active = true;
      const mounted = generation;
      return { generation: mounted, unmount() {
        if (!active || generation !== mounted) return;
        active = false;
        invalidate();
      } };
    },
    currentSurfaceGeneration(): number | undefined { return active ? generation : undefined; },
    notifyCommitted(receipt: VisualRenderReceipt): void { publish(receipt, { status: "committed", receipt }); },
    notifyFailed(identity: VisualRenderIdentity, message: string): void { publish(identity, { status: "failed", message }); },
    wait(identity: VisualRenderIdentity, options: { abort: AbortSignal; timeoutMs?: number }): Promise<VisualCommitResult> {
      if (options.abort.aborted || !active || generation !== identity.surfaceGeneration) return Promise.resolve({ status: "aborted" });
      const note = [...notes.values()].find(note => sameVisualRenderIdentity(note.identity, identity));
      if (note) return Promise.resolve(note.result);
      return new Promise(resolve => {
        const onAbort = () => waiter.settle({ status: "aborted" });
        let settled = false;
        const waiter: Waiter = { identity, settle(result) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          options.abort.removeEventListener("abort", onAbort);
          waiters.delete(waiter);
          resolve(result);
        } };
        const timer = setTimeout(() => waiter.settle({ status: "timeout" }), options.timeoutMs ?? 10_000);
        waiters.add(waiter);
        options.abort.addEventListener("abort", onAbort, { once: true });
      });
    },
    reset(): void { active = false; invalidate(); },
  };
}

export type VisualCommitPort = ReturnType<typeof createVisualCommitPort>;
