import type { TrainingRecordRepository } from "../ports/trainingRecordRepository";
import { db } from "../../../db/database";
import type { TrainingResult } from "../../../../../shared/trainingRuntime";

export function updateTrainingMastery(result: TrainingResult): void {
  const session = db.prepare("SELECT student_name, task_id FROM practice_sessions WHERE id = ?")
    .get(result.sessionId) as { student_name: string; task_id: string } | undefined;
  if (!session) throw new Error("Training session is unavailable");
  const statement = db.prepare(`
    INSERT INTO training_progress_v1
      (student_name, task_id, action_kind, completed_count, first_try_correct_count, wrong_attempt_count, total_duration_ms, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_name, task_id, action_kind) DO UPDATE SET
      completed_count = completed_count + excluded.completed_count,
      first_try_correct_count = first_try_correct_count + excluded.first_try_correct_count,
      wrong_attempt_count = wrong_attempt_count + excluded.wrong_attempt_count,
      total_duration_ms = total_duration_ms + excluded.total_duration_ms,
      updated_at = excluded.updated_at
  `);
  const now = new Date().toISOString();
  db.transaction(() => {
    const applied = db.prepare("INSERT OR IGNORE INTO training_progress_applied_v1 (record_id, applied_at) VALUES (?, ?)").run(result.recordId, now);
    if (applied.changes === 0) return;
    for (const metric of result.actionMetrics) statement.run(
      session.student_name, session.task_id, metric.actionKind, metric.completed ? 1 : 0,
      metric.firstTryCorrect ? 1 : 0, metric.wrongAttemptCount, metric.durationMs, now,
    );
  })();
}

export function readTrainingProgress(repository: TrainingRecordRepository, sessionId: string) {
  const records = repository.listForSession(sessionId);
  const latest = [...records].reverse().find((item) => item.kind === "result") || records.at(-1);
  const metrics = latest?.record.actionMetrics || [];
  const session = db.prepare("SELECT student_name, task_id FROM practice_sessions WHERE id = ?")
    .get(sessionId) as { student_name: string; task_id: string } | undefined;
  const mastery = session ? db.prepare("SELECT action_kind, completed_count, first_try_correct_count, wrong_attempt_count, total_duration_ms FROM training_progress_v1 WHERE student_name = ? AND task_id = ? ORDER BY action_kind")
    .all(session.student_name, session.task_id) as Array<{ action_kind: string; completed_count: number; first_try_correct_count: number; wrong_attempt_count: number; total_duration_ms: number }> : [];
  return {
    version: 1 as const,
    sessionId,
    recordCount: records.length,
    actionCount: metrics.length,
    completedActionCount: metrics.filter((metric) => metric.completed).length,
    firstTryCorrectRate: metrics.length ? metrics.filter((metric) => metric.firstTryCorrect).length / metrics.length : 0,
    averageActionDurationMs: metrics.length ? metrics.reduce((sum, metric) => sum + metric.durationMs, 0) / metrics.length : 0,
    mastery: mastery.map((item) => ({
      actionKind: item.action_kind,
      completedCount: item.completed_count,
      firstTryCorrectRate: item.completed_count ? item.first_try_correct_count / item.completed_count : 0,
      wrongAttemptCount: item.wrong_attempt_count,
      averageDurationMs: item.completed_count ? item.total_duration_ms / item.completed_count : 0,
    })),
  };
}
