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
import { getTopicLesson, getTopicScenario, pickTopicScenarioRecord, resolveTopicScenarioRecord } from "../engines/topicPractice/scenarioBank";
import type { TopicPracticeEngineState } from "../engines/topicPractice/types";
import { resolveContentDefinition } from "../platform/contentRegistry";
import { submitLearningAction } from "../../learningService";

const TASK_IDS: TopicPracticeTaskId[] = [
  "quadraticCompletion",
  "parallelLineRatios",
  "auxiliaryTwoRatios",
  "reverseASimilarity",
  "nestedSimilarity",
  "butterflySimilarity",
  "reverseAFourSimilarity",
];

const SCENARIO_COUNTS: Record<TopicPracticeTaskId, number> = {
  quadraticCompletion: 30,
  parallelLineRatios: 50,
  auxiliaryTwoRatios: 50,
  reverseASimilarity: 50,
  nestedSimilarity: 50,
  butterflySimilarity: 50,
  reverseAFourSimilarity: 4,
};

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
  await runTest("catalog exposes seven explanation and bank backed topic tasks", () => {
    const treeTaskIds = getTaskTree().grades.flatMap((grade) =>
      grade.chapters.flatMap((chapter) => chapter.tasks.map((task) => task.id)),
    );
    for (const taskId of TASK_IDS) {
      const { task, content } = taskContext(taskId);
      assert.equal(task.engineKind, "topic-practice");
      assert.equal(content.taskId, taskId);
      assert.match(content.sourceExplanation, /^artifacts\//);
      assert.match(content.sourceExplanation, /\.tex$/);
      assert.ok(content.sourceBanks.every((source) => source.includes("artifacts/题库/")));
      assert.ok(treeTaskIds.includes(taskId));
    }
  });

  await runTest("each topic rotates through its distinct ready-bank scenarios", () => {
    for (const taskId of TASK_IDS) {
      const { task, content } = taskContext(taskId);
      const states = Array.from({ length: 5 }, (_, index) => createTopicPracticeState(task, content, index));
      assert.equal(new Set(states.map((state) => state.scenarioId)).size, Math.min(5, SCENARIO_COUNTS[taskId]));
      for (const state of states) {
        const scenario = getTopicScenario(taskId, state.scenarioId);
        assert.match(scenario.sourceQuestionId, /^Q\d{3}$/);
        assert.ok(scenario.steps.length >= 2);
        assert.equal(scenario.sourceAssignment.includes(`items/${scenario.sourceQuestionId}/`), true);
        assert.equal(scenario.promptLatex.length > 0, true);
      }
    }
  });

  await runTest("topic bundle stores approved v2 records and runtime projections hide answer keys", () => {
    for (const taskId of TASK_IDS) {
      const { task, content } = taskContext(taskId);
      const record = pickTopicScenarioRecord(taskId, 0);
      assert.equal(record.taskId, task.id);
      assert.equal(record.engineKind, "topic-practice");
      assert.equal(record.contentId, content.id);
      assert.equal(record.status, "approved");
      assert.equal(record.validation.passed, true);
      assert.equal(record.validation.scenarioId, record.id);
      assert.ok(Object.keys(record.answerKey.steps).length >= 2);
      assert.ok(record.promptData.steps.every((step) => !("acceptedAnswers" in step)));

      const state = createTopicPracticeState(task, content, 0, record);
      assert.equal(state.scenarioId, record.id);
      const runtime = buildTopicPracticeRuntime(task, content, state, "answering");
      const serialized = JSON.stringify(runtime.instance.scene.topicWorkspace?.contracts || {});
      assert.equal(serialized.includes("acceptedAnswers"), false);
      assert.equal(serialized.includes("expectedLatex"), false);
    }
  });

  await runTest("interactive Learn evaluates on the backend without returning answer truth", () => {
    const scenario = getTopicScenario("parallelLineRatios", "three-known-fourth-parallel-2026-07-17:Q001");
    const step = scenario.steps[0];
    const wrong = submitLearningAction("parallelLineRatios", step.id, "AC=9;AP=9;CD=9");
    const correct = submitLearningAction("parallelLineRatios", step.id, step.acceptedAnswers[0]);
    assert.deepEqual(wrong, { accepted: true, evaluation: "wrong" });
    assert.deepEqual(correct, { accepted: true, evaluation: "correct" });
    assert.equal(JSON.stringify(correct).includes("acceptedAnswers"), false);
  });

  await runTest("selected scenario snapshots stay pinned across restore", () => {
    const { task, content } = taskContext("quadraticCompletion");
    const source = pickTopicScenarioRecord("quadraticCompletion", 0);
    const selected = {
      ...source,
      id: `${source.id}:snapshot-only`,
      validation: { ...source.validation, scenarioId: `${source.id}:snapshot-only` },
    };
    const created = createTopicPracticeState(task, content, 3, selected);
    assert.equal(created.scenarioId, selected.id);
    assert.equal(created.scenarioVersion, selected.version);

    const persistedWithoutInlineSnapshot = { ...created, pinnedScenario: undefined };
    const restored = restoreTopicPracticeState(persistedWithoutInlineSnapshot, selected);
    const runtime = buildTopicPracticeRuntime(task, content, restored, "answering");
    assert.equal(runtime.instance.prompt, selected.promptData.promptLatex);
    assert.equal(restored.pinnedScenario?.id, selected.id);
  });

  await runTest("all migrated topics smoke first, middle, and last approved records", () => {
    for (const taskId of TASK_IDS) {
      const { task, content } = taskContext(taskId);
      for (const index of [0, Math.floor(SCENARIO_COUNTS[taskId] / 2), SCENARIO_COUNTS[taskId] - 1]) {
        const record = pickTopicScenarioRecord(taskId, index);
        const scenario = resolveTopicScenarioRecord(record);
        let state = createTopicPracticeState(task, content, index, record);
        const wrong = reduceTopicPracticeAction(task, content, state, submit(scenario.steps[0].id, "__wrong__"));
        assert.equal(wrong.evaluation, "wrong", `${taskId}#${index} exposes a diagnosis branch`);
        state = wrong.engineState;
        while (state.status !== "correct") {
          const activeStep = scenario.steps[state.stepIndex];
          state = reduceTopicPracticeAction(
            task,
            content,
            state,
            submit(activeStep.id, activeStep.acceptedAnswers[0]),
          ).engineState;
        }
        const restored = restoreTopicPracticeState(JSON.parse(JSON.stringify(state)), record);
        assert.equal(restored.status, "correct");
        assert.equal(restored.scenarioId, record.id);
        assert.equal(restored.scenarioVersion, record.version);
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

  await runTest("unmappable legacy topic state expires instead of silently changing scenario", () => {
    const { task, content } = taskContext("nestedSimilarity");
    const legacy = {
      ...createTopicPracticeState(task, content, 0),
      scenarioId: "retired:missing",
      scenarioVersion: undefined,
      pinnedScenario: undefined,
    };
    assert.throws(
      () => restoreTopicPracticeState(legacy),
      (error: any) => error?.body?.error?.code === "LEGACY_SESSION_EXPIRED",
    );
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
