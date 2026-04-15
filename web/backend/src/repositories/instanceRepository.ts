import type { ExerciseEngineKind, TaskId } from "../../../shared/contracts";
import { db } from "../db/database";

export type RuntimeInstanceRow = {
  id: string;
  session_id: string;
  task_id: TaskId;
  content_id: string;
  engine_kind: ExerciseEngineKind;
  instance_index: number;
  content_json: string;
  instance_json: string;
  engine_state_json: string;
  runtime_state_json: string;
};

const listRuntimeInstancesBySessionIdStatement = db.prepare(
  `SELECT *
   FROM practice_instances
   WHERE session_id = ?
   ORDER BY instance_index ASC`,
);
const insertRuntimeInstanceStatement = db.prepare(
  `INSERT INTO practice_instances (id, session_id, task_id, content_id, engine_kind, instance_index, content_json, instance_json, engine_state_json, runtime_state_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const updateRuntimeInstanceStateStatement = db.prepare(
  `UPDATE practice_instances
   SET instance_json = ?, engine_state_json = ?, runtime_state_json = ?
   WHERE id = ?`,
);

export function listRuntimeInstancesBySessionId(sessionId: string): RuntimeInstanceRow[] {
  return listRuntimeInstancesBySessionIdStatement.all(sessionId) as RuntimeInstanceRow[];
}

export function insertRuntimeInstances(rows: RuntimeInstanceRow[]) {
  for (const row of rows) {
    insertRuntimeInstanceStatement.run(
      row.id,
      row.session_id,
      row.task_id,
      row.content_id,
      row.engine_kind,
      row.instance_index,
      row.content_json,
      row.instance_json,
      row.engine_state_json,
      row.runtime_state_json,
    );
  }
}

export function updateRuntimeInstanceState(
  instanceId: string,
  instanceJson: string,
  engineStateJson: string,
  runtimeStateJson: string,
) {
  updateRuntimeInstanceStateStatement.run(instanceJson, engineStateJson, runtimeStateJson, instanceId);
}
