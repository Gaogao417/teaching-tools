import type { VisualBarrier, VisualView } from "../../../../../shared/canonical/visualSchemas";
import { validFromRaw, runtimeSnapshotRaw, pendingVoicePresentation, pendingGeometryPresentation } from "../../../action-runtime/tutor/__tests__/runtimeSnapshotFixture";
export const owner = { client_instance_id: "page-test-A", epoch: 1 };
export const visual: VisualView = { visual_revision: 1, digest: "sha256:" + "a".repeat(64), annotations: [], focus: null };
export function snapshot(revision: number, kind?: "voice" | "cleanup", barrier?: VisualBarrier) {
  const raw = JSON.parse(JSON.stringify(runtimeSnapshotRaw({ revision, participationKind: "listen_only", viewFragments: [] })));
  raw.views.student_workspace_view.schema = "ai_teaching_student_workspace_view/v3";
  raw.views.student_workspace_view.canvas.visual = visual;
  raw.presentation_execution_owner = owner; raw.visual_barrier = barrier ?? null;
  if (kind) {
    const delivery = JSON.parse(JSON.stringify(kind === "voice" ? pendingVoicePresentation(revision) : pendingGeometryPresentation(revision, 3)));
    delivery.schema = "ai_teaching_presentation_delivery/v2"; delivery.execution_owner = owner;
    if (kind === "cleanup") {
      delivery.sequence_id = "PS-0099";
      delivery.action.workspace_action.capability = "geometry.visual.reconcile";
      delivery.action.workspace_action.command_payload = JSON.stringify({schema:"ai_teaching_geometry_visual_command/v1",op:"reconcile",barrier_id:"barrier",target_digest:visual.digest,target_visual_revision:visual.visual_revision});
    }
    raw.pending_presentation = delivery;
  }
  return validFromRaw(raw);
}
export const barrier = {status:"awaiting-cleanup",barrier_id:"barrier",cause:"barge-in",execution_owner:owner,control_request_id:"control-1",cleanup_sequence_id:"PS-0099",target_event_sequence:1,catalog_hash:"sha256:" + "b".repeat(64),target_visual_revision:1,target_digest:visual.digest} satisfies VisualBarrier;
