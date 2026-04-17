import type {
  CoordIsoscelesContentDefinition,
  CoordIsoscelesStepKey,
} from "../../../../../../shared/coordinateIsoscelesRight";
import type {
  RuntimeActionEvent,
  SessionPhase,
  TaskDefinition,
} from "../../../../../../shared/contracts";
import { appError } from "../../platform/errors";
import { defineEnginePlugin } from "../../platform/engineTypes";
import type { EngineActionResult } from "../../platform/engineTypes";
import {
  buildCoordIsoscelesFeedbackPacket,
  buildCoordIsoscelesRuntime,
} from "./runtimeProjector";
import { pickScenario } from "./scenarioBank";
import { cloneCoordIsoscelesState, parseDraftPayload } from "./shared";
import {
  evaluateConstructLines,
  evaluateIdentifyCongruent,
  evaluateSetupEquations,
  evaluateSolveCoordinates,
} from "./stepEvaluator";
import type { CoordIsoscelesEngineState } from "./types";

// ─── Step order ──────────────────────────────────────────────────────

const STEP_ORDER: CoordIsoscelesStepKey[] = [
  "construct-lines",
  "identify-congruent",
  "setup-equations",
  "solve-coordinates",
];

function currentStep(state: CoordIsoscelesEngineState): CoordIsoscelesStepKey {
  return STEP_ORDER.find((key) => !state.stepState[key].done) || "solve-coordinates";
}

// ─── Create state ────────────────────────────────────────────────────

export function createCoordIsoscelesState(
  task: TaskDefinition,
  content: CoordIsoscelesContentDefinition,
  index: number,
): CoordIsoscelesEngineState {
  const scenario = pickScenario(index);

  return {
    instanceId: crypto.randomUUID(),
    taskId: "isoscelesRightCoord",
    contentId: content.id,
    index,
    status: "pending",
    attempts: 0,
    firstTryCorrect: null,
    scenarioId: scenario.id,
    stepState: {
      "construct-lines": { done: false, value: "" },
      "identify-congruent": { done: false, value: "" },
      "setup-equations": { done: false, value: "" },
      "solve-coordinates": { done: false, value: "" },
    },
    answerKey: scenario.answerKey,
    scenarioParams: {
      B: scenario.B,
      C: scenario.C,
    },
  };
}

// ─── Restore state ───────────────────────────────────────────────────

export function restoreCoordIsoscelesState(
  raw: unknown,
): CoordIsoscelesEngineState {
  return raw as CoordIsoscelesEngineState;
}

// ─── Reduce action ───────────────────────────────────────────────────

export function reduceCoordIsoscelesAction(
  task: TaskDefinition,
  content: CoordIsoscelesContentDefinition,
  currentState: CoordIsoscelesEngineState,
  action: RuntimeActionEvent,
): EngineActionResult<CoordIsoscelesEngineState> {
  const state = cloneCoordIsoscelesState(currentState);

  // Handle clear
  if (action.type === "clear") {
    const runtime = buildCoordIsoscelesRuntime(task, content, state, "answering");
    return {
      accepted: true,
      evaluation: "progress",
      phase: "answering",
      engineState: state,
      runtime,
      feedback: buildCoordIsoscelesFeedbackPacket(
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
  const stepId = (action.stepId || currentStep(state)) as CoordIsoscelesStepKey;

  let evaluation: "correct" | "wrong" | "progress" = "wrong";
  let phase: SessionPhase = "wrong_feedback";

  if (stepId === "construct-lines") {
    const result = evaluateConstructLines(state, payload);
    if (result.correct) {
      state.stepState["construct-lines"] = {
        done: true,
        value: "已选择正确构造方式",
      };
      evaluation = "progress";
      phase = "answering";
    }
  } else if (stepId === "identify-congruent") {
    const result = evaluateIdentifyCongruent(state, payload);
    if (result.correct) {
      state.stepState["identify-congruent"] = {
        done: true,
        value: "已识别全等与对应边",
      };
      evaluation = "progress";
      phase = "answering";
    }
  } else if (stepId === "setup-equations") {
    const result = evaluateSetupEquations(state, payload);
    if (result.correct) {
      state.stepState["setup-equations"] = {
        done: true,
        value: "方程组正确",
      };
      evaluation = "progress";
      phase = "answering";
    }
  } else if (stepId === "solve-coordinates") {
    const result = evaluateSolveCoordinates(state, payload);
    if (result.correct) {
      const sol = state.answerKey.solutions[0];
      state.stepState["solve-coordinates"] = {
        done: true,
        value: `A(${sol.x}, ${sol.y})`,
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

  const runtime = buildCoordIsoscelesRuntime(task, content, state, phase);
  return {
    accepted: true,
    evaluation,
    phase,
    engineState: state,
    runtime,
    feedback: buildCoordIsoscelesFeedbackPacket(
      currentStep(state),
      evaluation,
    ),
  };
}

// ─── Plugin export ───────────────────────────────────────────────────

export const coordIsoscelesEnginePlugin = defineEnginePlugin({
  createState: createCoordIsoscelesState,
  restoreState: restoreCoordIsoscelesState,
  buildRuntime: buildCoordIsoscelesRuntime,
  reduceAction: reduceCoordIsoscelesAction,
});
