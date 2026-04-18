import type { BuoyancyVariableKey } from "../../../../../../shared/buoyancyForceAnalysis";
import type { BuoyancyEngineState, BuoyancyErrorCategory, StepEvaluationResult } from "./types";

const G = 10; // N/kg

/**
 * Round a number to 2 decimal places.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Check if two values match after rounding to 2 decimal places.
 */
function valuesMatch(submitted: number, expected: number): boolean {
  return round2(submitted) === round2(expected);
}

/**
 * Get the "other equation" wrong answer for a given unknown.
 * These are common wrong answers students produce when they use the wrong equation.
 */
function getWrongEquationValues(
  unknownKey: BuoyancyVariableKey,
  state: BuoyancyEngineState,
): number[] {
  const { values, useMassObj, useMassWater } = state;

  // Common wrong answers derived from misapplying equations
  const wrongMap: Partial<Record<BuoyancyVariableKey, number[]>> = {
    Ftable: [values.Gwater], // F桌 = G水 (forgot buoyancy contribution)
    Fb: [values.Gobj - values.Gwater - values.F], // wrong system equation solve
    Gobj: [values.F + values.Gwater], // tried system without Ftable
  };

  const wrongs = wrongMap[unknownKey] || [];

  // Also include the other unknown's correct value (student solved wrong one)
  const answerKey = state.answerKey;
  const otherUnknown =
    answerKey.unknown1.key === unknownKey ? answerKey.unknown2 : answerKey.unknown1;
  wrongs.push(otherUnknown.value);

  // If the unknown is a G value and useMass, include the mass equivalent
  if (unknownKey === "Gobj" && useMassObj) wrongs.push(values.Gobj / G);
  if (unknownKey === "Gwater" && useMassWater) wrongs.push(values.Gwater / G);

  return wrongs;
}

/**
 * Get common sign-reversal wrong answers.
 */
function getSignReversalValues(
  unknownKey: BuoyancyVariableKey,
  state: BuoyancyEngineState,
): number[] {
  const { values } = state;

  const signReversals: Partial<Record<BuoyancyVariableKey, number[]>> = {
    Fb: [values.F - values.Gobj], // F - G物 instead of G物 - F
    F: [values.Fb - values.Gobj], // F浮 - G物 instead of G物 - F浮
    Gobj: [values.Fb - values.F], // swapped
    Ftable: [values.F - values.Gwater - values.Gobj], // wrong sign in system eq
  };

  return signReversals[unknownKey] || [];
}

export function evaluateStep(
  state: BuoyancyEngineState,
  unknownKey: BuoyancyVariableKey,
  submittedStr: string,
): StepEvaluationResult {
  const submitted = parseFloat(submittedStr);

  if (isNaN(submitted)) {
    return { correct: false, errorCategory: "unknown" };
  }

  // Get the expected value
  const expected = getExpectedValue(unknownKey, state);

  if (valuesMatch(submitted, expected)) {
    return { correct: true };
  }

  // Infer error category from wrong answer

  // Check wrong-equation patterns
  const wrongEqValues = getWrongEquationValues(unknownKey, state);
  for (const wrongVal of wrongEqValues) {
    if (valuesMatch(submitted, wrongVal)) {
      return { correct: false, errorCategory: "wrong-equation" };
    }
  }

  // Check sign-reversal patterns
  const signReversalValues = getSignReversalValues(unknownKey, state);
  for (const wrongVal of signReversalValues) {
    if (valuesMatch(submitted, wrongVal)) {
      return { correct: false, errorCategory: "sign-reversal" };
    }
  }

  // Default: computation error (close but not exact, or unknown pattern)
  return { correct: false, errorCategory: "computation" };
}

/**
 * Get the expected value for an unknown, accounting for mass substitution.
 */
function getExpectedValue(
  unknownKey: BuoyancyVariableKey,
  state: BuoyancyEngineState,
): number {
  const raw = state.values[unknownKey];

  // If the variable is Gobj and displayed as m物
  if (unknownKey === "Gobj" && state.useMassObj) {
    return round2(raw / G);
  }
  // If the variable is Gwater and displayed as m水
  if (unknownKey === "Gwater" && state.useMassWater) {
    return round2(raw / G);
  }

  return raw;
}
