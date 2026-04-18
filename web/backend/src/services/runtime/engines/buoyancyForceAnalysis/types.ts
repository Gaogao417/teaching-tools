import type { BuoyancyStepKey, BuoyancyVariableKey } from "../../../../../../shared/buoyancyForceAnalysis";
import type { RuntimeEngineState } from "../../platform/engineTypes";

export type BuoyancyErrorCategory =
  | "wrong-equation"
  | "sign-reversal"
  | "computation"
  | "unknown";

export type BuoyancyEngineState = RuntimeEngineState & {
  taskId: "buoyancyForceAnalysis";
  scenarioId: string;
  knownKeys: [BuoyancyVariableKey, BuoyancyVariableKey, BuoyancyVariableKey];
  unknownKeys: [BuoyancyVariableKey, BuoyancyVariableKey];
  params: {
    Gobj: number;
    Fb: number;
    Gwater: number;
  };
  values: Record<BuoyancyVariableKey, number>;
  useMassObj: boolean;
  useMassWater: boolean;
  stepState: Record<BuoyancyStepKey, { done: boolean; value: string }>;
  answerKey: {
    unknown1: { key: BuoyancyVariableKey; value: number };
    unknown2: { key: BuoyancyVariableKey; value: number };
  };
  lastErrorCategory?: BuoyancyErrorCategory;
};

export type StepEvaluationResult = {
  correct: boolean;
  errorCategory?: BuoyancyErrorCategory;
};

export type RuntimeDraftPayload = {
  inputs?: Record<string, string>;
};
