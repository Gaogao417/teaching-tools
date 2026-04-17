import type { AngleEquationScenario } from "../../../../../../shared/angleEquation";

// ─── Built-in scenario bank ──────────────────────────────────────────
// Each scenario has pre-verified answer keys.
// Notation: all angles in radians using "a*pi/b" format.

const SCENARIOS: AngleEquationScenario[] = [
  // ── sin, omega=2, phi=0, solve for x ─────────────────────────────
  // sin(2x) = 1/2, x ∈ [0, 2*pi]
  // Step 1: reference angles where sin = 1/2 → pi/6, 5*pi/6
  // Step 2: 2x ∈ [0, 4*pi]
  // Step 3: theta = pi/6, 5*pi/6, pi/6+2*pi=13*pi/6, 5*pi/6+2*pi=17*pi/6
  // Step 4: 2x = theta → x = pi/12, 5*pi/12, 13*pi/12, 17*pi/12
  {
    id: "sin-2x-half-x",
    trigFn: "sin",
    value: "1/2",
    omega: 2,
    phi: "0",
    unknownType: "x",
    unknownRange: ["0", "2*pi"],
    answerKey: {
      referenceAngles: ["pi/6", "5*pi/6"],
      transformedRange: ["0", "4*pi"],
      filteredAngles: ["pi/6", "5*pi/6", "13*pi/6", "17*pi/6"],
      solutions: ["pi/12", "5*pi/12", "13*pi/12", "17*pi/12"],
    },
  },

  // ── cos, omega=2, phi=0, solve for x ─────────────────────────────
  // cos(2x) = -1/2, x ∈ [0, 2*pi]
  // Step 1: reference angles where cos = -1/2 → 2*pi/3, 4*pi/3
  // Step 2: 2x ∈ [0, 4*pi]
  // Step 3: theta = 2*pi/3, 4*pi/3, 2*pi/3+2*pi=8*pi/3, 4*pi/3+2*pi=10*pi/3
  // Step 4: x = pi/3, 2*pi/3, 4*pi/3, 5*pi/3
  {
    id: "cos-2x-neg-half-x",
    trigFn: "cos",
    value: "-1/2",
    omega: 2,
    phi: "0",
    unknownType: "x",
    unknownRange: ["0", "2*pi"],
    answerKey: {
      referenceAngles: ["2*pi/3", "4*pi/3"],
      transformedRange: ["0", "4*pi"],
      filteredAngles: ["2*pi/3", "4*pi/3", "8*pi/3", "10*pi/3"],
      solutions: ["pi/3", "2*pi/3", "4*pi/3", "5*pi/3"],
    },
  },

  // ── sin, omega=1, phi=pi/6, solve for x ──────────────────────────
  // sin(x + pi/6) = 1/2, x ∈ [0, 2*pi]
  // Step 1: reference angles where sin = 1/2 → pi/6, 5*pi/6
  // Step 2: x + pi/6 ∈ [pi/6, 13*pi/6]
  // Step 3: theta in [pi/6, 13*pi/6] from {pi/6, 5*pi/6, 13*pi/6}
  //   Note: 2*pi + pi/6 = 13*pi/6 is in range, 2*pi + 5*pi/6 = 17*pi/6 > 13*pi/6
  // Step 4: x = theta - pi/6 → 0, 2*pi/3, 2*pi
  {
    id: "sin-x-pi6-half-x",
    trigFn: "sin",
    value: "1/2",
    omega: 1,
    phi: "pi/6",
    unknownType: "x",
    unknownRange: ["0", "2*pi"],
    answerKey: {
      referenceAngles: ["pi/6", "5*pi/6"],
      transformedRange: ["pi/6", "13*pi/6"],
      filteredAngles: ["pi/6", "5*pi/6", "13*pi/6"],
      solutions: ["0", "2*pi/3", "2*pi"],
    },
  },

  // ── tan, omega=2, phi=0, solve for x ─────────────────────────────
  // tan(2x) = 1, x ∈ [0, 2*pi]
  // Step 1: reference angles where tan = 1 → pi/4
  //   (general: pi/4 + k*pi)
  // Step 2: 2x ∈ [0, 4*pi]
  // Step 3: theta = pi/4, 5*pi/4, 9*pi/4, 13*pi/4
  // Step 4: x = pi/8, 5*pi/8, 9*pi/8, 13*pi/8
  {
    id: "tan-2x-one-x",
    trigFn: "tan",
    value: "1",
    omega: 2,
    phi: "0",
    unknownType: "x",
    unknownRange: ["0", "2*pi"],
    answerKey: {
      referenceAngles: ["pi/4"],
      transformedRange: ["0", "4*pi"],
      filteredAngles: ["pi/4", "5*pi/4", "9*pi/4", "13*pi/4"],
      solutions: ["pi/8", "5*pi/8", "9*pi/8", "13*pi/8"],
    },
  },

  // ── sin, omega=-1, phi=0, solve for x (omega < 0) ────────────────
  // sin(-x) = 1/2, x ∈ [0, 2*pi]
  // Since sin(-x) = -sin(x), this is -sin(x) = 1/2 → sin(x) = -1/2
  // Step 1: reference angles where sin = 1/2 → pi/6, 5*pi/6
  //   (these are for sin(theta) = 1/2 where theta = -x)
  // Step 2: -x ∈ [0, -2*pi] → x ∈ [-2*pi, 0]
  //   Or equivalently: theta = -x, theta ∈ [-2*pi, 0]
  // Step 3: theta in [-2*pi, 0]: -11*pi/6, -7*pi/6 (from pi/6 and 5*pi/6 minus 2*pi)
  // Step 4: x = -theta → 11*pi/6, 7*pi/6
  {
    id: "sin-neg-x-half-x",
    trigFn: "sin",
    value: "1/2",
    omega: -1,
    phi: "0",
    unknownType: "x",
    unknownRange: ["0", "2*pi"],
    answerKey: {
      referenceAngles: ["pi/6", "5*pi/6"],
      transformedRange: ["-2*pi", "0"],
      filteredAngles: ["-11*pi/6", "-7*pi/6"],
      solutions: ["7*pi/6", "11*pi/6"],
    },
  },

  // ── cos, omega=1, phi=0, solve for phi ───────────────────────────
  // cos(x + phi) = sqrt(2)/2, phi ∈ [-pi, pi], given x = pi/4
  // The prompt will show: cos(pi/4 + phi) = sqrt(2)/2, phi ∈ [-pi, pi]
  // Step 1: reference angles where cos = sqrt(2)/2 → pi/4, 7*pi/4 (or -pi/4)
  // Step 2: pi/4 + phi ∈ [-3*pi/4, 5*pi/4]
  // Step 3: theta in [-3*pi/4, 5*pi/4]: -pi/4, pi/4
  // Step 4: phi = theta - pi/4 → -pi/2, 0
  {
    id: "cos-x-phi-sqrt2-half-phi",
    trigFn: "cos",
    value: "sqrt(2)/2",
    omega: 1,
    phi: "unknown",
    unknownType: "phi",
    unknownRange: ["-pi", "pi"],
    answerKey: {
      referenceAngles: ["pi/4", "7*pi/4"],
      transformedRange: ["-3*pi/4", "5*pi/4"],
      filteredAngles: ["-pi/4", "pi/4"],
      solutions: ["-pi/2", "0"],
    },
  },

  // ── sin, omega=2, phi=pi/3, solve for x ──────────────────────────
  // sin(2x + pi/3) = sqrt(3)/2, x ∈ [0, pi]
  // Step 1: reference angles where sin = sqrt(3)/2 → pi/3, 2*pi/3
  // Step 2: 2x + pi/3 ∈ [pi/3, 7*pi/3]
  // Step 3: theta in [pi/3, 7*pi/3]: pi/3, 2*pi/3, 7*pi/3
  //   Note: 2*pi + pi/3 = 7*pi/3 is in range; 2*pi + 2*pi/3 = 8*pi/3 > 7*pi/3
  // Step 4: 2x = theta - pi/3 → x = (theta - pi/3)/2
  //   pi/3 - pi/3 = 0 → x = 0
  //   2*pi/3 - pi/3 = pi/3 → x = pi/6
  //   7*pi/3 - pi/3 = 6*pi/3 = 2*pi → x = pi
  {
    id: "sin-2x-pi3-sqrt3-half-x",
    trigFn: "sin",
    value: "sqrt(3)/2",
    omega: 2,
    phi: "pi/3",
    unknownType: "x",
    unknownRange: ["0", "pi"],
    answerKey: {
      referenceAngles: ["pi/3", "2*pi/3"],
      transformedRange: ["pi/3", "7*pi/3"],
      filteredAngles: ["pi/3", "2*pi/3", "7*pi/3"],
      solutions: ["0", "pi/6", "pi"],
    },
  },

  // ── cos, omega=1/2, phi=0, solve for x ───────────────────────────
  // cos(x/2) = 1, x ∈ [0, 4*pi]
  // Step 1: reference angles where cos = 1 → 0
  // Step 2: x/2 ∈ [0, 2*pi]
  // Step 3: theta in [0, 2*pi] from {0, 2*pi}: 0, 2*pi
  // Step 4: x/2 = theta → x = 2*theta: 0, 4*pi
  {
    id: "cos-half-x-one-x",
    trigFn: "cos",
    value: "1",
    omega: 0.5,
    phi: "0",
    unknownType: "x",
    unknownRange: ["0", "4*pi"],
    answerKey: {
      referenceAngles: ["0"],
      transformedRange: ["0", "2*pi"],
      filteredAngles: ["0", "2*pi"],
      solutions: ["0", "4*pi"],
    },
  },

  // ── sin, omega=1, phi=0, solve for omega ─────────────────────────
  // sin(omega * x) = 0, omega ∈ [1, 3], given x = pi/2
  // The prompt shows: sin(omega * pi/2) = 0, omega ∈ [1, 3]
  // Step 1: reference angles where sin = 0 → 0, pi
  // Step 2: omega * pi/2 ∈ [pi/2, 3*pi/2]
  // Step 3: theta in [pi/2, 3*pi/2]: pi
  // Step 4: omega * pi/2 = pi → omega = 2
  {
    id: "sin-omega-x-zero-omega",
    trigFn: "sin",
    value: "0",
    omega: 0, // placeholder — omega is the unknown
    phi: "0",
    unknownType: "omega",
    unknownRange: ["1", "3"],
    answerKey: {
      referenceAngles: ["0", "pi"],
      transformedRange: ["pi/2", "3*pi/2"],
      filteredAngles: ["pi"],
      solutions: ["2"],
    },
  },

  // ── tan, omega=1, phi=pi/4, solve for x ──────────────────────────
  // tan(x + pi/4) = -1, x ∈ [0, 2*pi]
  // Step 1: reference angles where tan = -1 → 3*pi/4 (or -pi/4)
  //   general: -pi/4 + k*pi
  // Step 2: x + pi/4 ∈ [pi/4, 9*pi/4]
  // Step 3: theta in [pi/4, 9*pi/4]: 3*pi/4, 7*pi/4
  //   (-pi/4 + pi = 3*pi/4, -pi/4 + 2*pi = 7*pi/4)
  // Step 4: x = theta - pi/4 → pi/2, 3*pi/2
  {
    id: "tan-x-pi4-neg-one-x",
    trigFn: "tan",
    value: "-1",
    omega: 1,
    phi: "pi/4",
    unknownType: "x",
    unknownRange: ["0", "2*pi"],
    answerKey: {
      referenceAngles: ["3*pi/4"],
      transformedRange: ["pi/4", "9*pi/4"],
      filteredAngles: ["3*pi/4", "7*pi/4"],
      solutions: ["pi/2", "3*pi/2"],
    },
  },
];

// ─── Pick scenario ───────────────────────────────────────────────────
// Deterministic rotation through the bank.

export function pickScenario(index: number): AngleEquationScenario {
  return SCENARIOS[index % SCENARIOS.length];
}

export function getAllScenarios(): readonly AngleEquationScenario[] {
  return SCENARIOS;
}
