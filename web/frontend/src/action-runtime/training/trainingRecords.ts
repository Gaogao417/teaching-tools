import type { ExercisePlan } from "../../../../shared/actionRuntime";
import { TRAINING_RUNTIME_VERSION, type TrainingCheckpoint, type TrainingResult } from "../../../../shared/trainingRuntime";
import type { AttemptRecorderSnapshot } from "./attemptRecorder";

export function buildTrainingCheckpoint(sessionId: string, plan: ExercisePlan, currentActionId: string, completedActionIds: string[], snapshot: AttemptRecorderSnapshot): TrainingCheckpoint {
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
  };
}

export function buildTrainingResult(sessionId: string, plan: ExercisePlan, completedActionIds: string[], snapshot: AttemptRecorderSnapshot): TrainingResult {
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
  };
}
