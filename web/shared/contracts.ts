import type { AngleEquationTaskId } from "./angleEquation";
import type { BuoyancyTaskId } from "./buoyancyForceAnalysis";
import type { CoordIsoscelesTaskId } from "./coordinateIsoscelesRight";
import type { TriangleTrigTaskId } from "./triangleTrig";
import type {
  TopicPracticeContentDefinition,
  TopicLessonRecord,
  TopicPracticeTaskId,
  TopicPracticeWorkspaceModel,
} from "./topicPractice";
import type { RemediationDiagnosis, RemediationResumeContext, SessionKind } from "./similarityLearningMap";

export type DemoCounterTaskId = "demoCounter";
export type TaskId = TriangleTrigTaskId | DemoCounterTaskId | AngleEquationTaskId | CoordIsoscelesTaskId | BuoyancyTaskId | TopicPracticeTaskId;
export type ExerciseEngineKind = "triangle-trig" | "demo-counter" | "angle-equation" | "coordinate-isosceles-right" | "buoyancy-force-analysis" | "topic-practice";

export type SessionPhase =
  | "answering"
  | "correct_pause"
  | "wrong_feedback"
  | "group_finished";

export type ProblemStatus = "pending" | "correct" | "wrong";
export type FeedbackEffectKey = "correct" | "wrong" | "finish";
export type RuntimeStepStatus = "locked" | "active" | "done";
export type RuntimeEvaluation = "correct" | "wrong" | "progress";
export type RuntimeActionType = "select" | "input" | "assign" | "compose" | "clear" | "submit";
export type SceneKind = "triangle" | "number-line" | "coordinate-plane" | "custom";
export type SceneEntityKind = "triangle" | "edge" | "vertex" | "formula" | "text";
export type InteractionZoneKind = "edge" | "vertex" | "region" | "slot" | "input";
export type SceneAnchorKind = "value-input" | "label" | "formula-slot" | "badge";
export type SceneOverlayKind = "highlight" | "mask" | "guide-line" | "badge";
export type FeedbackScope = "global" | "workspace" | "guide";
export type SceneTextVariant = "inline-formula" | "angle-badge" | "note";
export type FormulaSceneLayout = "fraction";

export interface XYPoint {
  x: number;
  y: number;
}

export interface CatalogMeta {
  gradeId: string;
  gradeName: string;
  chapterId: string;
  chapterName: string;
  color?: string;
}

export interface TaskDefinition {
  id: TaskId;
  title: string;
  summary: string;
  difficulty: "easy" | "medium" | "hard";
  engineKind: ExerciseEngineKind;
  contentId: string;
  sample: {
    prompt: string;
    answerPreview?: string;
  };
  steps: string[];
  catalogMeta: CatalogMeta;
}

export interface GuideTemplateStepDefinition {
  stepId: string;
  title: string;
  summary: string;
}

export interface TriangleTrigContentDefinition {
  id: string;
  engineKind: "triangle-trig";
  taskId: TriangleTrigTaskId;
  version: string;
  promptTemplate: string;
  sceneTemplate: {
    sceneKind: "triangle";
    stage: {
      width: number;
      height: number;
    };
  };
  flowTemplate: {
    completionPolicy: "single-step" | "multi-step" | "whole-problem";
    stepOrder: string[];
    guideSteps: GuideTemplateStepDefinition[];
  };
  guideTemplate: {
    banner: string;
    hint: string;
  };
  feedbackTemplate: {
    correct: FeedbackEffectKey[];
    wrong: FeedbackEffectKey[];
    finish: FeedbackEffectKey[];
  };
  initialVariables?: Record<string, string>;
}

export interface DemoCounterContentDefinition {
  id: string;
  engineKind: "demo-counter";
  taskId: DemoCounterTaskId;
  version: string;
  promptTemplate: string;
  expectedAnswer: string;
  guideTemplate: {
    banner: string;
    hint: string;
  };
  feedbackTemplate: {
    correct: FeedbackEffectKey[];
    wrong: FeedbackEffectKey[];
    finish: FeedbackEffectKey[];
  };
}

export type ContentDefinition =
  | TriangleTrigContentDefinition
  | DemoCounterContentDefinition
  | TopicPracticeContentDefinition
  | import("./angleEquation").AngleEquationContentDefinition
  | import("./coordinateIsoscelesRight").CoordIsoscelesContentDefinition
  | import("./buoyancyForceAnalysis").BuoyancyContentDefinition;

export interface SceneEntityBase {
  id: string;
  kind: SceneEntityKind;
}

export interface TriangleSceneEntity extends SceneEntityBase {
  kind: "triangle";
  vertices: Record<string, XYPoint>;
  rightAnglePath: string;
  referenceAnglePath: string;
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
  x?: number;
  y?: number;
  slots?: string[];
  layout?: FormulaSceneLayout;
}

export interface TextSceneEntity extends SceneEntityBase {
  kind: "text";
  text: string;
  x?: number;
  y?: number;
  variant?: SceneTextVariant;
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
  placeholder?: string;
  value?: string;
  label?: string;
}

export interface SceneOverlay {
  id: string;
  overlayKind: SceneOverlayKind;
  targetRef?: string;
  label?: string;
}

export interface SceneSpec {
  sceneKind: SceneKind;
  entities: SceneEntity[];
  zones: InteractionZone[];
  anchors: SceneAnchor[];
  overlays?: SceneOverlay[];
  topicWorkspace?: TopicPracticeWorkspaceModel;
}

export interface SelectActionSpec {
  type: "select";
  target: string;
  selectionKind: "single" | "ordered";
  presentation?: ActionPresentationSpec;
}

export interface InputActionSpec {
  type: "input";
  target: string;
  valueKind: "text" | "integer" | "length" | "ratio-part";
  presentation?: ActionPresentationSpec;
}

export interface AssignActionSpec {
  type: "assign";
  source: string;
  target: string;
  presentation?: ActionPresentationSpec;
}

export interface ComposeActionSpec {
  type: "compose";
  target: string;
  slots: string[];
  presentation?: ActionPresentationSpec;
}

export interface ClearActionSpec {
  type: "clear";
  target?: string;
  presentation?: ActionPresentationSpec;
}

export interface SubmitActionSpec {
  type: "submit";
  stepId: string;
  presentation?: ActionPresentationSpec;
}

export interface ActionPresentationSlot {
  id: string;
  label: string;
  placeholder: string;
}

export interface ActionPresentationSpec {
  label?: string;
  slots?: ActionPresentationSlot[];
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
  contentId: string;
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

export interface PracticeSessionSnapshot {
  sessionId: string;
  taskId: TaskId;
  studentName: string;
  currentIndex: number;
  instanceCount: number;
  elapsedMs: number;
  phase: SessionPhase;
  sessionKind: SessionKind;
  challengeId?: string;
  sourceSessionId?: string;
  resumeContext?: RemediationResumeContext;
  diagnosis?: RemediationDiagnosis;
  runtime?: ExerciseRuntimeSpec;
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
  sessionId: string;
  studentName: string;
  elapsedMs: number;
  clearedAt: string;
  problemCount: number;
  firstTryAccuracy: number;
}

export interface ResultAttemptReview {
  actionType: RuntimeActionType;
  stepId?: string;
  stepTitle?: string;
  targetId?: string;
  submittedValue?: string;
  evaluation: RuntimeEvaluation;
  createdAt: string;
}

export interface StructuredAnswer {
  selections?: Record<string, string[]>;
  inputs?: Record<string, string>;
  display?: string;
}

export interface ProblemReviewProjection {
  diagnosisCode?: string;
  diagnosisTitle?: string;
  coachingCopy?: string;
  actualAnswer?: StructuredAnswer;
  expectedAnswer?: StructuredAnswer;
  focusStepId?: string;
  scene?: SceneSpec;
}

export interface ResultProblemReview extends ProblemReviewProjection {
  instanceId: string;
  index: number;
  prompt: string;
  attempts: number;
  firstTryCorrect: boolean;
  attemptLog: ResultAttemptReview[];
}

export interface LearningProjectionStep {
  stepId: string;
  title: string;
  narration: string;
  focusTargetRef?: string;
  actionLabel?: string;
  nextLabel?: string;
}

export interface LearningProjectionSpec {
  taskId: TaskId;
  objective: string;
  sampleRuntime: ExerciseRuntimeSpec;
  steps: LearningProjectionStep[];
  topicLesson?: TopicLessonRecord;
}

export interface TaskHistoryResponse {
  taskId: TaskId;
  studentName: string;
  items: TaskHistoryItem[];
}

export interface StartPracticeRequest {
  taskId: TaskId;
  studentName: string;
}

export interface StartPracticeResponse extends PracticeSessionSnapshot {}

export interface RestorePracticeResponse extends PracticeSessionSnapshot {}

export interface RuntimeActionRequest {
  sessionId: string;
  instanceId: string;
  action: RuntimeActionEvent;
}

export interface RuntimeActionResponse {
  accepted: boolean;
  evaluation: RuntimeEvaluation;
  runtimeState: ServerRuntimeState;
  runtime?: ExerciseRuntimeSpec;
  feedback?: RuntimeFeedbackPacket;
  nextIndex: number;
  phase: SessionPhase;
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
  problemReviews: ResultProblemReview[];
  sessionKind?: SessionKind;
  challengeId?: string;
  sourceSessionId?: string;
  linkedSessionIds?: string[];
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
      | "LEGACY_SESSION_EXPIRED"
      | "INTERNAL_ERROR";
    message: string;
  };
}
