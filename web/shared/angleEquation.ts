// Angle-equation engine domain types
// Shared between frontend and backend

// ─── Step IDs ────────────────────────────────────────────────────────

export type AngleEquationStepKey =
  | "find-angles"
  | "transform-range"
  | "filter-angles"
  | "solve-target";

// ─── Core domain types ───────────────────────────────────────────────

export type AngleEquationTrigFn = "sin" | "cos" | "tan";

export type UnknownType = "x" | "phi" | "omega";

export type AngleEquationTaskId = "trigEquationRange";

// ─── Scenario ────────────────────────────────────────────────────────

export interface AngleEquationScenario {
  id: string;
  trigFn: AngleEquationTrigFn;
  value: string; // e.g. "1/2", "sqrt(2)/2", "-sqrt(3)/2"
  omega: number;
  phi: string; // e.g. "0", "pi/6", "-pi/4"
  unknownType: UnknownType;
  unknownRange: [string, string]; // e.g. ["0", "2*pi"]
  answerKey: {
    referenceAngles: string[];
    transformedRange: [string, string];
    filteredAngles: string[];
    solutions: string[];
  };
}

// ─── ContentDefinition ───────────────────────────────────────────────

export interface AngleEquationContentDefinition {
  id: string;
  engineKind: "angle-equation";
  taskId: "trigEquationRange";
  version: string;
  promptTemplate: string;
  sceneTemplate: {
    sceneKind: "custom";
    stage: { width: number; height: number };
  };
  flowTemplate: {
    completionPolicy: "multi-step";
    stepOrder: AngleEquationStepKey[];
    guideSteps: Array<{
      stepId: string;
      title: string;
      summary: string;
    }>;
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

// ─── Workspace model (embedded in SceneSpec for frontend transport) ──

export interface AngleEquationWorkspaceModel {
  equation: {
    trigFn: AngleEquationTrigFn;
    omega: number;
    phi: string;
    value: string;
  };
  unknownType: UnknownType;
  unknownRange: [string, string];
  candidateAngles?: string[]; // populated after step 1 completes
  transformedRange?: [string, string]; // populated after step 2 completes
  filteredAngles?: string[]; // populated after step 3 completes
  unitCircleAngles: string[]; // standard angle labels on unit circle
  currentStepId: AngleEquationStepKey;
}
