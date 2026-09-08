import { studentWorkspaceViewV3Schema, visualBarrierSchema, visualExecutionOwnerSchema, type VisualBarrier, type VisualExecutionOwner, type VisualView } from "../../../../shared/canonical/visualSchemas";
import type { ValidatedSessionSnapshot } from "../../api/tutorRuntimeClient";

/** Narrow using canonical codecs, not a new HTTP profile. The shared HTTP reader
 * owns envelope validation; this helper is also used by isolated Runtime tests. */
export function visualRuntimeSnapshot(snapshot: ValidatedSessionSnapshot): { view: VisualView; owner: VisualExecutionOwner; barrier: VisualBarrier | null } | undefined {
  const workspace = snapshot.views.student_workspace_view;
  if (String(workspace.schema) !== "ai_teaching_student_workspace_view/v3") return undefined;
  const view = studentWorkspaceViewV3Schema.parse(workspace).canvas.visual;
  const owner = visualExecutionOwnerSchema.parse("presentation_execution_owner" in snapshot ? snapshot.presentation_execution_owner : undefined);
  const barrier = visualBarrierSchema.nullable().parse("visual_barrier" in snapshot ? snapshot.visual_barrier : undefined);
  return { view, owner, barrier };
}
