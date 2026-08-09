import type {
  AngleEquationContentDefinition,
  AngleEquationScenario,
  AngleEquationScenarioRecord,
  AngleEquationStepKey,
} from "../../../../../../shared/angleEquation";
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
} from "../../platform/engineTypes";
import type { EngineActionResult } from "../../platform/engineTypes";
import {
  buildAngleEquationFeedbackPacket,
  buildAngleEquationRuntime,
} from "./runtimeProjector";
import { pickScenario, pickScenarioRecord } from "./scenarioBank";
import { cloneAngleEquationState, parseDraftPayload } from "./shared";
import {
  evaluateFilterAngles,
  evaluateFindAngles,
  evaluateSolveTarget,
  evaluateTransformRange,
} from "./stepEvaluator";
import type { AngleEquationEngineState } from "./types";
import type { ScenarioRecord } from "../../../../../../shared/scenarios";

// ─── Step order ──────────────────────────────────────────────────────

const STEP_ORDER: AngleEquationStepKey[] = [
  "find-angles",
  "transform-range",
  "filter-angles",
  "solve-target",
];

function currentStep(state: AngleEquationEngineState): AngleEquationStepKey {
  return STEP_ORDER.find((key) => !state.stepState[key].done) || "solve-target";
}

function scenarioFromRecord(record: ScenarioRecord): AngleEquationScenario {
  return {
    id: record.id,
    ...(record.promptData as Omit<AngleEquationScenario, "id" | "answerKey">),
    answerKey: record.answerKey as AngleEquationScenario["answerKey"],
  };
}

// ─── Create state ────────────────────────────────────────────────────

export function createAngleEquationState(
  task: TaskDefinition,
  content: AngleEquationContentDefinition,
  index: number,
  selectedScenario?: ScenarioRecord,
): AngleEquationEngineState {
  if (selectedScenario && (
    selectedScenario.taskId !== task.id
    || selectedScenario.engineKind !== "angle-equation"
    || selectedScenario.contentId !== content.id
    || selectedScenario.status !== "approved"
  )) {
    throw appError("RUNTIME_CONTRACT_INVALID", `Scenario ${selectedScenario.id} does not match ${task.id}/${content.id}`);
  }
  const pinnedScenario = selectedScenario as AngleEquationScenarioRecord | undefined;
  const bundleRecord = pinnedScenario ?? pickScenarioRecord(index);
  const scenario = pinnedScenario ? scenarioFromRecord(pinnedScenario) : pickScenario(index);

  return {
    instanceId: crypto.randomUUID(),
    taskId: "trigEquationRange",
    contentId: content.id,
    index,
    status: "pending",
    attempts: 0,
    firstTryCorrect: null,
    unknownType: scenario.unknownType,
    scenarioId: scenario.id,
    scenarioVersion: bundleRecord.version,
    ...(pinnedScenario ? { pinnedScenario } : {}),
    stepState: {
      "find-angles": { done: false, value: "" },
      "transform-range": { done: false, value: "" },
      "filter-angles": { done: false, value: "" },
      "solve-target": { done: false, value: "" },
    },
    answerKey: scenario.answerKey,
    scenarioParams: {
      trigFn: scenario.trigFn,
      omega: scenario.omega,
      phi: scenario.phi,
      value: scenario.value,
      unknownRange: scenario.unknownRange,
    },
  };
}

// ─── Restore state ───────────────────────────────────────────────────

export function restoreAngleEquationState(
  raw: unknown,
  pinnedScenario?: ScenarioRecord,
): AngleEquationEngineState {
  const state = raw as AngleEquationEngineState;
  const pinned = pinnedScenario as AngleEquationScenarioRecord | undefined;
  return {
    ...state,
    pinnedScenario: pinned || state.pinnedScenario,
  };
}

// ─── Reduce action ───────────────────────────────────────────────────

export function reduceAngleEquationAction(
  task: TaskDefinition,
  content: AngleEquationContentDefinition,
  currentState: AngleEquationEngineState,
  action: RuntimeActionEvent,
): EngineActionResult<AngleEquationEngineState> {
  const state = cloneAngleEquationState(currentState);

  // Handle clear
  if (action.type === "clear") {
    const runtime = buildAngleEquationRuntime(task, content, state, "answering");
    return {
      accepted: true,
      evaluation: "progress",
      phase: "answering",
      engineState: state,
      runtime,
      feedback: buildAngleEquationFeedbackPacket(
        currentStep(state),
        "progress",
      ),
    };
  }

  if (action.type !== "submit") {
    throw appError(
      "ACTION_NOT_ALLOWED",
      "Only clear and submit actions are supported",
    );
  }

  state.attempts += 1;
  const payload = parseDraftPayload(action);
  const stepId = (action.stepId || currentStep(state)) as AngleEquationStepKey;

  let evaluation: "correct" | "wrong" | "progress" = "wrong";
  let phase: SessionPhase = "wrong_feedback";

  if (stepId === "find-angles") {
    const result = evaluateFindAngles(state, payload);
    if (result.correct) {
      state.stepState["find-angles"] = {
        done: true,
        value: state.answerKey.referenceAngles.join(", "),
      };
      evaluation = "progress";
      phase = "answering";
    }
  } else if (stepId === "transform-range") {
    const result = evaluateTransformRange(state, payload);
    if (result.correct) {
      state.stepState["transform-range"] = {
        done: true,
        value: state.answerKey.transformedRange.join(" ~ "),
      };
      evaluation = "progress";
      phase = "answering";
    }
  } else if (stepId === "filter-angles") {
    const result = evaluateFilterAngles(state, payload);
    if (result.correct) {
      state.stepState["filter-angles"] = {
        done: true,
        value: state.answerKey.filteredAngles.join(", "),
      };
      evaluation = "progress";
      phase = "answering";
    }
  } else if (stepId === "solve-target") {
    const result = evaluateSolveTarget(state, payload);
    if (result.correct) {
      state.stepState["solve-target"] = {
        done: true,
        value: state.answerKey.solutions.join(", "),
      };
      state.status = "correct";
      if (state.firstTryCorrect === null) {
        state.firstTryCorrect = state.attempts === 1;
      }
      evaluation = "correct";
      phase = "correct_pause";
    }
  }

  if (evaluation === "wrong") {
    state.status = "wrong";
  } else if (evaluation === "progress") {
    state.status = "pending";
  }

  const runtime = buildAngleEquationRuntime(task, content, state, phase);
  return {
    accepted: true,
    evaluation,
    phase,
    engineState: state,
    runtime,
    feedback: buildAngleEquationFeedbackPacket(
      currentStep(state),
      evaluation,
    ),
  };
}

function buildAngleLearningProjection(
  task: TaskDefinition,
  content: AngleEquationContentDefinition,
  state: AngleEquationEngineState,
): LearningProjectionSpec {
  const learningState = { ...state, instanceId: `learn-${task.id}` };
  return learningProjectionFromRuntime(task, buildAngleEquationRuntime(task, content, learningState, "answering"));
}

const ANGLE_COACHING: Record<string, { title: string; copy: string }> = {
  "find-angles": { title: "基准角没有找全", copy: "先在一个周期内找齐所有同函数值的角，再进入范围变换。" },
  "transform-range": { title: "范围变换出现偏差", copy: "把区间两端同时代入 omega·x+phi，注意负号会改变端点顺序。" },
  "filter-angles": { title: "合法角筛选不完整", copy: "按周期平移基准角，再逐个检查是否落在变换后的区间内。" },
  "solve-target": { title: "回代求解出现偏差", copy: "每个合法角都要独立回代，并检查解是否仍在原范围内。" },
};

function buildAngleProblemReviewProjection(
  _task: TaskDefinition,
  _content: AngleEquationContentDefinition,
  state: AngleEquationEngineState,
  instance: ExerciseInstance,
  attempts: ResultAttemptReview[],
): ProblemReviewProjection {
  const projection = defaultProblemReviewProjection(instance, attempts, {
    selections: {
      "find-angles": state.answerKey.referenceAngles,
      "filter-angles": state.answerKey.filteredAngles,
    },
    inputs: {
      "range-low": state.answerKey.transformedRange[0],
      "range-high": state.answerKey.transformedRange[1],
      ...Object.fromEntries(state.answerKey.solutions.map((value, index) => [`solution-${index}`, value])),
    },
  });
  const coaching = projection.focusStepId ? ANGLE_COACHING[projection.focusStepId] : undefined;
  return coaching
    ? { ...projection, diagnosisCode: `angle-${projection.focusStepId}`, diagnosisTitle: coaching.title, coachingCopy: coaching.copy }
    : projection;
}

// ─── Plugin export ───────────────────────────────────────────────────

export const angleEquationEnginePlugin = defineEnginePlugin({
  createState: createAngleEquationState,
  restoreState: restoreAngleEquationState,
  buildRuntime: buildAngleEquationRuntime,
  buildLearningProjection: buildAngleLearningProjection,
  buildProblemReviewProjection: buildAngleProblemReviewProjection,
  reduceAction: reduceAngleEquationAction,
});
