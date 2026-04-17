import type {
  AngleEquationContentDefinition,
  AngleEquationStepKey,
} from "../../../../../../shared/angleEquation";
import type {
  RuntimeActionEvent,
  SessionPhase,
  TaskDefinition,
} from "../../../../../../shared/contracts";
import { appError } from "../../platform/errors";
import { defineEnginePlugin } from "../../platform/engineTypes";
import type { EngineActionResult } from "../../platform/engineTypes";
import {
  buildAngleEquationFeedbackPacket,
  buildAngleEquationRuntime,
} from "./runtimeProjector";
import { pickScenario } from "./scenarioBank";
import { cloneAngleEquationState, parseDraftPayload } from "./shared";
import {
  evaluateFilterAngles,
  evaluateFindAngles,
  evaluateSolveTarget,
  evaluateTransformRange,
} from "./stepEvaluator";
import type { AngleEquationEngineState } from "./types";

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

// ─── Create state ────────────────────────────────────────────────────

export function createAngleEquationState(
  task: TaskDefinition,
  content: AngleEquationContentDefinition,
  index: number,
): AngleEquationEngineState {
  const scenario = pickScenario(index);

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
): AngleEquationEngineState {
  return raw as AngleEquationEngineState;
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

// ─── Plugin export ───────────────────────────────────────────────────

export const angleEquationEnginePlugin = defineEnginePlugin({
  createState: createAngleEquationState,
  restoreState: restoreAngleEquationState,
  buildRuntime: buildAngleEquationRuntime,
  reduceAction: reduceAngleEquationAction,
});
