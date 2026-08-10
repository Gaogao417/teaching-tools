import bundleJson from "../../../../content/triangleTrigScenarioBundle.json";
import type {
  Role,
  Side,
  TriangleTrigLengthValue,
  TriangleTrigResolvedScenario,
  TriangleTrigScenarioBundle,
  TriangleTrigScenarioRecord,
  TriangleTrigTaskId,
} from "../../../../../../shared/triangleTrig";

// Generated offline from the legacy triangle-trig seed constants.
const bundle = bundleJson as unknown as TriangleTrigScenarioBundle;

export function getTriangleBundleVersion(): string {
  return bundle.version;
}

function approvedRecords(taskId: TriangleTrigTaskId): TriangleTrigScenarioRecord[] {
  return (bundle.scenarios[taskId] || []).filter(
    (record) => record.status === "approved" && record.validation.passed,
  );
}

/**
 * Reattach the private answer key to a public scenario record, producing the
 * backend-only resolved shape consumed by the engine strategies.
 */
export function resolveTriangleScenarioRecord(record: TriangleTrigScenarioRecord): TriangleTrigResolvedScenario {
  if (record.engineKind !== "triangle-trig") {
    throw new Error(`Scenario ${record.id} has incompatible engine ${record.engineKind}`);
  }
  if (record.status !== "approved" || !record.validation.passed) {
    throw new Error(`Scenario ${record.id} is not approved`);
  }
  if (record.answerKey.kind !== record.taskId) {
    throw new Error(`Scenario ${record.id} answer key kind ${record.answerKey.kind} does not match task ${record.taskId}`);
  }
  return {
    id: record.id,
    taskId: record.taskId,
    contentId: record.contentId,
    version: record.version,
    target: record.promptData.target,
    referenceAngle: record.promptData.referenceAngle,
    knownType: record.promptData.knownType,
    given: record.promptData.given,
    answerKey: record.answerKey,
  };
}

export function pickTriangleScenarioRecord(taskId: TriangleTrigTaskId, index: number): TriangleTrigScenarioRecord {
  const scenarios = approvedRecords(taskId);
  if (!scenarios?.length) throw new Error(`No scenarios for ${taskId}`);
  return scenarios[index % scenarios.length];
}

export function pickTriangleScenario(taskId: TriangleTrigTaskId, index: number): TriangleTrigResolvedScenario {
  return resolveTriangleScenarioRecord(pickTriangleScenarioRecord(taskId, index));
}

export function getTriangleScenarioRecord(taskId: TriangleTrigTaskId, scenarioId: string): TriangleTrigScenarioRecord {
  const record = approvedRecords(taskId).find((item) => item.id === scenarioId);
  if (!record) throw new Error(`Unknown approved triangle scenario ${scenarioId}`);
  return record;
}

export function getTriangleScenario(taskId: TriangleTrigTaskId, scenarioId: string): TriangleTrigResolvedScenario {
  return resolveTriangleScenarioRecord(getTriangleScenarioRecord(taskId, scenarioId));
}

// ─── Resolved-scenario → engine-state adapters ───────────────────────
// The legacy strategies consume strongly-typed answer keys keyed by task. These
// helpers unwrap the discriminated `answerKey` union back into those shapes so
// the existing strategies keep working unchanged.

export interface MeaningAnswer {
  roles: [Role, Role];
}
export interface RatioAnswer {
  triple: Record<Side, TriangleTrigLengthValue>;
}
export interface GuidedAnswer {
  zRoles: Partial<Record<Role, string>>;
  thirdRole: Role;
  thirdZ: string;
  finalNumerator: string;
  finalDenominator: string;
}

export function meaningAnswerOf(scenario: TriangleTrigResolvedScenario): MeaningAnswer {
  if (scenario.answerKey.kind !== "meaning") throw new Error(`${scenario.id} is not a meaning scenario`);
  return { roles: scenario.answerKey.roles };
}

export function ratioAnswerOf(scenario: TriangleTrigResolvedScenario): RatioAnswer {
  if (scenario.answerKey.kind !== "ratioToSide") throw new Error(`${scenario.id} is not a ratioToSide scenario`);
  return { triple: scenario.answerKey.triple };
}

export function guidedAnswerOf(scenario: TriangleTrigResolvedScenario): GuidedAnswer {
  if (scenario.answerKey.kind !== "guidedSolve") throw new Error(`${scenario.id} is not a guidedSolve scenario`);
  const { zRoles, thirdRole, thirdZ, finalNumerator, finalDenominator } = scenario.answerKey;
  return { zRoles, thirdRole, thirdZ, finalNumerator, finalDenominator };
}
