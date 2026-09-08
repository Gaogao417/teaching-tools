import { geometryVisualCommandSchema, studentWorkspaceViewV3Schema, visualBarrierSchema, visualExecutionOwnerSchema } from "../../../../../shared/canonical/visualSchemas";
import { VisualRenderError } from "../../../geometry/react/visualRenderTypes";
import { sameExecutionOwner } from "../PresentationExecutionOwner";
import { presentationKeyOf, type PresentationToolAdapter } from "../types";
import type { WorkspaceCommitPort } from "../workspaceCommitPort";

/** Invoked by the sole controller. Generic workspace commits cannot complete visuals. */
export function createGeometryVisualPresentationAdapter(commitPort: WorkspaceCommitPort): PresentationToolAdapter {
  return {
    supports(action) {
      return action.kind === "workspace" && action.workspace_action?.surface === "geometry"
        && ["upsert", "focus", "close-group", "reconcile"].some(op => action.workspace_action?.capability === `geometry.visual.${op}`);
    },
    async present({ delivery, snapshot, abort }) {
      if (!commitPort.visualRenderer.hasSurface()) return { outcome: "awaiting-real-signal" };
      const action = delivery.action.workspace_action!;
      const parsedView = studentWorkspaceViewV3Schema.safeParse(snapshot.views.student_workspace_view);
      const owner = visualExecutionOwnerSchema.safeParse("execution_owner" in delivery ? delivery.execution_owner : undefined);
      const snapshotOwner = visualExecutionOwnerSchema.safeParse("presentation_execution_owner" in snapshot ? snapshot.presentation_execution_owner : undefined);
      if (!parsedView.success || !owner.success || !snapshotOwner.success || !sameExecutionOwner(owner.data, snapshotOwner.data)) {
        return { outcome: "failed", failureClass: "validation_failure", message: "visual delivery lacks a matching owner and student-safe v3 view" };
      }
      try {
        const command = geometryVisualCommandSchema.parse(JSON.parse(action.command_payload ?? ""));
        if (action.capability !== `geometry.visual.${command.op}`) throw new Error("visual command/capability mismatch");
        const view = parsedView.data.canvas.visual;
        if (command.op === "reconcile") {
          const parsedBarrier = visualBarrierSchema.safeParse("visual_barrier" in snapshot ? snapshot.visual_barrier : undefined);
          if (!parsedBarrier.success || parsedBarrier.data.status !== "awaiting-cleanup") throw new Error("cleanup has no active barrier");
          const barrier = parsedBarrier.data;
          if (barrier.barrier_id !== command.barrier_id || barrier.cleanup_sequence_id !== delivery.sequence_id
            || !sameExecutionOwner(barrier.execution_owner, owner.data) || command.target_digest !== barrier.target_digest
            || command.target_visual_revision !== barrier.target_visual_revision || view.digest !== barrier.target_digest
            || view.visual_revision !== barrier.target_visual_revision) throw new Error("cleanup does not match the frozen barrier target");
        } else if (command.op === "upsert") {
          if (!view.annotations.some(a => a.annotation_id === command.annotation_id && a.binding_ref === command.binding_ref && a.form === command.form)) throw new Error("visual annotation not applied in the safe view");
        } else if (command.op === "focus") {
          if (view.focus?.group_id !== command.group_id || view.focus.binding_ref !== command.binding_ref || view.focus.mode !== command.mode) throw new Error("visual focus not applied in the safe view");
        } else if (view.focus?.group_id === command.group_id) throw new Error("closed group remains focused");
        const pulse = command.op === "focus" && command.mode === "pulse";
        await commitPort.visualRenderer.render(view, {
          sessionId: delivery.session_id, executionKey: presentationKeyOf(delivery), visualRevision: view.visual_revision,
          targetDigest: view.digest, operation: command.op === "reconcile" || command.op === "close-group" ? "removed" : pulse ? "entrance-complete" : "installed",
          abort, ...(pulse ? { pulseIds: [`focus:${command.group_id}`] } : {}),
        });
        return { outcome: "presented" };
      } catch (error) {
        if (abort.aborted) return { outcome: "interrupted" };
        if (error instanceof VisualRenderError && ["aborted", "stale-surface"].includes(error.kind)) return { outcome: "awaiting-real-signal" };
        return { outcome: "failed", failureClass: error instanceof VisualRenderError ? "internal_error" : "validation_failure", message: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
