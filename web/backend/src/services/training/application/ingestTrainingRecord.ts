import { hasValidTrainingV2CarryOn, isTrainingCheckpoint, isTrainingResult, type TrainingCheckpoint, type TrainingResult } from "../../../../../shared/trainingRuntime";
import type { TrainingRecordKind, TrainingRecordRepository } from "../ports/trainingRecordRepository";

/** Envelope/invariant validation only. Practice correctness was already decided by the local Action guard. */
export function ingestTrainingRecord(repository: TrainingRecordRepository, kind: TrainingRecordKind, value: unknown) {
  const valid = kind === "checkpoint" ? isTrainingCheckpoint(value) : isTrainingResult(value);
  if (!valid) throw Object.assign(new Error(`Invalid training ${kind}`), { status: 400 });
  // ADR-006 v2 carry-on: when present it must be well-formed v2 telemetry. This
  // validates SHAPE only (the frozen v2 validators); it never re-judges math.
  if (!hasValidTrainingV2CarryOn(value)) {
    throw Object.assign(new Error(`Invalid training ${kind} v2 carry-on`), { status: 400 });
  }
  const record = value as TrainingCheckpoint | TrainingResult;
  if (record.attempts.some((attempt) => attempt.sessionId !== record.sessionId || attempt.exerciseId !== record.exerciseId)) {
    throw Object.assign(new Error("Training attempt envelope mismatch"), { status: 400 });
  }
  if (record.actionMetrics.some((metric) => metric.wrongAttemptCount > metric.attemptCount)) {
    throw Object.assign(new Error("Training metric invariant failed"), { status: 400 });
  }
  return repository.save(kind, record);
}
