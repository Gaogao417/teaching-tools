import { db } from "../../../db/database";
import type { TrainingResult } from "../../../../../shared/trainingRuntime";

/** Advances Practice from an already locally validated result; it never re-evaluates answer truth. */
export function advanceTrainingSession(result: TrainingResult): void {
  const state = trainingSessionState(result);
  if (state.currentIndex > state.exerciseIndex || state.phase === "group_finished") return;
  const { currentIndex, count } = validateTrainingSessionResult(result);
  const nextIndex = currentIndex + 1;
  db.prepare("UPDATE practice_sessions SET current_index = ?, phase = ? WHERE id = ?")
    .run(Math.min(nextIndex, Math.max(0, count - 1)), nextIndex >= count ? "group_finished" : "answering", result.sessionId);
}

export function validateTrainingSessionResult(result: TrainingResult): { currentIndex: number; count: number } {
  const state = trainingSessionState(result);
  if (state.currentIndex !== state.exerciseIndex) throw Object.assign(new Error("Training exercise is not active"), { status: 409 });
  return { currentIndex: state.currentIndex, count: state.count };
}

function trainingSessionState(result: TrainingResult): { currentIndex: number; exerciseIndex: number; count: number; phase: string } {
  const session = db.prepare("SELECT current_index, session_kind, finished FROM practice_sessions WHERE id = ?")
    .get(result.sessionId) as { current_index: number; session_kind: string; finished: number; phase?: string } | undefined;
  if (!session || session.finished) throw Object.assign(new Error("Training session is unavailable"), { status: 409 });
  if (session.session_kind === "challenge") throw Object.assign(new Error("Assessment does not accept local training results"), { status: 403 });
  const exercise = db.prepare("SELECT id, instance_index FROM practice_instances WHERE session_id = ? AND id = ?")
    .get(result.sessionId, result.exerciseId) as { id: string; instance_index: number } | undefined;
  if (!exercise) throw Object.assign(new Error("Training exercise is not part of this session"), { status: 409 });
  if (!result.actionMetrics.length || result.actionMetrics.some((metric) => !metric.completed)) {
    throw Object.assign(new Error("Training result is incomplete"), { status: 400 });
  }
  const count = (db.prepare("SELECT COUNT(*) AS count FROM practice_instances WHERE session_id = ?").get(result.sessionId) as { count: number }).count;
  const phase = (db.prepare("SELECT phase FROM practice_sessions WHERE id = ?").get(result.sessionId) as { phase: string }).phase;
  return { currentIndex: session.current_index, exerciseIndex: exercise.instance_index, count, phase };
}
