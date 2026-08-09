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
import type {
  Side,
  TriangleTrigResolvedScenario,
  TriangleTrigScenarioRecord,
  TriangleTrigTaskId,
} from "../../../../../../shared/triangleTrig";
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
  cloneTriangleTrigState,
  computeRatioPair,
  formatLength,
  parseDraftPayload,
  roleForSide,
  sideForRole,
} from "./shared";
import {
  getTriangleScenario,
  guidedAnswerOf,
  meaningAnswerOf,
  pickTriangleScenario,
  ratioAnswerOf,
  resolveTriangleScenarioRecord,
} from "./scenarioBank";
import { getTriangleTrigTaskStrategy } from "./taskStrategies";
import type {
  GuidedEngineState,
  MeaningEngineState,
  RatioEngineState,
  TriangleTrigEngineState,
} from "./types";
import type { ScenarioRecord } from "../../../../../../shared/scenarios";

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

function currentScenario(state: TriangleTrigEngineState): TriangleTrigResolvedScenario {
  const pinned = (state as TriangleTrigEngineState & { pinnedScenario?: TriangleTrigScenarioRecord }).pinnedScenario;
  if (pinned) return resolveTriangleScenarioRecord(pinned);
  // Fallback for sessions persisted before scenario pinning: resolve by id, or
  // fall back to the first approved scenario for the task.
  if (state.scenarioId) return getTriangleScenario(state.taskId, state.scenarioId);
  return pickTriangleScenario(state.taskId, 0);
}

function buildStateFromScenario(
  task: TaskDefinition,
  content: TriangleTrigContentDefinition,
  index: number,
  scenario: TriangleTrigResolvedScenario,
  instanceId: string,
  pinnedScenario?: TriangleTrigScenarioRecord,
): TriangleTrigEngineState {
  const base = {
    instanceId,
    contentId: content.id,
    index,
    status: "pending" as const,
    attempts: 0,
    firstTryCorrect: null as boolean | null,
    target: scenario.target,
    referenceAngle: scenario.referenceAngle,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    ...(pinnedScenario ? { pinnedScenario } : {}),
  };

  if (scenario.taskId === "meaning") {
    const answer = meaningAnswerOf(scenario);
    return { ...base, taskId: "meaning", answerKey: answer } as MeaningEngineState;
  }

  if (scenario.taskId === "ratioToSide") {
    const answer = ratioAnswerOf(scenario);
    return {
      ...base,
      taskId: "ratioToSide",
      ratio: computeRatioPair(answer.triple, scenario.target, scenario.referenceAngle),
      answerKey: answer,
    } as RatioEngineState;
  }

  const answer = guidedAnswerOf(scenario);
  return {
    ...base,
    taskId: "guidedSolve",
    knownType: scenario.knownType,
    given: scenario.given || [],
    stepState: {
      ratio: { done: false, value: "" },
      third: { done: false, value: "" },
      final: { done: false, value: "" },
    },
    answerKey: answer,
  } as GuidedEngineState;
}

export function createTriangleTrigState(
  task: TaskDefinition,
  content: TriangleTrigContentDefinition,
  index: number,
  selectedScenario?: ScenarioRecord,
): TriangleTrigEngineState {
  if (selectedScenario && (
    selectedScenario.taskId !== task.id
    || selectedScenario.engineKind !== "triangle-trig"
    || selectedScenario.contentId !== content.id
    || selectedScenario.status !== "approved"
  )) {
    throw appError("RUNTIME_CONTRACT_INVALID", `Scenario ${selectedScenario.id} does not match ${task.id}/${content.id}`);
  }
  const pinnedScenario = selectedScenario as TriangleTrigScenarioRecord | undefined;
  const scenario = pinnedScenario
    ? resolveTriangleScenarioRecord(pinnedScenario)
    : pickTriangleScenario(taskIdOf(task), index);
  return buildStateFromScenario(task, content, index, scenario, crypto.randomUUID(), pinnedScenario);
}

export function restoreTriangleTrigState(raw: unknown, pinnedScenario?: ScenarioRecord): TriangleTrigEngineState {
  const state = raw as TriangleTrigEngineState;
  const pinned = pinnedScenario as TriangleTrigScenarioRecord | undefined;
  return {
    ...state,
    pinnedScenario: pinned || (state as TriangleTrigEngineState & { pinnedScenario?: TriangleTrigScenarioRecord }).pinnedScenario,
  };
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
  const state = createTriangleTrigState(task, content, 0);
  state.instanceId = `learn-${task.id}`;
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
