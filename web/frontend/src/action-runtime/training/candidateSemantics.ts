import type { ActionEvidence } from "../../../../shared/actionRuntime";
import type { SemanticCandidate } from "../../../../shared/trainingRuntime";
import type { ActionRuntimeEvent } from "../events";
import type { ActionSnapshotView } from "../types";

export function semanticCandidate(event: ActionRuntimeEvent, before: ActionSnapshotView, after: ActionSnapshotView): SemanticCandidate | undefined {
  if (event.type === "OBJECT.SELECTED") {
    return { kind: "object", objectKind: event.objectKind, objectId: event.objectId };
  }
  if (event.type !== "SUBMIT") return undefined;
  if (after.evidence) return { kind: "action-evidence", evidence: after.evidence };
  const entries = Object.entries(after.answers);
  const changed = entries.find(([slotId, value]) => before.answers[slotId] !== value)
    || entries[entries.length - 1];
  return changed ? { kind: "answer", slotId: changed[0], value: changed[1] } : undefined;
}

export function evidenceCandidate(evidence: ActionEvidence): SemanticCandidate {
  return { kind: "action-evidence", evidence };
}
