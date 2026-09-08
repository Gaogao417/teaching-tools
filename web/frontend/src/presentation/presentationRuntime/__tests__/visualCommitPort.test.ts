import { describe, expect, it, vi } from "vitest";
import { createVisualCommitPort } from "../visualCommitPort";
import type { VisualRenderIdentity } from "../../../geometry/react/visualRenderTypes";

function identity(surfaceGeneration: number): VisualRenderIdentity {
  return { sessionId: "s", executionKey: "s:cleanup:0:a", visualRevision: 2,
    targetDigest: "digest", operation: "removed", surfaceGeneration };
}

describe("visual receipts are distinct from generic workspace commits", () => {
  it("requires exact operation, revision, digest, session and surface generation", async () => {
    const port = createVisualCommitPort();
    const surface = port.mountSurface();
    const id = identity(surface.generation);
    const done = vi.fn();
    const waiting = port.wait(id, { abort: new AbortController().signal }).then(done);
    for (const patch of [{ operation: "installed" as const }, { visualRevision: 3 }, { targetDigest: "other" }, { sessionId: "other" }, { surfaceGeneration: id.surfaceGeneration - 1 }]) {
      port.notifyCommitted({ ...id, ...patch });
    }
    await Promise.resolve(); expect(done).not.toHaveBeenCalled();
    port.notifyCommitted(id); await waiting;
    expect(done).toHaveBeenCalledWith({ status: "committed", receipt: id });
  });
  it("remount clears buffered receipts and aborts old waiters even for the same action", async () => {
    const port = createVisualCommitPort(); const old = port.mountSurface();
    const id = identity(old.generation);
    port.notifyCommitted(id);
    const pending = port.wait({ ...id, executionKey: "other" }, { abort: new AbortController().signal });
    old.unmount(); expect(await pending).toEqual({ status: "aborted" });
    const current = port.mountSurface(); const next = identity(current.generation);
    const abort = new AbortController(); const waiting = port.wait(next, { abort: abort.signal });
    port.notifyCommitted(id); abort.abort();
    expect(await waiting).toEqual({ status: "aborted" });
    old.unmount(); expect(port.currentSurfaceGeneration()).toBe(current.generation);
  });
  it("propagates real failure and timeout instead of success", async () => {
    const port = createVisualCommitPort(); const id = identity(port.mountSurface().generation);
    const waiting = port.wait(id, { abort: new AbortController().signal });
    port.notifyFailed(id, "old owner remains visible");
    expect(await waiting).toEqual({ status: "failed", message: "old owner remains visible" });
    expect(await port.wait({ ...id, executionKey: "next" }, { abort: new AbortController().signal, timeoutMs: 1 })).toEqual({ status: "timeout" });
  });
});
