import type {
  FlowSpec,
  ProblemStatus,
  RuntimeEvaluation,
  SceneAnchor,
  SceneEntity,
  SessionPhase,
  TaskDefinition,
  TriangleTrigContentDefinition,
} from "../../../../../../shared/contracts";
import type {
  Angle,
  GuidedStepKey,
  Role,
  Side,
  TriangleTrigLengthValue,
  TriangleTrigScenarioRecord,
  TriangleTrigTaskId,
  TrigFunction,
} from "../../../../../../shared/triangleTrig";
import type { RuntimeEngineState } from "../../platform/engineTypes";

/** @deprecated kept for backward compatibility with older state snapshots. */
export type LengthValue = TriangleTrigLengthValue;

export type MeaningAnswerKey = {
  roles: [Role, Role];
};

export type RatioAnswerKey = {
  triple: Record<Side, TriangleTrigLengthValue>;
};

export type GuidedAnswerKey = {
  zRoles: Partial<Record<Role, string>>;
  thirdRole: Role;
  thirdZ: string;
  finalNumerator: string;
  finalDenominator: string;
};

export type TriangleTrigBaseState = RuntimeEngineState & {
  instanceId: string;
  taskId: TriangleTrigTaskId;
  contentId: string;
  index: number;
  status: ProblemStatus;
  attempts: number;
  firstTryCorrect: boolean | null;
  target: TrigFunction;
  referenceAngle: Angle;
  /** Stable identifier of the bundle scenario backing this instance. */
  scenarioId?: string;
  scenarioVersion?: string;
  /** Backend-only immutable bundle snapshot; never included in ExerciseRuntimeSpec. */
  pinnedScenario?: TriangleTrigScenarioRecord;
};

export type MeaningEngineState = TriangleTrigBaseState & {
  taskId: "meaning";
  answerKey: MeaningAnswerKey;
};

export type RatioEngineState = TriangleTrigBaseState & {
  taskId: "ratioToSide";
  ratio: {
    numerator: string;
    denominator: string;
  };
  answerKey: RatioAnswerKey;
};

export type GuidedEngineState = TriangleTrigBaseState & {
  taskId: "guidedSolve";
  knownType: TrigFunction;
  given: Array<{
    edge: Side;
    value: string;
    role: Role;
  }>;
  stepState: Record<
    GuidedStepKey,
    {
      done: boolean;
      value: string;
    }
  >;
  answerKey: GuidedAnswerKey;
};

export type TriangleTrigEngineState =
  | MeaningEngineState
  | RatioEngineState
  | GuidedEngineState;

export type RuntimeDraftPayload = {
  selections?: Record<string, string[]>;
  inputs?: Record<string, string>;
};

export type TriangleTrigSeed = {
  instanceId: string;
  target: TrigFunction;
  referenceAngle: Angle;
};

export type TriangleTrigProjectionModel = {
  currentStepId: string;
  completedStepIds: string[];
  promptVars: Record<string, string>;
  taskEntities: SceneEntity[];
  anchors: SceneAnchor[];
  flow: FlowSpec;
  defaultHint: string;
  wrongHint: string;
  completedSummary: (stepId: string) => string;
};

export type TriangleTrigSubmitResult = {
  evaluation: RuntimeEvaluation;
  phase: SessionPhase;
};

export type TriangleTrigTaskStrategy<TState extends TriangleTrigEngineState = TriangleTrigEngineState> = {
  createState: (
    task: TaskDefinition,
    content: TriangleTrigContentDefinition,
    index: number,
    seed: TriangleTrigSeed,
  ) => TState;
  reduceSubmit: (
    state: TState,
    payload: RuntimeDraftPayload,
    stepId: string,
  ) => TriangleTrigSubmitResult;
  buildProjectionModel: (
    content: TriangleTrigContentDefinition,
    state: TState,
  ) => TriangleTrigProjectionModel;
};
