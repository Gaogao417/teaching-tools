// ─── Step IDs ──────────────────────────────────────────────────────────

export type CoordIsoscelesStepKey =
  | "construct-lines"
  | "identify-congruent"
  | "setup-equations"
  | "solve-coordinates";

// ─── Task ID ───────────────────────────────────────────────────────────

export type CoordIsoscelesTaskId = "isoscelesRightCoord";

// ─── Coordinate point ──────────────────────────────────────────────────

export interface CoordPoint {
  x: number;
  y: number;
}

// ─── Answer key ────────────────────────────────────────────────────────

export interface CoordIsoscelesAnswerKey {
  /** Step 1: correct construction option ID */
  correctConstruction: string;
  /** Step 2: correct congruence option ID */
  correctCongruence: string;
  /** Step 3: expected equation hints (for guide display) */
  equations: [string, string];
  /** Step 4: both valid solutions for A */
  solutions: [CoordPoint, CoordPoint];
}

// ─── Option item ───────────────────────────────────────────────────────

export interface OptionItem {
  id: string;
  label: string;
}

// ─── Scenario ──────────────────────────────────────────────────────────

export interface CoordIsoscelesScenario {
  id: string;
  B: CoordPoint;
  C: CoordPoint;
  answerKey: CoordIsoscelesAnswerKey;
  constructionOptions: OptionItem[];
  congruenceOptions: OptionItem[];
}

// ─── Content definition ────────────────────────────────────────────────

export interface CoordIsoscelesContentDefinition {
  id: string;
  engineKind: "coordinate-isosceles-right";
  taskId: "isoscelesRightCoord";
  version: string;
  promptTemplate: string;
  sceneTemplate: {
    sceneKind: "custom";
    stage: { width: number; height: number };
  };
  flowTemplate: {
    completionPolicy: "multi-step";
    stepOrder: CoordIsoscelesStepKey[];
    guideSteps: Array<{ stepId: string; title: string; summary: string }>;
  };
  guideTemplate: {
    banner: string;
    hint: string;
  };
  feedbackTemplate: {
    correct: string[];
    wrong: string[];
    finish: string[];
  };
}

// ─── Workspace model (transported via SceneSpec entity) ─────────────────

export interface CoordIsoscelesWorkspaceModel {
  B: CoordPoint;
  C: CoordPoint;
  currentStepId: CoordIsoscelesStepKey;
  constructionOptions: OptionItem[];
  congruenceOptions: OptionItem[];
  selectedConstruction?: string;
  selectedCongruence?: string;
  solvedCoord?: CoordPoint;
  gridBounds: { xMin: number; xMax: number; yMin: number; yMax: number };
}
