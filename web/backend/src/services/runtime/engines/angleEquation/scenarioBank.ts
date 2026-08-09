import bundleJson from "../../../../content/angleEquationScenarioBundle.json";
import type {
  AngleEquationResolvedScenario,
  AngleEquationScenario,
  AngleEquationScenarioBundle,
  AngleEquationScenarioRecord,
} from "../../../../../../shared/angleEquation";

// Generated offline from the legacy angle-equation scenario bank.
const bundle = bundleJson as unknown as AngleEquationScenarioBundle;

export function getAngleEquationBundleVersion(): string {
  return bundle.version;
}

function approvedRecords(): AngleEquationScenarioRecord[] {
  return (bundle.scenarios.trigEquationRange || []).filter(
    (record) => record.status === "approved" && record.validation.passed,
  );
}

/**
 * Reattach the private answer key to a public scenario record, producing the
 * backend-only resolved shape. The runtime reads `answerKey` only from here.
 */
export function resolveAngleScenarioRecord(record: AngleEquationScenarioRecord): AngleEquationResolvedScenario {
  if (record.engineKind !== "angle-equation") {
    throw new Error(`Scenario ${record.id} has incompatible engine ${record.engineKind}`);
  }
  if (record.status !== "approved" || !record.validation.passed) {
    throw new Error(`Scenario ${record.id} is not approved`);
  }
  return {
    id: record.id,
    taskId: record.taskId,
    contentId: record.contentId,
    version: record.version,
    trigFn: record.promptData.trigFn,
    value: record.promptData.value,
    omega: record.promptData.omega,
    phi: record.promptData.phi,
    unknownType: record.promptData.unknownType,
    unknownRange: record.promptData.unknownRange,
    answerKey: record.answerKey,
  };
}

/** Project the resolved scenario into the legacy `AngleEquationScenario` profile. */
function toScenario(resolved: AngleEquationResolvedScenario): AngleEquationScenario {
  const { id, trigFn, value, omega, phi, unknownType, unknownRange, answerKey } = resolved;
  return { id, trigFn, value, omega, phi, unknownType, unknownRange, answerKey };
}

export function pickScenarioRecord(index: number): AngleEquationScenarioRecord {
  const scenarios = approvedRecords();
  if (!scenarios?.length) throw new Error("No angle-equation scenarios available");
  return scenarios[index % scenarios.length];
}

export function pickScenario(index: number): AngleEquationScenario {
  return toScenario(resolveAngleScenarioRecord(pickScenarioRecord(index)));
}

export function getScenarioRecord(scenarioId: string): AngleEquationScenarioRecord {
  const record = approvedRecords().find((item) => item.id === scenarioId);
  if (!record) throw new Error(`Unknown approved angle-equation scenario ${scenarioId}`);
  return record;
}

export function getScenario(scenarioId: string): AngleEquationScenario {
  return toScenario(resolveAngleScenarioRecord(getScenarioRecord(scenarioId)));
}

export function getAllScenarios(): readonly AngleEquationScenario[] {
  return approvedRecords().map((record) => toScenario(resolveAngleScenarioRecord(record)));
}
