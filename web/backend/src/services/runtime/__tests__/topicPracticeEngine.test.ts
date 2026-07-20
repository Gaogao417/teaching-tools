import assert from "node:assert/strict";

import type { RuntimeActionEvent, TaskDefinition } from "../../../../../shared/contracts";
import type { TopicPracticeContentDefinition, TopicPracticeTaskId } from "../../../../../shared/topicPractice";
import { getTaskDefinition, getTaskTree } from "../../tasks/catalogService";
import {
  buildTopicPracticeRuntime,
  createTopicPracticeState,
  reduceTopicPracticeAction,
} from "../engines/topicPractice";
import { getTopicLesson, getTopicScenario } from "../engines/topicPractice/scenarioBank";
import type { TopicPracticeEngineState } from "../engines/topicPractice/types";
import { resolveContentDefinition } from "../platform/contentRegistry";

const TASK_IDS: TopicPracticeTaskId[] = [
  "quadraticCompletion",
  "parallelLineRatios",
  "auxiliaryTwoRatios",
  "reverseASimilarity",
  "nestedSimilarity",
  "butterflySimilarity",
];

function taskContext(taskId: TopicPracticeTaskId): {
  task: TaskDefinition;
  content: TopicPracticeContentDefinition;
} {
  const task = getTaskDefinition(taskId);
  return {
    task,
    content: resolveContentDefinition(task.contentId) as TopicPracticeContentDefinition,
  };
}

function submit(stepId: string, value: string): RuntimeActionEvent {
  return {
    type: "submit",
    stepId,
    value: JSON.stringify({ inputs: { "topic-answer": value } }),
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
  await runTest("catalog exposes six explanation and bank backed topic tasks", () => {
    const treeTaskIds = getTaskTree().grades.flatMap((grade) =>
      grade.chapters.flatMap((chapter) => chapter.tasks.map((task) => task.id)),
    );
    for (const taskId of TASK_IDS) {
      const { task, content } = taskContext(taskId);
      assert.equal(task.engineKind, "topic-practice");
      assert.equal(content.taskId, taskId);
      assert.match(content.sourceExplanation, /artifacts\/专题/);
      assert.match(content.sourceExplanation, /\.tex$/);
      assert.ok(content.sourceBanks.every((source) => source.includes("artifacts/题库/")));
      assert.ok(treeTaskIds.includes(taskId));
    }
  });

  await runTest("each topic rotates through five distinct ready-bank scenarios", () => {
    for (const taskId of TASK_IDS) {
      const { task, content } = taskContext(taskId);
      const states = Array.from({ length: 5 }, (_, index) => createTopicPracticeState(task, content, index));
      assert.equal(new Set(states.map((state) => state.scenarioId)).size, 5);
      for (const state of states) {
        const scenario = getTopicScenario(taskId, state.scenarioId);
        assert.match(scenario.sourceQuestionId, /^Q\d{3}$/);
        assert.ok(scenario.steps.length >= 2);
        assert.equal(scenario.sourceAssignment.includes(`items/${scenario.sourceQuestionId}/`), true);
        assert.equal(scenario.promptLatex.length > 0, true);
      }
    }
  });

  await runTest("quadratic practice advances one action at a time and records an intervening mistake", () => {
    const { task, content } = taskContext("quadraticCompletion");
    let state = createTopicPracticeState(task, content, 0);

    const scenario = getTopicScenario("quadraticCompletion", state.scenarioId);
    let result = reduceTopicPracticeAction(task, content, state, submit(scenario.steps[0].id, scenario.steps[0].acceptedAnswers[0]));
    assert.equal(result.evaluation, "progress");
    assert.equal(result.phase, "answering");
    state = result.engineState;
    assert.equal(state.stepIndex, 1);

    result = reduceTopicPracticeAction(task, content, state, submit(scenario.steps[1].id, "999"));
    assert.equal(result.evaluation, "wrong");
    assert.equal(result.phase, "wrong_feedback");
    state = result.engineState;
    assert.equal(state.stepIndex, 1);
    assert.equal(state.hadWrongAttempt, true);

    result = reduceTopicPracticeAction(task, content, state, submit(scenario.steps[1].id, scenario.steps[1].acceptedAnswers[0]));
    state = result.engineState;
    assert.equal(state.stepIndex, 2);

    result = reduceTopicPracticeAction(task, content, state, submit(scenario.steps[2].id, scenario.steps[2].acceptedAnswers[0]));
    assert.equal(result.evaluation, "correct");
    assert.equal(result.phase, "correct_pause");
    assert.equal(result.engineState.status, "correct");
    assert.equal(result.engineState.firstTryCorrect, false);
  });

  await runTest("similarity families remain separate while learning and training share contracts", () => {
    const { task, content } = taskContext("reverseASimilarity");
    const practiceState = createTopicPracticeState(task, content, 0);
    const practiceRuntime = buildTopicPracticeRuntime(task, content, practiceState, "answering");
    assert.equal(practiceRuntime.instance.scene.topicWorkspace?.guidedMode, false);
    assert.equal(Object.values(practiceRuntime.instance.scene.topicWorkspace?.contracts || {}).some((step) => step.expectedLatex === ""), false);
    assert.deepEqual(getTopicScenario("reverseASimilarity", practiceState.scenarioId).steps.map((step) => step.primitive), ["mark-segments", "mark-ratio", "equation"]);

    const learningState: TopicPracticeEngineState = {
      ...practiceState,
      instanceId: "learn-reverseASimilarity",
      isLearningProjection: true,
    };
    const learningRuntime = buildTopicPracticeRuntime(task, content, learningState, "answering");
    assert.equal(learningRuntime.instance.scene.topicWorkspace?.guidedMode, true);
    assert.deepEqual(learningRuntime.instance.scene.topicWorkspace?.contracts, practiceRuntime.instance.scene.topicWorkspace?.contracts);
    for (const taskId of ["reverseASimilarity", "nestedSimilarity", "butterflySimilarity"] as const) {
      const lesson = getTopicLesson(taskId);
      assert.equal(lesson.examples.length, 1);
      assert.equal(lesson.sourceAssignments.length, 1);
      assert.ok(lesson.sourceAssignments[0].endsWith(".tex"));
    }
  });

  await runTest("parallel-line task uses the three-known-one-unknown bank and share-marking actions", () => {
    const scenario = getTopicScenario("parallelLineRatios", "three-known-fourth-parallel-2026-07-17:Q001");
    assert.equal(scenario.sourceBankTitle, "三角形一边平行线：三边求第四边");
    assert.match(scenario.promptLatex, /PA=3/);
    assert.match(scenario.promptLatex, /PC=6/);
    assert.match(scenario.promptLatex, /CD=8/);
    assert.equal(scenario.answerLatex, "$AB=4$。");
    assert.deepEqual(scenario.steps.map((step) => step.primitive), ["mark-segments", "mark-segments", "equation"]);
    assert.equal(scenario.steps[0].acceptedAnswers[0], "AP=3;CD=8;CP=6");
    assert.equal(scenario.steps[1].acceptedAnswers[0], "AB=1;CD=2");
    assert.equal(scenario.steps[2].acceptedAnswers[0], "AB=CD*AB*CD|4");
  });

  await runTest("auxiliary first item encodes the required four-click construction and staged labels", () => {
    const scenario = getTopicScenario("auxiliaryTwoRatios", "auxiliary-two-small-integer-ratios-50-2026-07-17:Q001");
    assert.deepEqual(scenario.steps.map((step) => step.primitive), ["construct-parallel", "mark-segments", "mark-segments", "input"]);
    assert.equal(scenario.steps[0].acceptedAnswers[0], "point:C|parallel:AD|carrier:B,E");
    assert.equal(scenario.steps[1].acceptedAnswers[0], "AP=1;CF=1");
    assert.equal(scenario.steps[2].acceptedAnswers[0], "DP=1/2");
  });
}

void main();
