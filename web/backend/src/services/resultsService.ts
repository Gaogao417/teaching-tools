import type { ResultSnapshot, TaskHistoryItem, TaskId } from "../../../shared/contracts";
import { TASK_COLORS, TASK_LABELS } from "../../../shared/tasks";
import { db } from "../db/database";
import { appError } from "./runtime/errors";

type ResultSessionRecord = {
  id: string;
  task_id: TaskId;
  student_name: string;
  started_at: string;
};

type ResultInstanceRecord = {
  engineState: {
    firstTryCorrect: boolean | null;
  };
};

function getResultRow(sessionId: string) {
  return db
    .prepare(`SELECT snapshot_json FROM practice_results WHERE session_id = ?`)
    .get(sessionId) as { snapshot_json: string } | undefined;
}

function groupLabel(taskId: TaskId) {
  if (taskId === "meaning") return "\u7b2c1\u7ec4";
  if (taskId === "ratioToSide") return "\u7b2c2\u7ec4";
  return "\u7b2c3\u7ec4";
}

function buildResultHistory(taskId: TaskId, studentName: string, limit = 10) {
  const rows = db
    .prepare(
      `SELECT snapshot_json
       FROM practice_results
       WHERE task_id = ? AND student_name = ?
       ORDER BY cleared_at DESC
       LIMIT ?`,
    )
    .all(taskId, studentName, limit) as Array<{ snapshot_json: string }>;

  return rows
    .map((row) => JSON.parse(row.snapshot_json) as ResultSnapshot)
    .reverse()
    .map((item) => ({
      elapsedMs: item.elapsedMs,
      clearedAt: item.clearedAt,
    }));
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getResult(sessionId: string): ResultSnapshot {
  const row = getResultRow(sessionId);

  if (!row) {
    throw appError("SESSION_NOT_FOUND", "Result not found", 404);
  }

  return JSON.parse(row.snapshot_json) as ResultSnapshot;
}

export function getTaskHistory(taskId: TaskId, studentName: string, limit = 5): TaskHistoryItem[] {
  return db
    .prepare(
      `SELECT student_name, elapsed_ms, cleared_at, problem_count, first_try_accuracy
       FROM practice_results
       WHERE task_id = ? AND student_name = ?
       ORDER BY cleared_at DESC
       LIMIT ?`,
    )
    .all(taskId, studentName, limit)
    .map((row: any) => ({
      studentName: row.student_name as string,
      elapsedMs: row.elapsed_ms as number,
      clearedAt: row.cleared_at as string,
      problemCount: row.problem_count as number,
      firstTryAccuracy: row.first_try_accuracy as number,
    }))
    .reverse();
}

export function finishAndPersistResult(
  session: ResultSessionRecord,
  instances: ResultInstanceRecord[],
): { resultSnapshot: ResultSnapshot; alreadyFinished?: boolean } {
  const existing = getResultRow(session.id);
  if (existing) {
    return {
      resultSnapshot: JSON.parse(existing.snapshot_json) as ResultSnapshot,
      alreadyFinished: true,
    };
  }

  const finishedAt = new Date().toISOString();
  const elapsedMs = Math.max(0, Date.parse(finishedAt) - Date.parse(session.started_at));
  const firstTryCorrectCount = instances.filter((record) => record.engineState.firstTryCorrect).length;
  const firstTryAccuracy = instances.length ? firstTryCorrectCount / instances.length : 0;

  const previous = db
    .prepare(
      `SELECT elapsed_ms
       FROM practice_results
       WHERE task_id = ? AND student_name = ?
       ORDER BY cleared_at DESC
       LIMIT 1`,
    )
    .get(session.task_id, session.student_name) as { elapsed_ms: number } | undefined;

  const history = buildResultHistory(session.task_id, session.student_name);
  const snapshot: ResultSnapshot = {
    sessionId: session.id,
    taskId: session.task_id,
    studentName: session.student_name,
    startedAt: session.started_at,
    clearedAt: finishedAt,
    title: `${groupLabel(session.task_id)} \u5df2\u5b8c\u6210`,
    groupLabel: TASK_LABELS[session.task_id],
    elapsedMs,
    bestMs: history.length ? Math.min(...history.map((item) => item.elapsedMs), elapsedMs) : elapsedMs,
    avgMs: average([...history.map((item) => item.elapsedMs), elapsedMs].slice(-5)),
    copy: `\u672c\u6b21\u5171\u5b8c\u6210 ${instances.length} \u9898\uff0c\u53ef\u67e5\u770b\u8be6\u7ec6\u7ed3\u679c\u4e0e\u6700\u8fd1\u8d8b\u52bf\u3002`,
    problemCount: instances.length,
    firstTryAccuracy,
    firstTryCorrectCount,
    color: TASK_COLORS[session.task_id],
    deltaVsPreviousMs: previous ? elapsedMs - previous.elapsed_ms : null,
    history: [...history, { elapsedMs, clearedAt: finishedAt }],
  };

  db.prepare(`UPDATE practice_sessions SET phase = ?, finished = 1, finished_at = ? WHERE id = ?`).run(
    "group_finished",
    finishedAt,
    session.id,
  );
  db.prepare(
    `INSERT INTO practice_results (session_id, task_id, student_name, elapsed_ms, problem_count, first_try_accuracy, first_try_correct_count, started_at, cleared_at, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    session.id,
    session.task_id,
    session.student_name,
    elapsedMs,
    instances.length,
    firstTryAccuracy,
    firstTryCorrectCount,
    session.started_at,
    finishedAt,
    JSON.stringify(snapshot),
  );

  return { resultSnapshot: snapshot };
}
