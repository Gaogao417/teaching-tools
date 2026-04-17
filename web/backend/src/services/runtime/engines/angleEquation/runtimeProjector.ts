import type {
  AngleEquationContentDefinition,
  AngleEquationStepKey,
  AngleEquationWorkspaceModel,
} from "../../../../../../shared/angleEquation";
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
import type { AngleEquationEngineState } from "./types";
import { UNIT_CIRCLE_ANGLES } from "./shared";

// ─── Helpers ─────────────────────────────────────────────────────────

const STEP_ORDER: AngleEquationStepKey[] = [
  "find-angles",
  "transform-range",
  "filter-angles",
  "solve-target",
];

function makeCue(
  key: string,
  scope: FeedbackCue["scope"],
  targetRef?: string,
): FeedbackCue {
  return { key, scope, targetRef };
}

function currentStep(state: AngleEquationEngineState): AngleEquationStepKey {
  return STEP_ORDER.find((key) => !state.stepState[key].done) || "solve-target";
}

// ─── Build workspace model ───────────────────────────────────────────

function buildWorkspaceModel(
  state: AngleEquationEngineState,
): AngleEquationWorkspaceModel {
  const step = currentStep(state);

  const model: AngleEquationWorkspaceModel = {
    equation: {
      trigFn: state.scenarioParams.trigFn as AngleEquationWorkspaceModel["equation"]["trigFn"],
      omega: state.scenarioParams.omega,
      phi: state.scenarioParams.phi,
      value: state.scenarioParams.value,
    },
    unknownType: state.unknownType,
    unknownRange: state.scenarioParams.unknownRange,
    unitCircleAngles: UNIT_CIRCLE_ANGLES,
    currentStepId: step,
  };

  // Populate completed step data for the renderer
  if (state.stepState["find-angles"].done) {
    model.candidateAngles = state.answerKey.referenceAngles;
  }
  if (state.stepState["transform-range"].done) {
    model.transformedRange = state.answerKey.transformedRange;
  }
  if (state.stepState["filter-angles"].done) {
    model.filteredAngles = state.answerKey.filteredAngles;
  }

  return model;
}

// ─── Build scene ─────────────────────────────────────────────────────

function buildScene(
  state: AngleEquationEngineState,
  phase: SessionPhase,
): SceneSpec {
  const model = buildWorkspaceModel(state);

  const entities: SceneSpec["entities"] = [
    // Embed the workspace model as a text entity for the frontend
    {
      id: "angle-equation-model",
      kind: "text",
      text: JSON.stringify(model),
      variant: "note",
    },
    // Equation display
    {
      id: "equation-display",
      kind: "text",
      text: formatEquation(state),
      x: 240,
      y: 20,
      variant: "inline-formula",
    },
    // Range display
    {
      id: "range-display",
      kind: "text",
      text: formatRange(state),
      x: 240,
      y: 44,
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

function formatEquation(state: AngleEquationEngineState): string {
  const { trigFn, omega, phi, value } = state.scenarioParams;
  const fn = trigFn;
  let inner = "";
  if (state.unknownType === "x") {
    const omegaStr = omega === 1 ? "" : omega === -1 ? "-" : `${omega}`;
    const phiStr = phi === "0" ? "" : phi.startsWith("-") ? ` ${phi}` : ` + ${phi}`;
    inner = `${omegaStr}x${phiStr}`;
  } else if (state.unknownType === "phi") {
    inner = `x + phi`;
  } else {
    inner = `omega * x`;
  }
  return `${fn}(${inner}) = ${value}`;
}

function formatRange(state: AngleEquationEngineState): string {
  const [lo, hi] = state.scenarioParams.unknownRange;
  const label =
    state.unknownType === "x" ? "x" : state.unknownType === "phi" ? "phi" : "omega";
  return `${label} in [${lo}, ${hi}]`;
}

// ─── Build flow ──────────────────────────────────────────────────────

function buildFlow(
  content: AngleEquationContentDefinition,
  state: AngleEquationEngineState,
): FlowSpec {
  const step = currentStep(state);

  const stepConfigs: Array<{
    id: AngleEquationStepKey;
    title: string;
    goal: string;
  }> = [
    {
      id: "find-angles",
      title: "找出基准角",
      goal: "找出单位圆上满足该函数值的全部角。",
    },
    {
      id: "transform-range",
      title: "变换范围",
      goal: "把待求量的范围变换成 omega*x+phi 的范围。",
    },
    {
      id: "filter-angles",
      title: "筛选合法角",
      goal: "在变换后的范围内选出全部合法角。",
    },
    {
      id: "solve-target",
      title: "回代求解",
      goal: "对每个合法角求解待求量。",
    },
  ];

  const steps: FlowStep[] = stepConfigs.map((cfg) => {
    const done = state.stepState[cfg.id].done;
    const isActive = !done && cfg.id === step;
    const status = done ? "done" : isActive ? "active" : "locked";

    const allowedActions = buildAllowedActions(cfg.id, state, isActive);

    return {
      id: cfg.id,
      title: cfg.title,
      goal: cfg.goal,
      status,
      allowedActions,
      submitMode: "explicit" as const,
    };
  });

  return {
    steps,
    currentStepId: step,
    completionPolicy: content.flowTemplate.completionPolicy,
  };
}

function buildAllowedActions(
  stepId: AngleEquationStepKey,
  _state: AngleEquationEngineState,
  isActive: boolean,
): FlowStep["allowedActions"] {
  if (!isActive) return [];

  switch (stepId) {
    case "find-angles":
      return [
        { type: "select", target: "find-angles", selectionKind: "single" },
        { type: "clear", target: "find-angles" },
        { type: "submit", stepId: "find-angles" },
      ];
    case "transform-range":
      return [
        { type: "input", target: "range-low", valueKind: "text" },
        { type: "input", target: "range-high", valueKind: "text" },
        { type: "clear", target: "transform-range" },
        { type: "submit", stepId: "transform-range" },
      ];
    case "filter-angles":
      return [
        { type: "select", target: "filter-angles", selectionKind: "single" },
        { type: "clear", target: "filter-angles" },
        { type: "submit", stepId: "filter-angles" },
      ];
    case "solve-target":
      return [
        { type: "input", target: "solution-*", valueKind: "text" },
        { type: "clear", target: "solve-target" },
        { type: "submit", stepId: "solve-target" },
      ];
  }
}

// ─── Build guide ─────────────────────────────────────────────────────

function buildGuide(
  content: AngleEquationContentDefinition,
  state: AngleEquationEngineState,
  phase: SessionPhase,
  flow: FlowSpec,
): GuideSpec {
  const step = currentStep(state);
  const hint = phase === "wrong_feedback" ? wrongHint(step) : defaultHint(step);

  return {
    banner: content.guideTemplate.banner,
    hint,
    statusCopy:
      phase === "wrong_feedback"
        ? "请回到左侧修正当前步骤。"
        : "左侧负责操作，右侧负责引导。",
    stepItems: content.flowTemplate.guideSteps.map((guideStep) => {
      const flowStep = flow.steps.find((s) => s.id === guideStep.stepId);
      const summary =
        flowStep?.status === "done"
          ? state.stepState[guideStep.stepId as AngleEquationStepKey].value ||
            "已完成"
          : guideStep.summary;
      return {
        stepId: guideStep.stepId,
        title: guideStep.title,
        status: flowStep?.status || "locked",
        summary,
      };
    }),
  };
}

function defaultHint(step: AngleEquationStepKey): string {
  switch (step) {
    case "find-angles":
      return "在单位圆上选出满足该函数值的所有角。";
    case "transform-range":
      return "先把待求量的范围变换到 omega*x+phi 的范围。";
    case "filter-angles":
      return "从候选角中选出落在变换后范围内的全部角。";
    case "solve-target":
      return "对每个合法角回代求解。";
  }
}

function wrongHint(step: AngleEquationStepKey): string {
  switch (step) {
    case "find-angles":
      return "这个函数值在单位圆上不止一个位置，检查是否找全了。";
    case "transform-range":
      return "注意范围的等价变换，omega 为负时不等号方向要反转。";
    case "filter-angles":
      return "这些角本身成立，但不都落在题目给定范围内。";
    case "solve-target":
      return "检查回代求解的过程，确保所有解都在原始范围内。";
  }
}

// ─── Build feedback ──────────────────────────────────────────────────

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

export function buildAngleEquationFeedbackPacket(
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

// ─── Build instance ──────────────────────────────────────────────────

function buildInstance(
  task: TaskDefinition,
  content: AngleEquationContentDefinition,
  state: AngleEquationEngineState,
  phase: SessionPhase,
): ExerciseInstance {
  const flow = buildFlow(content, state);
  const step = currentStep(state);

  return {
    instanceId: state.instanceId,
    taskId: task.id,
    engineKind: task.engineKind,
    contentId: content.id,
    prompt: buildPrompt(task, state),
    scene: buildScene(state, phase),
    flow,
    guide: buildGuide(content, state, phase, flow),
    feedback: buildFeedback(step),
  };
}

function buildPrompt(
  _task: TaskDefinition,
  state: AngleEquationEngineState,
): string {
  const { trigFn, omega, phi, value } = state.scenarioParams;
  const unknown =
    state.unknownType === "x"
      ? "x"
      : state.unknownType === "phi"
        ? "phi"
        : "omega";
  const [lo, hi] = state.scenarioParams.unknownRange;

  let equationInner = "";
  if (state.unknownType === "x") {
    const omegaStr = omega === 1 ? "" : omega === -1 ? "-" : `${omega}`;
    const phiStr = phi === "0" ? "" : phi.startsWith("-") ? ` ${phi}` : ` + ${phi}`;
    equationInner = `${omegaStr}x${phiStr}`;
  } else if (state.unknownType === "phi") {
    equationInner = "x + phi";
  } else {
    equationInner = "omega * x";
  }

  return `已知 ${trigFn}(${equationInner}) = ${value}，${unknown} ∈ [${lo}, ${hi}]，求 ${unknown} 的所有值。`;
}

// ─── Main entry ──────────────────────────────────────────────────────

export function buildAngleEquationRuntime(
  task: TaskDefinition,
  content: AngleEquationContentDefinition,
  state: AngleEquationEngineState,
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
