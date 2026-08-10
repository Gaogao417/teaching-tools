import type {
  TopicChoiceOption,
  TopicCoachScript,
  TopicGeometryModel,
  TopicInteractionPresentation,
  TopicSegmentLabel,
} from "./topicPractice";
import type { DomainCommand } from "./actionWorld";

export const ACTION_RUNTIME_PLAN_VERSION = 2 as const;

export type LearningMode = "learn" | "guided-practice" | "assessment";
export type ValidationPolicy = "local-teaching" | "server-authoritative";

export interface CoachProfile {
  profileId: string;
  displayName: string;
  avatarId: string;
  voiceId?: string;
  tone: "supportive" | "socratic" | "direct";
}

export interface ExerciseMetadata {
  taskId: string;
  title: string;
  promptLatex: string;
  modelLabel?: string;
  diagramAsset?: string;
  skillTags: string[];
}

export interface WorldProjection {
  geometry?: TopicGeometryModel;
  diagramAsset?: string;
  revision: number;
}

export interface AnswerSlotSpec {
  id: string;
  label: string;
  kind: "object" | "text" | "number" | "equation";
  required: boolean;
  placeholder?: string;
  options?: TopicChoiceOption[];
}

/**
 * Offline-authored action envelope. Backend runtime treats `kind`, `version`
 * and both input objects as opaque JSON; the frontend registry owns the
 * action-specific schema and machine factory.
 */
export interface AuthoredActionTemplate {
  actionId: string;
  sourceStepId: string;
  kind: string;
  version: number;
  title: string;
  instruction: string;
  input: Record<string, unknown>;
  /** Public teaching targets merged for Learn/Guided, never for Assessment. */
  teachingInput?: Record<string, unknown>;
  capabilities: string[];
  answerSlots: AnswerSlotSpec[];
  submitOnComplete: boolean;
  presentation?: TopicInteractionPresentation;
  coach?: TopicCoachScript;
}

interface ActionContractBase<Kind extends string, Input> {
  actionId: string;
  sourceStepId: string;
  kind: Kind;
  version: 1;
  title: string;
  instruction: string;
  input: Input;
  capabilities: string[];
  answerSlots: AnswerSlotSpec[];
  validationPolicy: ValidationPolicy;
  submitOnComplete: boolean;
  presentation?: TopicInteractionPresentation;
  coach?: TopicCoachScript;
}

export type MakeParallelAction = ActionContractBase<"make-parallel", {
  throughPointId?: string;
  referenceLineId?: string;
  availablePointIds: string[];
  availableLineIds: string[];
  outputLineId: string;
  /** Learner-facing name for the constructed line; the runtime id stays opaque. */
  outputLineLabel?: string;
}>;

export type IntersectCarriersAction = ActionContractBase<"intersect-carriers", {
  carrierPointIds?: [string, string];
  resultPointId?: string;
  availablePointIds: string[];
  parallelLineId: string;
  outputCarrierLineId: string;
  outputPointId: string;
}>;

export type MarkSegmentValuesAction = ActionContractBase<"mark-segment-values", {
  labels: TopicSegmentLabel[];
  availableSegmentIds: string[];
  autoFocusSequence: boolean;
}>;

export type PairSegmentsAction = ActionContractBase<"pair-segments", {
  expectedOrder?: string[];
  availableSegmentIds: string[];
  pairCount: number;
}>;

export type RatioScratchAction = ActionContractBase<"ratio-scratch", {
  expectedOrder?: string[];
  availableSegmentIds: string[];
  firstDisplayName: string;
  firstValueLatex: string;
  secondDisplayName: string;
  secondValueLatex: string;
  simplifiedRatio?: [string, string];
}>;

export type ConvertCollinearAction = ActionContractBase<"convert-collinear", {
  expectedOrder?: string[];
  availableSegmentIds: string[];
  wholeSegment: string;
  targetSegment: string;
  knownSegment: string;
  relationLatex: string;
}>;

export type EnterEquationAction = ActionContractBase<"enter-equation", {
  expectedOrder?: string[];
  availableSegmentIds: string[];
  targetLatex: string;
  factorSlots: [string, string, string];
  shareValues?: [string, string];
  knownValueLatex?: string;
  expectedResult?: string;
}>;

export type SelectOptionAction = ActionContractBase<"select-option", {
  options: TopicChoiceOption[];
  expectedValue?: string;
}>;

export type EnterTextAction = ActionContractBase<"enter-text", {
  placeholder: string;
  expectedValues?: string[];
}>;

export type ActionContract =
  | MakeParallelAction
  | IntersectCarriersAction
  | MarkSegmentValuesAction
  | PairSegmentsAction
  | RatioScratchAction
  | ConvertCollinearAction
  | EnterEquationAction
  | SelectOptionAction
  | EnterTextAction;

export type ActionKind = ActionContract["kind"];

export interface ExercisePlan {
  planVersion: typeof ACTION_RUNTIME_PLAN_VERSION;
  exerciseId: string;
  revision: number;
  mode: LearningMode;
  metadata: ExerciseMetadata;
  world: WorldProjection;
  coach: CoachProfile;
  actions: ActionContract[];
  currentActionId: string;
  completedActionIds: string[];
}

interface EvidenceBase<Kind extends ActionKind> {
  actionId: string;
  sourceStepId: string;
  kind: Kind;
  version: 1;
}

export type ActionEvidence =
  | (EvidenceBase<"make-parallel"> & { throughPointId: string; referenceLineId: string })
  | (EvidenceBase<"intersect-carriers"> & { carrierPointIds: [string, string] })
  | (EvidenceBase<"mark-segment-values"> & { values: Record<string, string> })
  | (EvidenceBase<"pair-segments"> & { segmentIds: string[] })
  | (EvidenceBase<"ratio-scratch"> & { segmentIds: string[]; ratio: [string, string] })
  | (EvidenceBase<"convert-collinear"> & { segmentIds: string[] })
  | (EvidenceBase<"enter-equation"> & { factors: string[]; result: string })
  | (EvidenceBase<"select-option"> & { value: string })
  | (EvidenceBase<"enter-text"> & { value: string });

export interface ActionCompletion {
  actionId: string;
  sourceStepId: string;
  evidence: ActionEvidence;
  commands: DomainCommand[];
}

export type StudentEvent =
  | { type: "object-selected"; objectKind: "point" | "line" | "angle"; objectId: string; at: string }
  | { type: "answer-changed"; slotId: string; value: string; at: string }
  | { type: "back" | "clear" | "help-requested" | "action-completed"; at: string };

export interface StudentTrace {
  exerciseId: string;
  currentActionId: string;
  actionState: string;
  selectedObjectIds: string[];
  answerDraft: Record<string, string>;
  recentEvents: StudentEvent[];
  wrongAttempts: number;
  revision: number;
  studentMessage?: string;
}

export interface CoachDirective {
  directiveId: string;
  messageLatex: string;
  tone: "prompt" | "correct" | "wrong" | "explain";
  highlightObjectIds: string[];
  focusTargetId?: string;
  suggestedActionId?: string;
  agentCommand?: AgentCommand;
}

export interface AgentCommand {
  commandId: string;
  actionId: string;
  type: "select-object" | "set-answer" | "back" | "clear";
  objectId?: string;
  slotId?: string;
  value?: string;
}

export interface ActionEvaluationRequest {
  sessionId: string;
  exerciseId: string;
  sourceStepId: string;
  revision: number;
  evidence: ActionEvidence[];
  idempotencyKey: string;
}

export interface ActionCheckpointRequest {
  sessionId: string;
  exerciseId: string;
  currentActionId: string;
  completedActionIds: string[];
  evidence: ActionEvidence[];
  currentDraft?: ActionDraftCheckpoint;
  revision: number;
}

export interface ActionDraftCheckpoint {
  selectedByKind: { points: string[]; lines: string[]; angles: string[] };
  answers: Record<string, string>;
  activeSlotId?: string;
}

export interface ActionCheckpointSnapshot {
  currentActionId: string;
  completedActionIds: string[];
  evidence: ActionEvidence[];
  currentDraft?: ActionDraftCheckpoint;
  revision: number;
  updatedAt: string;
}

export interface ActionPlanResponse {
  sessionId: string;
  plan: ExercisePlan;
  checkpoint?: ActionCheckpointSnapshot;
}

export interface CoachRequest {
  sessionId: string;
  exerciseId: string;
  trace: StudentTrace;
  studentMessage?: string;
}

export interface CoachResponse {
  directive: CoachDirective;
}

export type EvaluationOutcome = "accepted" | "rejected" | "conflict";

export interface ActionEvaluationResponse {
  outcome: EvaluationOutcome;
  evaluation: "correct" | "wrong" | "progress";
  revision: number;
  diagnosis?: {
    messageLatex: string;
    wrongObjectIds: string[];
    wrongActionIds?: string[];
    wrongSlotIds?: string[];
    focusTargetId?: string;
  };
  nextActionId?: string;
  plan?: ExercisePlan;
  phase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished";
  nextIndex: number;
  committedWorld?: WorldProjection;
}

export interface ActionCheckpointResponse {
  accepted: true;
  revision: number;
  updatedAt: string;
}

const ACTION_KINDS: ReadonlySet<string> = new Set<ActionKind>([
  "make-parallel",
  "intersect-carriers",
  "mark-segment-values",
  "pair-segments",
  "ratio-scratch",
  "convert-collinear",
  "enter-equation",
  "select-option",
  "enter-text",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string";
}

function hasStringArray(value: Record<string, unknown>, key: string): boolean {
  return Array.isArray(value[key]) && (value[key] as unknown[]).every((item) => typeof item === "string");
}

export function isActionEvidence(value: unknown): value is ActionEvidence {
  if (!isRecord(value) || !hasString(value, "actionId") || !hasString(value, "sourceStepId") || value.version !== 1) return false;
  if (typeof value.kind !== "string" || !ACTION_KINDS.has(value.kind)) return false;
  switch (value.kind as ActionKind) {
    case "make-parallel":
      return hasString(value, "throughPointId") && hasString(value, "referenceLineId");
    case "intersect-carriers":
      return hasStringArray(value, "carrierPointIds") && (value.carrierPointIds as string[]).length === 2;
    case "mark-segment-values":
      return isRecord(value.values) && Object.values(value.values).every((item) => typeof item === "string");
    case "pair-segments":
    case "convert-collinear":
      return hasStringArray(value, "segmentIds");
    case "ratio-scratch":
      return hasStringArray(value, "segmentIds") && hasStringArray(value, "ratio") && (value.ratio as string[]).length === 2;
    case "enter-equation":
      return hasStringArray(value, "factors") && hasString(value, "result");
    case "select-option":
    case "enter-text":
      return hasString(value, "value");
  }
}

export function isActionEvaluationRequest(value: unknown): value is ActionEvaluationRequest {
  if (!isRecord(value)) return false;
  return hasString(value, "sessionId")
    && hasString(value, "exerciseId")
    && hasString(value, "sourceStepId")
    && typeof value.revision === "number"
    && hasString(value, "idempotencyKey")
    && Array.isArray(value.evidence)
    && value.evidence.every(isActionEvidence);
}

export function isActionCheckpointRequest(value: unknown): value is ActionCheckpointRequest {
  if (!isRecord(value)) return false;
  const draft = value.currentDraft;
  const validDraft = draft === undefined || (isRecord(draft)
    && isRecord(draft.selectedByKind)
    && hasStringArray(draft.selectedByKind, "points")
    && hasStringArray(draft.selectedByKind, "lines")
    && hasStringArray(draft.selectedByKind, "angles")
    && isRecord(draft.answers)
    && Object.values(draft.answers).every((item) => typeof item === "string")
    && (draft.activeSlotId === undefined || typeof draft.activeSlotId === "string"));
  return hasString(value, "sessionId")
    && hasString(value, "exerciseId")
    && hasString(value, "currentActionId")
    && typeof value.revision === "number"
    && hasStringArray(value, "completedActionIds")
    && Array.isArray(value.evidence)
    && value.evidence.every(isActionEvidence)
    && validDraft;
}

export function isCoachRequest(value: unknown): value is CoachRequest {
  if (!isRecord(value) || !hasString(value, "sessionId") || !hasString(value, "exerciseId") || !isRecord(value.trace)) return false;
  const trace = value.trace;
  return hasString(trace, "exerciseId")
    && hasString(trace, "currentActionId")
    && hasString(trace, "actionState")
    && hasStringArray(trace, "selectedObjectIds")
    && isRecord(trace.answerDraft)
    && typeof trace.wrongAttempts === "number"
    && typeof trace.revision === "number"
    && Array.isArray(trace.recentEvents)
    && (trace.studentMessage === undefined || typeof trace.studentMessage === "string")
    && (value.studentMessage === undefined || typeof value.studentMessage === "string");
}

export function isAgentCommand(value: unknown): value is AgentCommand {
  if (!isRecord(value) || !hasString(value, "commandId") || !hasString(value, "actionId") || !hasString(value, "type")) return false;
  switch (value.type) {
    case "select-object": return hasString(value, "objectId");
    case "set-answer": return hasString(value, "slotId") && hasString(value, "value");
    case "back":
    case "clear": return true;
    default: return false;
  }
}

export function isCoachDirective(value: unknown): value is CoachDirective {
  if (!isRecord(value)
    || !hasString(value, "directiveId")
    || !hasString(value, "messageLatex")
    || !["prompt", "correct", "wrong", "explain"].includes(String(value.tone))
    || !hasStringArray(value, "highlightObjectIds")) return false;
  return (value.focusTargetId === undefined || typeof value.focusTargetId === "string")
    && (value.suggestedActionId === undefined || typeof value.suggestedActionId === "string")
    && (value.agentCommand === undefined || isAgentCommand(value.agentCommand));
}

export function isCoachResponse(value: unknown): value is CoachResponse {
  return isRecord(value) && isCoachDirective(value.directive);
}

export function isActionCheckpointResponse(value: unknown): value is ActionCheckpointResponse {
  return isRecord(value) && value.accepted === true && typeof value.revision === "number" && hasString(value, "updatedAt");
}

export function isActionEvaluationResponse(value: unknown): value is ActionEvaluationResponse {
  if (!isRecord(value)
    || !["accepted", "rejected", "conflict"].includes(String(value.outcome))
    || !["correct", "wrong", "progress"].includes(String(value.evaluation))
    || typeof value.revision !== "number" || typeof value.nextIndex !== "number"
    || !["answering", "correct_pause", "wrong_feedback", "group_finished"].includes(String(value.phase))) return false;
  if (value.diagnosis !== undefined) {
    if (!isRecord(value.diagnosis) || !hasString(value.diagnosis, "messageLatex") || !hasStringArray(value.diagnosis, "wrongObjectIds")) return false;
    if (value.diagnosis.wrongActionIds !== undefined && !hasStringArray(value.diagnosis, "wrongActionIds")) return false;
    if (value.diagnosis.wrongSlotIds !== undefined && !hasStringArray(value.diagnosis, "wrongSlotIds")) return false;
  }
  return (value.plan === undefined || isExercisePlan(value.plan))
    && (value.committedWorld === undefined || isWorldProjection(value.committedWorld));
}

export function isActionPlanResponse(value: unknown): value is ActionPlanResponse {
  return isRecord(value) && hasString(value, "sessionId") && isExercisePlan(value.plan);
}

function isAnswerSlot(value: unknown): value is AnswerSlotSpec {
  if (!isRecord(value) || !hasString(value, "id") || !hasString(value, "label") || typeof value.required !== "boolean") return false;
  return ["object", "text", "number", "equation"].includes(String(value.kind));
}

function isWorldProjection(value: unknown): value is WorldProjection {
  if (!isRecord(value) || typeof value.revision !== "number") return false;
  if (value.diagramAsset !== undefined && typeof value.diagramAsset !== "string") return false;
  if (value.geometry === undefined) return true;
  if (!isRecord(value.geometry) || !isRecord(value.geometry.viewBox)
    || typeof value.geometry.viewBox.width !== "number" || typeof value.geometry.viewBox.height !== "number"
    || !Array.isArray(value.geometry.points) || !Array.isArray(value.geometry.segments)) return false;
  return value.geometry.points.every((point) => isRecord(point) && hasString(point, "id") && typeof point.x === "number" && typeof point.y === "number")
    && value.geometry.segments.every((line) => isRecord(line) && hasString(line, "id") && hasString(line, "from") && hasString(line, "to"))
    && (value.geometry.derivedLines === undefined || (Array.isArray(value.geometry.derivedLines)
      && value.geometry.derivedLines.every((line) => isRecord(line) && hasString(line, "id") && line.kind === "parallel-line" && hasString(line, "through") && hasString(line, "parallelTo"))));
}

export function isExercisePlan(value: unknown): value is ExercisePlan {
  if (!isRecord(value) || value.planVersion !== ACTION_RUNTIME_PLAN_VERSION
    || !hasString(value, "exerciseId") || typeof value.revision !== "number"
    || !["learn", "guided-practice", "assessment"].includes(String(value.mode))
    || !hasString(value, "currentActionId") || !hasStringArray(value, "completedActionIds")
    || !isWorldProjection(value.world) || !isRecord(value.metadata) || !isRecord(value.coach)) return false;
  if (!Array.isArray(value.actions) || !value.actions.length) return false;
  const ids = new Set<string>();
  return value.actions.every((action) => {
    if (!isRecord(action) || !hasString(action, "actionId") || ids.has(action.actionId as string)) return false;
    ids.add(action.actionId as string);
    return hasString(action, "sourceStepId") && hasString(action, "kind") && Number.isInteger(action.version) && Number(action.version) > 0
      && hasString(action, "title") && hasString(action, "instruction") && isRecord(action.input)
      && hasStringArray(action, "capabilities") && Array.isArray(action.answerSlots) && action.answerSlots.every(isAnswerSlot)
      && ["local-teaching", "server-authoritative"].includes(String(action.validationPolicy))
      && typeof action.submitOnComplete === "boolean";
  }) && ids.has(value.currentActionId as string);
}

export function assertExercisePlan(value: unknown): asserts value is ExercisePlan {
  if (!isRecord(value) || value.planVersion !== ACTION_RUNTIME_PLAN_VERSION) {
    throw new Error("Unsupported Action Runtime plan version");
  }
  if (!isExercisePlan(value)) throw new Error("Invalid ExercisePlan schema");
}
