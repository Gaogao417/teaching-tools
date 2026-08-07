import assert from "node:assert/strict";

import type { RuntimeActionEvent, TaskDefinition } from "../../../../../shared/contracts";
import type { TopicPracticeContentDefinition, TopicPracticeTaskId } from "../../../../../shared/topicPractice";
import { getTaskDefinition, getTaskTree } from "../../tasks/catalogService";
import {
  buildTopicPracticeRuntime,
  createTopicPracticeState,
  reduceTopicPracticeAction,
  restoreTopicPracticeState,
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

  await runTest("parallel-line task uses paper-like ratio scratch and a rigorous coach explanation", () => {
    const scenario = getTopicScenario("parallelLineRatios", "three-known-fourth-parallel-2026-07-17:Q001");
    assert.equal(scenario.sourceBankTitle, "三角形一边平行线：三边求第四边");
    assert.match(scenario.promptLatex, /PA=3/);
    assert.match(scenario.promptLatex, /PC=6/);
    assert.match(scenario.promptLatex, /CD=8/);
    assert.equal(scenario.answerLatex, "$AB=4$。");
    assert.deepEqual(scenario.steps.map((step) => step.primitive), ["mark-segments", "ratio-scratch", "equation"]);
    assert.equal(scenario.steps[0].acceptedAnswers[0], "AC=3;AP=3;CD=8");
    assert.deepEqual(scenario.steps[0].interaction?.expectedLabels?.map((label) => label.displayName), ["PA", "AC", "CD"]);
    assert.equal(scenario.steps[0].presentation?.autoFocusSequence, true);
    assert.equal(scenario.steps[0].presentation?.autoSubmitOnComplete, true);
    assert.equal(scenario.steps[1].acceptedAnswers[0], "AP,CP|1,2");
    assert.deepEqual(scenario.steps[1].interaction?.ratioScratch, {
      content: "$\\dfrac{PA}{PC}=\\dfrac{3}{6}=\\dfrac{1}{2}$。",
      firstDisplayName: "PA",
      firstSegmentId: "AP",
      secondDisplayName: "PC",
      secondSegmentId: "CP",
      firstValueLatex: "3",
      secondValueLatex: "6",
      simplifiedFirstLatex: "1",
      simplifiedSecondLatex: "2",
    });
    assert.equal(scenario.steps[2].acceptedAnswers[0], "AB=CD*1*2|4");
    assert.match(scenario.steps[2].coach?.explanationLatex || "", /两个三角形相似/);
    assert.match(scenario.steps[2].coach?.explanationLatex || "", /AB 是 1 份，CD 是 2 份/);
    assert.equal(scenario.steps[2].presentation?.prefillKnownFactor, true);

    const { task, content } = taskContext("parallelLineRatios");
    const practiceState = createTopicPracticeState(task, content, 0);
    const learningState: TopicPracticeEngineState = {
      ...practiceState,
      scenarioId: scenario.id,
      instanceId: "learn-parallelLineRatios",
      isLearningProjection: true,
    };
    const learningRuntime = buildTopicPracticeRuntime(task, content, learningState, "answering");
    assert.deepEqual(
      Object.values(learningRuntime.instance.scene.topicWorkspace?.contracts || {}).map((step) => step.primitive),
      ["mark-segments", "equation"],
    );
    assert.equal(learningRuntime.instance.flow.steps.length, 2);
  });

  await runTest("parallel-line scratch diagnoses an unreduced ratio without losing the current step", () => {
    const { task, content } = taskContext("parallelLineRatios");
    const scenarioId = "three-known-fourth-parallel-2026-07-17:Q001";
    const scenario = getTopicScenario("parallelLineRatios", scenarioId);
    const initial = createTopicPracticeState(task, content, 0);
    const state: TopicPracticeEngineState = {
      ...initial,
      scenarioId,
      stepIndex: 1,
      completedStepIds: [scenario.steps[0].id],
    };
    const wrong = reduceTopicPracticeAction(task, content, state, submit(scenario.steps[1].id, "AP,CP|2,4"));
    assert.equal(wrong.evaluation, "wrong");
    assert.equal(wrong.engineState.stepIndex, 1);
    assert.deepEqual(wrong.runtime.runtimeState.wrongObjectIds, ["最简整数比"]);

    const corrected = reduceTopicPracticeAction(task, content, wrong.engineState, submit(scenario.steps[1].id, "AP,CP|1,2"));
    assert.equal(corrected.evaluation, "progress");
    assert.equal(corrected.engineState.stepIndex, 2);
  });

  await runTest("auxiliary first item encodes the required four-click construction and staged labels", () => {
    const scenario = getTopicScenario("auxiliaryTwoRatios", "auxiliary-two-small-integer-ratios-50-2026-07-17:Q001");
    assert.deepEqual(scenario.steps.map((step) => step.primitive), ["construct-parallel", "mark-segments", "mark-segments", "input"]);
    assert.equal(scenario.steps[0].acceptedAnswers[0], "point:C|parallel:AD|carrier:B,E");
    assert.equal(scenario.steps[1].acceptedAnswers[0], "AP=1;CF=1");
    assert.equal(scenario.steps[2].acceptedAnswers[0], "DP=1/2");
  });

  await runTest("nested similarity inserts a dedicated collinear conversion action", () => {
    const scenario = getTopicScenario("nestedSimilarity", "nested-similarity-2026-07-16:Q001");
    assert.deepEqual(scenario.steps.map((step) => step.primitive), ["mark-segments", "convert-collinear", "mark-ratio", "equation"]);
    assert.equal(scenario.steps[1].acceptedAnswers[0], "AC,AD,CD");
    assert.equal(scenario.steps[1].interaction?.collinear?.relationLatex, "AC=AD+DC");
  });

  await runTest("legacy nested sessions resume at the newly required conversion action", () => {
    const { task, content } = taskContext("nestedSimilarity");
    const state = createTopicPracticeState(task, content, 0);
    const scenario = getTopicScenario("nestedSimilarity", state.scenarioId);
    const legacyState = { ...state, stepIndex: 1, completedStepIds: [scenario.steps[0].id] } as Partial<TopicPracticeEngineState>;
    delete legacyState.interactionVersion;
    const restored = restoreTopicPracticeState(legacyState);
    const runtime = buildTopicPracticeRuntime(task, content, restored, "answering");
    assert.equal(runtime.instance.scene.topicWorkspace?.contracts[runtime.runtimeState.currentStepId].primitive, "convert-collinear");
  });

  await runTest("topic evaluation identifies only the incorrect geometry object", () => {
    const { task, content } = taskContext("reverseASimilarity");
    const state = createTopicPracticeState(task, content, 0);
    const scenario = getTopicScenario("reverseASimilarity", state.scenarioId);
    const result = reduceTopicPracticeAction(task, content, state, submit(
      scenario.steps[0].id,
      "AB=2\\sqrt{6};AP=wrong;CD=8",
    ));
    assert.equal(result.evaluation, "wrong");
    assert.deepEqual(result.runtime.runtimeState.wrongObjectIds, ["AP"]);
  });
}

void main();
