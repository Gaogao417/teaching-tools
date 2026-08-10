import type { RuntimeActionEvent, RuntimeEvaluation } from "../../../shared/contracts";
import type { SimilarityCapabilityId } from "../../../shared/similarityLearningMap";
import { db } from "../db/database";

export type ActionEventRow = {
  instance_id: string;
  action_type: RuntimeActionEvent["type"];
  target_id: string | null;
  submitted_value: string | null;
  source_id: string | null;
  step_id: string | null;
  capability_id: SimilarityCapabilityId | null;
  capability_ids_json: string | null;
  evaluation: RuntimeEvaluation;
  created_at: string;
};

const insertActionEventStatement = db.prepare(
  `INSERT INTO practice_action_events
    (session_id, instance_id, action_type, target_id, submitted_value, source_id, step_id, capability_id, capability_ids_json, evaluation, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const listActionEventsStatement = db.prepare(
  `SELECT instance_id, action_type, target_id, submitted_value, source_id, step_id, capability_id, capability_ids_json, evaluation, created_at
   FROM practice_action_events
   WHERE session_id = ?
   ORDER BY id ASC`,
);

export function insertActionEvent(
  sessionId: string,
  instanceId: string,
  action: RuntimeActionEvent,
  evaluation: RuntimeEvaluation,
  capabilityIds: SimilarityCapabilityId[] = [],
  createdAt = new Date().toISOString(),
) {
  insertActionEventStatement.run(
    sessionId,
    instanceId,
    action.type,
    action.targetId ?? null,
    action.value ?? null,
    action.sourceId ?? null,
    action.stepId ?? null,
    capabilityIds[0] ?? null,
    capabilityIds.length ? JSON.stringify(capabilityIds) : null,
    evaluation,
    createdAt,
  );
}

/** v2 audit row: typed evidence lives in practice_action_evaluations_v2, never in submitted_value. */
export function insertTypedActionEvent(
  sessionId: string,
  instanceId: string,
  stepId: string,
  evaluation: RuntimeEvaluation,
  capabilityIds: SimilarityCapabilityId[] = [],
  createdAt = new Date().toISOString(),
) {
  insertActionEventStatement.run(
    sessionId,
    instanceId,
    "submit",
    null,
    null,
    "action-runtime-v2",
    stepId,
    capabilityIds[0] ?? null,
    capabilityIds.length ? JSON.stringify(capabilityIds) : null,
    evaluation,
    createdAt,
  );
}

export function listActionEvents(sessionId: string): ActionEventRow[] {
  return listActionEventsStatement.all(sessionId) as ActionEventRow[];
}
