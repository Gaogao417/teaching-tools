import { exactValueSetsEqual, rangesEqual } from "./exactValue";
import type {
  AngleEquationEngineState,
  RuntimeDraftPayload,
  StepErrorCategory,
  StepEvaluationResult,
} from "./types";

// ─── Step 1: find-angles ─────────────────────────────────────────────
// Student selects reference angles on the unit circle.

export function evaluateFindAngles(
  state: AngleEquationEngineState,
  payload: RuntimeDraftPayload,
): StepEvaluationResult {
  const submitted = payload.selections?.["find-angles"] || [];
  const expected = state.answerKey.referenceAngles;

  const correct = exactValueSetsEqual(submitted, expected);
  return {
    correct,
    errorCategory: correct ? undefined : "incomplete-angles",
  };
}

// ─── Step 2: transform-range ─────────────────────────────────────────
// Student writes the transformed range endpoints.

export function evaluateTransformRange(
  state: AngleEquationEngineState,
  payload: RuntimeDraftPayload,
): StepEvaluationResult {
  const lo = payload.inputs?.["range-low"] || "";
  const hi = payload.inputs?.["range-high"] || "";

  if (!lo || !hi) {
    return { correct: false, errorCategory: "wrong-range" };
  }

  const correct = rangesEqual([lo, hi], state.answerKey.transformedRange);
  return {
    correct,
    errorCategory: correct ? undefined : "wrong-range",
  };
}

// ─── Step 3: filter-angles ───────────────────────────────────────────
// Student selects valid angles from candidate chips.

export function evaluateFilterAngles(
  state: AngleEquationEngineState,
  payload: RuntimeDraftPayload,
): StepEvaluationResult {
  const submitted = payload.selections?.["filter-angles"] || [];
  const expected = state.answerKey.filteredAngles;

  const correct = exactValueSetsEqual(submitted, expected);
  return {
    correct,
    errorCategory: correct ? undefined : "missed-extra-angles",
  };
}

// ─── Step 4: solve-target ────────────────────────────────────────────
// Student inputs final solutions.

export function evaluateSolveTarget(
  state: AngleEquationEngineState,
  payload: RuntimeDraftPayload,
): StepEvaluationResult {
  const inputs = payload.inputs || {};
  // Collect all solution-N entries
  const submitted: string[] = [];
  const keys = Object.keys(inputs).filter((k) => k.startsWith("solution-"));
  // Sort by numeric suffix for deterministic ordering
  keys.sort((a, b) => {
    const na = parseInt(a.replace("solution-", ""), 10);
    const nb = parseInt(b.replace("solution-", ""), 10);
    return na - nb;
  });
  for (const key of keys) {
    const val = inputs[key]?.trim();
    if (val) submitted.push(val);
  }

  const expected = state.answerKey.solutions;
  const correct = exactValueSetsEqual(submitted, expected);
  return {
    correct,
    errorCategory: correct ? undefined : "wrong-solutions",
  };
}
