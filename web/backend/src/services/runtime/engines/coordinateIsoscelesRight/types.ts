import type {
  CoordIsoscelesScenario,
  CoordIsoscelesStepKey,
} from "../../../../../../shared/coordinateIsoscelesRight";
import type { CoordPoint } from "../../../../../../shared/coordinateIsoscelesRight";
import type { RuntimeEvaluation, SessionPhase } from "../../../../../../shared/contracts";
import type { RuntimeEngineState } from "../../platform/engineTypes";

// ─── Engine state ──────────────────────────────────────────────────────

export type CoordIsoscelesEngineState = RuntimeEngineState & {
  taskId: "isoscelesRightCoord";
  scenarioId: string;
  stepState: Record<CoordIsoscelesStepKey, { done: boolean; value: string }>;
  answerKey: CoordIsoscelesScenario["answerKey"];
  scenarioParams: {
    B: CoordPoint;
    C: CoordPoint;
  };
};

// ─── Submit result ─────────────────────────────────────────────────────

export type CoordIsoscelesSubmitResult = {
  evaluation: RuntimeEvaluation;
  phase: SessionPhase;
};

// ─── Draft payload ─────────────────────────────────────────────────────

export type RuntimeDraftPayload = {
  selections?: Record<string, string[]>;
  inputs?: Record<string, string>;
};

// ─── Step evaluation ───────────────────────────────────────────────────

export type StepErrorCategory =
  | "wrong-construction"
  | "wrong-congruence"
  | "wrong-equations"
  | "wrong-coordinates";

export type StepEvaluationResult = {
  correct: boolean;
  errorCategory?: StepErrorCategory;
};
