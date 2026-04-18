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

// ─── Workspace model (supplementary metadata, not a substitute for anchors/zones) ──

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

// ─── Unit circle geometry (shared between backend zones and frontend SVG) ──

export const UNIT_CIRCLE_CX = 140;
export const UNIT_CIRCLE_CY = 140;
export const UNIT_CIRCLE_R = 110;

export interface UnitCirclePoint {
  id: string;
  label: string;
  x: number;
  y: number;
  labelX: number;
  labelY: number;
}

const STANDARD_ANGLE_RAD = [
  0,
  Math.PI / 6,
  Math.PI / 4,
  Math.PI / 3,
  Math.PI / 2,
  (2 * Math.PI) / 3,
  (3 * Math.PI) / 4,
  (5 * Math.PI) / 6,
  Math.PI,
  (7 * Math.PI) / 6,
  (5 * Math.PI) / 4,
  (4 * Math.PI) / 3,
  (3 * Math.PI) / 2,
  (5 * Math.PI) / 3,
  (7 * Math.PI) / 4,
  (11 * Math.PI) / 6,
];

const STANDARD_ANGLE_IDS = [
  "0",
  "pi/6",
  "pi/4",
  "pi/3",
  "pi/2",
  "2*pi/3",
  "3*pi/4",
  "5*pi/6",
  "pi",
  "7*pi/6",
  "5*pi/4",
  "4*pi/3",
  "3*pi/2",
  "5*pi/3",
  "7*pi/4",
  "11*pi/6",
];

const STANDARD_ANGLE_LABELS = [
  "0",
  "pi/6",
  "pi/4",
  "pi/3",
  "pi/2",
  "2pi/3",
  "3pi/4",
  "5pi/6",
  "pi",
  "7pi/6",
  "5pi/4",
  "4pi/3",
  "3pi/2",
  "5pi/3",
  "7pi/4",
  "11pi/6",
];

export const UNIT_CIRCLE_POINTS: UnitCirclePoint[] = STANDARD_ANGLE_RAD.map(
  (rad, i) => {
    const x = UNIT_CIRCLE_CX + UNIT_CIRCLE_R * Math.cos(rad);
    const y = UNIT_CIRCLE_CY - UNIT_CIRCLE_R * Math.sin(rad);
    // Push labels outward from center
    const lx = UNIT_CIRCLE_CX + (UNIT_CIRCLE_R + 18) * Math.cos(rad);
    const ly = UNIT_CIRCLE_CY - (UNIT_CIRCLE_R + 18) * Math.sin(rad);
    return {
      id: STANDARD_ANGLE_IDS[i],
      label: STANDARD_ANGLE_LABELS[i],
      x,
      y,
      labelX: lx,
      labelY: ly,
    };
  },
);

