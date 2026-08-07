import assert from "node:assert/strict";
import { CONTENT_DEFINITIONS, TASK_DEFINITIONS } from "../../../../../shared/tasks";
import { getEnginePlugin } from "../platform/engineRegistry";
import { selectApprovedScenario } from "../platform/scenarioSelector";

function main() {
  for (const task of Object.values(TASK_DEFINITIONS)) {
    const content = CONTENT_DEFINITIONS[task.contentId];
    assert.ok(content, `content exists for ${task.id}`);

    const scenario = selectApprovedScenario(task, content, 0);
    assert.equal(scenario.status, "approved");
    assert.equal(scenario.taskId, task.id);
    assert.equal(scenario.engineKind, task.engineKind);
    assert.equal(scenario.contentId, content.id);

    const state = getEnginePlugin(task.engineKind).createState(task, content, 0, scenario);
    if ("scenarioId" in state) assert.equal(state.scenarioId, scenario.id);
  }

  const task = TASK_DEFINITIONS.trigEquationRange;
  const content = CONTENT_DEFINITIONS[task.contentId];
  assert.equal(
    selectApprovedScenario(task, content, 1).id,
    selectApprovedScenario(task, content, 1).id,
    "selection is stable for a task/index pair",
  );
  console.log("PASS scenario selector only supplies approved, compatible records to engines");
}

main();
