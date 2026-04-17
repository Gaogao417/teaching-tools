import type { CoordIsoscelesScenario } from "../../../../../../shared/coordinateIsoscelesRight";

// ─── Shared option templates ───────────────────────────────────────────

const CONSTRUCTION_OPTIONS = [
  { id: "construct-a-hv", label: "过A作横线和竖线，从B向横线作垂线，从C向竖线作垂线" },
  { id: "construct-b-hv", label: "过B作横线和竖线，从A向横线作垂线，从C向竖线作垂线" },
  { id: "construct-c-hv", label: "过C作横线和竖线，从A向横线作垂线，从B向竖线作垂线" },
  { id: "construct-bc-parallel", label: "过A作BC的平行线和垂线" },
] as const;

const CONGRUENCE_OPTIONS = [
  { id: "congruent-abe-caf", label: "△ABE ≅ △CAF，BE = AF，AE = CF" },
  { id: "congruent-abf-cae", label: "△ABF ≅ △CAE，BF = AE，AF = CE" },
  { id: "congruent-abe-cef", label: "△ABE ≅ △CEF，BE = EF，AE = CF" },
] as const;

// ─── Built-in scenario bank ────────────────────────────────────────────
// Each scenario has pre-verified answer keys.
// Solutions use the formulas:
//   A1 = ((x1+x2+y1-y2)/2, (x2-x1+y1+y2)/2)
//   A2 = ((x1+x2-y1+y2)/2, (x1-x2+y1+y2)/2)

const SCENARIOS: CoordIsoscelesScenario[] = [
  // ── B(0,0), C(4,0) ──────────────────────────────────────────────────
  // A1 = (2,2), A2 = (2,-2)
  // Equations: |0-b| = |4-a|, |0-a| = |0-b|
  {
    id: "b00-c40",
    B: { x: 0, y: 0 },
    C: { x: 4, y: 0 },
    answerKey: {
      correctConstruction: "construct-a-hv",
      correctCongruence: "congruent-abe-caf",
      equations: ["|0 - b| = |4 - a|", "|0 - a| = |0 - b|"],
      solutions: [{ x: 2, y: 2 }, { x: 2, y: -2 }],
    },
    constructionOptions: [...CONSTRUCTION_OPTIONS],
    congruenceOptions: [...CONGRUENCE_OPTIONS],
  },

  // ── B(1,1), C(5,3) ──────────────────────────────────────────────────
  // A1 = (2,4), A2 = (4,0)
  // Equations: |1-b| = |5-a|, |1-a| = |3-b|
  {
    id: "b11-c53",
    B: { x: 1, y: 1 },
    C: { x: 5, y: 3 },
    answerKey: {
      correctConstruction: "construct-a-hv",
      correctCongruence: "congruent-abe-caf",
      equations: ["|1 - b| = |5 - a|", "|1 - a| = |3 - b|"],
      solutions: [{ x: 2, y: 4 }, { x: 4, y: 0 }],
    },
    constructionOptions: [...CONSTRUCTION_OPTIONS],
    congruenceOptions: [...CONGRUENCE_OPTIONS],
  },

  // ── B(0,2), C(4,4) ──────────────────────────────────────────────────
  // A1 = (1,5), A2 = (3,1)
  {
    id: "b02-c44",
    B: { x: 0, y: 2 },
    C: { x: 4, y: 4 },
    answerKey: {
      correctConstruction: "construct-a-hv",
      correctCongruence: "congruent-abe-caf",
      equations: ["|2 - b| = |4 - a|", "|0 - a| = |4 - b|"],
      solutions: [{ x: 1, y: 5 }, { x: 3, y: 1 }],
    },
    constructionOptions: [...CONSTRUCTION_OPTIONS],
    congruenceOptions: [...CONGRUENCE_OPTIONS],
  },

  // ── B(2,0), C(2,4) ──────────────────────────────────────────────────
  // A1 = (0,2), A2 = (4,2)
  {
    id: "b20-c24",
    B: { x: 2, y: 0 },
    C: { x: 2, y: 4 },
    answerKey: {
      correctConstruction: "construct-a-hv",
      correctCongruence: "congruent-abe-caf",
      equations: ["|0 - b| = |2 - a|", "|2 - a| = |4 - b|"],
      solutions: [{ x: 0, y: 2 }, { x: 4, y: 2 }],
    },
    constructionOptions: [...CONSTRUCTION_OPTIONS],
    congruenceOptions: [...CONGRUENCE_OPTIONS],
  },

  // ── B(1,3), C(5,1) ──────────────────────────────────────────────────
  // A1 = (4,4), A2 = (2,0)
  {
    id: "b13-c51",
    B: { x: 1, y: 3 },
    C: { x: 5, y: 1 },
    answerKey: {
      correctConstruction: "construct-a-hv",
      correctCongruence: "congruent-abe-caf",
      equations: ["|3 - b| = |5 - a|", "|1 - a| = |1 - b|"],
      solutions: [{ x: 4, y: 4 }, { x: 2, y: 0 }],
    },
    constructionOptions: [...CONSTRUCTION_OPTIONS],
    congruenceOptions: [...CONGRUENCE_OPTIONS],
  },

  // ── B(0,0), C(2,4) ──────────────────────────────────────────────────
  // A1 = (-1,3), A2 = (3,1)
  {
    id: "b00-c24",
    B: { x: 0, y: 0 },
    C: { x: 2, y: 4 },
    answerKey: {
      correctConstruction: "construct-a-hv",
      correctCongruence: "congruent-abe-caf",
      equations: ["|0 - b| = |2 - a|", "|0 - a| = |4 - b|"],
      solutions: [{ x: -1, y: 3 }, { x: 3, y: 1 }],
    },
    constructionOptions: [...CONSTRUCTION_OPTIONS],
    congruenceOptions: [...CONGRUENCE_OPTIONS],
  },
];

// ─── Pick scenario ─────────────────────────────────────────────────────
// Deterministic rotation through the bank.

export function pickScenario(index: number): CoordIsoscelesScenario {
  return SCENARIOS[index % SCENARIOS.length];
}

export function getAllScenarios(): readonly CoordIsoscelesScenario[] {
  return SCENARIOS;
}
