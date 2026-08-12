import type { TrainingCheckpoint, TrainingReceipt, TrainingResult } from "../../../../../shared/trainingRuntime";

export type TrainingRecord = TrainingCheckpoint | TrainingResult;
export type TrainingRecordKind = "checkpoint" | "result";

export interface TrainingRecordRepository {
  save(kind: TrainingRecordKind, record: TrainingRecord): TrainingReceipt;
  listForSession(sessionId: string): Array<{ kind: TrainingRecordKind; record: TrainingRecord; receivedAt: string }>;
}
