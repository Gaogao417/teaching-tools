import type {
  ExerciseInstance,
  LearningProjectionSpec,
  ProblemReviewProjection,
  ResultAttemptReview,
  RuntimeActionEvent,
  SessionPhase,
  TaskDefinition,
  TriangleTrigContentDefinition,
} from "../../../../../../shared/contracts";
import type { TriangleTrigTaskId } from "../../../../../../shared/triangleTrig";
import type { Side } from "../../../../../../shared/triangleTrig";
import { appError } from "../../platform/errors";
import type { EngineActionResult } from "../../platform/engineTypes";
import { defineEnginePlugin } from "../../platform/engineTypes";
import {
  defaultProblemReviewProjection,
  learningProjectionFromRuntime,
  parseSubmittedAnswer,
} from "../../platform/engineTypes";
import { buildTriangleTrigFeedbackPacket, buildTriangleTrigRuntime } from "./runtimeProjector";
import {
  ACUTE_ANGLES,
  TRIGS,
  cloneTriangleTrigState,
  formatLength,
  parseDraftPayload,
  randomItem,
  roleForSide,
  sideForRole,
} from "./shared";
import { getTriangleTrigTaskStrategy } from "./taskStrategies";
import type {
  GuidedEngineState,
  MeaningEngineState,
  RatioEngineState,
  TriangleTrigEngineState,
} from "./types";

export type {
  GuidedEngineState,
  MeaningEngineState,
  RatioEngineState,
  TriangleTrigEngineState,
};

function taskIdOf(task: TaskDefinition): TriangleTrigTaskId {
  return task.id as TriangleTrigTaskId;
}

function currentStepId(state: TriangleTrigEngineState, content: TriangleTrigContentDefinition): string {
  return getTriangleTrigTaskStrategy(state.taskId).buildProjectionModel(content, state).currentStepId;
}

export function createTriangleTrigState(
  task: TaskDefinition,
  content: TriangleTrigContentDefinition,
  index: number,
): TriangleTrigEngineState {
  return getTriangleTrigTaskStrategy(taskIdOf(task)).createState(task, content, index, {
    instanceId: crypto.randomUUID(),
    target: randomItem(TRIGS),
    referenceAngle: randomItem(ACUTE_ANGLES),
  });
}

export function restoreTriangleTrigState(raw: unknown): TriangleTrigEngineState {
  return raw as TriangleTrigEngineState;
}

export function reduceTriangleTrigAction(
  task: TaskDefinition,
  content: TriangleTrigContentDefinition,
  currentState: TriangleTrigEngineState,
  action: RuntimeActionEvent,
): EngineActionResult<TriangleTrigEngineState> {
  const state = cloneTriangleTrigState(currentState);

  if (action.type === "clear") {
    const runtime = buildTriangleTrigRuntime(task, content, state, "answering");
    return {
      accepted: true,
      evaluation: "progress",
      phase: "answering",
      engineState: state,
      runtime,
      feedback: buildTriangleTrigFeedbackPacket(currentStepId(state, content), "progress"),
    };
  }

  if (action.type !== "submit") {
    throw appError("ACTION_NOT_ALLOWED", "Only clear and submit actions are supported");
  }

  state.attempts += 1;
  const payload = parseDraftPayload(action);
  const strategy = getTriangleTrigTaskStrategy(state.taskId);
  const result = strategy.reduceSubmit(state, payload, action.stepId || currentStepId(state, content));

  if (result.evaluation === "correct" && state.firstTryCorrect === null) {
    state.firstTryCorrect = state.attempts === 1;
  }

  const stepId = currentStepId(state, content);
  const runtime = buildTriangleTrigRuntime(task, content, state, result.phase);
  return {
    accepted: true,
    evaluation: result.evaluation,
    phase: result.phase,
    engineState: state,
    runtime,
    feedback: buildTriangleTrigFeedbackPacket(stepId, result.evaluation),
  };
}

export function buildRuntimeForState(
  task: TaskDefinition,
  content: TriangleTrigContentDefinition,
  state: TriangleTrigEngineState,
  phase: SessionPhase,
) {
  return buildTriangleTrigRuntime(task, content, state, phase);
}

function buildTriangleLearningProjection(
  task: TaskDefinition,
  content: TriangleTrigContentDefinition,
): LearningProjectionSpec {
  const state = getTriangleTrigTaskStrategy(taskIdOf(task)).createState(task, content, 0, {
    instanceId: `learn-${task.id}`,
    target: TRIGS[0],
    referenceAngle: ACUTE_ANGLES[0],
  });
  return learningProjectionFromRuntime(task, buildTriangleTrigRuntime(task, content, state, "answering"));
}

function expectedTriangleAnswer(state: TriangleTrigEngineState): ProblemReviewProjection["expectedAnswer"] {
  if (state.taskId === "meaning") {
    return {
      selections: {
        "meaning-selection": state.answerKey.roles.map((role) => sideForRole(state.referenceAngle, role)),
      },
      display: `${state.target} ${state.referenceAngle}：先分子，后分母`,
    };
  }
  if (state.taskId === "ratioToSide") {
    return {
      inputs: Object.fromEntries(
        Object.entries(state.answerKey.triple).map(([side, value]) => [`side-${side}`, formatLength(value)]),
      ),
    };
  }
  return {
    inputs: {
      ...state.answerKey.zRoles,
      third: state.answerKey.thirdZ,
      numerator: state.answerKey.finalNumerator,
      denominator: state.answerKey.finalDenominator,
    },
  };
}

function buildTriangleProblemReviewProjection(
  _task: TaskDefinition,
  _content: TriangleTrigContentDefinition,
  state: TriangleTrigEngineState,
  instance: ExerciseInstance,
  attempts: ResultAttemptReview[],
): ProblemReviewProjection {
  const expectedAnswer = expectedTriangleAnswer(state);
  const fallback = defaultProblemReviewProjection(instance, attempts, expectedAnswer);
  const firstWrong = attempts.find((attempt) => attempt.actionType === "submit" && attempt.evaluation === "wrong");
  if (!firstWrong || state.taskId !== "meaning") return fallback;

  const actualAnswer = parseSubmittedAnswer(firstWrong.submittedValue);
  const selected = actualAnswer?.selections?.["meaning-selection"] || [];
  const actualRoles = selected.slice(0, 2).map((side) => roleForSide(state.referenceAngle, side as Side));
  const reversed =
    actualRoles.length === 2 &&
    actualRoles[0] === state.answerKey.roles[1] &&
    actualRoles[1] === state.answerKey.roles[0];

  return {
    ...fallback,
    diagnosisCode: reversed ? "ratio-order-reversed" : "ratio-role-mismatch",
    diagnosisTitle: reversed
      ? `${state.target} ${state.referenceAngle}：分子与分母顺序混淆`
      : `${state.target} ${state.referenceAngle}：边的角色判断有偏差`,
    coachingCopy: reversed
      ? "先说出定义中的分子角色，再按同一顺序选择分母角色。"
      : "先锁定参考角，再分别找对边、邻边和斜边。",
    actualAnswer,
    focusStepId: "pick-roles",
  };
}

export const triangleTrigEnginePlugin = defineEnginePlugin({
  createState: createTriangleTrigState,
  restoreState: restoreTriangleTrigState,
  buildRuntime: buildRuntimeForState,
  buildLearningProjection: buildTriangleLearningProjection,
  buildProblemReviewProjection: buildTriangleProblemReviewProjection,
  reduceAction: reduceTriangleTrigAction,
});
