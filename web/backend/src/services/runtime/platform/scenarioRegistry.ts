import type { TaskDefinition, ContentDefinition } from "../../../../../shared/contracts";
import type { ScenarioRecord } from "../../../../../shared/scenarios";
import { getAllScenarios as getAngleScenarios } from "../engines/angleEquation/scenarioBank";
import { generateScenario } from "../engines/buoyancyForceAnalysis/scenarioBank";
import { getAllScenarios as getCoordinateScenarios } from "../engines/coordinateIsoscelesRight/scenarioBank";
import { pickTopicScenarioRecord } from "../engines/topicPractice/scenarioBank";

type ScenarioProvider = (
  task: TaskDefinition,
  content: ContentDefinition,
  index: number,
) => readonly ScenarioRecord[];

function approvedRecord(
  task: TaskDefinition,
  content: ContentDefinition,
  id: string,
  promptData: Record<string, unknown>,
  answerKey: Record<string, unknown>,
  source: ScenarioRecord["metadata"]["source"] = "manual",
): ScenarioRecord {
  return {
    id,
    taskId: task.id,
    engineKind: task.engineKind,
    contentId: content.id,
    version: content.version,
    status: "approved",
    promptData,
    answerKey,
    createdAt: "2026-08-07T00:00:00.000Z",
    approvedAt: "2026-08-07T00:00:00.000Z",
    metadata: {
      source,
      authoringRunId: `runtime-builtins:${content.version}`,
      assignments: [],
      difficulty: task.difficulty,
    },
  };
}

const providers: Partial<Record<TaskDefinition["engineKind"], ScenarioProvider>> = {
  "angle-equation": (task, content) => getAngleScenarios().map((scenario) => {
    const { answerKey, ...promptData } = scenario;
    return approvedRecord(task, content, scenario.id, promptData, answerKey as unknown as Record<string, unknown>);
  }),
  "coordinate-isosceles-right": (task, content) => getCoordinateScenarios().map((scenario) => {
    const { answerKey, ...promptData } = scenario;
    return approvedRecord(task, content, scenario.id, promptData, answerKey as unknown as Record<string, unknown>);
  }),
  "buoyancy-force-analysis": (task, content, index) => {
    const scenario = generateScenario(index);
    const { answers, ...promptData } = scenario;
    return [approvedRecord(task, content, scenario.id, promptData, { answers })];
  },
  "topic-practice": (task, content, index) => {
    const scenario = pickTopicScenarioRecord(task.id as Parameters<typeof pickTopicScenarioRecord>[0], index);
    return [scenario as unknown as ScenarioRecord];
  },
  "triangle-trig": (task, content, index) => {
    const targets = ["sin", "cos", "tan", "cot"];
    const referenceAngles = ["A", "C"];
    const target = targets[index % targets.length];
    const referenceAngle = referenceAngles[Math.floor(index / targets.length) % referenceAngles.length];
    return [approvedRecord(
      task,
      content,
      `${task.id}-${target}-${referenceAngle}-${index}`,
      { target, referenceAngle },
      {},
    )];
  },
  "demo-counter": (task, content) => {
    const expectedAnswer = "expectedAnswer" in content ? content.expectedAnswer : "";
    return [approvedRecord(task, content, `${task.id}-default`, {}, { expectedAnswer })];
  },
};

export function listRegisteredScenarios(
  task: TaskDefinition,
  content: ContentDefinition,
  index: number,
): readonly ScenarioRecord[] {
  return providers[task.engineKind]?.(task, content, index) || [];
}
