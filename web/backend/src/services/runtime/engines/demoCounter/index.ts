import type {
  DemoCounterContentDefinition,
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
  defaultProblemReviewProjection,
  defineEnginePlugin,
  learningProjectionFromRuntime,
  type EngineActionResult,
  type RuntimeEngineState,
} from "../../platform/engineTypes";
import { appError } from "../../platform/errors";
import type { ScenarioRecord } from "../../../../../../shared/scenarios";

export type DemoCounterEngineState = RuntimeEngineState & {
  taskId: "demoCounter";
  expectedAnswer: string;
};

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => vars[key] ?? "");
}

function buildRuntimeState(state: DemoCounterEngineState, phase: SessionPhase): ServerRuntimeState {
  return {
    phase,
    currentStepId: "demo-answer",
    completedStepIds: state.status === "correct" ? ["demo-answer"] : [],
    problemStatus: state.status,
    attempts: state.attempts,
  };
}

function makeCue(key: string, scope: FeedbackCue["scope"]): FeedbackCue {
  return { key, scope };
}

function buildFeedback(): FeedbackSpec {
  return {
    correct: [makeCue("correct", "global")],
    wrong: [makeCue("wrong", "global")],
    finish: [makeCue("finish", "global")],
  };
}

function buildFeedbackPacket(evaluation: RuntimeEvaluation): RuntimeFeedbackPacket {
  const feedback = buildFeedback();
  if (evaluation === "correct") {
    return { global: feedback.correct, workspace: feedback.correct, guide: [] };
  }
  if (evaluation === "wrong") {
    return { global: feedback.wrong, workspace: [], guide: feedback.wrong };
  }
  return { global: [], workspace: [], guide: [] };
}

function buildScene(state: DemoCounterEngineState): SceneSpec {
  return {
    sceneKind: "custom",
    entities: [
      {
        id: "demo-note",
        kind: "text",
        text: `演示口令长度：${state.expectedAnswer.length}`,
        variant: "note",
        x: 0,
        y: 0,
      },
    ],
    zones: [],
    anchors: [
      {
        id: "demo-answer",
        anchorKind: "value-input",
        x: 0,
        y: 0,
        placeholder: "请输入口令",
        label: "演示口令",
      },
    ],
    overlays: [],
  };
}

function buildGuide(content: DemoCounterContentDefinition, state: DemoCounterEngineState, phase: SessionPhase): GuideSpec {
  return {
    banner: content.guideTemplate.banner,
    hint: phase === "wrong_feedback" ? "口令不匹配，请再试一次。" : content.guideTemplate.hint,
    statusCopy:
      phase === "wrong_feedback"
        ? "请在左侧修正输入后重新提交。"
        : "这是一个最小的非 trig engine，用于验证平台层通用性。",
    stepItems: [
      {
        stepId: "demo-answer",
        title: "输入演示口令",
        status: state.status === "correct" ? "done" : "active",
        summary: state.status === "correct" ? "已完成演示提交。" : "在左侧输入指定口令并提交。",
      },
    ],
  };
}

function buildInstance(task: TaskDefinition, content: DemoCounterContentDefinition, state: DemoCounterEngineState, phase: SessionPhase): ExerciseInstance {
  return {
    instanceId: state.instanceId,
    taskId: task.id,
    engineKind: task.engineKind,
    contentId: content.id,
    prompt: renderTemplate(content.promptTemplate, { expectedAnswer: state.expectedAnswer }),
    scene: buildScene(state),
    flow: {
      steps: [
        {
          id: "demo-answer",
          title: "输入演示口令",
          goal: "验证非 trig engine 也能走通统一平台链路。",
          status: state.status === "correct" ? "done" : "active",
          allowedActions: [
            {
              type: "input",
              target: "demo-answer",
              valueKind: "text",
              presentation: { slots: [{ id: "demo-answer", label: "演示口令", placeholder: "请输入口令" }] },
            },
            { type: "clear", target: "demo-answer" },
            { type: "submit", stepId: "demo-answer" },
          ],
          submitMode: "explicit",
        },
      ],
      currentStepId: "demo-answer",
      completionPolicy: "whole-problem",
    },
    guide: buildGuide(content, state, phase),
    feedback: buildFeedback(),
  };
}

export function buildDemoCounterRuntime(
  task: TaskDefinition,
  content: DemoCounterContentDefinition,
  state: DemoCounterEngineState,
  phase: SessionPhase,
): ExerciseRuntimeSpec {
  return {
    instance: buildInstance(task, content, state, phase),
    runtimeState: buildRuntimeState(state, phase),
  };
}

export function createDemoCounterState(
  _task: TaskDefinition,
  content: DemoCounterContentDefinition,
  index: number,
  scenario?: ScenarioRecord,
): DemoCounterEngineState {
  return {
    instanceId: crypto.randomUUID(),
    taskId: "demoCounter",
    contentId: content.id,
    index,
    status: "pending",
    attempts: 0,
    firstTryCorrect: null,
    expectedAnswer: typeof scenario?.answerKey.expectedAnswer === "string"
      ? scenario.answerKey.expectedAnswer
      : content.expectedAnswer,
  };
}

export function restoreDemoCounterState(raw: unknown): DemoCounterEngineState {
  return raw as DemoCounterEngineState;
}

function parseInput(action: RuntimeActionEvent): string {
  if (action.type !== "submit") return "";
  if (!action.value) return "";

  try {
    const parsed = JSON.parse(action.value) as { inputs?: Record<string, string> };
    return parsed.inputs?.["demo-answer"]?.trim() || "";
  } catch (_error) {
    throw appError("ANSWER_INVALID", "Submit payload is invalid JSON");
  }
}

export function reduceDemoCounterAction(
  task: TaskDefinition,
  content: DemoCounterContentDefinition,
  currentState: DemoCounterEngineState,
  action: RuntimeActionEvent,
): EngineActionResult<DemoCounterEngineState> {
  const state = JSON.parse(JSON.stringify(currentState)) as DemoCounterEngineState;

  if (action.type === "clear") {
    const runtime = buildDemoCounterRuntime(task, content, state, "answering");
    return {
      accepted: true,
      evaluation: "progress",
      phase: "answering",
      engineState: state,
      runtime,
      feedback: buildFeedbackPacket("progress"),
    };
  }

  if (action.type !== "submit") {
    throw appError("ACTION_NOT_ALLOWED", "Only clear and submit actions are supported");
  }

  state.attempts += 1;
  const submitted = parseInput(action);

  let phase: SessionPhase = "wrong_feedback";
  let evaluation: RuntimeEvaluation = "wrong";
  if (submitted.toLowerCase() === state.expectedAnswer.toLowerCase()) {
    state.status = "correct";
    if (state.firstTryCorrect === null) state.firstTryCorrect = state.attempts === 1;
    phase = "correct_pause";
    evaluation = "correct";
  } else {
    state.status = "wrong";
  }

  const runtime = buildDemoCounterRuntime(task, content, state, phase);
  return {
    accepted: true,
    evaluation,
    phase,
    engineState: state,
    runtime,
    feedback: buildFeedbackPacket(evaluation),
  };
}

function buildDemoLearningProjection(
  task: TaskDefinition,
  content: DemoCounterContentDefinition,
  state: DemoCounterEngineState,
): LearningProjectionSpec {
  const learningState = { ...state, instanceId: `learn-${task.id}` };
  return learningProjectionFromRuntime(task, buildDemoCounterRuntime(task, content, learningState, "answering"));
}

function buildDemoProblemReviewProjection(
  _task: TaskDefinition,
  _content: DemoCounterContentDefinition,
  state: DemoCounterEngineState,
  instance: ExerciseInstance,
  attempts: ResultAttemptReview[],
): ProblemReviewProjection {
  return defaultProblemReviewProjection(instance, attempts, {
    inputs: { "demo-answer": state.expectedAnswer },
    display: state.expectedAnswer,
  });
}

export const demoCounterEnginePlugin = defineEnginePlugin({
  createState: createDemoCounterState,
  restoreState: restoreDemoCounterState,
  buildRuntime: buildDemoCounterRuntime,
  buildLearningProjection: buildDemoLearningProjection,
  buildProblemReviewProjection: buildDemoProblemReviewProjection,
  reduceAction: reduceDemoCounterAction,
});
