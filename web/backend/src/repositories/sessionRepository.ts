import type { SessionPhase, TaskId } from "../../../shared/contracts";
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
};

const getSessionByIdStatement = db.prepare(`SELECT * FROM practice_sessions WHERE id = ?`);
const insertSessionStatement = db.prepare(
  `INSERT INTO practice_sessions (id, task_id, student_name, phase, current_index, started_at, finished_at, finished, schema_version)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  );
}

export function updateSessionProgress(sessionId: string, currentIndex: number, phase: SessionPhase) {
  updateSessionProgressStatement.run(currentIndex, phase, sessionId);
}

export function markSessionFinished(sessionId: string, finishedAt: string, phase: SessionPhase = "group_finished") {
  markSessionFinishedStatement.run(phase, finishedAt, sessionId);
}
