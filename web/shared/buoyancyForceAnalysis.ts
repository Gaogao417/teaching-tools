import type { FeedbackEffectKey, GuideTemplateStepDefinition } from "./contracts";

// ─── Task & Step IDs ──────────────────────────────────────────────

export type BuoyancyTaskId = "buoyancyForceAnalysis";
export type BuoyancyStepKey = "solve-unknown-1" | "solve-unknown-2";

// ─── Variable keys ────────────────────────────────────────────────

export type BuoyancyVariableKey = "F" | "Fb" | "Gobj" | "Gwater" | "Ftable";

// ─── Scenario ─────────────────────────────────────────────────────

export interface BuoyancyVariable {
  key: BuoyancyVariableKey;
  label: string;
  value: number;
  unit: "N" | "kg";
}

export interface BuoyancyScenario {
  id: string;
  /** Which 3 variables are given */
  knownKeys: [BuoyancyVariableKey, BuoyancyVariableKey, BuoyancyVariableKey];
  /** Free parameters used to derive all 5 values */
  params: {
    Gobj: number;
    Fb: number;
    Gwater: number;
  };
  /** Whether Gobj is shown as m instead */
  useMassObj: boolean;
  /** Whether Gwater is shown as m instead */
  useMassWater: boolean;
  /** Answer key: the 2 unknown variables with their correct values */
  answers: { key: BuoyancyVariableKey; value: number }[];
}

// ─── Content definition ───────────────────────────────────────────

export interface BuoyancyContentDefinition {
  id: string;
  engineKind: "buoyancy-force-analysis";
  taskId: BuoyancyTaskId;
  version: string;
  promptTemplate: string;
  sceneTemplate: {
    sceneKind: "custom";
    stage: { width: number; height: number };
  };
  flowTemplate: {
    completionPolicy: "multi-step";
    stepOrder: BuoyancyStepKey[];
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
}

// ─── Workspace model (passed to frontend via scene entity) ────────

export interface BuoyancyWorkspaceModel {
  /** All 5 variables with their display state */
  variables: Array<{
    key: BuoyancyVariableKey;
    label: string;
    value: number | null; // null means unknown
    unit: "N" | "kg";
    isKnown: boolean;
  }>;
  /** Which step is active */
  currentStepId: BuoyancyStepKey;
  /** The equation labels for the reference card */
  equations: {
    object: string;  // "F + F浮 = G物"
    system: string;  // "F + F桌 = G水 + G物"
  };
  /** Prompt text */
  prompt: string;
  /** Wrong-answer hint for current step */
  wrongHint?: string;
}
