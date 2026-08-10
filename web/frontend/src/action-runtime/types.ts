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

export interface RuntimeEntityView {
  id: string;
  kind: "point" | "line" | "angle";
  enabled: boolean;
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
  placeholder?: string;
  options?: import("../../../shared/topicPractice").TopicChoiceOption[];
}

export type StepRecordTokenView =
  | { kind: "text"; text: string }
  | { kind: "slot"; slotId: string; label: string; value?: string };

export type ExerciseStepStatus = "pending" | "active" | "complete";

export interface ExerciseStepView {
  sourceStepId: string;
  title: string;
  instruction: string;
  actionIds: string[];
  status: ExerciseStepStatus;
  record?: StepRecordTokenView[];
  summary?: string;
}

export interface AnswerSlice {
  slots: AnswerSlotView[];
  activeSlotId?: string;
  steps: ExerciseStepView[];
}

export interface CoachSlice {
  profileName: string;
  avatarId: string;
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

export interface WorkspaceView {
  actionId: string;
  actionKind: ActionContract["kind"];
  title: string;
  instruction: string;
  progress: { current: number; total: number };
  canvas: CanvasSlice;
  answer: AnswerSlice;
  coach: CoachSlice;
  controls: ControlSlice;
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
  enabledByKind: { points: string[]; lines: string[]; angles: string[] };
  projectedAnswerSlots: AnswerSlotView[];
  preview?: CanvasSlice["preview"];
}

export interface ActionActor {
  readonly contract: ActionContract;
  send(event: ActionRuntimeEvent): void;
  getSnapshot(): ActionSnapshotView;
  subscribe(listener: () => void): () => void;
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
  subscribe(listener: () => void): () => void;
  applyCoach(directive: CoachDirective): void;
  /** Learn allows direct execution; Guided requires explicit confirmation; Assessment rejects it. */
  applyAgentCommand(command: AgentCommand, confirmed?: boolean): boolean;
  markSubmitting(): void;
  markTransportFailure(message?: string): void;
  retrySubmission(): void;
  applyEvaluation(result: import("../../../shared/actionRuntime").ActionEvaluationResponse): void;
  resetFromPlan(plan: ExercisePlan): void;
  stop(): void;
}
