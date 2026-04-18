import type { BuoyancyScenario, BuoyancyVariableKey } from "../../../../../../shared/buoyancyForceAnalysis";

/**
 * 8 valid "know 3" combinations (out of C(5,3)=10).
 * Invalid: {F, Fb, Gobj} (eq1 fully known, eq2 has 2 unknowns)
 *         {Fb, Gwater, Ftable} (eq2 degenerates, eq1 has 2 unknowns)
 */
const VALID_KNOWN_COMBOS: [BuoyancyVariableKey, BuoyancyVariableKey, BuoyancyVariableKey][] = [
  ["F", "Fb", "Gwater"],
  ["F", "Fb", "Ftable"],
  ["F", "Gobj", "Gwater"],
  ["F", "Gobj", "Ftable"],
  ["F", "Gwater", "Ftable"],
  ["Fb", "Gobj", "Gwater"],
  ["Fb", "Gobj", "Ftable"],
  ["Gobj", "Gwater", "Ftable"],
];

function deriveValues(params: { Gobj: number; Fb: number; Gwater: number }): Record<BuoyancyVariableKey, number> {
  return {
    F: params.Gobj - params.Fb,
    Fb: params.Fb,
    Gobj: params.Gobj,
    Gwater: params.Gwater,
    Ftable: params.Gwater + params.Fb,
  };
}

function unknownKeysFor(
  known: [BuoyancyVariableKey, BuoyancyVariableKey, BuoyancyVariableKey],
): [BuoyancyVariableKey, BuoyancyVariableKey] {
  const all: BuoyancyVariableKey[] = ["F", "Fb", "Gobj", "Gwater", "Ftable"];
  const knownSet = new Set(known);
  const unknowns = all.filter((k) => !knownSet.has(k));
  return [unknowns[0], unknowns[1]];
}

export function generateScenario(index: number): BuoyancyScenario {
  const comboIndex = index % VALID_KNOWN_COMBOS.length;
  const variation = Math.floor(index / VALID_KNOWN_COMBOS.length);

  const knownKeys = VALID_KNOWN_COMBOS[comboIndex];

  // Generate free parameters using simple deterministic scheme
  // Gobj: 3-15, Fb: 1-(Gobj-1), Gwater: 2-10
  const rng = seedRng(index * 31 + 7);
  const Gobj = 3 + (rng() % 13); // 3-15
  const Fb = 1 + (rng() % (Gobj - 1)); // 1 to Gobj-1
  const Gwater = 2 + (rng() % 9); // 2-10

  const params = { Gobj, Fb, Gwater };
  const values = deriveValues(params);
  const unknownKeys = unknownKeysFor(knownKeys);

  // Decide mass substitution based on variation
  const useMassObj = variation % 3 === 1;
  const useMassWater = variation % 3 === 2;

  return {
    id: `buoyancy-${index}`,
    knownKeys,
    params,
    useMassObj,
    useMassWater,
    answers: [
      { key: unknownKeys[0], value: values[unknownKeys[0]] },
      { key: unknownKeys[1], value: values[unknownKeys[1]] },
    ],
  };
}

export function getAllValidCombos() {
  return VALID_KNOWN_COMBOS;
}

/** Simple seeded PRNG for deterministic scenario generation */
function seedRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s;
  };
}
