import type { ResultSnapshot, TaskHistoryItem, TaskId } from "../../../shared/contracts";
import { db } from "../db/database";

type ResultRow = {
  snapshot_json: string;
};

type PreviousElapsedRow = {
  elapsed_ms: number;
};

type TaskHistoryRow = {
  session_id: string;
  student_name: string;
  elapsed_ms: number;
  cleared_at: string;
  problem_count: number;
  first_try_accuracy: number;
};

type ResultHistoryRow = {
  elapsedMs: number;
  clearedAt: string;
};

type InsertResultSnapshotArgs = {
  sessionId: string;
  taskId: TaskId;
  studentName: string;
  elapsedMs: number;
  problemCount: number;
  firstTryAccuracy: number;
  firstTryCorrectCount: number;
  startedAt: string;
  clearedAt: string;
  snapshot: ResultSnapshot;
};

const getResultRowBySessionIdStatement = db.prepare(`SELECT snapshot_json FROM practice_results WHERE session_id = ?`);
const listTaskHistoryStatement = db.prepare(
  `SELECT session_id, student_name, elapsed_ms, cleared_at, problem_count, first_try_accuracy
   FROM practice_results
   WHERE task_id = ? AND student_name = ?
   ORDER BY cleared_at DESC
   LIMIT ?`,
);
const listResultSnapshotHistoryStatement = db.prepare(
  `SELECT snapshot_json
   FROM practice_results
   WHERE task_id = ? AND student_name = ?
   ORDER BY cleared_at DESC
   LIMIT ?`,
);
const getPreviousElapsedMsStatement = db.prepare(
  `SELECT elapsed_ms
   FROM practice_results
   WHERE task_id = ? AND student_name = ?
   ORDER BY cleared_at DESC
   LIMIT 1`,
);
const insertResultSnapshotStatement = db.prepare(
  `INSERT INTO practice_results (session_id, task_id, student_name, elapsed_ms, problem_count, first_try_accuracy, first_try_correct_count, started_at, cleared_at, snapshot_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

export function getResultSnapshot(sessionId: string): ResultSnapshot | undefined {
  const row = getResultRowBySessionIdStatement.get(sessionId) as ResultRow | undefined;
  return row ? (JSON.parse(row.snapshot_json) as ResultSnapshot) : undefined;
}

export function listTaskHistory(taskId: TaskId, studentName: string, limit = 5): TaskHistoryItem[] {
  return (listTaskHistoryStatement.all(taskId, studentName, limit) as TaskHistoryRow[])
    .map((row) => ({
      sessionId: row.session_id,
      studentName: row.student_name,
      elapsedMs: row.elapsed_ms,
      clearedAt: row.cleared_at,
      problemCount: row.problem_count,
      firstTryAccuracy: row.first_try_accuracy,
    }))
    .reverse();
}

export function listResultHistory(taskId: TaskId, studentName: string, limit = 10): ResultHistoryRow[] {
  return (listResultSnapshotHistoryStatement.all(taskId, studentName, limit) as ResultRow[])
    .map((row) => JSON.parse(row.snapshot_json) as ResultSnapshot)
    .reverse()
    .map((snapshot) => ({
      elapsedMs: snapshot.elapsedMs,
      clearedAt: snapshot.clearedAt,
    }));
}

export function getPreviousElapsedMs(taskId: TaskId, studentName: string): number | null {
  const row = getPreviousElapsedMsStatement.get(taskId, studentName) as PreviousElapsedRow | undefined;
  return row?.elapsed_ms ?? null;
}

export function insertResultSnapshot(args: InsertResultSnapshotArgs) {
  insertResultSnapshotStatement.run(
    args.sessionId,
    args.taskId,
    args.studentName,
    args.elapsedMs,
    args.problemCount,
    args.firstTryAccuracy,
    args.firstTryCorrectCount,
    args.startedAt,
    args.clearedAt,
    JSON.stringify(args.snapshot),
  );
}
