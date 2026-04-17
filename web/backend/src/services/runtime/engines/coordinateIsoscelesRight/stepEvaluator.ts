import type {
  CoordIsoscelesEngineState,
  RuntimeDraftPayload,
  StepErrorCategory,
  StepEvaluationResult,
} from "./types";

// ─── Step 1: construct-lines ───────────────────────────────────────────

export function evaluateConstructLines(
  state: CoordIsoscelesEngineState,
  payload: RuntimeDraftPayload,
): StepEvaluationResult {
  const selected = payload.selections?.["construct-lines"] || [];
  const expected = state.answerKey.correctConstruction;

  if (selected.length !== 1) {
    return { correct: false, errorCategory: "wrong-construction" };
  }

  const correct = selected[0] === expected;
  return {
    correct,
    errorCategory: correct ? undefined : "wrong-construction",
  };
}

// ─── Step 2: identify-congruent ────────────────────────────────────────

export function evaluateIdentifyCongruent(
  state: CoordIsoscelesEngineState,
  payload: RuntimeDraftPayload,
): StepEvaluationResult {
  const selected = payload.selections?.["identify-congruent"] || [];
  const expected = state.answerKey.correctCongruence;

  if (selected.length !== 1) {
    return { correct: false, errorCategory: "wrong-congruence" };
  }

  const correct = selected[0] === expected;
  return {
    correct,
    errorCategory: correct ? undefined : "wrong-congruence",
  };
}

// ─── Step 3: setup-equations ───────────────────────────────────────────
// Substitute both valid solutions into the student's equations.
// Both solutions must satisfy both equations.

export function evaluateSetupEquations(
  state: CoordIsoscelesEngineState,
  payload: RuntimeDraftPayload,
): StepEvaluationResult {
  const eq1 = (payload.inputs?.["equation-1"] || "").trim();
  const eq2 = (payload.inputs?.["equation-2"] || "").trim();

  if (!eq1 || !eq2) {
    return { correct: false, errorCategory: "wrong-equations" };
  }

  const solutions = state.answerKey.solutions;
  const allValid = solutions.every((sol) => {
    return checkEquation(eq1, sol.x, sol.y) && checkEquation(eq2, sol.x, sol.y);
  });

  return {
    correct: allValid,
    errorCategory: allValid ? undefined : "wrong-equations",
  };
}

// ─── Step 4: solve-coordinates ─────────────────────────────────────────
// Accept either of the two valid solutions.

export function evaluateSolveCoordinates(
  state: CoordIsoscelesEngineState,
  payload: RuntimeDraftPayload,
): StepEvaluationResult {
  const aStr = (payload.inputs?.["coord-a"] || "").trim();
  const bStr = (payload.inputs?.["coord-b"] || "").trim();

  const a = parseFloat(aStr);
  const b = parseFloat(bStr);

  if (isNaN(a) || isNaN(b)) {
    return { correct: false, errorCategory: "wrong-coordinates" };
  }

  const matches = state.answerKey.solutions.some(
    (sol) => Math.abs(sol.x - a) < 1e-9 && Math.abs(sol.y - b) < 1e-9,
  );

  return {
    correct: matches,
    errorCategory: matches ? undefined : "wrong-coordinates",
  };
}

// ─── Equation checker ──────────────────────────────────────────────────

function checkEquation(eq: string, a: number, b: number): boolean {
  const parts = eq.split("=");
  if (parts.length !== 2) return false;

  try {
    const lhsVal = evalExpr(parts[0].trim(), a, b);
    const rhsVal = evalExpr(parts[1].trim(), a, b);
    if (lhsVal === null || rhsVal === null) return false;
    return Math.abs(lhsVal - rhsVal) < 1e-9;
  } catch {
    return false;
  }
}

/**
 * Evaluate a simple arithmetic expression.
 * Supports: numbers, a, b, +, -, *, /, parentheses, |...| (absolute value).
 */
function evalExpr(expr: string, a: number, b: number): number | null {
  try {
    // 1. Replace |...| with abs(...)
    let s = expr.replace(/\|([^|]+)\|/g, "abs($1)");

    // 2. Replace variables with values
    s = s.replace(/\ba\b/g, `(${a})`);
    s = s.replace(/\bb\b/g, `(${b})`);

    // 3. Validate: after removing 'abs', only digits/operators/parens/dots/spaces
    const stripped = s.replace(/abs/g, "");
    if (!/^[\d\s+\-*/().]+$/.test(stripped)) return null;

    // 4. Evaluate safely
    const fn = new Function("abs", `"use strict"; return (${s});`);
    const result = fn(Math.abs) as number;
    if (typeof result !== "number" || !isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}
