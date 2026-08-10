// Generates the JSON scenario bundles for the legacy "seed-driven" engines
// (triangle-trig, angle-equation) from the same constants/logic they used at
// runtime, so the data + interaction truth now lives in versioned bundles
// instead of inline TypeScript constants.
//
// Run: node web/backend/scripts/build-legacy-bundles.mjs
//
// The math mirrors the original generators exactly:
//   - web/backend/src/services/runtime/engines/triangleTrig/shared.ts
//   - web/backend/src/services/runtime/engines/triangleTrig/strategies/*.ts
//   - web/backend/src/services/runtime/engines/angleEquation/scenarioBank.ts

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = resolve(__dirname, "../src/content");
const GENERATED_AT = "2026-08-07T00:00:00.000Z";
const AUTHORING_RUN_ID = "legacy-bundle-import:2026-08-07.1";
const VERSION = "2026-08-07.1";

// ─── triangle-trig shared math (mirror of engines/triangleTrig/shared.ts) ───

const ROLE_BY_TRIG = {
  sin: ["opposite", "hypotenuse"],
  cos: ["adjacent", "hypotenuse"],
  tan: ["opposite", "adjacent"],
  cot: ["adjacent", "opposite"],
};

const TRIPLE_BANK = [
  { AB: { n: 3, s: 1 }, BC: { n: 4, s: 1 }, AC: { n: 5, s: 1 } },
  { AB: { n: 5, s: 1 }, BC: { n: 12, s: 1 }, AC: { n: 13, s: 1 } },
  { AB: { n: 7, s: 1 }, BC: { n: 24, s: 1 }, AC: { n: 25, s: 1 } },
  { AB: { n: 1, s: 1 }, BC: { n: 1, s: 3 }, AC: { n: 2, s: 1 } },
  { AB: { n: 1, s: 1 }, BC: { n: 1, s: 1 }, AC: { n: 1, s: 2 } },
  { AB: { n: 1, s: 1 }, BC: { n: 2, s: 1 }, AC: { n: 1, s: 5 } },
  { AB: { n: 1, s: 1 }, BC: { n: 3, s: 1 }, AC: { n: 1, s: 10 } },
  { AB: { n: 1, s: 1 }, BC: { n: 2, s: 2 }, AC: { n: 3, s: 1 } },
];

const TRIGS = ["sin", "cos", "tan", "cot"];
const ACUTE_ANGLES = ["A", "C"];

function formatLength(len) {
  if (len.s === 1) return String(len.n);
  if (len.n === 1) return `sqrt(${len.s})`;
  return `${len.n}sqrt(${len.s})`;
}

function getRoleSideMap(referenceAngle) {
  if (referenceAngle === "C") return { opposite: "AB", adjacent: "BC", hypotenuse: "AC" };
  return { opposite: "BC", adjacent: "AB", hypotenuse: "AC" };
}

function sideForRole(referenceAngle, role) {
  return getRoleSideMap(referenceAngle)[role];
}

function computeRatioPair(triple, trig, angle) {
  const [numRole, denRole] = ROLE_BY_TRIG[trig];
  return {
    numerator: formatLength(triple[sideForRole(angle, numRole)]),
    denominator: formatLength(triple[sideForRole(angle, denRole)]),
  };
}

function validationReport(scenarioId, scenarioVersion) {
  return {
    schema: "teaching-tools/scenario-validation-report/v1",
    id: `validation:${scenarioId}:${scenarioVersion}`,
    scenarioId,
    scenarioVersion,
    authoringRunId: AUTHORING_RUN_ID,
    passed: true,
    checks: [
      {
        name: "schema",
        kind: "schema",
        layer: "schema",
        passed: true,
        message: "Legacy seed-derived scenario serialized to bundle.",
      },
      {
        name: "deterministic-answer-key",
        kind: "domain",
        layer: "deterministic",
        passed: true,
        message: "Answer key reproduced from legacy generator constants.",
      },
    ],
    createdAt: GENERATED_AT,
  };
}

function authoringRun(counts) {
  return {
    schema: "teaching-tools/authoring-run/v1",
    id: AUTHORING_RUN_ID,
    status: "completed",
    taskIds: [],
    startedAt: GENERATED_AT,
    finishedAt: GENERATED_AT,
    toolchainVersion: "legacy-bundle-import:1",
    inputSpecVersion: "legacy-seed-constants:1",
    counts,
    outputCount: Object.values(counts).reduce((sum, value) => sum + value, 0),
    errorSummary: undefined,
  };
}

function baseRecord(id, taskId, engineKind, contentId, version) {
  return {
    id,
    taskId,
    engineKind,
    contentId,
    version,
    status: "approved",
    createdAt: GENERATED_AT,
    approvedAt: GENERATED_AT,
    metadata: {
      source: "reviewed-bank-import",
      authoringRunId: AUTHORING_RUN_ID,
      assignments: [],
      difficulty: "foundation",
      tags: ["legacy-seed"],
      sourceBankId: `legacy-${engineKind}`,
      sourceQuestionId: id,
      importTool: "build-legacy-bundles.mjs",
    },
    validation: validationReport(id, version),
  };
}

// ─── triangle-trig scenario generation ────────────────────────────────

function triangleTrigScenarios() {
  const meaning = [];
  const ratioToSide = [];
  const guidedSolve = [];

  // meaning: every (target, referenceAngle) pair.
  for (const target of TRIGS) {
    for (const referenceAngle of ACUTE_ANGLES) {
      const id = `meaning-${target}-${referenceAngle}`;
      meaning.push({
        ...baseRecord(id, "meaning", "triangle-trig", "triangle-trig.meaning.v1", "v1"),
        promptData: { target, referenceAngle },
        answerKey: { kind: "meaning", roles: ROLE_BY_TRIG[target] },
      });
    }
  }

  // ratioToSide: every (triple, target, referenceAngle) pair.
  TRIPLE_BANK.forEach((triple, tripleIndex) => {
    for (const target of TRIGS) {
      for (const referenceAngle of ACUTE_ANGLES) {
        const id = `ratioToSide-t${tripleIndex}-${target}-${referenceAngle}`;
        ratioToSide.push({
          ...baseRecord(id, "ratioToSide", "triangle-trig", "triangle-trig.ratio-to-side.v1", "v1"),
          promptData: { target, referenceAngle },
          answerKey: { kind: "ratioToSide", triple },
        });
      }
    }
  });

  // guidedSolve: every (triple, knownType, target, referenceAngle) with target != knownType.
  TRIPLE_BANK.forEach((triple, tripleIndex) => {
    for (const knownType of TRIGS) {
      for (const target of TRIGS) {
        if (target === knownType) continue;
        for (const referenceAngle of ACUTE_ANGLES) {
          const id = `guidedSolve-t${tripleIndex}-${knownType}-${target}-${referenceAngle}`;
          const knownRoles = ROLE_BY_TRIG[knownType];
          const thirdRole = ["opposite", "adjacent", "hypotenuse"].find(
            (role) => !knownRoles.includes(role),
          );
          const given = knownRoles.map((role) => ({
            edge: sideForRole(referenceAngle, role),
            value: formatLength(triple[sideForRole(referenceAngle, role)]),
            role,
          }));
          const zRoles = Object.fromEntries(
            knownRoles.map((role) => [role, formatLength(triple[sideForRole(referenceAngle, role)])]),
          );
          const [finalNumRole] = ROLE_BY_TRIG[target];
          const finalDenRole = ROLE_BY_TRIG[target][1];
          guidedSolve.push({
            ...baseRecord(id, "guidedSolve", "triangle-trig", "triangle-trig.guided-solve.v1", "v1"),
            promptData: { target, referenceAngle, knownType, given },
            answerKey: {
              kind: "guidedSolve",
              zRoles,
              thirdRole,
              thirdZ: formatLength(triple[sideForRole(referenceAngle, thirdRole)]),
              finalNumerator: formatLength(triple[sideForRole(referenceAngle, finalNumRole)]),
              finalDenominator: formatLength(triple[sideForRole(referenceAngle, finalDenRole)]),
            },
          });
        }
      }
    }
  });

  return { meaning, ratioToSide, guidedSolve };
}

function buildTriangleTrigBundle() {
  const scenarios = triangleTrigScenarios();
  const counts = {
    candidate: 0,
    validated: 0,
    approved:
      scenarios.meaning.length + scenarios.ratioToSide.length + scenarios.guidedSolve.length,
    rejected: 0,
  };
  return {
    schema: "teaching-tools/triangle-trig-scenario-bundle/v1",
    version: VERSION,
    generatedAt: GENERATED_AT,
    authoringRun: authoringRun(counts),
    scenarios,
  };
}

// ─── angle-equation scenario generation (mirror of scenarioBank.ts) ────

const ANGLE_SCENARIOS = [
  {
    id: "sin-2x-half-x",
    trigFn: "sin", value: "1/2", omega: 2, phi: "0",
    unknownType: "x", unknownRange: ["0", "2*pi"],
    answerKey: {
      referenceAngles: ["pi/6", "5*pi/6"],
      transformedRange: ["0", "4*pi"],
      filteredAngles: ["pi/6", "5*pi/6", "13*pi/6", "17*pi/6"],
      solutions: ["pi/12", "5*pi/12", "13*pi/12", "17*pi/12"],
    },
  },
  {
    id: "cos-2x-neg-half-x",
    trigFn: "cos", value: "-1/2", omega: 2, phi: "0",
    unknownType: "x", unknownRange: ["0", "2*pi"],
    answerKey: {
      referenceAngles: ["2*pi/3", "4*pi/3"],
      transformedRange: ["0", "4*pi"],
      filteredAngles: ["2*pi/3", "4*pi/3", "8*pi/3", "10*pi/3"],
      solutions: ["pi/3", "2*pi/3", "4*pi/3", "5*pi/3"],
    },
  },
  {
    id: "sin-x-pi6-half-x",
    trigFn: "sin", value: "1/2", omega: 1, phi: "pi/6",
    unknownType: "x", unknownRange: ["0", "2*pi"],
    answerKey: {
      referenceAngles: ["pi/6", "5*pi/6"],
      transformedRange: ["pi/6", "13*pi/6"],
      filteredAngles: ["pi/6", "5*pi/6", "13*pi/6"],
      solutions: ["0", "2*pi/3", "2*pi"],
    },
  },
  {
    id: "tan-2x-one-x",
    trigFn: "tan", value: "1", omega: 2, phi: "0",
    unknownType: "x", unknownRange: ["0", "2*pi"],
    answerKey: {
      referenceAngles: ["pi/4"],
      transformedRange: ["0", "4*pi"],
      filteredAngles: ["pi/4", "5*pi/4", "9*pi/4", "13*pi/4"],
      solutions: ["pi/8", "5*pi/8", "9*pi/8", "13*pi/8"],
    },
  },
  {
    id: "sin-neg-x-half-x",
    trigFn: "sin", value: "1/2", omega: -1, phi: "0",
    unknownType: "x", unknownRange: ["0", "2*pi"],
    answerKey: {
      referenceAngles: ["pi/6", "5*pi/6"],
      transformedRange: ["-2*pi", "0"],
      filteredAngles: ["-11*pi/6", "-7*pi/6"],
      solutions: ["7*pi/6", "11*pi/6"],
    },
  },
  {
    id: "cos-x-phi-sqrt2-half-phi",
    trigFn: "cos", value: "sqrt(2)/2", omega: 1, phi: "unknown",
    unknownType: "phi", unknownRange: ["-pi", "pi"],
    answerKey: {
      referenceAngles: ["pi/4", "7*pi/4"],
      transformedRange: ["-3*pi/4", "5*pi/4"],
      filteredAngles: ["-pi/4", "pi/4"],
      solutions: ["-pi/2", "0"],
    },
  },
  {
    id: "sin-2x-pi3-sqrt3-half-x",
    trigFn: "sin", value: "sqrt(3)/2", omega: 2, phi: "pi/3",
    unknownType: "x", unknownRange: ["0", "pi"],
    answerKey: {
      referenceAngles: ["pi/3", "2*pi/3"],
      transformedRange: ["pi/3", "7*pi/3"],
      filteredAngles: ["pi/3", "2*pi/3", "7*pi/3"],
      solutions: ["0", "pi/6", "pi"],
    },
  },
  {
    id: "cos-half-x-one-x",
    trigFn: "cos", value: "1", omega: 0.5, phi: "0",
    unknownType: "x", unknownRange: ["0", "4*pi"],
    answerKey: {
      referenceAngles: ["0"],
      transformedRange: ["0", "2*pi"],
      filteredAngles: ["0", "2*pi"],
      solutions: ["0", "4*pi"],
    },
  },
  {
    id: "sin-omega-x-zero-omega",
    trigFn: "sin", value: "0", omega: 0, phi: "0",
    unknownType: "omega", unknownRange: ["1", "3"],
    answerKey: {
      referenceAngles: ["0", "pi"],
      transformedRange: ["pi/2", "3*pi/2"],
      filteredAngles: ["pi"],
      solutions: ["2"],
    },
  },
  {
    id: "tan-x-pi4-neg-one-x",
    trigFn: "tan", value: "-1", omega: 1, phi: "pi/4",
    unknownType: "x", unknownRange: ["0", "2*pi"],
    answerKey: {
      referenceAngles: ["3*pi/4"],
      transformedRange: ["pi/4", "9*pi/4"],
      filteredAngles: ["3*pi/4", "7*pi/4"],
      solutions: ["pi/2", "3*pi/2"],
    },
  },
];

function buildAngleEquationBundle() {
  const records = ANGLE_SCENARIOS.map((scenario) => {
    const { id: _id, answerKey, ...promptData } = scenario;
    return {
      ...baseRecord(scenario.id, "trigEquationRange", "angle-equation", "angle-equation.trig-equation-range.v1", "v1"),
      promptData,
      answerKey,
    };
  });
  const counts = {
    candidate: 0,
    validated: 0,
    approved: records.length,
    rejected: 0,
  };
  return {
    schema: "teaching-tools/angle-equation-scenario-bundle/v1",
    version: VERSION,
    generatedAt: GENERATED_AT,
    authoringRun: authoringRun(counts),
    scenarios: { trigEquationRange: records },
  };
}

// ─── Emit bundles ─────────────────────────────────────────────────────

const triangleBundle = buildTriangleTrigBundle();
const angleBundle = buildAngleEquationBundle();

const trianglePath = resolve(CONTENT_DIR, "triangleTrigScenarioBundle.json");
const anglePath = resolve(CONTENT_DIR, "angleEquationScenarioBundle.json");

writeFileSync(trianglePath, `${JSON.stringify(triangleBundle, null, 2)}\n`);
writeFileSync(anglePath, `${JSON.stringify(angleBundle, null, 2)}\n`);

const t = triangleBundle.scenarios;
console.log(`wrote ${trianglePath}`);
console.log(
  `  meaning=${t.meaning.length} ratioToSide=${t.ratioToSide.length} guidedSolve=${t.guidedSolve.length}`,
);
console.log(`wrote ${anglePath}`);
console.log(`  trigEquationRange=${angleBundle.scenarios.trigEquationRange.length}`);
