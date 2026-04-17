import type {
  AngleEquationScenario,
  AngleEquationStepKey,
  UnknownType,
} from "../../../../../../shared/angleEquation";
import type { RuntimeEvaluation, SessionPhase } from "../../../../../../shared/contracts";
import type { RuntimeEngineState } from "../../platform/engineTypes";

// ─── Engine state ────────────────────────────────────────────────────

export type AngleEquationEngineState = RuntimeEngineState & {
  taskId: "trigEquationRange";
  unknownType: UnknownType;
  scenarioId: string;
  stepState: Record<AngleEquationStepKey, { done: boolean; value: string }>;
  answerKey: AngleEquationScenario["answerKey"];
  scenarioParams: {
    trigFn: string;
    omega: number;
    phi: string;
    value: string;
    unknownRange: [string, string];
  };
};

// ─── Submit result ───────────────────────────────────────────────────

export type AngleEquationSubmitResult = {
  evaluation: RuntimeEvaluation;
  phase: SessionPhase;
};

// ─── Draft payload ───────────────────────────────────────────────────

export type RuntimeDraftPayload = {
  selections?: Record<string, string[]>;
  inputs?: Record<string, string>;
};

// ─── Step evaluation ─────────────────────────────────────────────────

export type StepErrorCategory =
  | "incomplete-angles"
  | "wrong-range"
  | "missed-extra-angles"
  | "wrong-solutions";

export type StepEvaluationResult = {
  correct: boolean;
  errorCategory?: StepErrorCategory;
};
