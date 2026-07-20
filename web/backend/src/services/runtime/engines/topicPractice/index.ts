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
  isTopicAnswerAccepted,
  type TopicPracticeContentDefinition,
  type TopicScenarioRecord,
} from "../../../../../../shared/topicPractice";
import {
  defaultProblemReviewProjection,
  defineEnginePlugin,
  learningProjectionFromRuntime,
  type EngineActionResult,
} from "../../platform/engineTypes";
import { appError } from "../../platform/errors";
import { getTopicLesson, getTopicScenario, pickTopicScenario } from "./scenarioBank";
import type { TopicPracticeEngineState } from "./types";
import { capabilityIdsForTopicStep } from "../../../../../../shared/similarityLearningMap";

const ANSWER_TARGET = "topic-answer";

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

function currentScenario(state: TopicPracticeEngineState): TopicScenarioRecord {
  return getTopicScenario(state.taskId, state.scenarioId);
}

function currentStep(state: TopicPracticeEngineState) {
  return currentScenario(state).steps[state.stepIndex];
}

function buildServerState(state: TopicPracticeEngineState, phase: SessionPhase): ServerRuntimeState {
  const step = currentStep(state);
  return {
    phase,
    currentStepId: step.id,
    completedStepIds: state.completedStepIds,
    problemStatus: state.status,
    attempts: state.attempts,
  };
}

function buildScene(state: TopicPracticeEngineState): SceneSpec {
  const scenario = currentScenario(state);
  const step = currentStep(state);
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
      contracts: Object.fromEntries(scenario.steps.map((item, index) => [item.id, {
        ...item,
        presentation: {
          selectionMode: item.primitive === "mark-ratio" ? "pair" : item.primitive === "construct-parallel" ? "ordered" : "single",
          inputAnchor: item.primitive === "mark-segments" ? "segment-midpoint" : "workspace",
          retainCompletedMarks: true,
          allowLocalUndo: true,
          availableObjectIds: item.interaction?.availableSegments,
          capabilityIds: capabilityIdsForTopicStep(scenario.taskId, item.primitive, index),
        },
      }])),
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
  return {
    banner: content.guideTemplate.banner,
    hint: phase === "wrong_feedback" ? active.hintLatex : content.guideTemplate.hint,
    statusCopy: phase === "wrong_feedback"
      ? "当前动作还没对上。只修正这一步，不需要推翻前面已经完成的动作。"
      : `当前构型：${scenario.modelLabel} · 来源 ${scenario.sourceQuestionId}`,
    stepItems: scenario.steps.map((step, index) => ({
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
  return {
    instanceId: state.instanceId,
    taskId: task.id,
    engineKind: "topic-practice",
    contentId: content.id,
    prompt: scenario.promptLatex,
    scene: buildScene(state),
    flow: {
      steps: scenario.steps.map((step, index) => ({
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
): TopicPracticeEngineState {
  const scenario = pickTopicScenario(content.taskId, index);
  return {
    instanceId: crypto.randomUUID(),
    taskId: scenario.taskId,
    contentId: content.id,
    index,
    status: "pending",
    attempts: 0,
    firstTryCorrect: null,
    scenarioId: scenario.id,
    stepIndex: 0,
    completedStepIds: [],
    hadWrongAttempt: false,
    isLearningProjection: false,
  };
}

export function restoreTopicPracticeState(raw: unknown): TopicPracticeEngineState {
  return raw as TopicPracticeEngineState;
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

  const scenario = currentScenario(state);
  const step = currentStep(state);
  if (action.stepId && action.stepId !== step.id) {
    throw appError("ACTION_NOT_ALLOWED", `Step ${action.stepId} is not active`);
  }

  state.attempts += 1;
  const submitted = parseSubmittedInput(action);
  if (!isTopicAnswerAccepted(submitted, step.acceptedAnswers)) {
    state.status = "wrong";
    state.hadWrongAttempt = true;
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
  const isFinal = state.stepIndex === scenario.steps.length - 1;
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
  return {
    ...learningProjectionFromRuntime(task, buildTopicPracticeRuntime(task, content, learningState, "answering")),
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
