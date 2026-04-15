import type {
  RuntimeActionEvent,
  SessionPhase,
  TaskDefinition,
  TriangleTrigContentDefinition,
} from "../../../../../../shared/contracts";
import type { TriangleTrigTaskId } from "../../../../../../shared/triangleTrig";
import { appError } from "../../platform/errors";
import type { EngineActionResult } from "../../platform/engineTypes";
import { defineEnginePlugin } from "../../platform/engineTypes";
import { buildTriangleTrigFeedbackPacket, buildTriangleTrigRuntime } from "./runtimeProjector";
import { ACUTE_ANGLES, TRIGS, cloneTriangleTrigState, parseDraftPayload, randomItem } from "./shared";
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

export const triangleTrigEnginePlugin = defineEnginePlugin({
  createState: createTriangleTrigState,
  restoreState: restoreTriangleTrigState,
  buildRuntime: buildRuntimeForState,
  reduceAction: reduceTriangleTrigAction,
});
