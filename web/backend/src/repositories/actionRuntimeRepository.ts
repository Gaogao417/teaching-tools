import type {
  ActionCheckpointRequest,
  ActionEvaluationRequest,
  ActionEvaluationResponse,
  WorldProjection,
} from "../../../shared/actionRuntime";
import { db } from "../db/database";

export interface ActionCheckpointRow {
  session_id: string;
  instance_id: string;
  revision: number;
  current_action_id: string;
  completed_action_ids_json: string;
  evidence_json: string;
  draft_json: string | null;
  updated_at: string;
}

const getCheckpointStatement = db.prepare(
  `SELECT * FROM practice_action_checkpoints WHERE session_id = ? AND instance_id = ?`,
);
const upsertCheckpointStatement = db.prepare(
  `INSERT INTO practice_action_checkpoints
    (session_id, instance_id, revision, current_action_id, completed_action_ids_json, evidence_json, draft_json, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(session_id, instance_id) DO UPDATE SET
     revision = excluded.revision,
     current_action_id = excluded.current_action_id,
     completed_action_ids_json = excluded.completed_action_ids_json,
     evidence_json = excluded.evidence_json,
     draft_json = excluded.draft_json,
     updated_at = excluded.updated_at`,
);
const getEvaluationStatement = db.prepare(
  `SELECT request_json, response_json FROM practice_action_evaluations_v2 WHERE session_id = ? AND idempotency_key = ?`,
);
const insertEvaluationStatement = db.prepare(
  `INSERT INTO practice_action_evaluations_v2
    (session_id, instance_id, idempotency_key, request_json, response_json, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
const listEvaluationsStatement = db.prepare(
  `SELECT instance_id, request_json, response_json, created_at
   FROM practice_action_evaluations_v2
   WHERE session_id = ?
   ORDER BY created_at ASC`,
);
const getWorldStatement = db.prepare(
  `SELECT source_step_id, revision, world_json, updated_at FROM practice_action_worlds_v2 WHERE session_id = ? AND instance_id = ?`,
);
const upsertWorldStatement = db.prepare(
  `INSERT INTO practice_action_worlds_v2 (session_id, instance_id, source_step_id, revision, world_json, updated_at)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(session_id, instance_id) DO UPDATE SET
     source_step_id = excluded.source_step_id, revision = excluded.revision, world_json = excluded.world_json, updated_at = excluded.updated_at`,
);

export interface StoredActionEvaluationRow {
  instanceId: string;
  request: ActionEvaluationRequest;
  response: ActionEvaluationResponse;
  createdAt: string;
}

export function getActionCheckpoint(sessionId: string, instanceId: string): ActionCheckpointRow | undefined {
  return getCheckpointStatement.get(sessionId, instanceId) as ActionCheckpointRow | undefined;
}

export function saveActionCheckpoint(
  request: ActionCheckpointRequest,
  updatedAt = new Date().toISOString(),
): string {
  upsertCheckpointStatement.run(
    request.sessionId,
    request.exerciseId,
    request.revision,
    request.currentActionId,
    JSON.stringify(request.completedActionIds),
    JSON.stringify(request.evidence),
    request.currentDraft ? JSON.stringify(request.currentDraft) : null,
    updatedAt,
  );
  return updatedAt;
}

export function getCachedActionEvaluation(
  sessionId: string,
  idempotencyKey: string,
): { request: ActionEvaluationRequest; response: ActionEvaluationResponse } | undefined {
  const row = getEvaluationStatement.get(sessionId, idempotencyKey) as { request_json: string; response_json: string } | undefined;
  return row ? {
    request: JSON.parse(row.request_json) as ActionEvaluationRequest,
    response: JSON.parse(row.response_json) as ActionEvaluationResponse,
  } : undefined;
}

export function saveActionEvaluation(
  request: ActionEvaluationRequest,
  response: ActionEvaluationResponse,
  createdAt = new Date().toISOString(),
) {
  insertEvaluationStatement.run(
    request.sessionId,
    request.exerciseId,
    request.idempotencyKey,
    JSON.stringify(request),
    JSON.stringify(response),
    createdAt,
  );
}

export function listActionEvaluations(sessionId: string): StoredActionEvaluationRow[] {
  const rows = listEvaluationsStatement.all(sessionId) as Array<{
    instance_id: string;
    request_json: string;
    response_json: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    instanceId: row.instance_id,
    request: JSON.parse(row.request_json) as ActionEvaluationRequest,
    response: JSON.parse(row.response_json) as ActionEvaluationResponse,
    createdAt: row.created_at,
  }));
}

export function getCommittedActionWorld(sessionId: string, instanceId: string): { sourceStepId: string; revision: number; world: WorldProjection; updatedAt: string } | undefined {
  const row = getWorldStatement.get(sessionId, instanceId) as { source_step_id: string; revision: number; world_json: string; updated_at: string } | undefined;
  return row ? { sourceStepId: row.source_step_id, revision: row.revision, world: JSON.parse(row.world_json) as WorldProjection, updatedAt: row.updated_at } : undefined;
}

export function saveCommittedActionWorld(sessionId: string, instanceId: string, sourceStepId: string, revision: number, world: WorldProjection, updatedAt = new Date().toISOString()) {
  upsertWorldStatement.run(sessionId, instanceId, sourceStepId, revision, JSON.stringify(world), updatedAt);
}
