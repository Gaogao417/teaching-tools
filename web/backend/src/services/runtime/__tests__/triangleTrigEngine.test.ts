import assert from "node:assert/strict";

import type {
  RuntimeActionEvent,
  TriangleTrigContentDefinition,
  TaskDefinition,
  TaskId,
} from "../../../../../shared/contracts";
import type { Role, Side, TriangleTrigTaskId } from "../../../../../shared/triangleTrig";
import { getTaskDefinition } from "../../tasks/catalogService";
import { resolveContentDefinition } from "../platform/contentRegistry";
import {
  buildRuntimeForState,
  createTriangleTrigState,
  reduceTriangleTrigAction,
  type GuidedEngineState,
  type MeaningEngineState,
  type RatioEngineState,
  type TriangleTrigEngineState,
} from "../engines/triangleTrig";

function taskContext(taskId: TriangleTrigTaskId): { task: TaskDefinition; content: TriangleTrigContentDefinition } {
  const task = getTaskDefinition(taskId);
  return {
    task,
    content: resolveContentDefinition(task.contentId) as TriangleTrigContentDefinition,
  };
}

function formatLength(len: { n: number; s: number }) {
  if (len.s === 1) return String(len.n);
  if (len.n === 1) return `√${len.s}`;
  return `${len.n}√${len.s}`;
}

function sideForRole(referenceAngle: "A" | "C", role: Role): Side {
  if (referenceAngle === "C") {
    return ({ opposite: "AB", adjacent: "BC", hypotenuse: "AC" } satisfies Record<Role, Side>)[role];
  }
  return ({ opposite: "BC", adjacent: "AB", hypotenuse: "AC" } satisfies Record<Role, Side>)[role];
}

function correctSubmitAction(state: TriangleTrigEngineState): RuntimeActionEvent {
  if (state.taskId === "meaning") {
    return {
      type: "submit",
      stepId: "pick-roles",
      value: JSON.stringify({
        selections: {
          "meaning-selection": [
            sideForRole(state.referenceAngle, state.answerKey.roles[0]),
            sideForRole(state.referenceAngle, state.answerKey.roles[1]),
          ],
        },
      }),
    };
  }

  if (state.taskId === "ratioToSide") {
    return {
      type: "submit",
      stepId: "fill-lengths",
      value: JSON.stringify({
        inputs: {
          "side-AB": formatLength(state.answerKey.triple.AB),
          "side-BC": formatLength(state.answerKey.triple.BC),
          "side-AC": formatLength(state.answerKey.triple.AC),
        },
      }),
    };
  }

  if (!state.stepState.ratio.done) {
    return {
      type: "submit",
      stepId: "ratio",
      value: JSON.stringify({
        inputs: Object.fromEntries(
          Object.entries(state.answerKey.zRoles).map(([role, value]) => [`ratio-${role}`, value || ""]),
        ),
      }),
    };
  }

  if (!state.stepState.third.done) {
    return {
      type: "submit",
      stepId: "third",
      value: JSON.stringify({
        inputs: {
          "third-side": state.answerKey.thirdZ,
        },
      }),
    };
  }

  return {
    type: "submit",
    stepId: "final",
    value: JSON.stringify({
      inputs: {
        "final-numerator": state.answerKey.finalNumerator,
        "final-denominator": state.answerKey.finalDenominator,
      },
    }),
  };
}

function wrongRatioSubmitAction(): RuntimeActionEvent {
  return {
    type: "submit",
    stepId: "fill-lengths",
    value: JSON.stringify({
      inputs: {
        "side-AB": "999",
        "side-BC": "999",
        "side-AC": "999",
      },
    }),
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
  await runTest("createTriangleTrigState returns task-specific initial state for all task families", () => {
    for (const taskId of ["meaning", "ratioToSide", "guidedSolve"] as TriangleTrigTaskId[]) {
      const { task, content } = taskContext(taskId);
      const state = createTriangleTrigState(task, content, 2);

      assert.equal(state.taskId, taskId);
      assert.equal(state.contentId, content.id);
      assert.equal(state.index, 2);
      assert.equal(state.status, "pending");
      assert.equal(state.attempts, 0);
      assert.equal(state.firstTryCorrect, null);
      assert.ok(state.instanceId);

      if (state.taskId === "meaning") {
        assert.equal(state.answerKey.roles.length, 2);
      } else if (state.taskId === "ratioToSide") {
        assert.ok(state.ratio.numerator);
        assert.ok(state.ratio.denominator);
      } else {
        assert.equal(state.given.length, 2);
        assert.deepEqual(
          Object.fromEntries(Object.entries(state.stepState).map(([key, value]) => [key, value.done])),
          { ratio: false, third: false, final: false },
        );
      }
    }
  });

  await runTest("buildRuntimeForState derives guided runtime flow and anchors from current step state", () => {
    const { task, content } = taskContext("guidedSolve");
    const state = createTriangleTrigState(task, content, 0) as GuidedEngineState;

    const initialRuntime = buildRuntimeForState(task, content, state, "answering");
    assert.equal(initialRuntime.runtimeState.currentStepId, "ratio");
    assert.equal(initialRuntime.instance.flow.currentStepId, "ratio");
    assert.equal(initialRuntime.instance.scene.anchors.every((anchor) => anchor.id.startsWith("ratio-")), true);

    const ratioDoneState: GuidedEngineState = {
      ...state,
      stepState: {
        ...state.stepState,
        ratio: { done: true, value: "ratio done" },
      },
    };
    const nextRuntime = buildRuntimeForState(task, content, ratioDoneState, "answering");
    assert.equal(nextRuntime.runtimeState.currentStepId, "third");
    assert.equal(nextRuntime.instance.flow.currentStepId, "third");
    assert.deepEqual(
      nextRuntime.instance.scene.anchors.map((anchor) => anchor.id),
      ["third-side"],
    );
  });

  await runTest("reduceTriangleTrigAction clones meaning state and marks a correct first try", () => {
    const { task, content } = taskContext("meaning");
    const state = createTriangleTrigState(task, content, 0) as MeaningEngineState;
    const original = JSON.parse(JSON.stringify(state)) as MeaningEngineState;

    const result = reduceTriangleTrigAction(task, content, state, correctSubmitAction(state));

    assert.equal(result.accepted, true);
    assert.equal(result.evaluation, "correct");
    assert.equal(result.phase, "correct_pause");
    assert.equal(result.engineState.status, "correct");
    assert.equal(result.engineState.attempts, 1);
    assert.equal(result.engineState.firstTryCorrect, true);
    assert.equal(result.runtime.runtimeState.problemStatus, "correct");
    assert.deepEqual(state, original);
  });

  await runTest("reduceTriangleTrigAction keeps guidedSolve in answering until the final step succeeds", () => {
    const { task, content } = taskContext("guidedSolve");
    const initial = createTriangleTrigState(task, content, 0) as GuidedEngineState;

    const ratioResult = reduceTriangleTrigAction(task, content, initial, correctSubmitAction(initial));
    assert.equal(ratioResult.evaluation, "progress");
    assert.equal(ratioResult.phase, "answering");
    assert.equal(ratioResult.engineState.taskId, "guidedSolve");
    assert.equal(ratioResult.engineState.stepState.ratio.done, true);
    assert.equal(ratioResult.engineState.stepState.third.done, false);

    const thirdState = ratioResult.engineState as GuidedEngineState;
    const thirdResult = reduceTriangleTrigAction(task, content, thirdState, correctSubmitAction(thirdState));
    assert.equal(thirdResult.evaluation, "progress");
    assert.equal(thirdResult.phase, "answering");
    assert.equal((thirdResult.engineState as GuidedEngineState).stepState.third.done, true);
    assert.equal(thirdResult.runtime.runtimeState.currentStepId, "final");

    const finalState = thirdResult.engineState as GuidedEngineState;
    const finalResult = reduceTriangleTrigAction(task, content, finalState, correctSubmitAction(finalState));
    assert.equal(finalResult.evaluation, "correct");
    assert.equal(finalResult.phase, "correct_pause");
    assert.equal(finalResult.engineState.status, "correct");
    assert.equal(finalResult.engineState.firstTryCorrect, false);
  });

  await runTest("reduceTriangleTrigAction marks wrong attempts and only sets firstTryCorrect on later success", () => {
    const { task, content } = taskContext("ratioToSide");
    const initial = createTriangleTrigState(task, content, 0) as RatioEngineState;

    const wrongResult = reduceTriangleTrigAction(task, content, initial, wrongRatioSubmitAction());
    assert.equal(wrongResult.evaluation, "wrong");
    assert.equal(wrongResult.phase, "wrong_feedback");
    assert.equal(wrongResult.engineState.status, "wrong");
    assert.equal(wrongResult.engineState.attempts, 1);
    assert.equal(wrongResult.engineState.firstTryCorrect, null);

    const corrected = reduceTriangleTrigAction(
      task,
      content,
      wrongResult.engineState as RatioEngineState,
      correctSubmitAction(wrongResult.engineState),
    );
    assert.equal(corrected.evaluation, "correct");
    assert.equal(corrected.phase, "correct_pause");
    assert.equal(corrected.engineState.firstTryCorrect, false);
    assert.equal(corrected.engineState.attempts, 2);
  });

  await runTest("reduceTriangleTrigAction rejects invalid submit JSON with ANSWER_INVALID", () => {
    const { task, content } = taskContext("meaning");
    const state = createTriangleTrigState(task, content, 0);

    assert.throws(
      () =>
        reduceTriangleTrigAction(task, content, state, {
          type: "submit",
          stepId: "pick-roles",
          value: "{invalid-json",
        }),
      (error: any) => error?.body?.error?.code === "ANSWER_INVALID",
    );
  });
}

void main();
