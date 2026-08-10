import type { AuthoringRun, ScenarioRecord, ScenarioValidationReport } from "./scenarios";

export type TriangleTrigTaskId = "meaning" | "ratioToSide" | "guidedSolve";
export type TrigFunction = "sin" | "cos" | "tan" | "cot";
export type Angle = "A" | "C";
export type Role = "opposite" | "adjacent" | "hypotenuse";
export type Side = "AB" | "BC" | "AC";
export type GuidedStepKey = "ratio" | "third" | "final";

// ─── Length value (shared between bundle JSON and runtime) ────────────
/** Rationalized surd length expressed as n·√s. s=1 represents an integer. */
export interface TriangleTrigLengthValue {
  n: number;
  s: number;
}

// ─── Per-task answer keys (backend-only truth, never projected) ───────
export interface TriangleTrigMeaningAnswerKey {
  roles: [Role, Role];
}

export interface TriangleTrigRatioAnswerKey {
  triple: Record<Side, TriangleTrigLengthValue>;
}

export interface TriangleTrigGuidedAnswerKey {
  zRoles: Partial<Record<Role, string>>;
  thirdRole: Role;
  thirdZ: string;
  finalNumerator: string;
  finalDenominator: string;
}

export type TriangleTrigAnswerKey =
  | { kind: "meaning"; roles: [Role, Role] }
  | { kind: "ratioToSide"; triple: Record<Side, TriangleTrigLengthValue> }
  | {
      kind: "guidedSolve";
      zRoles: Partial<Record<Role, string>>;
      thirdRole: Role;
      thirdZ: string;
      finalNumerator: string;
      finalDenominator: string;
    };

// ─── Scenario record (JSON bundle shape) ──────────────────────────────
/**
 * Scenario for the triangle-trig engine. `promptData` is the learner-facing
 * problem seed (reference angle + trig function + knowns); `answerKey` is the
 * backend-only truth. The runtime derives per-step accepted answers from
 * `answerKey` and never serializes it into `ExerciseRuntimeSpec`.
 */
export interface TriangleTrigScenarioRecord extends ScenarioRecord {
  taskId: TriangleTrigTaskId;
  engineKind: "triangle-trig";
  validation: ScenarioValidationReport;
  promptData: {
    target: TrigFunction;
    referenceAngle: Angle;
    /** guidedSolve only: the trig ratio the student is given as known. */
    knownType?: TrigFunction;
    /** guidedSolve only: the concrete given edges and values. */
    given?: Array<{ edge: Side; value: string; role: Role }>;
  };
  answerKey: TriangleTrigAnswerKey;
}

// ─── Resolved scenario (backend-only; answer key reattached) ──────────
export interface TriangleTrigResolvedScenario {
  id: string;
  taskId: TriangleTrigTaskId;
  contentId: string;
  version: string;
  target: TrigFunction;
  referenceAngle: Angle;
  knownType?: TrigFunction;
  given?: Array<{ edge: Side; value: string; role: Role }>;
  answerKey: TriangleTrigAnswerKey;
}

// ─── Bundle container ─────────────────────────────────────────────────
export interface TriangleTrigScenarioBundle {
  schema: "teaching-tools/triangle-trig-scenario-bundle/v1";
  version: string;
  generatedAt: string;
  authoringRun: AuthoringRun;
  scenarios: Record<TriangleTrigTaskId, TriangleTrigScenarioRecord[]>;
}

export type TriangleTrigScenarioValidationReport = ScenarioValidationReport;
