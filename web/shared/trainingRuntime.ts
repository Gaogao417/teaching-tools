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

// ===========================================================================
// Training Runtime v2 contract — ADR-006 §Local attempt and completion,
// §Training telemetry, §Metrics Semantics. Additive over v1: the v1 wire types
// above remain valid for back-compat (persistent queue, server ingest). v2 is
// the frozen target the Training remediation runtime produces — trainingGuard
// (CandidateDecision), actionTimer (ActionDuration), attemptRecorder
// (TrainingActionMetricV2 / TrainingAttemptEventV2). Illegal candidates never
// enter this telemetry and never count toward hit-rate.
// ===========================================================================

export const TRAINING_RUNTIME_V2_VERSION = 2 as const;

/** ADR-006 Feedback — reply shown/spoken on a wrong candidate. */
export interface TrainingFeedback {
  messageLatex: string;
  spokenText?: string;
  focusTargetId?: string;
  wrongObjectIds: string[];
}

/**
 * ADR-006 AttemptOutcome (audit "CandidateDecision"). `ignored-illegal` is a
 * no-op: it does NOT count as a wrong attempt and never enters hit-rate.
 */
export type CandidateDecision =
  | { kind: "ignored-illegal" }
  | { kind: "wrong"; feedback: TrainingFeedback }
  | { kind: "correct-partial" }
  | { kind: "correct-completion" };

/** ADR-006 AttemptClassification — legal candidate attempts only. */
export type AttemptClassification = "correct-candidate" | "wrong-candidate";

/** ADR-006 AssistanceLevel — coarse per-Action assistance bucket. */
export type AssistanceLevel = "unassisted" | "immediate-feedback-only" | "hint-used" | "coach-used";

/**
 * ADR-006 §Metrics Semantics timing contract. The timer pauses on visibility
 * hidden and resumes on return; BACK re-entry into the same Action continues
 * accumulating the original Action's active segments. Implemented by a single
 * ActionTimer, never per React component.
 */
export interface ActiveSegment {
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

export interface ActionDuration {
  startedAt: string;
  completedAt?: string;
  activeDurationMs: number;
  segments: ActiveSegment[];
}

/** ADR-006 errorDistribution(actionStateBefore, candidateId). */
export interface ErrorDistributionEntry {
  actionStateBefore: string;
  candidateId: string;
  wrongCount: number;
}

/** ADR-006 ActionTrainingSummary — frozen v2 Action-level metric. */
export interface TrainingActionMetricV2 {
  version: typeof TRAINING_RUNTIME_V2_VERSION;
  actionId: string;
  actionKind: string;
  startedAt: string;
  completedAt: string;
  duration: ActionDuration;
  correctAttemptCount: number;
  wrongAttemptCount: number;
  backCount: number;
  clearCount: number;
  hintCount: number;
  coachCount: number;
  firstAttemptCorrect: boolean;
  assistanceLevel: AssistanceLevel;
  errorDistribution: ErrorDistributionEntry[];
}

/** ADR-006 TrainingAttemptEvent — one legal candidate attempt (illegal excluded). */
export interface TrainingAttemptEventV2 {
  version: typeof TRAINING_RUNTIME_V2_VERSION;
  eventId: string;
  exerciseId: string;
  actionId: string;
  actionKind: string;
  actionStateBefore: string;
  sequence: number;
  occurredAt: string;
  elapsedMs: number;
  classification: AttemptClassification;
  candidateId?: string;
}

const isActiveSegment = (value: unknown): value is ActiveSegment => record(value)
  && string(value, "startedAt") && string(value, "endedAt")
  && Number.isFinite(value.durationMs) && Number(value.durationMs) >= 0;

const isActiveDuration = (value: unknown): value is ActionDuration => record(value)
  && string(value, "startedAt") && (value.completedAt === undefined || typeof value.completedAt === "string")
  && Number.isFinite(value.activeDurationMs) && Number(value.activeDurationMs) >= 0
  && Array.isArray(value.segments) && value.segments.every(isActiveSegment);

const isErrorDistributionEntry = (value: unknown): value is ErrorDistributionEntry => record(value)
  && string(value, "actionStateBefore") && string(value, "candidateId")
  && Number.isInteger(value.wrongCount) && Number(value.wrongCount) >= 0;

export function isTrainingActionMetricV2(value: unknown): value is TrainingActionMetricV2 {
  return record(value) && value.version === TRAINING_RUNTIME_V2_VERSION && string(value, "actionId") && string(value, "actionKind")
    && string(value, "startedAt") && string(value, "completedAt") && isActiveDuration(value.duration)
    && Number.isInteger(value.correctAttemptCount) && Number(value.correctAttemptCount) >= 0
    && Number.isInteger(value.wrongAttemptCount) && Number(value.wrongAttemptCount) >= 0
    && Number.isInteger(value.backCount) && Number(value.backCount) >= 0
    && Number.isInteger(value.clearCount) && Number(value.clearCount) >= 0
    && Number.isInteger(value.hintCount) && Number(value.hintCount) >= 0
    && Number.isInteger(value.coachCount) && Number(value.coachCount) >= 0
    && typeof value.firstAttemptCorrect === "boolean"
    && ["unassisted", "immediate-feedback-only", "hint-used", "coach-used"].includes(String(value.assistanceLevel))
    && Array.isArray(value.errorDistribution) && value.errorDistribution.every(isErrorDistributionEntry);
}

export function isTrainingAttemptEventV2(value: unknown): value is TrainingAttemptEventV2 {
  return record(value) && value.version === TRAINING_RUNTIME_V2_VERSION && string(value, "eventId") && string(value, "exerciseId")
    && string(value, "actionId") && string(value, "actionKind") && string(value, "actionStateBefore")
    && Number.isInteger(value.sequence) && Number(value.sequence) > 0 && string(value, "occurredAt")
    && Number.isFinite(value.elapsedMs) && Number(value.elapsedMs) >= 0
    && ["correct-candidate", "wrong-candidate"].includes(String(value.classification))
    && (value.candidateId === undefined || typeof value.candidateId === "string");
}
