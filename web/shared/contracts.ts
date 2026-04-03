export type TaskId = "meaning" | "ratioToSide" | "guidedSolve";
export type ExerciseEngineKind = "triangle-trig";

export type SessionPhase =
  | "answering"
  | "correct_pause"
  | "wrong_feedback"
  | "group_finished";

export type ProblemStatus = "pending" | "correct" | "wrong";

export type TrigFunction = "sin" | "cos" | "tan" | "cot";
export type Angle = "A" | "C";
export type Role = "opposite" | "adjacent" | "hypotenuse";
export type Side = "AB" | "BC" | "AC";
export type GuidedStepKey = "mark" | "ratio" | "third" | "final";
export type FeedbackEffectKey = "correct" | "wrong" | "finish";
export type GuideStepStatus = "done" | "active" | "pending";
export type RuntimeStepStatus = "locked" | "active" | "done";
export type RuntimeEvaluation = "correct" | "wrong" | "progress";
export type RuntimeActionType = "select" | "input" | "assign" | "compose" | "clear" | "submit";
export type SceneKind = "triangle" | "number-line" | "coordinate-plane" | "custom";
export type SceneEntityKind = "triangle" | "edge" | "vertex" | "formula" | "text";
export type InteractionZoneKind = "edge" | "vertex" | "region" | "slot" | "input";
export type SceneAnchorKind = "value-input" | "label" | "formula-slot" | "badge";
export type SceneOverlayKind = "highlight" | "mask" | "guide-line" | "badge";
export type FeedbackScope = "global" | "workspace" | "guide";

// Legacy: v0 workspace schema used by the current PracticePage implementation.

export interface XYPoint {
  x: number;
  y: number;
}

export interface SideHitZoneLine {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeWidth: number;
}

export interface SideHitZonePolygon {
  kind: "polygon";
  points: XYPoint[];
}

export type SideHitZone = SideHitZoneLine | SideHitZonePolygon;

export interface TriangleWorkspaceSideSchema {
  side: Side;
  role: Role;
  label: XYPoint;
  input: XYPoint;
  hitZone: SideHitZone;
}

export interface TriangleWorkspaceSchema {
  stage: {
    width: number;
    height: number;
  };
  vertices: Record<"A" | "B" | "C", XYPoint>;
  rightAnglePath: string;
  referenceAnglePath: string;
  sides: TriangleWorkspaceSideSchema[];
}

export interface GuideStepSchema {
  id: string;
  title: string;
  body: string;
  status: GuideStepStatus;
}

export interface ProblemRenderSchema {
  workspace: TriangleWorkspaceSchema;
  guide: {
    title: string;
    body: string;
    steps: GuideStepSchema[];
  };
  feedback: {
    correct: FeedbackEffectKey;
    wrong: FeedbackEffectKey;
    finish: FeedbackEffectKey;
  };
}

export interface SceneEntityBase {
  id: string;
  kind: SceneEntityKind;
}

export interface TriangleSceneEntity extends SceneEntityBase {
  kind: "triangle";
  vertices: Record<string, XYPoint>;
}

export interface EdgeSceneEntity extends SceneEntityBase {
  kind: "edge";
  from: string;
  to: string;
  label?: string;
  role?: string;
}

export interface VertexSceneEntity extends SceneEntityBase {
  kind: "vertex";
  x: number;
  y: number;
  label?: string;
}

export interface FormulaSceneEntity extends SceneEntityBase {
  kind: "formula";
  label: string;
  slots?: string[];
}

export interface TextSceneEntity extends SceneEntityBase {
  kind: "text";
  text: string;
}

export type SceneEntity =
  | TriangleSceneEntity
  | EdgeSceneEntity
  | VertexSceneEntity
  | FormulaSceneEntity
  | TextSceneEntity;

export interface LineCorridorZoneShape {
  type: "lineCorridor";
  from: string;
  to: string;
  width: number;
}

export interface PolygonZoneShape {
  type: "polygon";
  points: XYPoint[];
}

export interface AnchorZoneShape {
  type: "anchor";
  x: number;
  y: number;
  radius?: number;
}

export type ZoneShape = LineCorridorZoneShape | PolygonZoneShape | AnchorZoneShape;

export interface InteractionZone {
  id: string;
  zoneKind: InteractionZoneKind;
  targetRef: string;
  shape: ZoneShape;
  accepts?: RuntimeActionType[];
}

export interface SceneAnchor {
  id: string;
  anchorKind: SceneAnchorKind;
  entityRef?: string;
  x: number;
  y: number;
}

export interface SceneOverlay {
  id: string;
  overlayKind: SceneOverlayKind;
  targetRef?: string;
}

export interface SceneSpec {
  sceneKind: SceneKind;
  entities: SceneEntity[];
  zones: InteractionZone[];
  anchors: SceneAnchor[];
  overlays?: SceneOverlay[];
}

export interface SelectActionSpec {
  type: "select";
  target: string;
  selectionKind: "single" | "ordered";
}

export interface InputActionSpec {
  type: "input";
  target: string;
  valueKind: "text" | "integer" | "length" | "ratio-part";
}

export interface AssignActionSpec {
  type: "assign";
  source: string;
  target: string;
}

export interface ComposeActionSpec {
  type: "compose";
  target: string;
  slots: string[];
}

export interface ClearActionSpec {
  type: "clear";
  target?: string;
}

export interface SubmitActionSpec {
  type: "submit";
  stepId: string;
}

export type ActionSpec =
  | SelectActionSpec
  | InputActionSpec
  | AssignActionSpec
  | ComposeActionSpec
  | ClearActionSpec
  | SubmitActionSpec;

export interface FlowStep {
  id: string;
  title: string;
  goal: string;
  status: RuntimeStepStatus;
  allowedActions: ActionSpec[];
  submitMode: "immediate" | "explicit";
}

export interface FlowSpec {
  steps: FlowStep[];
  currentStepId: string;
  completionPolicy: "single-step" | "multi-step" | "whole-problem";
}

export interface GuideStepItem {
  stepId: string;
  title: string;
  status: RuntimeStepStatus;
  summary?: string;
}

export interface GuideSpec {
  banner: string;
  stepItems: GuideStepItem[];
  hint?: string;
  statusCopy?: string;
}

export interface FeedbackCue {
  key: string;
  scope: FeedbackScope;
  targetRef?: string;
}

export interface FeedbackSpec {
  correct: FeedbackCue[];
  wrong: FeedbackCue[];
  finish: FeedbackCue[];
}

export interface ServerRuntimeState {
  phase: SessionPhase;
  currentStepId: string;
  completedStepIds: string[];
  problemStatus: ProblemStatus;
  attempts: number;
}

export interface ClientDraftState {
  selections: Record<string, string[]>;
  inputs: Record<string, string>;
  focusTarget?: string;
  transientFeedback?: string[];
}

export interface ExerciseInstance {
  instanceId: string;
  taskId: string;
  engineKind: ExerciseEngineKind;
  prompt: string;
  scene: SceneSpec;
  flow: FlowSpec;
  guide: GuideSpec;
  feedback: FeedbackSpec;
}

export interface ExerciseRuntimeSpec {
  instance: ExerciseInstance;
  runtimeState: ServerRuntimeState;
}

export interface ClientRuntimeSnapshot {
  spec: ExerciseRuntimeSpec;
  draft: ClientDraftState;
}

export interface RuntimeActionEvent {
  type: RuntimeActionType;
  targetId?: string;
  value?: string;
  sourceId?: string;
  stepId?: string;
}

export interface RuntimeFeedbackPacket {
  global: FeedbackCue[];
  workspace: FeedbackCue[];
  guide: FeedbackCue[];
}

export interface TaskTreeResponse {
  grades: GradeNode[];
}

export interface GradeNode {
  id: string;
  name: string;
  chapters: ChapterNode[];
}

export interface ChapterNode {
  id: string;
  name: string;
  tasks: TaskNode[];
}

export interface TaskNode {
  id: TaskId;
  title: string;
  summary: string;
  difficulty: "easy" | "medium" | "hard";
  engineKind: ExerciseEngineKind;
  sample: {
    prompt: string;
    answerPreview?: string;
  };
  steps: string[];
  color?: string;
}

export interface TaskHistoryItem {
  studentName: string;
  elapsedMs: number;
  clearedAt: string;
  problemCount: number;
  firstTryAccuracy: number;
}

export interface TaskHistoryResponse {
  taskId: TaskId;
  studentName: string;
  items: TaskHistoryItem[];
}

export interface BaseProblem {
  id: string;
  taskId: TaskId;
  type: TaskId;
  index: number;
  status: ProblemStatus;
  attempts: number;
  firstTryCorrect: boolean | null;
  runtime?: ExerciseRuntimeSpec;
}

export interface MeaningProblem extends BaseProblem {
  type: "meaning";
  prompt: string;
  target: TrigFunction;
  referenceAngle: Angle;
  renderSchema: ProblemRenderSchema;
  ui: {
    numeratorLabel: string;
    denominatorLabel: string;
    selectableRoles: Role[];
  };
}

export interface RatioToSideProblem extends BaseProblem {
  type: "ratioToSide";
  prompt: string;
  target: TrigFunction;
  referenceAngle: Angle;
  renderSchema: ProblemRenderSchema;
  ratio: {
    numerator: string;
    denominator: string;
  };
  ui: {
    edges: Side[];
  };
}

export interface GuidedSolveProblem extends BaseProblem {
  type: "guidedSolve";
  prompt: string;
  target: TrigFunction;
  referenceAngle: Angle;
  renderSchema: ProblemRenderSchema;
  knownType: TrigFunction;
  given: Array<{
    edge: Side;
    value: string;
    role: Role;
  }>;
  stepKeys: GuidedStepKey[];
  stepState: Record<
    GuidedStepKey,
    {
      done: boolean;
      value: string;
    }
  >;
}

export type Problem = MeaningProblem | RatioToSideProblem | GuidedSolveProblem;

export interface MeaningAnswerPayload {
  type: "meaning";
  numeratorRole: Role;
  denominatorRole: Role;
}

export interface RatioToSideAnswerPayload {
  type: "ratioToSide";
  placements: Partial<Record<Side, string>>;
}

export interface GuidedSolveAnswerPayload {
  type: "guidedSolve";
  stepKey: GuidedStepKey;
  value: Record<string, string>;
}

export type AnswerPayload =
  | MeaningAnswerPayload
  | RatioToSideAnswerPayload
  | GuidedSolveAnswerPayload;

export interface StartPracticeRequest {
  taskId: TaskId;
  studentName: string;
}

export interface StartPracticeResponse {
  sessionId: string;
  taskId: TaskId;
  studentName: string;
  problems: Problem[];
  startedAt: string;
  runtime?: ExerciseRuntimeSpec;
}

export interface AnswerRequest {
  sessionId: string;
  problemId: string;
  payload: AnswerPayload;
}

export interface RuntimeActionRequest {
  sessionId: string;
  instanceId: string;
  action: RuntimeActionEvent;
}

export interface AnswerResponse {
  correct: boolean;
  allSolved: boolean;
  hint?: string;
  problemState: Problem;
  nextIndex: number;
  phase: SessionPhase;
  runtime?: ExerciseRuntimeSpec;
  feedback?: RuntimeFeedbackPacket;
}

export interface RuntimeActionResponse {
  accepted: boolean;
  evaluation: RuntimeEvaluation;
  runtimeState: ServerRuntimeState;
  instancePatch?: Partial<ExerciseInstance>;
  runtime?: ExerciseRuntimeSpec;
  feedback?: RuntimeFeedbackPacket;
  nextIndex: number;
  phase: SessionPhase;
}

export interface RestorePracticeResponse {
  sessionId: string;
  taskId: TaskId;
  studentName: string;
  currentIndex: number;
  problems: Problem[];
  elapsedMs: number;
  phase: SessionPhase;
  runtime?: ExerciseRuntimeSpec;
}

export interface ResultSnapshot {
  sessionId: string;
  taskId: TaskId;
  studentName: string;
  startedAt: string;
  clearedAt: string;
  title: string;
  groupLabel: string;
  elapsedMs: number;
  bestMs: number | null;
  avgMs: number | null;
  copy: string;
  problemCount: number;
  firstTryAccuracy: number;
  firstTryCorrectCount: number;
  color: string;
  deltaVsPreviousMs: number | null;
  history: Array<{
    elapsedMs: number;
    clearedAt: string;
  }>;
}

export interface FinishPracticeRequest {
  sessionId: string;
}

export interface FinishPracticeResponse {
  sessionId: string;
  resultSnapshot: ResultSnapshot;
  alreadyFinished?: boolean;
}

export interface ApiErrorResponse {
  error: {
    code:
      | "BAD_REQUEST"
      | "INVALID_STUDENT_NAME"
      | "TASK_NOT_FOUND"
      | "SESSION_NOT_FOUND"
      | "SESSION_FINISHED"
      | "PROBLEM_NOT_FOUND"
      | "ANSWER_INVALID"
      | "ACTION_NOT_ALLOWED"
      | "INSTANCE_NOT_ACTIVE"
      | "RUNTIME_CONTRACT_INVALID"
      | "INTERNAL_ERROR";
    message: string;
  };
}
