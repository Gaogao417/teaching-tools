import type {
  ContentDefinition,
  ExerciseRuntimeSpec,
  ProblemStatus,
  RuntimeActionEvent,
  RuntimeEvaluation,
  RuntimeFeedbackPacket,
  SessionPhase,
  TaskDefinition,
  TaskId,
} from "../../../../shared/contracts";

export type RuntimeEngineState = {
  instanceId: string;
  taskId: TaskId;
  contentId: string;
  index: number;
  status: ProblemStatus;
  attempts: number;
  firstTryCorrect: boolean | null;
};

export type EngineActionResult<TState extends RuntimeEngineState = RuntimeEngineState> = {
  accepted: boolean;
  evaluation: RuntimeEvaluation;
  phase: SessionPhase;
  engineState: TState;
  runtime: ExerciseRuntimeSpec;
  feedback: RuntimeFeedbackPacket;
};

export type EnginePlugin<
  TContent extends ContentDefinition = ContentDefinition,
  TState extends RuntimeEngineState = RuntimeEngineState,
> = {
  createState: (task: TaskDefinition, content: TContent, index: number) => TState;
  restoreState: (raw: unknown) => TState;
  adaptAction?: (state: TState, action: RuntimeActionEvent) => RuntimeActionEvent;
  buildRuntime: (task: TaskDefinition, content: TContent, state: TState, phase: SessionPhase) => ExerciseRuntimeSpec;
  reduceAction: (
    task: TaskDefinition,
    content: TContent,
    state: TState,
    action: RuntimeActionEvent,
  ) => EngineActionResult<TState>;
};

export type RegisteredEnginePlugin = EnginePlugin<ContentDefinition, RuntimeEngineState>;

export function defineEnginePlugin<
  TContent extends ContentDefinition,
  TState extends RuntimeEngineState,
>(plugin: EnginePlugin<TContent, TState>): RegisteredEnginePlugin {
  return plugin as unknown as RegisteredEnginePlugin;
}
