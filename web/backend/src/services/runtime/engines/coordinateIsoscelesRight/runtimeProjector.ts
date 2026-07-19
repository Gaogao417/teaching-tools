import type {
  CoordIsoscelesContentDefinition,
  CoordIsoscelesStepKey,
  CoordIsoscelesWorkspaceModel,
} from "../../../../../../shared/coordinateIsoscelesRight";
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
import type { CoordIsoscelesEngineState } from "./types";
import { pickScenario } from "./scenarioBank";

// ─── Helpers ───────────────────────────────────────────────────────────

const STEP_ORDER: CoordIsoscelesStepKey[] = [
  "construct-lines",
  "identify-congruent",
  "setup-equations",
  "solve-coordinates",
];

function makeCue(
  key: string,
  scope: FeedbackCue["scope"],
  targetRef?: string,
): FeedbackCue {
  return { key, scope, targetRef };
}

function currentStep(state: CoordIsoscelesEngineState): CoordIsoscelesStepKey {
  return STEP_ORDER.find((key) => !state.stepState[key].done) || "solve-coordinates";
}

// ─── Build workspace model ─────────────────────────────────────────────

function buildWorkspaceModel(
  state: CoordIsoscelesEngineState,
  scenario: ReturnType<typeof getScenario>,
): CoordIsoscelesWorkspaceModel {
  const step = currentStep(state);

  // Compute grid bounds from B, C, and both solutions
  const points = [
    state.scenarioParams.B,
    state.scenarioParams.C,
    ...state.answerKey.solutions,
  ];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = 1;
  const gridBounds = {
    xMin: Math.min(...xs) - pad,
    xMax: Math.max(...xs) + pad,
    yMin: Math.min(...ys) - pad,
    yMax: Math.max(...ys) + pad,
  };

  const model: CoordIsoscelesWorkspaceModel = {
    B: state.scenarioParams.B,
    C: state.scenarioParams.C,
    currentStepId: step,
    constructionOptions: scenario.constructionOptions,
    congruenceOptions: scenario.congruenceOptions,
    gridBounds,
  };

  if (state.stepState["construct-lines"].done) {
    model.selectedConstruction = state.answerKey.correctConstruction;
  }
  if (state.stepState["identify-congruent"].done) {
    model.selectedCongruence = state.answerKey.correctCongruence;
  }
  if (state.stepState["solve-coordinates"].done) {
    model.solvedCoord = state.answerKey.solutions[0];
  }

  return model;
}

function getScenario(state: CoordIsoscelesEngineState) {
  return pickScenario(state.index);
}

// ─── Build scene ───────────────────────────────────────────────────────

function buildScene(
  state: CoordIsoscelesEngineState,
  _phase: SessionPhase,
): SceneSpec {
  const scenario = getScenario(state);
  const model = buildWorkspaceModel(state, scenario);

  const entities: SceneSpec["entities"] = [
    {
      id: "coord-isosceles-right-model",
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

// ─── Build flow ────────────────────────────────────────────────────────

function buildFlow(
  content: CoordIsoscelesContentDefinition,
  state: CoordIsoscelesEngineState,
): FlowSpec {
  const step = currentStep(state);

  const stepConfigs: Array<{
    id: CoordIsoscelesStepKey;
    title: string;
    goal: string;
  }> = [
    {
      id: "construct-lines",
      title: "构造辅助线",
      goal: "选择正确的辅助线构造方式。",
    },
    {
      id: "identify-congruent",
      title: "识别全等与对应边",
      goal: "指出两个全等三角形及对应边关系。",
    },
    {
      id: "setup-equations",
      title: "列方程组",
      goal: "利用对应边相等列关于 a、b 的二元一次方程组。",
    },
    {
      id: "solve-coordinates",
      title: "求解坐标",
      goal: "解方程组，求出 A 的坐标。",
    },
  ];

  const steps: FlowStep[] = stepConfigs.map((cfg) => {
    const done = state.stepState[cfg.id].done;
    const isActive = !done && cfg.id === step;
    const status = done ? "done" : isActive ? "active" : "locked";

    const allowedActions = buildAllowedActions(cfg.id, isActive);

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
  stepId: CoordIsoscelesStepKey,
  isActive: boolean,
): FlowStep["allowedActions"] {
  if (!isActive) return [];

  switch (stepId) {
    case "construct-lines":
      return [
        { type: "select", target: "construct-lines", selectionKind: "single", presentation: { label: "辅助线方案" } },
        { type: "clear", target: "construct-lines" },
        { type: "submit", stepId: "construct-lines" },
      ];
    case "identify-congruent":
      return [
        { type: "select", target: "identify-congruent", selectionKind: "single", presentation: { label: "全等关系" } },
        { type: "clear", target: "identify-congruent" },
        { type: "submit", stepId: "identify-congruent" },
      ];
    case "setup-equations":
      return [
        { type: "input", target: "equation-1", valueKind: "text", presentation: { slots: [{ id: "equation-1", label: "方程 ①", placeholder: "输入第一条方程" }] } },
        { type: "input", target: "equation-2", valueKind: "text", presentation: { slots: [{ id: "equation-2", label: "方程 ②", placeholder: "输入第二条方程" }] } },
        { type: "clear", target: "setup-equations" },
        { type: "submit", stepId: "setup-equations" },
      ];
    case "solve-coordinates":
      return [
        { type: "input", target: "coord-a", valueKind: "text", presentation: { slots: [{ id: "coord-a", label: "横坐标 a", placeholder: "输入 a" }] } },
        { type: "input", target: "coord-b", valueKind: "text", presentation: { slots: [{ id: "coord-b", label: "纵坐标 b", placeholder: "输入 b" }] } },
        { type: "clear", target: "solve-coordinates" },
        { type: "submit", stepId: "solve-coordinates" },
      ];
  }
}

// ─── Build guide ───────────────────────────────────────────────────────

function buildGuide(
  content: CoordIsoscelesContentDefinition,
  state: CoordIsoscelesEngineState,
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
          ? state.stepState[guideStep.stepId as CoordIsoscelesStepKey].value ||
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

function defaultHint(step: CoordIsoscelesStepKey): string {
  switch (step) {
    case "construct-lines":
      return "过直角顶点 A 作横竖辅助线，并从 B、C 分别作垂线。选择正确的构造方式。";
    case "identify-congruent":
      return "构造辅助线后形成两个直角三角形，指出全等关系及对应边。";
    case "setup-equations":
      return "利用对应边相等，设 A(a,b)，列出关于 a、b 的方程组。";
    case "solve-coordinates":
      return "解方程组，求出 A 的坐标。";
  }
}

function wrongHint(step: CoordIsoscelesStepKey): string {
  switch (step) {
    case "construct-lines":
      return "辅助线应该过哪个点？注意直角顶点在哪里。";
    case "identify-congruent":
      return "注意对应关系：一个三角形的竖直边应该等于另一个三角形的水平边。";
    case "setup-equations":
      return "检查方程是否由正确的对应边关系得出。";
    case "solve-coordinates":
      return "方程列对了，但解的过程再检查一下计算。";
  }
}

// ─── Build feedback ────────────────────────────────────────────────────

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

export function buildCoordIsoscelesFeedbackPacket(
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

// ─── Build prompt ──────────────────────────────────────────────────────

function buildPrompt(
  _task: TaskDefinition,
  state: CoordIsoscelesEngineState,
): string {
  const { B, C } = state.scenarioParams;
  return `已知等腰 Rt△ABC，∠A=90°，AB=AC，B(${B.x},${B.y})，C(${C.x},${C.y})。求 A 的坐标。`;
}

// ─── Build instance ────────────────────────────────────────────────────

function buildInstance(
  task: TaskDefinition,
  content: CoordIsoscelesContentDefinition,
  state: CoordIsoscelesEngineState,
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

// ─── Main entry ────────────────────────────────────────────────────────

export function buildCoordIsoscelesRuntime(
  task: TaskDefinition,
  content: CoordIsoscelesContentDefinition,
  state: CoordIsoscelesEngineState,
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
