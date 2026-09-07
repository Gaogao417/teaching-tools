import type { VisualView } from "../../../../shared/canonical/visualSchemas";
import type { VisualRenderExecution, VisualRenderReceipt } from "../../geometry/react/visualRenderTypes";
import { sameVisualRenderIdentity, VisualRenderError } from "../../geometry/react/visualRenderTypes";
import type { VisualCommitPort } from "./visualCommitPort";

export interface VisualSurfaceRenderer {
  render(view: VisualView, execution: VisualRenderExecution): Promise<VisualRenderReceipt>;
  suppress(ownerKey: string): void;
}

/** An imperative port into the existing Canvas, invoked by the sole Runtime.
 * It never buffers or schedules actions; an absent surface pauses the adapter. */
export function createVisualRendererPort(commits: VisualCommitPort) {
  let source: { renderer: VisualSurfaceRenderer; generation: number; unmount(): void } | undefined;
  let layoutValid = true;
  let ready: { generation: number; digest: string; revision: number } | undefined;
  return {
    attach(renderer: VisualSurfaceRenderer): { generation: number; detach(): void } {
      source?.unmount();
      ready = undefined; layoutValid = true;
      const mounted = commits.mountSurface();
      const current = { renderer, generation: mounted.generation, unmount: mounted.unmount };
      source = current;
      return { generation: current.generation, detach() {
        if (source !== current) return;
        source = undefined; current.unmount();
      } };
    },
    setLayoutValid(valid: boolean): void { layoutValid = valid; },
    hasSurface(): boolean { return source !== undefined; },
    generation(): number | undefined { return source?.generation; },
    isReady(view: VisualView): boolean { return layoutValid && !!source && ready?.generation === source.generation && ready.digest === view.digest && ready.revision === view.visual_revision; },
    async render(view: VisualView, request: Omit<VisualRenderExecution, "surfaceGeneration">): Promise<VisualRenderReceipt> {
      const current = source;
      if (!current) throw new VisualRenderError("stale-surface", "visual surface unavailable");
      const execution = { ...request, surfaceGeneration: current.generation };
      try {
        const receipt = await current.renderer.render(view, execution);
        if (source !== current || request.abort.aborted) throw new VisualRenderError("stale-surface", "visual renderer was replaced during execution");
        if (!sameVisualRenderIdentity(receipt, execution)) throw new VisualRenderError("identity", "renderer receipt identity differs from requested visual action");
        commits.notifyCommitted(receipt);
        layoutValid = true;
        ready = { generation: current.generation, digest: view.digest, revision: view.visual_revision };
        return receipt;
      } catch (error) {
        if (source === current && !request.abort.aborted) commits.notifyFailed(execution, error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    suppress(ownerKey: string): void { ready = undefined; source?.renderer.suppress(ownerKey); },
    reset(): void { ready = undefined; source?.unmount(); source = undefined; },
  };
}
export type VisualRendererPort = ReturnType<typeof createVisualRendererPort>;
