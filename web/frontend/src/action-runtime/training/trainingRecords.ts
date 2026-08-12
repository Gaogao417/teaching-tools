import type { ExercisePlan } from "../../../../shared/actionRuntime";
import {
  TRAINING_RUNTIME_VERSION,
  type TrainingCheckpoint,
  type TrainingResult,
} from "../../../../shared/trainingRuntime";
import type { AttemptRecorderSnapshot } from "./attemptRecorder";

/**
 * The envelope "carries v2 alongside v1" (ADR-006 remediation option B): the v1
 * checkpoint/result wire shape stays valid for back-compat (the persistent
 * TrainingSyncQueue and the presentation frame keep emitting it unchanged), and
 * the v2 telemetry arrays are attached additively when the local training
 * runtime produced them. v2-aware backends read v2 first and fall back to v1;
 * v1-only backends ignore the extra fields.
 *
 * `buildTrainingCheckpoint`/`buildTrainingResult` are the frame-facing builders
 * (unchanged signatures) and now also attach the v2 carry-on when present.
 * `buildTrainingCheckpointV2`/`buildTrainingResultV2` are explicit v2-aware
 * aliases for producers that want to signal v2 intent; they are equivalent.
 */

function attachV2<Carry extends AttemptRecorderSnapshot>(base: Carry) {
  return base.actionMetricsV2 && base.attemptsV2
    ? { actionMetricsV2: base.actionMetricsV2, attemptsV2: base.attemptsV2 }
    : {};
}

export function buildTrainingCheckpoint(
  sessionId: string,
  plan: ExercisePlan,
  currentActionId: string,
  completedActionIds: string[],
  snapshot: AttemptRecorderSnapshot,
): TrainingCheckpoint {
  const clientRevision = completedActionIds.length + snapshot.attempts.length;
  return {
    version: TRAINING_RUNTIME_VERSION,
    recordId: `${sessionId}:${plan.exerciseId}:checkpoint:${clientRevision}:${currentActionId}`,
    sessionId,
    exerciseId: plan.exerciseId,
    planRevision: plan.revision,
    currentActionId,
    completedActionIds: [...completedActionIds],
    attempts: snapshot.attempts.map((attempt) => ({ ...attempt, sessionId })),
    actionMetrics: snapshot.actionMetrics,
    clientRevision,
    createdAt: new Date().toISOString(),
    ...attachV2(snapshot),
  };
}

export function buildTrainingResult(
  sessionId: string,
  plan: ExercisePlan,
  completedActionIds: string[],
  snapshot: AttemptRecorderSnapshot,
): TrainingResult {
  const completedAt = new Date().toISOString();
  const clientRevision = completedActionIds.length + snapshot.attempts.length;
  return {
    version: TRAINING_RUNTIME_VERSION,
    recordId: `${sessionId}:${plan.exerciseId}:result:v1`,
    sessionId,
    exerciseId: plan.exerciseId,
    planRevision: plan.revision,
    completedActionIds: [...completedActionIds],
    attempts: snapshot.attempts.map((attempt) => ({ ...attempt, sessionId })),
    actionMetrics: snapshot.actionMetrics,
    clientRevision,
    createdAt: completedAt,
    completedAt,
    durationMs: snapshot.actionMetrics.reduce((sum, metric) => sum + metric.durationMs, 0),
    correctActionCount: snapshot.actionMetrics.filter((metric) => metric.completed).length,
    firstTryCorrectCount: snapshot.actionMetrics.filter((metric) => metric.firstTryCorrect).length,
    ...attachV2(snapshot),
  };
}

/** v2-aware alias. Equivalent to buildTrainingCheckpoint (carries v2 when present). */
export const buildTrainingCheckpointV2 = buildTrainingCheckpoint;

/** v2-aware alias. Equivalent to buildTrainingResult (carries v2 when present). */
export const buildTrainingResultV2 = buildTrainingResult;
