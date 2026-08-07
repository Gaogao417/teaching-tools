import type {
  ExerciseInstance,
  ExerciseRuntimeSpec,
  FeedbackCue,
  FeedbackSpec,
  GuideSpec,
  LearningProjectionSpec,
  ProblemReviewProjection,
  ResultAttemptReview,
  RuntimeActionEvent,
  RuntimeEvaluation,
  RuntimeFeedbackPacket,
  SceneSpec,
  ServerRuntimeState,
  SessionPhase,
  TaskDefinition,
} from "../../../../../../shared/contracts";
import {
  assertNeverPrimitive,
  isTopicAnswerAccepted,
  type TopicActionPrimitive,
  type TopicPracticeContentDefinition,
  type TopicResolvedScenario,
  type TopicScenarioRecord,
} from "../../../../../../shared/topicPractice";
import {
  defaultProblemReviewProjection,
  defineEnginePlugin,
  learningProjectionFromRuntime,
  type EngineActionResult,
} from "../../platform/engineTypes";
import { appError } from "../../platform/errors";
import { getTopicLesson, getTopicScenario, pickTopicScenario, resolveTopicScenarioRecord } from "./scenarioBank";
import type { TopicPracticeEngineState } from "./types";
import { capabilityIdsForTopicStep } from "../../../../../../shared/similarityLearningMap";
import type { ScenarioRecord } from "../../../../../../shared/scenarios";

const ANSWER_TARGET = "topic-answer";

function selectionModeForPrimitive(primitive: TopicActionPrimitive): "single" | "pair" | "ordered" {
  switch (primitive) {
    case "mark-ratio":
    case "ratio-scratch":
      return "pair";
    case "construct-parallel":
    case "convert-collinear":
      return "ordered";
    case "select":
    case "input":
    case "mark-segments":
    case "equation":
      return "single";
    default:
      return assertNeverPrimitive(primitive);
  }
}

function inputAnchorForPrimitive(primitive: TopicActionPrimitive): "segment-midpoint" | "workspace" {
  switch (primitive) {
    case "mark-segments":
      return "segment-midpoint";
    case "select":
    case "input":
    case "construct-parallel":
    case "mark-ratio":
    case "ratio-scratch":
    case "convert-collinear":
    case "equation":
      return "workspace";
    default:
      return assertNeverPrimitive(primitive);
  }
}

function cue(key: string, scope: FeedbackCue["scope"]): FeedbackCue {
  return { key, scope };
}

function feedbackSpec(): FeedbackSpec {
  return {
    correct: [cue("correct", "global")],
    wrong: [cue("wrong", "guide")],
    finish: [cue("finish", "global")],
  };
}

function feedbackPacket(evaluation: RuntimeEvaluation, finalStep: boolean): RuntimeFeedbackPacket {
  if (evaluation === "wrong") {
    return { global: [cue("wrong", "global")], workspace: [], guide: [cue("wrong", "guide")] };
  }
  if (evaluation === "correct") {
    const key = finalStep ? "finish" : "correct";
    return { global: [cue(key, "global")], workspace: [cue("correct", "workspace")], guide: [] };
  }
  return { global: [], workspace: [cue("correct", "workspace")], guide: [] };
}

function currentScenario(state: TopicPracticeEngineState): TopicResolvedScenario {
  return state.pinnedScenario
    ? resolveTopicScenarioRecord(state.pinnedScenario)
    : getTopicScenario(state.taskId, state.scenarioId);
}

function runtimeStepEntries(state: TopicPracticeEngineState) {
  const scenario = currentScenario(state);
  return scenario.steps
    .map((step, sourceIndex) => ({ step, sourceIndex }))
    .filter(({ step }) => !(
      state.isLearningProjection
      && state.taskId === "parallelLineRatios"
      && step.primitive === "ratio-scratch"
    ))
    .filter(({ step, sourceIndex }) => {
      const capabilityIds = capabilityIdsForTopicStep(scenario.taskId, step.primitive, sourceIndex);
      if (state.remediationCapabilityId) return capabilityIds.includes(state.remediationCapabilityId);
      if (state.allowedCapabilityIds?.length) return capabilityIds.some((item) => state.allowedCapabilityIds?.includes(item));
      return true;
    });
}

function currentStep(state: TopicPracticeEngineState) {
  return runtimeStepEntries(state)[state.stepIndex]?.step;
}

function buildServerState(state: TopicPracticeEngineState, phase: SessionPhase): ServerRuntimeState {
  const step = currentStep(state);
  return {
    phase,
    currentStepId: step.id,
    completedStepIds: state.completedStepIds,
    problemStatus: state.status,
    attempts: state.attempts,
    wrongObjectIds: state.wrongObjectIds,
  };
}

function buildScene(state: TopicPracticeEngineState): SceneSpec {
  const scenario = currentScenario(state);
  const step = currentStep(state);
  const entries = runtimeStepEntries(state);
  return {
    sceneKind: "custom",
    entities: [],
    zones: [],
    anchors: [{
      id: ANSWER_TARGET,
      anchorKind: "value-input",
      x: 0,
      y: 0,
      label: step.title,
      placeholder: step.primitive === "input" ? "写出本步结果" : "选择一个数学动作",
    }],
    overlays: [],
    topicWorkspace: {
      topicLabel: scenario.taskId,
      modelLabel: scenario.modelLabel,
      sourceBank: scenario.sourceBankTitle,
      sourceQuestionId: scenario.sourceQuestionId,
      sourceAssignment: scenario.sourceAssignment,
      promptLatex: scenario.promptLatex,
      promptDiagramAsset: scenario.promptDiagramAsset,
      promptGeometry: scenario.promptGeometry,
      skillTags: scenario.skillTags,
      activeStepId: step.id,
      completedStepIds: state.completedStepIds,
      contracts: Object.fromEntries(entries.map(({ step: item, sourceIndex }) => {
        const { acceptedAnswers: _acceptedAnswers, expectedLatex: _expectedLatex, ...projection } = item;
        return [item.id, {
          ...projection,
          presentation: {
            selectionMode: selectionModeForPrimitive(item.primitive),
            inputAnchor: inputAnchorForPrimitive(item.primitive),
            retainCompletedMarks: true,
            allowLocalUndo: true,
            availableObjectIds: item.interaction?.availableSegments,
            capabilityIds: capabilityIdsForTopicStep(scenario.taskId, item.primitive, sourceIndex),
            requiredInputCount: item.interaction?.expectedLabels?.length || item.interaction?.expectedOrder?.length,
            completedLabels: state.completedStepIds.includes(item.id) ? item.interaction?.expectedLabels : undefined,
            completedObjectIds: state.completedStepIds.includes(item.id) ? item.interaction?.expectedOrder : undefined,
            ...item.presentation,
          },
        }];
      })),
      guidedMode: state.isLearningProjection,
    },
  };
}

function buildGuide(
  content: TopicPracticeContentDefinition,
  state: TopicPracticeEngineState,
  phase: SessionPhase,
): GuideSpec {
  const scenario = currentScenario(state);
  const active = currentStep(state);
  const entries = runtimeStepEntries(state);
  return {
    banner: content.guideTemplate.banner,
    hint: phase === "wrong_feedback" ? active.hintLatex : content.guideTemplate.hint,
    statusCopy: phase === "wrong_feedback"
      ? "当前动作还没对上。只修正这一步，不需要推翻前面已经完成的动作。"
      : `当前构型：${scenario.modelLabel} · 来源 ${scenario.sourceQuestionId}`,
    stepItems: entries.map(({ step }, index) => ({
      stepId: step.id,
      title: step.title,
      status: state.completedStepIds.includes(step.id) ? "done" : index === state.stepIndex ? "active" : "locked",
      summary: step.goal,
    })),
  };
}

function buildInstance(
  task: TaskDefinition,
  content: TopicPracticeContentDefinition,
  state: TopicPracticeEngineState,
  phase: SessionPhase,
): ExerciseInstance {
  const scenario = currentScenario(state);
  const entries = runtimeStepEntries(state);
  return {
    instanceId: state.instanceId,
    taskId: task.id,
    engineKind: "topic-practice",
    contentId: content.id,
    prompt: scenario.promptLatex,
    scene: buildScene(state),
    flow: {
      steps: entries.map(({ step }, index) => ({
        id: step.id,
        title: step.title,
        goal: step.goal,
        status: state.completedStepIds.includes(step.id) ? "done" : index === state.stepIndex ? "active" : "locked",
        allowedActions: [
          {
            type: "input" as const,
            target: ANSWER_TARGET,
            valueKind: "text" as const,
            presentation: {
              slots: [{ id: ANSWER_TARGET, label: step.title, placeholder: step.primitive === "input" ? "写出本步结果" : "请选择" }],
            },
          },
          { type: "clear" as const, target: ANSWER_TARGET },
          { type: "submit" as const, stepId: step.id },
        ],
        submitMode: "explicit" as const,
      })),
      currentStepId: currentStep(state).id,
      completionPolicy: "multi-step",
    },
    guide: buildGuide(content, state, phase),
    feedback: feedbackSpec(),
  };
}

export function buildTopicPracticeRuntime(
  task: TaskDefinition,
  content: TopicPracticeContentDefinition,
  state: TopicPracticeEngineState,
  phase: SessionPhase,
): ExerciseRuntimeSpec {
  return {
    instance: buildInstance(task, content, state, phase),
    runtimeState: buildServerState(state, phase),
  };
}

export function createTopicPracticeState(
  task: TaskDefinition,
  content: TopicPracticeContentDefinition,
  index: number,
  selectedScenario?: ScenarioRecord,
): TopicPracticeEngineState {
  if (selectedScenario && (
    selectedScenario.taskId !== task.id
    || selectedScenario.engineKind !== "topic-practice"
    || selectedScenario.contentId !== content.id
    || selectedScenario.status !== "approved"
  )) {
    throw appError("RUNTIME_CONTRACT_INVALID", `Scenario ${selectedScenario.id} does not match ${task.id}/${content.id}`);
  }
  const pinnedScenario = selectedScenario as TopicScenarioRecord | undefined;
  const scenario = pinnedScenario
    ? resolveTopicScenarioRecord(pinnedScenario)
    : pickTopicScenario(content.taskId, index);
  return {
    instanceId: crypto.randomUUID(),
    taskId: scenario.taskId,
    contentId: content.id,
    index,
    status: "pending",
    attempts: 0,
    firstTryCorrect: null,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    pinnedScenario,
    stepIndex: 0,
    completedStepIds: [],
    hadWrongAttempt: false,
    isLearningProjection: false,
    wrongObjectIds: [],
    interactionVersion: 2,
  };
}

export function restoreTopicPracticeState(raw: unknown, selectedScenario?: ScenarioRecord): TopicPracticeEngineState {
  const state = raw as TopicPracticeEngineState;
  const pinnedScenario = selectedScenario as TopicScenarioRecord | undefined;
  let scenarioVersion = pinnedScenario?.version || state.scenarioVersion;
  if (!scenarioVersion) {
    try {
      scenarioVersion = getTopicScenario(state.taskId, state.scenarioId).version;
    } catch {
      throw appError("LEGACY_SESSION_EXPIRED", `Legacy topic scenario ${state.scenarioId} is no longer available`, 409);
    }
  }
  const restored = {
    ...state,
    pinnedScenario: pinnedScenario || state.pinnedScenario,
    scenarioVersion,
    wrongObjectIds: state.wrongObjectIds || [],
    interactionVersion: 2,
  };
  if (!state.interactionVersion && restored.taskId === "nestedSimilarity") {
    const entries = runtimeStepEntries(restored);
    restored.stepIndex = restored.status === "correct"
      ? entries.length - 1
      : Math.max(0, entries.findIndex(({ step }) => !restored.completedStepIds.includes(step.id)));
  }
  return restored;
}

function parseDelimitedObjects(value: string, delimiter = ","): string[] {
  return value.split(delimiter).map((item) => item.trim()).filter(Boolean);
}

function wrongObjectsForSubmission(submitted: string, step: TopicResolvedScenario["steps"][number]): string[] {
  const expected = step.acceptedAnswers[0] || "";
  const primitive: TopicActionPrimitive = step.primitive;
  switch (primitive) {
    case "select":
    case "input":
      // Whole-submission verdicts; per-object diagnosis does not apply.
      return [];
    case "mark-segments": {
      const expectedLabels = new Map(parseDelimitedObjects(expected, ";").map((part) => {
        const separator = part.indexOf("=");
        return [part.slice(0, separator), part.slice(separator + 1)] as const;
      }));
      return parseDelimitedObjects(submitted, ";").flatMap((part) => {
        const separator = part.indexOf("=");
        const objectId = part.slice(0, separator);
        const value = part.slice(separator + 1);
        return expectedLabels.get(objectId) === value ? [] : [objectId];
      });
    }
    case "mark-ratio":
    case "convert-collinear": {
      const selected = parseDelimitedObjects(submitted);
      const expectedOrder = step.interaction?.expectedOrder || parseDelimitedObjects(expected);
      return [...new Set(selected.filter((objectId, index) => objectId !== expectedOrder[index]))];
    }
    case "ratio-scratch": {
      const [submittedObjects = "", submittedRatio = ""] = submitted.split("|");
      const selected = parseDelimitedObjects(submittedObjects);
      const expectedOrder = step.interaction?.expectedOrder || [];
      const wrongObjects = selected.filter((objectId, index) => objectId !== expectedOrder[index]);
      const expectedRatio = step.interaction?.ratioScratch;
      const values = parseDelimitedObjects(submittedRatio);
      if (expectedRatio && (values[0] !== expectedRatio.simplifiedFirstLatex || values[1] !== expectedRatio.simplifiedSecondLatex)) {
        wrongObjects.push("最简整数比");
      }
      return [...new Set(wrongObjects)];
    }
    case "construct-parallel": {
      const parts = Object.fromEntries(submitted.split("|").filter(Boolean).map((part) => part.split(":")));
      const construction = step.interaction?.construction;
      if (!construction) return [];
      return [
        parts.point !== construction.throughPoint ? parts.point : undefined,
        parts.parallel !== construction.parallelSegment ? parts.parallel : undefined,
        ...parseDelimitedObjects(parts.carrier || "").filter((point, index) => point !== construction.carrierPoints[index]),
      ].filter((value): value is string => Boolean(value));
    }
    case "equation": {
      const [submittedEquation = "", submittedResult = ""] = submitted.split("|");
      const selected = submittedEquation.split("=")[1]?.split("*").filter(Boolean) || [];
      const expectedOrder = step.interaction?.expectedOrder || [];
      const wrongObjects = selected.filter((objectId, index) => objectId !== expectedOrder[index]);
      const expectedResult = expected.split("|")[1];
      if (submittedResult && expectedResult && submittedResult !== expectedResult) wrongObjects.push("计算结果");
      return [...new Set(wrongObjects)];
    }
    default:
      return assertNeverPrimitive(primitive);
  }
}

function parseSubmittedInput(action: RuntimeActionEvent): string {
  if (!action.value) return "";
  try {
    const payload = JSON.parse(action.value) as { inputs?: Record<string, string> };
    return payload.inputs?.[ANSWER_TARGET]?.trim() || "";
  } catch {
    throw appError("ANSWER_INVALID", "Submit payload is invalid JSON");
  }
}

export function reduceTopicPracticeAction(
  task: TaskDefinition,
  content: TopicPracticeContentDefinition,
  currentState: TopicPracticeEngineState,
  action: RuntimeActionEvent,
): EngineActionResult<TopicPracticeEngineState> {
  const state = JSON.parse(JSON.stringify(currentState)) as TopicPracticeEngineState;

  if (action.type === "clear") {
    return {
      accepted: true,
      evaluation: "progress",
      phase: "answering",
      engineState: state,
      runtime: buildTopicPracticeRuntime(task, content, state, "answering"),
      feedback: feedbackPacket("progress", false),
    };
  }

  if (action.type !== "submit") {
    throw appError("ACTION_NOT_ALLOWED", "Only clear and submit actions are supported");
  }

  const step = currentStep(state);
  if (action.stepId && action.stepId !== step.id) {
    throw appError("ACTION_NOT_ALLOWED", `Step ${action.stepId} is not active`);
  }

  state.attempts += 1;
  const submitted = parseSubmittedInput(action);
  if (!isTopicAnswerAccepted(submitted, step.acceptedAnswers)) {
    state.status = "wrong";
    state.hadWrongAttempt = true;
    state.wrongObjectIds = wrongObjectsForSubmission(submitted, step);
    return {
      accepted: true,
      evaluation: "wrong",
      phase: "wrong_feedback",
      engineState: state,
      runtime: buildTopicPracticeRuntime(task, content, state, "wrong_feedback"),
      feedback: feedbackPacket("wrong", false),
    };
  }

  state.completedStepIds.push(step.id);
  state.wrongObjectIds = [];
  const isFinal = state.stepIndex === runtimeStepEntries(state).length - 1;
  if (isFinal) {
    state.status = "correct";
    state.firstTryCorrect = !state.hadWrongAttempt;
  } else {
    state.status = "pending";
    state.stepIndex += 1;
  }

  const evaluation: RuntimeEvaluation = isFinal ? "correct" : "progress";
  const phase: SessionPhase = isFinal ? "correct_pause" : "answering";
  return {
    accepted: true,
    evaluation,
    phase,
    engineState: state,
    runtime: buildTopicPracticeRuntime(task, content, state, phase),
    feedback: feedbackPacket(evaluation, isFinal),
  };
}

function buildLearningProjection(
  task: TaskDefinition,
  content: TopicPracticeContentDefinition,
  state: TopicPracticeEngineState,
): LearningProjectionSpec {
  const learningState = {
    ...state,
    instanceId: `learn-${task.id}`,
    isLearningProjection: true,
  };
  const runtime = buildTopicPracticeRuntime(task, content, learningState, "answering");
  const runtimeAlignedTask = {
    ...task,
    steps: runtime.instance.flow.steps.map((step) => step.goal),
  };
  return {
    ...learningProjectionFromRuntime(runtimeAlignedTask, runtime),
    objective: getTopicLesson(content.taskId).objective,
    topicLesson: getTopicLesson(content.taskId),
  };
}

function buildProblemReview(
  _task: TaskDefinition,
  _content: TopicPracticeContentDefinition,
  state: TopicPracticeEngineState,
  instance: ExerciseInstance,
  attempts: ResultAttemptReview[],
): ProblemReviewProjection {
  const scenario = currentScenario(state);
  const final = scenario.steps[scenario.steps.length - 1];
  return defaultProblemReviewProjection(instance, attempts, {
    inputs: { [ANSWER_TARGET]: final.expectedLatex },
    display: final.expectedLatex,
  });
}

export const topicPracticeEnginePlugin = defineEnginePlugin({
  createState: createTopicPracticeState,
  restoreState: restoreTopicPracticeState,
  buildRuntime: buildTopicPracticeRuntime,
  buildLearningProjection,
  buildProblemReviewProjection: buildProblemReview,
  reduceAction: reduceTopicPracticeAction,
});
