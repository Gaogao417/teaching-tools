import type {
  TopicChoiceOption,
  TopicCoachScript,
  TopicGeometryModel,
  TopicInteractionPresentation,
  TopicSegmentLabel,
} from "./topicPractice";
import type { DomainCommand } from "./actionWorld";
import {
  isActionSolutionBoardContext,
  type ActionSolutionBoardContext,
} from "./solutionBoard";

export const ACTION_RUNTIME_PLAN_VERSION = 5 as const;

export type LearningMode = "learn" | "guided-practice" | "assessment";
export type ValidationPolicy = "local-demonstration" | "local-training" | "server-authoritative";

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
  /** Reviewed answer truth. Required for local modes and forbidden in Assessment. */
  localTruth?: Record<string, unknown>;
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
  requiredCount?: number;
  autoFocusSequence: boolean;
}>;

export type PairSegmentsAction = ActionContractBase<"pair-segments", {
  expectedOrder?: string[];
  availableSegmentIds: string[];
  pairCount: number;
  /** Authored equivalence policy; see shared/actionAnswerEquivalence. */
  pairOrderPolicy?: import("./actionAnswerEquivalence").PairOrderPolicy;
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
  /** Authored equivalence policy; see shared/actionAnswerEquivalence. */
  answerNormalization?: import("./actionAnswerEquivalence").AnswerNormalization;
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
  /**
   * Complete server-projected board snapshots for Actions currently authorized
   * in this plan. Assessment always omits them.
   */
  solutionBoardContexts?: ActionSolutionBoardContext[];
  coach: CoachProfile;
  actions: ActionContract[];
  currentActionId: string;
  completedActionIds: string[];
  runtimeCapabilities?: {
    practiceValidation: "local-training" | "server-authoritative";
    trainingSync: "legacy-evaluation" | "async-records" | "local-only";
    narrationTransport: "url" | "stream" | "off";
    coachTurnTransport: "request-response" | "stream";
    liveCoach: boolean;
  };
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
  /** Plain spoken copy. Keep display LaTeX out of the TTS input. */
  spokenText?: string;
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

export interface CoachConversationTurn {
  role: "student" | "coach";
  text: string;
}

export interface CoachAudioInput {
  /** Browser-recorded audio encoded as a data URL; limited and validated by the backend. */
  dataUrl: string;
  durationMs?: number;
}

export interface CoachTurnRequest {
  context:
    | { kind: "practice"; sessionId: string }
    | { kind: "learn"; taskId: string };
  exerciseId: string;
  trace: StudentTrace;
  studentMessage?: string;
  studentAudio?: CoachAudioInput;
  conversation?: CoachConversationTurn[];
  synthesizeSpeech?: boolean;
}

export interface CoachSpeech {
  audioUrl: string;
  expiresAt?: number;
}

/**
 * Direct, deterministic teacher-text TTS request. The frontend normalizes
 * display LaTeX into plain spoken copy before calling, but the endpoint
 * re-applies the shared normalization so LaTeX input is also safe. This is a
 * stateless text→audio port: it never invokes the AI coach.
 */
export interface DirectSpeechRequest {
  text: string;
  /** Optional correlationId so the server-side narration timeline can be sunk
   *  under the same id the browser reports `browser_first_audio_at` for
   *  (ADR-005 §Observability Contract). Additive; the request guard ignores it. */
  correlationId?: string;
}

export type DirectSpeechResponse = CoachSpeech;

export interface CoachTurnResponse extends CoachResponse {
  transcript?: string;
  speech?: CoachSpeech;
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
  /** Complete snapshot for the Action that is current after this response. */
  solutionBoardContext?: ActionSolutionBoardContext;
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

/**
 * Action vocabulary 真源的公开只读视图（Phase 4 / P4-01）。
 * planBuild 的 RuntimeRegistrySnapshot 以此为唯一 ActionKind 清单；
 * Build Agent 只能引用其中的 kind，缺 primitive 一律 fail closed。
 */
export const RUNTIME_ACTION_KINDS: readonly string[] = [...ACTION_KINDS];

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
  return (value.spokenText === undefined || typeof value.spokenText === "string")
    && (value.focusTargetId === undefined || typeof value.focusTargetId === "string")
    && (value.suggestedActionId === undefined || typeof value.suggestedActionId === "string")
    && (value.agentCommand === undefined || isAgentCommand(value.agentCommand));
}

export function isCoachResponse(value: unknown): value is CoachResponse {
  return isRecord(value) && isCoachDirective(value.directive);
}

function isCoachConversationTurn(value: unknown): value is CoachConversationTurn {
  return isRecord(value)
    && ["student", "coach"].includes(String(value.role))
    && hasString(value, "text");
}

export function isCoachTurnRequest(value: unknown): value is CoachTurnRequest {
  if (!isRecord(value) || !isRecord(value.context) || !hasString(value.context, "kind")
    || !hasString(value, "exerciseId") || !isRecord(value.trace)) return false;
  const contextValid = value.context.kind === "practice"
    ? hasString(value.context, "sessionId")
    : value.context.kind === "learn" && hasString(value.context, "taskId");
  const audio = value.studentAudio;
  const audioValid = audio === undefined || (isRecord(audio)
    && hasString(audio, "dataUrl")
    && (audio.durationMs === undefined || (typeof audio.durationMs === "number" && audio.durationMs >= 0)));
  const conversationValid = value.conversation === undefined || (Array.isArray(value.conversation)
    && value.conversation.every(isCoachConversationTurn));
  return contextValid
    && isCoachRequest({
      sessionId: value.context.kind === "practice" ? value.context.sessionId : `learn:${value.context.taskId}`,
      exerciseId: value.exerciseId,
      trace: value.trace,
      studentMessage: value.studentMessage,
    })
    && audioValid
    && conversationValid
    && (value.studentMessage === undefined || typeof value.studentMessage === "string")
    && (value.synthesizeSpeech === undefined || typeof value.synthesizeSpeech === "boolean")
    && ((typeof value.studentMessage === "string" && value.studentMessage.trim().length > 0) || audio !== undefined);
}

export function isCoachTurnResponse(value: unknown): value is CoachTurnResponse {
  if (!isCoachResponse(value) || !isRecord(value)) return false;
  if (value.transcript !== undefined && typeof value.transcript !== "string") return false;
  if (value.speech === undefined) return true;
  return isRecord(value.speech)
    && hasString(value.speech, "audioUrl")
    && (value.speech.expiresAt === undefined || typeof value.speech.expiresAt === "number");
}

export function isActionCheckpointResponse(value: unknown): value is ActionCheckpointResponse {
  return isRecord(value) && value.accepted === true && typeof value.revision === "number" && hasString(value, "updatedAt");
}

export function isDirectSpeechRequest(value: unknown): value is DirectSpeechRequest {
  return isRecord(value) && typeof value.text === "string" && value.text.trim().length > 0;
}

export function isDirectSpeechResponse(value: unknown): value is DirectSpeechResponse {
  if (!isRecord(value) || !hasString(value, "audioUrl")) return false;
  return value.expiresAt === undefined || typeof value.expiresAt === "number";
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
    && (value.committedWorld === undefined || isWorldProjection(value.committedWorld))
    && (value.solutionBoardContext === undefined || isActionSolutionBoardContext(value.solutionBoardContext));
}

export function isActionPlanResponse(value: unknown): value is ActionPlanResponse {
  return isRecord(value) && hasString(value, "sessionId") && isExercisePlan(value.plan);
}

function isAnswerSlot(value: unknown): value is AnswerSlotSpec {
  if (!isRecord(value) || !hasString(value, "id") || !hasString(value, "label") || typeof value.required !== "boolean") return false;
  return ["object", "text", "number", "equation"].includes(String(value.kind));
}

function isTeachingMark(value: unknown): boolean {
  if (!isRecord(value) || !hasString(value, "id") || !hasString(value, "kind")) return false;
  if (value.kind === "segment-label") {
    return hasString(value, "segmentId") && hasString(value, "valueLatex")
      && ["length", "share"].includes(String(value.labelKind));
  }
  if (value.kind === "correspondence") {
    return Array.isArray(value.segmentIds) && value.segmentIds.length === 2
      && value.segmentIds.every((id) => typeof id === "string")
      && Number.isInteger(value.tickCount) && Number(value.tickCount) > 0;
  }
  return value.kind === "emphasis" && hasStringArray(value, "entityIds");
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
      && value.geometry.derivedLines.every((line) => isRecord(line) && hasString(line, "id") && line.kind === "parallel-line" && hasString(line, "through") && hasString(line, "parallelTo"))))
    && (value.geometry.teachingMarks === undefined || (Array.isArray(value.geometry.teachingMarks)
      && value.geometry.teachingMarks.every(isTeachingMark)));
}

const LOCAL_TRUTH_KEYS = /^(acceptedAnswers|expectedValue|expectedValues|expectedOrder|expectedResult|throughPointId|referenceLineId|carrierPointIds|simplifiedRatio|shareValues|knownValueLatex)$/;
function containsLocalTruth(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsLocalTruth);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) => LOCAL_TRUTH_KEYS.test(key) || containsLocalTruth(nested));
}

export function isExercisePlan(value: unknown): value is ExercisePlan {
  if (!isRecord(value) || value.planVersion !== ACTION_RUNTIME_PLAN_VERSION
    || !hasString(value, "exerciseId") || typeof value.revision !== "number"
    || !["learn", "guided-practice", "assessment"].includes(String(value.mode))
    || !hasString(value, "currentActionId") || !hasStringArray(value, "completedActionIds")
    || !isWorldProjection(value.world) || !isRecord(value.metadata) || !isRecord(value.coach)
    || (value.runtimeCapabilities !== undefined && (!isRecord(value.runtimeCapabilities)
      || !["local-training", "server-authoritative"].includes(String(value.runtimeCapabilities.practiceValidation))
      || !["legacy-evaluation", "async-records", "local-only"].includes(String(value.runtimeCapabilities.trainingSync))
      || !["url", "stream", "off"].includes(String(value.runtimeCapabilities.narrationTransport))
      || !["request-response", "stream"].includes(String(value.runtimeCapabilities.coachTurnTransport))
      || typeof value.runtimeCapabilities.liveCoach !== "boolean"))
    || (value.solutionBoardContexts !== undefined && (!Array.isArray(value.solutionBoardContexts)
      || !value.solutionBoardContexts.every(isActionSolutionBoardContext)))) return false;
  if (!Array.isArray(value.actions) || !value.actions.length) return false;
  const ids = new Set<string>();
  return value.actions.every((action) => {
    if (!isRecord(action) || !hasString(action, "actionId") || ids.has(action.actionId as string)) return false;
    ids.add(action.actionId as string);
    return hasString(action, "sourceStepId") && hasString(action, "kind") && Number.isInteger(action.version) && Number(action.version) > 0
      && hasString(action, "title") && hasString(action, "instruction") && isRecord(action.input)
      && hasStringArray(action, "capabilities") && Array.isArray(action.answerSlots) && action.answerSlots.every(isAnswerSlot)
      && ["local-demonstration", "local-training", "server-authoritative"].includes(String(action.validationPolicy))
      && typeof action.submitOnComplete === "boolean";
  }) && ids.has(value.currentActionId as string)
    && (value.mode === "assessment"
      ? value.actions.every((action) => isRecord(action) && action.validationPolicy === "server-authoritative"
        && action.localTruth === undefined && !containsLocalTruth(action.input))
      : value.actions.every((action) => isRecord(action) && isRecord(action.localTruth)
        && action.validationPolicy === (value.mode === "learn" ? "local-demonstration"
          : isRecord(value.runtimeCapabilities) && value.runtimeCapabilities.practiceValidation === "server-authoritative"
            ? "server-authoritative" : "local-training")))
    && (value.solutionBoardContexts === undefined
      || (value.mode !== "assessment"
        && value.solutionBoardContexts.every((context) => ids.has(context.actionId))));
}

export function assertExercisePlan(value: unknown): asserts value is ExercisePlan {
  if (!isRecord(value) || value.planVersion !== ACTION_RUNTIME_PLAN_VERSION) {
    throw new Error("Unsupported Action Runtime plan version");
  }
  if (!isExercisePlan(value)) throw new Error("Invalid ExercisePlan schema");
}
