import type { RuntimeActionEvent, RuntimeEvaluation } from "../../../shared/contracts";
import { db } from "../db/database";

export type ActionEventRow = {
  instance_id: string;
  action_type: RuntimeActionEvent["type"];
  target_id: string | null;
  submitted_value: string | null;
  source_id: string | null;
  step_id: string | null;
  evaluation: RuntimeEvaluation;
  created_at: string;
};

const insertActionEventStatement = db.prepare(
  `INSERT INTO practice_action_events
    (session_id, instance_id, action_type, target_id, submitted_value, source_id, step_id, evaluation, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const listActionEventsStatement = db.prepare(
  `SELECT instance_id, action_type, target_id, submitted_value, source_id, step_id, evaluation, created_at
   FROM practice_action_events
   WHERE session_id = ?
   ORDER BY id ASC`,
);

export function insertActionEvent(
  sessionId: string,
  instanceId: string,
  action: RuntimeActionEvent,
  evaluation: RuntimeEvaluation,
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
    evaluation,
    createdAt,
  );
}

export function listActionEvents(sessionId: string): ActionEventRow[] {
  return listActionEventsStatement.all(sessionId) as ActionEventRow[];
}
