import type {
  ActionContract,
  ActionEvidence,
  CoachDirective,
  ExercisePlan,
  StudentTrace,
  AgentCommand,
} from "../../../shared/actionRuntime";
import type { TopicGeometryModel } from "../../../shared/topicPractice";
import type { DomainCommand, WorkspaceWorld } from "../../../shared/actionWorld";
import type { ActionRuntimeEvent } from "./events";
import type { AttemptRecorderSnapshot } from "./training/attemptRecorder";
import type { TrainingFeedbackView } from "../presentation/training/TrainingFeedbackController";

export interface RuntimeEntityView {
  id: string;
  kind: "point" | "line" | "angle";
  enabled: boolean;
  /** Can receive pointer/keyboard input even when it is not an advancing candidate. */
  hitTestable: boolean;
  /** Semantically plausible candidate; wrong candidates must still reach the local guard. */
  candidate: boolean;
  /** Current state allows this candidate to advance when correct. */
  advanceEnabled: boolean;
  visualState: "idle" | "available" | "selected" | "wrong" | "correct";
  feedback?: string;
}

export interface CanvasSlice {
  geometry?: TopicGeometryModel;
  diagramAsset?: string;
  entities: Record<string, RuntimeEntityView>;
  selectedObjectIds: string[];
  cursor: "default" | "pointer" | "crosshair";
  preview?:
    | { type: "parallel"; throughPointId?: string; referenceLineId?: string }
    | { type: "intersection"; parallelLineId: string; carrierPointIds: string[] };
}

export interface AnswerSlotView {
  id: string;
  label: string;
  kind: "object" | "text" | "number" | "equation";
  value: string;
  required: boolean;
  active: boolean;
  status: "empty" | "filled" | "wrong" | "correct";
  hitTestable?: boolean;
  candidate?: boolean;
  advanceEnabled?: boolean;
  placeholder?: string;
  options?: import("../../../shared/topicPractice").TopicChoiceOption[];
}

export interface AnswerSlice {
  slots: AnswerSlotView[];
  activeSlotId?: string;
}

export interface BoardExpressionView {
  expressionId: string;
  sourceStepId: string;
  latex: string;
  isCurrent: boolean;
  isComplete: boolean;
}

export interface SolutionBoardView {
  headingLatex: string;
  visibleExpressions: BoardExpressionView[];
  currentExpressionId?: string;
  announcement?: string;
}

export interface CoachSlice {
  profileName: string;
  avatarId: string;
  /** Reviewed copy owned by the current Action. Coach replies never replace it. */
  actionPromptLatex: string;
  messageLatex: string;
  tone: "prompt" | "correct" | "wrong" | "explain";
  highlightObjectIds: string[];
  focusTargetId?: string;
  suggestedActionId?: string;
  agentCommand?: AgentCommand;
}

export interface ControlSlice {
  canBack: boolean;
  canClear: boolean;
  canCancel: boolean;
  canHelp: boolean;
  canSubmit: boolean;
  isSubmitting: boolean;
  submitReason?: string;
}

/**
 * A short-lived, UI-only highlight of elements that just changed. It is NOT
 * part of the domain world, evaluation, checkpoint, or any persistent state:
 * it exists only to drive a one-shot renderer animation. The `key` changes each
 * time a new completion produces fresh targets so a renderer can play the
 * animation again; the same key on a re-render must not replay.
 */
export type EmphasisTarget =
  | { surface: "canvas"; kind: "entity"; id: string }
  | { surface: "canvas"; kind: "teaching-mark"; id: string }
  | { surface: "solution-board"; kind: "expression"; id: string }
  | { surface: "answer"; kind: "slot"; id: string };

export interface TransientEmphasis {
  key: string;
  targets: EmphasisTarget[];
}

export interface WorkspaceView {
  actionId: string;
  actionKind: ActionContract["kind"];
  title: string;
  instruction: string;
  progress: { current: number; total: number };
  canvas: CanvasSlice;
  answer: AnswerSlice;
  solutionBoard?: SolutionBoardView;
  coach: CoachSlice;
  controls: ControlSlice;
  /** Frontend-only, never persisted. Absent means no pending highlight. */
  transientEmphasis?: TransientEmphasis;
  /**
   * ADR-006 §Voice and Coach Integration — instant wrong-candidate feedback
   * projected by `TrainingFeedbackController` from a guard decision. Frontend-
   * only view value (never persisted, never in XState context). Absent/inactive
   * means there is no wrong feedback to show this render cycle.
   */
  feedback?: TrainingFeedbackView;
}

export interface ActionSnapshotView {
  state: string;
  selectedObjectIds: string[];
  selectedByKind: {
    points: string[];
    lines: string[];
    angles: string[];
  };
  answers: Record<string, string>;
  activeSlotId?: string;
  wrongObjectId?: string;
  wrongMessage?: string;
  ready: boolean;
  done: boolean;
  evidence?: ActionEvidence;
  commands: DomainCommand[];
  diagramPreviewCommands: DomainCommand[];
  enabledByKind: { points: string[]; lines: string[]; angles: string[] };
  /**
   * ADR-006 3-layer affordance — the set of object ids that are on a CORRECT
   * advancing path right now (the local truth). Produced by each action machine
   * from its local truth. When absent, the projector falls back to `enabledByKind`
   * (i.e. every plausible candidate also advances, which is the server-authoritative
   * behavior where truth is not local). `enabledByKind` stays the broadest
   * "interactable in this state" set so the renderer/hit-test and the
   * `ignored-illegal` guard classification keep working unchanged.
   */
  advanceObjectIds?: string[];
  projectedAnswerSlots: AnswerSlotView[];
  preview?: CanvasSlice["preview"];
}

export interface ActionActor {
  readonly contract: ActionContract;
  send(event: ActionRuntimeEvent): void;
  getSnapshot(): ActionSnapshotView;
  subscribe(listener: () => void): () => void;
  demonstrate(): boolean;
  stop(): void;
}

export interface PageRuntimeSnapshot {
  plan: ExercisePlan;
  currentActionId: string;
  completedActionIds: string[];
  evidence: ActionEvidence[];
  revision: number;
  status: "active" | "submitting" | "transport-error" | "wrong" | "complete" | "conflict";
  coachDirective?: CoachDirective;
  wrongObjectIds: string[];
  wrongMessage?: string;
  transportMessage?: string;
  world: WorkspaceWorld;
}

export interface ActionPageRuntime {
  send(event: ActionRuntimeEvent): void;
  getView(): WorkspaceView;
  getSnapshot(): PageRuntimeSnapshot;
  getTrace(studentMessage?: string): StudentTrace;
  getTrainingSnapshot(): AttemptRecorderSnapshot;
  recordAssistance(kind: "hint" | "coach"): void;
  consumeTransientEmphasis(key: string): void;
  subscribe(listener: () => void): () => void;
  applyCoach(directive: CoachDirective): void;
  /** Apply the reviewed teaching targets and advance exactly one Learn beat. */
  advanceTeaching(): boolean;
  /** Rebuild Learn presentation state at the start of a specific Action. */
  seekTeaching(actionId: string): boolean;
  /** Learn allows direct execution; Guided requires explicit confirmation; Assessment rejects it. */
  applyAgentCommand(command: AgentCommand, confirmed?: boolean): boolean;
  markSubmitting(): void;
  markTransportFailure(message?: string): void;
  retrySubmission(): void;
  applyEvaluation(result: import("../../../shared/actionRuntime").ActionEvaluationResponse): void;
  resetFromPlan(plan: ExercisePlan): void;
  stop(): void;
}
