import { isActionEvidence, type ActionEvidence } from "./actionRuntime";

export const TRAINING_RUNTIME_VERSION = 1 as const;
export type TrainingAssistance = "none" | "back" | "clear" | "hint" | "coach";

export type SemanticCandidate =
  | { kind: "object"; objectKind: "point" | "line" | "angle"; objectId: string }
  | { kind: "answer"; slotId: string; value: string }
  | { kind: "action-evidence"; evidence: ActionEvidence };

export interface TrainingAttemptEvent {
  version: typeof TRAINING_RUNTIME_VERSION;
  eventId: string;
  sessionId: string;
  exerciseId: string;
  actionId: string;
  actionKind: string;
  candidate: SemanticCandidate;
  outcome: "correct-partial" | "correct-complete" | "wrong";
  attemptIndex: number;
  elapsedMs: number;
  assistance: TrainingAssistance;
  at: string;
}

export interface TrainingActionMetric {
  actionId: string;
  actionKind: string;
  durationMs: number;
  attemptCount: number;
  wrongAttemptCount: number;
  firstTryCorrect: boolean;
  completed: boolean;
  assistanceUsed: TrainingAssistance[];
}

export interface TrainingCheckpoint {
  version: typeof TRAINING_RUNTIME_VERSION;
  recordId: string;
  sessionId: string;
  exerciseId: string;
  planRevision: number;
  currentActionId: string;
  completedActionIds: string[];
  attempts: TrainingAttemptEvent[];
  actionMetrics: TrainingActionMetric[];
  clientRevision: number;
  createdAt: string;
}

export interface TrainingResult extends Omit<TrainingCheckpoint, "currentActionId"> {
  completedAt: string;
  durationMs: number;
  correctActionCount: number;
  firstTryCorrectCount: number;
}

export interface TrainingSummary {
  version: typeof TRAINING_RUNTIME_VERSION;
  summaryId: string;
  taskId: string;
  exerciseCount: number;
  actionCount: number;
  firstTryCorrectRate: number;
  averageActionDurationMs: number;
  generatedAt: string;
}

export interface TrainingReceipt {
  version: typeof TRAINING_RUNTIME_VERSION;
  recordId: string;
  accepted: true;
  duplicate: boolean;
  serverRevision: number;
  receivedAt: string;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: Record<string, unknown>, key: string) => typeof value[key] === "string" && String(value[key]).length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

export function isSemanticCandidate(value: unknown): value is SemanticCandidate {
  if (!record(value) || !string(value, "kind")) return false;
  switch (value.kind) {
    case "object": return ["point", "line", "angle"].includes(String(value.objectKind)) && string(value, "objectId");
    case "answer": return string(value, "slotId") && typeof value.value === "string";
    case "action-evidence": return isActionEvidence(value.evidence);
    default: return false;
  }
}

export function isTrainingAttemptEvent(value: unknown): value is TrainingAttemptEvent {
  return record(value) && value.version === TRAINING_RUNTIME_VERSION && string(value, "eventId") && string(value, "sessionId")
    && string(value, "exerciseId") && string(value, "actionId") && string(value, "actionKind") && isSemanticCandidate(value.candidate)
    && ["correct-partial", "correct-complete", "wrong"].includes(String(value.outcome))
    && Number.isInteger(value.attemptIndex) && Number(value.attemptIndex) > 0 && Number.isFinite(value.elapsedMs) && Number(value.elapsedMs) >= 0
    && ["none", "back", "clear", "hint", "coach"].includes(String(value.assistance)) && string(value, "at");
}

export function isTrainingActionMetric(value: unknown): value is TrainingActionMetric {
  return record(value) && string(value, "actionId") && string(value, "actionKind") && Number.isFinite(value.durationMs) && Number(value.durationMs) >= 0
    && Number.isInteger(value.attemptCount) && Number(value.attemptCount) >= 0 && Number.isInteger(value.wrongAttemptCount) && Number(value.wrongAttemptCount) >= 0
    && typeof value.firstTryCorrect === "boolean" && typeof value.completed === "boolean" && Array.isArray(value.assistanceUsed)
    && value.assistanceUsed.every((item) => ["none", "back", "clear", "hint", "coach"].includes(String(item)));
}

export function isTrainingCheckpoint(value: unknown): value is TrainingCheckpoint {
  return record(value) && value.version === TRAINING_RUNTIME_VERSION && string(value, "recordId") && string(value, "sessionId")
    && string(value, "exerciseId") && Number.isInteger(value.planRevision) && string(value, "currentActionId") && strings(value.completedActionIds)
    && Array.isArray(value.attempts) && value.attempts.every(isTrainingAttemptEvent)
    && Array.isArray(value.actionMetrics) && value.actionMetrics.every(isTrainingActionMetric)
    && Number.isInteger(value.clientRevision) && Number(value.clientRevision) >= 0 && string(value, "createdAt");
}

export function isTrainingResult(value: unknown): value is TrainingResult {
  return record(value) && isTrainingCheckpoint({ ...value, currentActionId: "completed" }) && string(value, "completedAt")
    && Number.isFinite(value.durationMs) && Number(value.durationMs) >= 0 && Number.isInteger(value.correctActionCount)
    && Number(value.correctActionCount) >= 0 && Number.isInteger(value.firstTryCorrectCount) && Number(value.firstTryCorrectCount) >= 0;
}

export function isTrainingReceipt(value: unknown): value is TrainingReceipt {
  return record(value) && value.version === TRAINING_RUNTIME_VERSION && string(value, "recordId") && value.accepted === true
    && typeof value.duplicate === "boolean" && Number.isInteger(value.serverRevision) && Number(value.serverRevision) >= 0 && string(value, "receivedAt");
}
