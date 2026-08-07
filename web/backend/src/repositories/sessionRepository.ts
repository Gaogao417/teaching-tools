import type { SessionPhase, TaskId } from "../../../shared/contracts";
import type { SessionKind } from "../../../shared/similarityLearningMap";
import { db } from "../db/database";

export type SessionRow = {
  id: string;
  task_id: TaskId;
  student_name: string;
  phase: SessionPhase;
  current_index: number;
  started_at: string;
  finished_at: string | null;
  finished: number;
  schema_version: number;
  session_kind: SessionKind;
  challenge_id: string | null;
  source_session_id: string | null;
  source_instance_id: string | null;
  source_step_id: string | null;
  return_mode: "resume-step" | "restart-instance" | null;
  preserved_completed_step_ids_json: string | null;
};

const getSessionByIdStatement = db.prepare(`SELECT * FROM practice_sessions WHERE id = ?`);
const insertSessionStatement = db.prepare(
  `INSERT INTO practice_sessions
    (id, task_id, student_name, phase, current_index, started_at, finished_at, finished, schema_version,
     session_kind, challenge_id, source_session_id, source_instance_id, source_step_id, return_mode,
     preserved_completed_step_ids_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const updateSessionProgressStatement = db.prepare(
  `UPDATE practice_sessions
   SET current_index = ?, phase = ?
   WHERE id = ?`,
);
const markSessionFinishedStatement = db.prepare(
  `UPDATE practice_sessions
   SET phase = ?, finished = 1, finished_at = ?
   WHERE id = ?`,
);
const listChildSessionIdsStatement = db.prepare(
  `SELECT id FROM practice_sessions WHERE source_session_id = ? ORDER BY started_at ASC`,
);

export function getSessionById(sessionId: string): SessionRow | undefined {
  return getSessionByIdStatement.get(sessionId) as SessionRow | undefined;
}

export function createSession(session: SessionRow) {
  insertSessionStatement.run(
    session.id,
    session.task_id,
    session.student_name,
    session.phase,
    session.current_index,
    session.started_at,
    session.finished_at,
    session.finished,
    session.schema_version,
    session.session_kind,
    session.challenge_id,
    session.source_session_id,
    session.source_instance_id,
    session.source_step_id,
    session.return_mode,
    session.preserved_completed_step_ids_json,
  );
}

export function updateSessionProgress(sessionId: string, currentIndex: number, phase: SessionPhase) {
  updateSessionProgressStatement.run(currentIndex, phase, sessionId);
}

export function markSessionFinished(sessionId: string, finishedAt: string, phase: SessionPhase = "group_finished") {
  markSessionFinishedStatement.run(phase, finishedAt, sessionId);
}

export function listChildSessionIds(sessionId: string): string[] {
  return (listChildSessionIdsStatement.all(sessionId) as Array<{ id: string }>).map((row) => row.id);
}
