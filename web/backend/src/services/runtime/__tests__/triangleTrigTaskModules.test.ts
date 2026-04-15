import assert from "node:assert/strict";

import type { TaskDefinition, TriangleTrigContentDefinition } from "../../../../../shared/contracts";
import type { TriangleTrigTaskId } from "../../../../../shared/triangleTrig";
import { getTaskDefinition } from "../../tasks/catalogService";
import { resolveContentDefinition } from "../platform/contentRegistry";
import { getTriangleTrigTaskStrategy } from "../engines/triangleTrig/taskStrategies";
import { buildRuntimeForState, createTriangleTrigState } from "../engines/triangleTrig";

function taskContext(taskId: TriangleTrigTaskId): { task: TaskDefinition; content: TriangleTrigContentDefinition } {
  const task = getTaskDefinition(taskId);
  return {
    task,
    content: resolveContentDefinition(task.contentId) as TriangleTrigContentDefinition,
  };
}

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main() {
  await runTest("triangle trig task module registry covers every trig task id", () => {
    for (const taskId of ["meaning", "ratioToSide", "guidedSolve"] as TriangleTrigTaskId[]) {
      assert.ok(getTriangleTrigTaskStrategy(taskId));
    }
  });

  await runTest("task modules project their task-specific active step through the facade runtime", () => {
    const meaningContext = taskContext("meaning");
    const meaningState = createTriangleTrigState(meaningContext.task, meaningContext.content, 0);
    const meaningRuntime = buildRuntimeForState(meaningContext.task, meaningContext.content, meaningState, "answering");
    assert.equal(meaningRuntime.runtimeState.currentStepId, "pick-roles");

    const ratioContext = taskContext("ratioToSide");
    const ratioState = createTriangleTrigState(ratioContext.task, ratioContext.content, 0);
    const ratioRuntime = buildRuntimeForState(ratioContext.task, ratioContext.content, ratioState, "answering");
    assert.equal(ratioRuntime.runtimeState.currentStepId, "fill-lengths");

    const guidedContext = taskContext("guidedSolve");
    const guidedState = createTriangleTrigState(guidedContext.task, guidedContext.content, 0);
    const guidedRuntime = buildRuntimeForState(guidedContext.task, guidedContext.content, guidedState, "answering");
    assert.equal(guidedRuntime.runtimeState.currentStepId, "ratio");
  });
}

void main();
