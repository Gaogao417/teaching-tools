import type { BuoyancyContentDefinition, BuoyancyStepKey } from "../../../../../../shared/buoyancyForceAnalysis";
import type { RuntimeActionEvent, SessionPhase, TaskDefinition } from "../../../../../../shared/contracts";
import { appError } from "../../platform/errors";
import { defineEnginePlugin, type EngineActionResult } from "../../platform/engineTypes";
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

// ─── Plugin export ─────────────────────────────────────────────────

export const buoyancyForceAnalysisEnginePlugin = defineEnginePlugin({
  createState: createBuoyancyState,
  restoreState: restoreBuoyancyState,
  buildRuntime: buildBuoyancyRuntime,
  reduceAction: reduceBuoyancyAction,
});
