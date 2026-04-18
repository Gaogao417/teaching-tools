import type {
  BuoyancyContentDefinition,
  BuoyancyStepKey,
  BuoyancyVariableKey,
  BuoyancyWorkspaceModel,
} from "../../../../../../shared/buoyancyForceAnalysis";
import type {
  ExerciseInstance,
  ExerciseRuntimeSpec,
  FeedbackCue,
  FeedbackSpec,
  FlowSpec,
  FlowStep,
  GuideSpec,
  SceneSpec,
  SessionPhase,
  TaskDefinition,
} from "../../../../../../shared/contracts";
import type { BuoyancyEngineState } from "./types";
import { VARIABLE_LABELS } from "./shared";

// ─── Constants ─────────────────────────────────────────────────────

const STEP_ORDER: BuoyancyStepKey[] = ["solve-unknown-1", "solve-unknown-2"];
const G = 10;

// ─── Helpers ───────────────────────────────────────────────────────

function makeCue(key: string, scope: FeedbackCue["scope"], targetRef?: string): FeedbackCue {
  return { key, scope, targetRef };
}

function currentStep(state: BuoyancyEngineState): BuoyancyStepKey {
  return STEP_ORDER.find((key) => !state.stepState[key].done) || "solve-unknown-2";
}

function unknownKeyForStep(state: BuoyancyEngineState, stepKey: BuoyancyStepKey): BuoyancyVariableKey {
  return stepKey === "solve-unknown-1"
    ? state.answerKey.unknown1.key
    : state.answerKey.unknown2.key;
}

function displayLabel(key: BuoyancyVariableKey, useMass: boolean): string {
  const info = VARIABLE_LABELS[key];
  if (useMass && info.mass) return info.mass;
  return info.force;
}

function displayUnit(key: BuoyancyVariableKey, useMass: boolean): string {
  if (useMass) return "kg";
  return "N";
}

function displayValue(key: BuoyancyVariableKey, value: number, state: BuoyancyEngineState): string {
  if (key === "Gobj" && state.useMassObj) return String(value / G);
  if (key === "Gwater" && state.useMassWater) return String(value / G);
  return String(value);
}

function useMassFor(key: BuoyancyVariableKey, state: BuoyancyEngineState): boolean {
  if (key === "Gobj") return state.useMassObj;
  if (key === "Gwater") return state.useMassWater;
  return false;
}

// ─── Build workspace model ─────────────────────────────────────────

function buildWorkspaceModel(state: BuoyancyEngineState): BuoyancyWorkspaceModel {
  const step = currentStep(state);
  const allKeys: BuoyancyVariableKey[] = ["F", "Fb", "Gobj", "Gwater", "Ftable"];
  const knownSet = new Set(state.knownKeys);

  const variables = allKeys.map((key) => {
    const useMass = useMassFor(key, state);
    return {
      key,
      label: displayLabel(key, useMass),
      value: knownSet.has(key) ? state.values[key] : null,
      unit: displayUnit(key, useMass) as "N" | "kg",
      isKnown: knownSet.has(key),
    };
  });

  return {
    variables,
    currentStepId: step,
    equations: {
      object: "F + F浮 = G物",
      system: "F + F桌 = G水 + G物",
    },
    prompt: buildPrompt(state),
    wrongHint: wrongHint(state),
  };
}

// ─── Build prompt ──────────────────────────────────────────────────

function buildPrompt(state: BuoyancyEngineState): string {
  const knownParts = state.knownKeys.map((key) => {
    const useMass = useMassFor(key, state);
    const label = displayLabel(key, useMass);
    const unit = displayUnit(key, useMass);
    const value = displayValue(key, state.values[key], state);
    return `${label} = ${value} ${unit}`;
  });

  const unknownParts = [state.answerKey.unknown1, state.answerKey.unknown2].map((a) => {
    const useMass = useMassFor(a.key, state);
    return displayLabel(a.key, useMass);
  });

  return `已知 ${knownParts.join("，")}，求 ${unknownParts.join(" 和 ")}。`;
}

// ─── Build wrong hint ──────────────────────────────────────────────

function wrongHint(state: BuoyancyEngineState): string {
  const category = state.lastErrorCategory;
  switch (category) {
    case "wrong-equation":
      return "你可能选错了受力分析对象——试试另一个方程。";
    case "sign-reversal":
      return "代入方向反了，检查等号两边谁减谁。";
    case "computation":
      return "方程选对了，再算一遍看看。";
    default:
      return "再想想该用哪个方程。";
  }
}

// ─── Build scene ───────────────────────────────────────────────────

function buildScene(state: BuoyancyEngineState): SceneSpec {
  const model = buildWorkspaceModel(state);

  const entities: SceneSpec["entities"] = [
    {
      id: "buoyancy-model",
      kind: "text",
      text: JSON.stringify(model),
      variant: "note",
    },
  ];

  return {
    sceneKind: "custom",
    entities,
    zones: [],
    anchors: [],
    overlays: [],
  };
}

// ─── Build flow ────────────────────────────────────────────────────

function buildFlow(
  content: BuoyancyContentDefinition,
  state: BuoyancyEngineState,
): FlowSpec {
  const step = currentStep(state);

  const stepConfigs: Array<{ id: BuoyancyStepKey; title: string; goal: string }> = [
    {
      id: "solve-unknown-1",
      title: `求 ${displayLabel(state.answerKey.unknown1.key, useMassFor(state.answerKey.unknown1.key, state))}`,
      goal: "选择正确的受力分析对象，代入方程求解。",
    },
    {
      id: "solve-unknown-2",
      title: `求 ${displayLabel(state.answerKey.unknown2.key, useMassFor(state.answerKey.unknown2.key, state))}`,
      goal: "用另一个方程求出剩余未知量。",
    },
  ];

  const steps: FlowStep[] = stepConfigs.map((cfg) => {
    const done = state.stepState[cfg.id].done;
    const isActive = !done && cfg.id === step;
    const status = done ? "done" : isActive ? "active" : "locked";

    return {
      id: cfg.id,
      title: cfg.title,
      goal: cfg.goal,
      status,
      allowedActions: isActive ? buildAllowedActions(cfg.id) : [],
      submitMode: "explicit" as const,
    };
  });

  return {
    steps,
    currentStepId: step,
    completionPolicy: content.flowTemplate.completionPolicy,
  };
}

function buildAllowedActions(stepId: BuoyancyStepKey): FlowStep["allowedActions"] {
  return [
    { type: "input", target: stepId, valueKind: "text" },
    { type: "clear", target: stepId },
    { type: "submit", stepId },
  ];
}

// ─── Build guide ───────────────────────────────────────────────────

function buildGuide(
  content: BuoyancyContentDefinition,
  state: BuoyancyEngineState,
  phase: SessionPhase,
  flow: FlowSpec,
): GuideSpec {
  const step = currentStep(state);
  const hint =
    phase === "wrong_feedback"
      ? wrongHint(state)
      : defaultHint(step, state);

  return {
    banner: content.guideTemplate.banner,
    hint,
    statusCopy:
      phase === "wrong_feedback"
        ? "请回到左侧修正答案。"
        : "左侧负责操作，右侧负责引导。",
    stepItems: flow.steps.map((flowStep) => ({
      stepId: flowStep.id,
      title: flowStep.title,
      status: flowStep.status,
      summary:
        flowStep.status === "done"
          ? state.stepState[flowStep.id as BuoyancyStepKey].value || "已完成"
          : flowStep.goal,
    })),
  };
}

function defaultHint(step: BuoyancyStepKey, state: BuoyancyEngineState): string {
  const unknownKey = unknownKeyForStep(state, step);
  const useMass = useMassFor(unknownKey, state);
  const label = displayLabel(unknownKey, useMass);

  if (unknownKey === "Fb" || unknownKey === "Gobj") {
    return `要求 ${label}，试试对物块单独受力分析：F + F浮 = G物`;
  }
  if (unknownKey === "Ftable" || unknownKey === "Gwater") {
    return `要求 ${label}，试试整体法：F + F桌 = G水 + G物`;
  }
  // F appears in both equations
  return `${label} 同时出现在两个方程中，想想先用哪个更方便。`;
}

// ─── Build feedback ────────────────────────────────────────────────

function buildFeedback(stepId: string): FeedbackSpec {
  return {
    correct: [
      makeCue("correct", "global"),
      makeCue("highlight-correct", "workspace", stepId),
    ],
    wrong: [
      makeCue("wrong", "global"),
      makeCue("highlight-wrong", "guide", stepId),
    ],
    finish: [makeCue("finish", "global")],
  };
}

export function buildBuoyancyFeedbackPacket(
  currentStepId: string,
  evaluation: "correct" | "wrong" | "progress",
) {
  const feedback = buildFeedback(currentStepId);
  if (evaluation === "correct") {
    return { global: feedback.correct, workspace: feedback.correct, guide: [] };
  }
  if (evaluation === "wrong") {
    return { global: feedback.wrong, workspace: [], guide: feedback.wrong };
  }
  return { global: [], workspace: [], guide: [] };
}

// ─── Build instance ────────────────────────────────────────────────

function buildInstance(
  task: TaskDefinition,
  content: BuoyancyContentDefinition,
  state: BuoyancyEngineState,
  phase: SessionPhase,
): ExerciseInstance {
  const flow = buildFlow(content, state);
  const step = currentStep(state);

  return {
    instanceId: state.instanceId,
    taskId: task.id,
    engineKind: task.engineKind,
    contentId: content.id,
    prompt: buildPrompt(state),
    scene: buildScene(state),
    flow,
    guide: buildGuide(content, state, phase, flow),
    feedback: buildFeedback(step),
  };
}

// ─── Main entry ────────────────────────────────────────────────────

export function buildBuoyancyRuntime(
  task: TaskDefinition,
  content: BuoyancyContentDefinition,
  state: BuoyancyEngineState,
  phase: SessionPhase,
): ExerciseRuntimeSpec {
  const step = currentStep(state);
  const instance = buildInstance(task, content, state, phase);

  return {
    instance,
    runtimeState: {
      phase,
      currentStepId: step,
      completedStepIds: STEP_ORDER.filter((key) => state.stepState[key].done),
      problemStatus: state.status,
      attempts: state.attempts,
    },
  };
}
