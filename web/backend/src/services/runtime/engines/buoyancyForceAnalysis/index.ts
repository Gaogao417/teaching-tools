import type { BuoyancyContentDefinition, BuoyancyStepKey } from "../../../../../../shared/buoyancyForceAnalysis";
import type {
  ExerciseInstance,
  LearningProjectionSpec,
  ProblemReviewProjection,
  ResultAttemptReview,
  RuntimeActionEvent,
  SessionPhase,
  TaskDefinition,
} from "../../../../../../shared/contracts";
import { appError } from "../../platform/errors";
import {
  defaultProblemReviewProjection,
  defineEnginePlugin,
  learningProjectionFromRuntime,
  type EngineActionResult,
} from "../../platform/engineTypes";
import { buildBuoyancyFeedbackPacket, buildBuoyancyRuntime } from "./runtimeProjector";
import { cloneBuoyancyState, parseDraftPayload } from "./shared";
import { generateScenario } from "./scenarioBank";
import { evaluateStep } from "./stepEvaluator";
import type { BuoyancyEngineState } from "./types";

const STEP_ORDER: BuoyancyStepKey[] = ["solve-unknown-1", "solve-unknown-2"];

function currentStep(state: BuoyancyEngineState): BuoyancyStepKey {
  return STEP_ORDER.find((key) => !state.stepState[key].done) || "solve-unknown-2";
}

function unknownKeyForStep(state: BuoyancyEngineState, stepKey: BuoyancyStepKey) {
  return stepKey === "solve-unknown-1"
    ? state.answerKey.unknown1.key
    : state.answerKey.unknown2.key;
}

// ─── Create state ──────────────────────────────────────────────────

export function createBuoyancyState(
  _task: TaskDefinition,
  content: BuoyancyContentDefinition,
  index: number,
): BuoyancyEngineState {
  const scenario = generateScenario(index);

  // Derive all 5 values from free parameters
  const { Gobj, Fb, Gwater } = scenario.params;
  const values = {
    F: Gobj - Fb,
    Fb,
    Gobj,
    Gwater,
    Ftable: Gwater + Fb,
  };

  const unknownKeys = scenario.answers.map((a) => a.key);
  const unknownKey1 = unknownKeys[0];
  const unknownKey2 = unknownKeys[1];

  return {
    instanceId: crypto.randomUUID(),
    taskId: "buoyancyForceAnalysis",
    contentId: content.id,
    index,
    status: "pending",
    attempts: 0,
    firstTryCorrect: null,
    scenarioId: scenario.id,
    knownKeys: scenario.knownKeys,
    unknownKeys: [unknownKey1, unknownKey2],
    params: scenario.params,
    values,
    useMassObj: scenario.useMassObj,
    useMassWater: scenario.useMassWater,
    stepState: {
      "solve-unknown-1": { done: false, value: "" },
      "solve-unknown-2": { done: false, value: "" },
    },
    answerKey: {
      unknown1: { key: unknownKey1, value: scenario.answers[0].value },
      unknown2: { key: unknownKey2, value: scenario.answers[1].value },
    },
  };
}

// ─── Restore state ─────────────────────────────────────────────────

export function restoreBuoyancyState(raw: unknown): BuoyancyEngineState {
  return raw as BuoyancyEngineState;
}

// ─── Reduce action ─────────────────────────────────────────────────

export function reduceBuoyancyAction(
  task: TaskDefinition,
  content: BuoyancyContentDefinition,
  currentState: BuoyancyEngineState,
  action: RuntimeActionEvent,
): EngineActionResult<BuoyancyEngineState> {
  const state = cloneBuoyancyState(currentState);

  // Handle clear
  if (action.type === "clear") {
    const runtime = buildBuoyancyRuntime(task, content, state, "answering");
    return {
      accepted: true,
      evaluation: "progress",
      phase: "answering",
      engineState: state,
      runtime,
      feedback: buildBuoyancyFeedbackPacket(currentStep(state), "progress"),
    };
  }

  if (action.type !== "submit") {
    throw appError("ACTION_NOT_ALLOWED", "Only clear and submit actions are supported");
  }

  state.attempts += 1;
  const payload = parseDraftPayload(action);
  const stepId = (action.stepId || currentStep(state)) as BuoyancyStepKey;
  const unknownKey = unknownKeyForStep(state, stepId);
  const inputKey = stepId; // input target matches step id
  const submittedStr = payload.inputs?.[inputKey] || "";

  const result = evaluateStep(state, unknownKey, submittedStr);

  let evaluation: "correct" | "wrong" | "progress" = "wrong";
  let phase: SessionPhase = "wrong_feedback";

  if (result.correct) {
    state.stepState[stepId] = { done: true, value: submittedStr };
    state.lastErrorCategory = undefined;

    // Check if all steps are done
    const allDone = STEP_ORDER.every((key) => state.stepState[key].done);
    if (allDone) {
      state.status = "correct";
      if (state.firstTryCorrect === null) state.firstTryCorrect = state.attempts === 1;
      evaluation = "correct";
      phase = "correct_pause";
    } else {
      // Step correct but problem not finished — advance to next step
      evaluation = "progress";
      phase = "answering";
    }
  } else {
    state.status = "wrong";
    state.lastErrorCategory = result.errorCategory;
  }

  const runtime = buildBuoyancyRuntime(task, content, state, phase);
  return {
    accepted: true,
    evaluation,
    phase,
    engineState: state,
    runtime,
    feedback: buildBuoyancyFeedbackPacket(currentStep(state), evaluation),
  };
}

function buildBuoyancyLearningProjection(
  task: TaskDefinition,
  content: BuoyancyContentDefinition,
  state: BuoyancyEngineState,
): LearningProjectionSpec {
  const learningState = { ...state, instanceId: `learn-${task.id}` };
  return learningProjectionFromRuntime(task, buildBuoyancyRuntime(task, content, learningState, "answering"));
}

const BUOYANCY_COACHING: Record<string, { title: string; copy: string }> = {
  "solve-unknown-1": { title: "第一个受力方程选择不稳", copy: "先隔离单个物体，明确每个力的方向，再决定用物块方程还是整体方程。" },
  "solve-unknown-2": { title: "第二个未知量代入偏差", copy: "复用第一步已求出的量，检查等号两边的正负号和单位。" },
};

function displayBuoyancyValue(
  state: BuoyancyEngineState,
  key: BuoyancyEngineState["answerKey"]["unknown1"]["key"],
  value: number,
) {
  if (key === "Gobj" && state.useMassObj) return String(value / 10);
  if (key === "Gwater" && state.useMassWater) return String(value / 10);
  return String(value);
}

function buildBuoyancyProblemReviewProjection(
  _task: TaskDefinition,
  _content: BuoyancyContentDefinition,
  state: BuoyancyEngineState,
  instance: ExerciseInstance,
  attempts: ResultAttemptReview[],
): ProblemReviewProjection {
  const projection = defaultProblemReviewProjection(instance, attempts, {
    inputs: {
      "solve-unknown-1": displayBuoyancyValue(state, state.answerKey.unknown1.key, state.answerKey.unknown1.value),
      "solve-unknown-2": displayBuoyancyValue(state, state.answerKey.unknown2.key, state.answerKey.unknown2.value),
    },
  });
  const coaching = projection.focusStepId ? BUOYANCY_COACHING[projection.focusStepId] : undefined;
  return coaching
    ? { ...projection, diagnosisCode: `buoyancy-${projection.focusStepId}`, diagnosisTitle: coaching.title, coachingCopy: coaching.copy }
    : projection;
}

// ─── Plugin export ─────────────────────────────────────────────────

export const buoyancyForceAnalysisEnginePlugin = defineEnginePlugin({
  createState: createBuoyancyState,
  restoreState: restoreBuoyancyState,
  buildRuntime: buildBuoyancyRuntime,
  buildLearningProjection: buildBuoyancyLearningProjection,
  buildProblemReviewProjection: buildBuoyancyProblemReviewProjection,
  reduceAction: reduceBuoyancyAction,
});
