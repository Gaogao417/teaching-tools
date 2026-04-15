import type { ProblemStatus } from "../../../../../../shared/contracts";
import type {
  Angle,
  GuidedStepKey,
  Role,
  Side,
  TriangleTrigTaskId,
  TrigFunction,
} from "../../../../../../shared/triangleTrig";
import type { RuntimeEngineState } from "../../platform/engineTypes";

export type LengthValue = { n: number; s: number };

export type MeaningAnswerKey = {
  roles: [Role, Role];
};

export type RatioAnswerKey = {
  triple: Record<Side, LengthValue>;
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
