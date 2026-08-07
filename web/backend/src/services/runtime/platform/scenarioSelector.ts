import type { ContentDefinition, TaskDefinition } from "../../../../../shared/contracts";
import type { ScenarioRecord } from "../../../../../shared/scenarios";
import { appError } from "./errors";
import { listRegisteredScenarios } from "./scenarioRegistry";

export function selectApprovedScenario(
  task: TaskDefinition,
  content: ContentDefinition,
  index: number,
): ScenarioRecord {
  const approved = listRegisteredScenarios(task, content, index).filter((scenario) =>
    scenario.status === "approved"
      && scenario.taskId === task.id
      && scenario.engineKind === task.engineKind
      && scenario.contentId === content.id,
  );
  if (!approved.length) {
    throw appError("NO_APPROVED_SCENARIO", `No approved scenario registered for task ${task.id}`, 500);
  }
  return approved[index % approved.length];
}
