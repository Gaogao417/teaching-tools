import {
  ActionSpec,
  Angle,
  AnswerPayload,
  AnswerResponse,
  ApiErrorResponse,
  ExerciseInstance,
  ExerciseRuntimeSpec,
  FeedbackCue,
  FeedbackSpec,
  GuideStepSchema,
  GuideSpec,
  FinishPracticeResponse,
  FlowSpec,
  FlowStep,
  GuidedSolveProblem,
  GuidedStepKey,
  InteractionZone,
  MeaningProblem,
  Problem,
  ProblemRenderSchema,
  RatioToSideProblem,
  RestorePracticeResponse,
  ResultSnapshot,
  Role,
  RuntimeActionEvent,
  RuntimeActionResponse,
  RuntimeFeedbackPacket,
  SceneAnchor,
  SceneEntity,
  SceneOverlay,
  SceneSpec,
  SessionPhase,
  ServerRuntimeState,
  Side,
  StartPracticeResponse,
  TaskId,
  TrigFunction,
} from "../../../shared/contracts";
import { TASK_COLORS, TASK_LABELS } from "../../../shared/tasks";
import { db } from "../db/database";

type LengthValue = { n: number; s: number };

type StoredProblemRecord = {
  publicProblem: Problem;
  answerKey: unknown;
};

type MeaningAnswerKey = {
  roles: [Role, Role];
};

type RatioAnswerKey = {
  triple: Record<Side, LengthValue>;
};

type GuidedAnswerKey = {
  zRoles: Partial<Record<Role, string>>;
  thirdRole: Role;
  thirdZ: string;
  finalNumerator: string;
  finalDenominator: string;
};

function hasRenderSchema(problem: Problem): problem is Problem & { renderSchema: ProblemRenderSchema } {
  return Boolean(problem.renderSchema?.workspace?.sides?.length);
}

const ACUTE_ANGLES: Angle[] = ["A", "C"];
const TRIGS: TrigFunction[] = ["sin", "cos", "tan", "cot"];
const ROLE_BY_TRIG: Record<TrigFunction, [Role, Role]> = {
  sin: ["opposite", "hypotenuse"],
  cos: ["adjacent", "hypotenuse"],
  tan: ["opposite", "adjacent"],
  cot: ["adjacent", "opposite"],
};

const TRIPLE_BANK: Array<Record<Side, LengthValue>> = [
  { AB: makeLength(3), BC: makeLength(4), AC: makeLength(5) },
  { AB: makeLength(5), BC: makeLength(12), AC: makeLength(13) },
  { AB: makeLength(7), BC: makeLength(24), AC: makeLength(25) },
  { AB: makeLength(1), BC: makeLength(1, 3), AC: makeLength(2) },
  { AB: makeLength(1), BC: makeLength(1), AC: makeLength(1, 2) },
  { AB: makeLength(1), BC: makeLength(2), AC: makeLength(1, 5) },
  { AB: makeLength(1), BC: makeLength(3), AC: makeLength(1, 10) },
  { AB: makeLength(1), BC: makeLength(2, 2), AC: makeLength(3) },
];

function makeLength(n: number, s = 1): LengthValue {
  return { n, s };
}

function formatLength(len: LengthValue): string {
  if (len.s === 1) return String(len.n);
  if (len.n === 1) return `√${len.s}`;
  return `${len.n}√${len.s}`;
}

function lengthValue(len: LengthValue): number {
  return len.n * Math.sqrt(len.s);
}

function parseLengthInput(str: string): LengthValue | null {
  const value = str.trim().replace(/\s+/g, "");
  const sqrtMatch = value.match(/^(\d*)[√]\s*(\d+)$/);
  if (sqrtMatch) {
    return makeLength(sqrtMatch[1] ? Number(sqrtMatch[1]) : 1, Number(sqrtMatch[2]));
  }
  const sqrtMatch2 = value.match(/^(\d*)sqrt\s*\(?(\d+)\)?$/i);
  if (sqrtMatch2) {
    return makeLength(sqrtMatch2[1] ? Number(sqrtMatch2[1]) : 1, Number(sqrtMatch2[2]));
  }
  const num = Number(value);
  if (!Number.isNaN(num)) {
    const simple = [
      { v: Math.sqrt(2), n: 1, s: 2 },
      { v: Math.sqrt(3), n: 1, s: 3 },
      { v: Math.sqrt(5), n: 1, s: 5 },
      { v: Math.sqrt(10), n: 1, s: 10 },
      { v: 2 * Math.sqrt(2), n: 2, s: 2 },
    ];
    for (const cand of simple) {
      if (Math.abs(num - cand.v) < 0.0001) {
        return makeLength(cand.n, cand.s);
      }
    }
    return makeLength(Math.round(num), 1);
  }
  return null;
}

function lengthsEqual(a: LengthValue, b: LengthValue): boolean {
  return Math.abs(lengthValue(a) - lengthValue(b)) < 0.0001;
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function getRoleSideMap(referenceAngle: Angle): Record<Role, Side> {
  if (referenceAngle === "C") {
    return { opposite: "AB", adjacent: "BC", hypotenuse: "AC" };
  }
  return { opposite: "BC", adjacent: "AB", hypotenuse: "AC" };
}

function getSideForRole(referenceAngle: Angle, role: Role): Side {
  return getRoleSideMap(referenceAngle)[role];
}

function buildWorkspaceSchema(referenceAngle: Angle): ProblemRenderSchema["workspace"] {
  const vertices = {
    A: { x: 90, y: 288 },
    B: { x: 320, y: 288 },
    C: { x: 320, y: 110 },
  };
  const sideCoords = {
    AB: {
      x1: vertices.A.x,
      y1: vertices.A.y,
      x2: vertices.B.x,
      y2: vertices.B.y,
      label: { x: 205, y: 316 },
      input: { x: 205, y: 255 },
      hitZone: { kind: "line", x1: vertices.A.x, y1: vertices.A.y, x2: vertices.B.x, y2: vertices.B.y, strokeWidth: 30 },
    },
    BC: {
      x1: vertices.B.x,
      y1: vertices.B.y,
      x2: vertices.C.x,
      y2: vertices.C.y,
      label: { x: 348, y: 205 },
      input: { x: 350, y: 205 },
      hitZone: { kind: "line", x1: vertices.B.x, y1: vertices.B.y, x2: vertices.C.x, y2: vertices.C.y, strokeWidth: 30 },
    },
    AC: {
      x1: vertices.A.x,
      y1: vertices.A.y,
      x2: vertices.C.x,
      y2: vertices.C.y,
      label: { x: 194, y: 122 },
      input: { x: 200, y: 150 },
      hitZone: {
        kind: "polygon",
        points: [
          { x: 82, y: 302 },
          { x: 104, y: 322 },
          { x: 336, y: 124 },
          { x: 314, y: 96 },
        ],
      },
    },
  } satisfies Record<Side, {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    label: { x: number; y: number };
    input: { x: number; y: number };
    hitZone: ProblemRenderSchema["workspace"]["sides"][number]["hitZone"];
  }>;

  return {
    stage: { width: 460, height: 340 },
    vertices,
    rightAnglePath: "M292 288 L292 260 L320 260",
    referenceAnglePath:
      referenceAngle === "A"
        ? "M124 288 A34 34 0 0 1 111 259"
        : "M320 146 A34 34 0 0 1 290 134",
    sides: (["AB", "BC", "AC"] as Side[]).map((side) => ({
      side,
      role: (Object.entries(getRoleSideMap(referenceAngle)).find(([, value]) => value === side)?.[0] ?? "hypotenuse") as Role,
      label: sideCoords[side].label,
      input: sideCoords[side].input,
      hitZone: sideCoords[side].hitZone,
    })),
  };
}

function buildGuideSteps(problem: Problem): GuideStepSchema[] {
  if (problem.type === "meaning") {
    return [
      {
        id: "pick-numerator",
        title: "先选分子边",
        body: "在左侧教具上点击符合目标三角比定义的分子边。",
        status: problem.status === "correct" || problem.attempts > 0 ? "done" : "active",
      },
      {
        id: "pick-denominator",
        title: "再选分母边",
        body: "第二次点击补上分母边；右侧只负责提示，不承载输入。",
        status: problem.status === "correct" ? "done" : problem.attempts > 0 ? "active" : "pending",
      },
    ];
  }

  if (problem.type === "ratioToSide") {
    return [
      {
        id: "map-roles",
        title: "先认三条边的角色",
        body: "先看参考角，再判断对边、邻边和斜边分别是哪一条。",
        status: "done",
      },
      {
        id: "fill-lengths",
        title: "在左侧边上填数值",
        body: "所有输入和提交都在左侧教具区完成，右侧只展示状态。",
        status: problem.status === "correct" ? "done" : "active",
      },
    ];
  }

  const currentStep = (["ratio", "third", "final"] as const).find((key) => !problem.stepState[key].done) ?? "final";
  return [
    {
      id: "ratio",
      title: "第 2 步：写最简 z 比",
      body: problem.stepState.ratio.done ? problem.stepState.ratio.value : "在左侧已知边旁输入对应的 z 系数。",
      status: problem.stepState.ratio.done ? "done" : currentStep === "ratio" ? "active" : "pending",
    },
    {
      id: "third",
      title: "第 3 步：补第三边",
      body: problem.stepState.third.done ? problem.stepState.third.value : "继续在左侧教具上补出第三边的 z 系数。",
      status: problem.stepState.third.done ? "done" : currentStep === "third" ? "active" : "pending",
    },
    {
      id: "final",
      title: `第 4 步：求 ${problem.target.toUpperCase()} ${problem.referenceAngle}`,
      body: problem.stepState.final.done ? problem.stepState.final.value : "最后把分子边和分母边代回目标三角比。",
      status: problem.stepState.final.done ? "done" : currentStep === "final" ? "active" : "pending",
    },
  ];
}

function buildRenderSchema(problem: Problem): ProblemRenderSchema {
  const workspace = buildWorkspaceSchema(problem.referenceAngle);
  if (problem.type === "meaning") {
    return {
      workspace,
      guide: {
        title: `求 ${problem.target.toUpperCase()} ${problem.referenceAngle}`,
        body: "按顺序在左侧三角形上先选分子边，再选分母边。",
        steps: buildGuideSteps(problem),
      },
      feedback: { correct: "correct", wrong: "wrong", finish: "finish" },
    };
  }

  if (problem.type === "ratioToSide") {
    return {
      workspace,
      guide: {
        title: `${problem.target.toUpperCase()} ${problem.referenceAngle} = ${problem.ratio.numerator}/${problem.ratio.denominator}`,
        body: "左侧教具区负责填写和提交，右侧只提示你正在做什么。",
        steps: buildGuideSteps(problem),
      },
      feedback: { correct: "correct", wrong: "wrong", finish: "finish" },
    };
  }

  return {
    workspace,
    guide: {
      title: `已知 ${problem.knownType.toUpperCase()} ${problem.referenceAngle}，求 ${problem.target.toUpperCase()} ${problem.referenceAngle}`,
      body: `已知 ${problem.given.map((item) => `${item.edge}=${item.value}`).join("，")}。`,
      steps: buildGuideSteps(problem),
    },
    feedback: { correct: "correct", wrong: "wrong", finish: "finish" },
  };
}

function makeCue(key: string, scope: FeedbackCue["scope"], targetRef?: string): FeedbackCue {
  return { key, scope, targetRef };
}

function buildScene(problem: Problem): SceneSpec {
  const workspace = problem.renderSchema.workspace;
  const entities: SceneEntity[] = [
    {
      id: "triangle-main",
      kind: "triangle",
      vertices: workspace.vertices,
      rightAnglePath: workspace.rightAnglePath,
      referenceAnglePath: workspace.referenceAnglePath,
    },
    ...(["AB", "BC", "AC"] as Side[]).map((side) => {
      const schema = workspace.sides.find((item) => item.side === side)!;
      return {
        id: `edge-${side}`,
        kind: "edge" as const,
        from: side[0],
        to: side[1],
        label: side,
        role: schema.role,
      };
    }),
    ...(["A", "B", "C"] as const).map((vertex) => ({
      id: `vertex-${vertex}`,
      kind: "vertex" as const,
      x: workspace.vertices[vertex].x,
      y: workspace.vertices[vertex].y,
      label: vertex,
    })),
  ];

  const zones: InteractionZone[] = workspace.sides.map((schema) => ({
    id: `zone-${schema.side}`,
    zoneKind: "edge",
    targetRef: `edge-${schema.side}`,
    shape:
      schema.hitZone.kind === "line"
        ? {
            type: "lineCorridor",
            from: `vertex-${schema.side[0]}`,
            to: `vertex-${schema.side[1]}`,
            width: schema.hitZone.strokeWidth,
          }
        : {
            type: "polygon",
            points: schema.hitZone.points,
          },
    accepts: ["select", "input"],
  }));

  const anchors: SceneAnchor[] = workspace.sides.map((schema) => ({
    id: `anchor-${schema.side}`,
    anchorKind: "value-input",
    entityRef: `edge-${schema.side}`,
    x: schema.input.x,
    y: schema.input.y,
  }));

  const overlays: SceneOverlay[] = [
    { id: "overlay-current-step", overlayKind: "highlight" },
    { id: "overlay-reference-angle", overlayKind: "badge" },
  ];

  if (problem.type === "guidedSolve") {
    anchors.push(
      { id: "anchor-final-numerator", anchorKind: "formula-slot", x: 176, y: 68 },
      { id: "anchor-final-denominator", anchorKind: "formula-slot", x: 176, y: 110 },
    );
    entities.push({
      id: "formula-target",
      kind: "formula",
      label: `${problem.target.toUpperCase()} ${problem.referenceAngle}`,
      slots: ["anchor-final-numerator", "anchor-final-denominator"],
    });
  }

  return {
    sceneKind: "triangle",
    entities,
    zones,
    anchors,
    overlays,
  };
}

function runtimeGuideBanner(problem: Problem): string {
  if (problem.type === "meaning") {
    return `求 ${problem.target.toUpperCase()} ${problem.referenceAngle}`;
  }
  if (problem.type === "ratioToSide") {
    return `${problem.target.toUpperCase()} ${problem.referenceAngle} = ${problem.ratio.numerator}/${problem.ratio.denominator}`;
  }
  return `已知 ${problem.knownType.toUpperCase()} ${problem.referenceAngle}，求 ${problem.target.toUpperCase()} ${problem.referenceAngle}`;
}

function runtimeGuideHint(problem: Problem): string {
  if (problem.type === "meaning") {
    return "先看参考角，再依次确定分子边和分母边。";
  }
  if (problem.type === "ratioToSide") {
    return "先判断边角色，再把比值映射回三条边。";
  }
  const currentStep = (["ratio", "third", "final"] as const).find((key) => !problem.stepState[key].done) ?? "final";
  if (currentStep === "ratio") return "先把已知边化成最简 z 比。";
  if (currentStep === "third") return "根据前一步的 z 比补出第三边。";
  return "最后把目标三角比的分子和分母填回去。";
}

function buildFlow(problem: Problem): FlowSpec {
  const makeSubmit = (stepId: string): ActionSpec => ({ type: "submit", stepId });

  if (problem.type === "meaning") {
    const steps: FlowStep[] = [
      {
        id: "pick-numerator",
        title: "先选分子边",
        goal: "选出符合三角比定义的分子边",
        status: problem.status === "correct" || problem.attempts > 0 ? "done" : "active",
        allowedActions: [
          { type: "select", target: "edge", selectionKind: "single" },
          { type: "clear", target: "meaning-selection" },
          makeSubmit("pick-roles"),
        ],
        submitMode: "explicit",
      },
      {
        id: "pick-denominator",
        title: "再选分母边",
        goal: "补全分母边",
        status: problem.status === "correct" ? "done" : problem.attempts > 0 ? "active" : "locked",
        allowedActions: [
          { type: "select", target: "edge", selectionKind: "ordered" },
          { type: "clear", target: "meaning-selection" },
          makeSubmit("pick-roles"),
        ],
        submitMode: "explicit",
      },
    ];
    return {
      steps,
      currentStepId: problem.attempts > 0 ? "pick-denominator" : "pick-numerator",
      completionPolicy: "single-step",
    };
  }

  if (problem.type === "ratioToSide") {
    return {
      steps: [
        {
          id: "fill-lengths",
          title: "补全三边长度",
          goal: "在三条边上填写长度",
          status: problem.status === "correct" ? "done" : "active",
          allowedActions: [
            { type: "input", target: "edge-length", valueKind: "length" },
            { type: "clear", target: "edge-length" },
            makeSubmit("fill-lengths"),
          ],
          submitMode: "explicit",
        },
      ],
      currentStepId: "fill-lengths",
      completionPolicy: "whole-problem",
    };
  }

  const currentStepId = (["ratio", "third", "final"] as const).find((key) => !problem.stepState[key].done) ?? "final";
  return {
    steps: [
      {
        id: "ratio",
        title: "写最简 z 比",
        goal: "把已知边写成最简 z 比",
        status: problem.stepState.ratio.done ? "done" : currentStepId === "ratio" ? "active" : "locked",
        allowedActions: [
          { type: "input", target: "ratio", valueKind: "length" },
          { type: "clear", target: "ratio" },
          makeSubmit("ratio"),
        ],
        submitMode: "explicit",
      },
      {
        id: "third",
        title: "补第三边",
        goal: "用 z 比补出第三边",
        status: problem.stepState.third.done ? "done" : currentStepId === "third" ? "active" : "locked",
        allowedActions: [
          { type: "input", target: "third", valueKind: "length" },
          { type: "clear", target: "third" },
          makeSubmit("third"),
        ],
        submitMode: "explicit",
      },
      {
        id: "final",
        title: "求目标三角比",
        goal: "把分子边和分母边代回目标三角比",
        status: problem.stepState.final.done ? "done" : currentStepId === "final" ? "active" : "locked",
        allowedActions: [
          { type: "input", target: "final", valueKind: "length" },
          { type: "clear", target: "final" },
          makeSubmit("final"),
        ],
        submitMode: "explicit",
      },
    ],
    currentStepId,
    completionPolicy: "multi-step",
  };
}

function buildGuide(problem: Problem): GuideSpec {
  return {
    banner: runtimeGuideBanner(problem),
    hint: runtimeGuideHint(problem),
    statusCopy: problem.status === "wrong" ? "请回到左侧修正当前步骤。" : "左侧负责操作，右侧负责引导。",
    stepItems: buildGuideSteps(problem).map((step) => ({
      stepId: step.id,
      title: step.title,
      status: step.status === "pending" ? "locked" : step.status,
      summary: step.body,
    })),
  };
}

function buildFeedbackSpec(problem: Problem): FeedbackSpec {
  const currentStep = buildFlow(problem).currentStepId;
  return {
    correct: [makeCue("correct", "global"), makeCue("highlight-correct", "workspace", currentStep)],
    wrong: [makeCue("wrong", "global"), makeCue("highlight-wrong", "guide", currentStep)],
    finish: [makeCue("finish", "global")],
  };
}

function buildRuntimeState(problem: Problem, phase: SessionPhase): ServerRuntimeState {
  const flow = buildFlow(problem);
  return {
    phase,
    currentStepId: flow.currentStepId,
    completedStepIds: flow.steps.filter((step) => step.status === "done").map((step) => step.id),
    problemStatus: problem.status,
    attempts: problem.attempts,
  };
}

function buildExerciseInstance(problem: Problem): ExerciseInstance {
  return {
    instanceId: problem.id,
    taskId: problem.taskId,
    engineKind: "triangle-trig",
    contentId: `legacy.${problem.taskId}`,
    prompt: problem.prompt,
    scene: buildScene(problem),
    flow: buildFlow(problem),
    guide: buildGuide(problem),
    feedback: buildFeedbackSpec(problem),
  };
}

function buildRuntime(problem: Problem, phase: SessionPhase): ExerciseRuntimeSpec {
  return {
    instance: buildExerciseInstance(problem),
    runtimeState: buildRuntimeState(problem, phase),
  };
}

function buildFeedbackPacket(problem: Problem, evaluation: "correct" | "wrong" | "progress"): RuntimeFeedbackPacket {
  const feedback = buildFeedbackSpec(problem);
  if (evaluation === "correct") {
    return { global: feedback.correct, workspace: [], guide: [] };
  }
  if (evaluation === "wrong") {
    return { global: feedback.wrong, workspace: [], guide: feedback.wrong };
  }
  return { global: [], workspace: [], guide: [] };
}

function groupLabel(taskId: TaskId): string {
  if (taskId === "meaning") return "第 1 组";
  if (taskId === "ratioToSide") return "第 2 组";
  return "第 3 组";
}

function appError(code: ApiErrorResponse["error"]["code"], message: string, status = 400) {
  return { status, body: { error: { code, message } } };
}

function generateMeaningProblem(index: number): StoredProblemRecord {
  const target = randomItem(TRIGS);
  const referenceAngle = randomItem(ACUTE_ANGLES);
  const roles = ROLE_BY_TRIG[target];
  const problem: MeaningProblem = {
    id: crypto.randomUUID(),
    taskId: "meaning",
    type: "meaning",
    index,
    status: "pending",
    attempts: 0,
    firstTryCorrect: null,
    prompt: `请先选出 ${target.toUpperCase()} ${referenceAngle} 的分子边，再选分母边。`,
    target,
    referenceAngle,
    renderSchema: {} as ProblemRenderSchema,
    ui: {
      numeratorLabel: "分子边",
      denominatorLabel: "分母边",
      selectableRoles: ["opposite", "adjacent", "hypotenuse"],
    },
  };
  problem.renderSchema = buildRenderSchema(problem);
  return { publicProblem: problem, answerKey: { roles } satisfies MeaningAnswerKey };
}

function computeRatioPair(triple: Record<Side, LengthValue>, trig: TrigFunction, angle: Angle) {
  const [numRole, denRole] = ROLE_BY_TRIG[trig];
  const numerator = formatLength(triple[getSideForRole(angle, numRole)]);
  const denominator = formatLength(triple[getSideForRole(angle, denRole)]);
  return { numerator, denominator };
}

function generateRatioProblem(index: number): StoredProblemRecord {
  const target = randomItem(TRIGS);
  const referenceAngle = randomItem(ACUTE_ANGLES);
  const triple = randomItem(TRIPLE_BANK);
  const ratio = computeRatioPair(triple, target, referenceAngle);
  const problem: RatioToSideProblem = {
    id: crypto.randomUUID(),
    taskId: "ratioToSide",
    type: "ratioToSide",
    index,
    status: "pending",
    attempts: 0,
    firstTryCorrect: null,
    prompt: `根据 ${target.toUpperCase()} ${referenceAngle} = ${ratio.numerator}/${ratio.denominator} 推断三边长度，并填写到图上。`,
    target,
    referenceAngle,
    renderSchema: {} as ProblemRenderSchema,
    ratio,
    ui: {
      edges: ["AB", "BC", "AC"],
    },
  };
  problem.renderSchema = buildRenderSchema(problem);
  return { publicProblem: problem, answerKey: { triple } satisfies RatioAnswerKey };
}

function generateGuidedProblem(index: number): StoredProblemRecord {
  const triple = randomItem(TRIPLE_BANK);
  const referenceAngle = randomItem(ACUTE_ANGLES);
  const knownType = randomItem(TRIGS);
  const target = randomItem(TRIGS.filter((item) => item !== knownType));
  const knownRoles = ROLE_BY_TRIG[knownType];
  const thirdRole = (["opposite", "adjacent", "hypotenuse"] as Role[]).find(
    (role) => !knownRoles.includes(role),
  ) as Role;

  const given = knownRoles.map((role) => ({
    edge: getSideForRole(referenceAngle, role),
    value: formatLength(triple[getSideForRole(referenceAngle, role)]),
    role,
  }));

  const zRoles = Object.fromEntries(
    knownRoles.map((role) => [role, formatLength(triple[getSideForRole(referenceAngle, role)])]),
  ) as Partial<Record<Role, string>>;

  const [finalNumRole, finalDenRole] = ROLE_BY_TRIG[target];
  const problem: GuidedSolveProblem = {
    id: crypto.randomUUID(),
    taskId: "guidedSolve",
    type: "guidedSolve",
    index,
    status: "pending",
    attempts: 0,
    firstTryCorrect: null,
    prompt: `已知 ${knownType.toUpperCase()} ${referenceAngle} 对应的两条边，逐步求 ${target.toUpperCase()} ${referenceAngle}。`,
    target,
    referenceAngle,
    renderSchema: {} as ProblemRenderSchema,
    knownType,
    given,
    stepKeys: ["mark", "ratio", "third", "final"],
    stepState: {
      mark: {
        done: true,
        value: given.map((item) => `${item.role}=${item.value}`).join(", "),
      },
      ratio: { done: false, value: "" },
      third: { done: false, value: "" },
      final: { done: false, value: "" },
    },
  };
  problem.renderSchema = buildRenderSchema(problem);
  return {
    publicProblem: problem,
    answerKey: {
      zRoles,
      thirdRole,
      thirdZ: formatLength(triple[getSideForRole(referenceAngle, thirdRole)]),
      finalNumerator: formatLength(triple[getSideForRole(referenceAngle, finalNumRole)]),
      finalDenominator: formatLength(triple[getSideForRole(referenceAngle, finalDenRole)]),
    } satisfies GuidedAnswerKey,
  };
}

function generateProblem(taskId: TaskId, index: number): StoredProblemRecord {
  if (taskId === "meaning") return generateMeaningProblem(index);
  if (taskId === "ratioToSide") return generateRatioProblem(index);
  return generateGuidedProblem(index);
}

function normalizeProblem(problem: Problem): Problem {
  if (!hasRenderSchema(problem)) {
    (problem as Problem & { renderSchema: ProblemRenderSchema }).renderSchema = buildRenderSchema(problem);
  }
  problem.runtime = buildRuntime(problem, "answering");
  return problem;
}

function loadProblemRows(sessionId: string): StoredProblemRecord[] {
  const rows = db
    .prepare(
      `SELECT public_json, answer_key_json
       FROM practice_problems
       WHERE session_id = ?
       ORDER BY problem_index ASC`,
    )
    .all(sessionId) as Array<{ public_json: string; answer_key_json: string }>;
  return rows.map((row) => ({
    publicProblem: normalizeProblem(JSON.parse(row.public_json) as Problem),
    answerKey: JSON.parse(row.answer_key_json) as unknown,
  }));
}

function saveProblem(problem: Problem, answerKey: unknown): void {
  db.prepare(`UPDATE practice_problems SET public_json = ?, answer_key_json = ? WHERE id = ?`).run(
    JSON.stringify(problem),
    JSON.stringify(answerKey),
    problem.id,
  );
}

function getSession(sessionId: string) {
  return db
    .prepare(`SELECT * FROM practice_sessions WHERE id = ?`)
    .get(sessionId) as
    | {
        id: string;
        task_id: TaskId;
        student_name: string;
        phase: SessionPhase;
        current_index: number;
        started_at: string;
        finished_at: string | null;
        finished: number;
      }
    | undefined;
}

export function startPractice(taskId: TaskId, studentName: string): StartPracticeResponse {
  const trimmed = studentName.trim();
  if (!trimmed) throw appError("INVALID_STUDENT_NAME", "studentName is required");
  const sessionId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const problems = Array.from({ length: 5 }, (_, index) => generateProblem(taskId, index));

  db.prepare(
    `INSERT INTO practice_sessions (id, task_id, student_name, phase, current_index, started_at, finished)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
  ).run(sessionId, taskId, trimmed, "answering", 0, startedAt);

  const insertProblem = db.prepare(
    `INSERT INTO practice_problems (id, session_id, task_id, type, problem_index, public_json, answer_key_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    problems.forEach(({ publicProblem, answerKey }) => {
      insertProblem.run(
        publicProblem.id,
        sessionId,
        taskId,
        publicProblem.type,
        publicProblem.index,
        JSON.stringify(publicProblem),
        JSON.stringify(answerKey),
      );
    });
  });
  tx();

  return {
    sessionId,
    taskId,
    studentName: trimmed,
    currentIndex: 0,
    instanceCount: problems.length,
    elapsedMs: 0,
    phase: "answering",
    runtime: buildRuntime(problems[0].publicProblem, "answering"),
    legacy: {
      problems: problems.map((item) => item.publicProblem),
    },
  };
}

function answerMeaning(problem: MeaningProblem, answerKey: MeaningAnswerKey, payload: AnswerPayload): { correct: boolean; hint?: string } {
  if (payload.type !== "meaning") {
    throw appError("ANSWER_INVALID", "Payload type mismatch");
  }
  const correct =
    payload.numeratorRole === answerKey.roles[0] && payload.denominatorRole === answerKey.roles[1];
  return {
    correct,
    hint: correct ? undefined : "先看参考角，再判断对边、邻边和斜边。",
  };
}

function answerRatio(problem: RatioToSideProblem, answerKey: RatioAnswerKey, payload: AnswerPayload): { correct: boolean; hint?: string } {
  if (payload.type !== "ratioToSide") {
    throw appError("ANSWER_INVALID", "Payload type mismatch");
  }
  const correct = (["AB", "BC", "AC"] as Side[]).every((side) => {
    const raw = payload.placements[side];
    const parsed = raw ? parseLengthInput(raw) : null;
    return parsed ? lengthsEqual(parsed, answerKey.triple[side]) : false;
  });
  return {
    correct,
    hint: correct ? undefined : "先确定参考角，再把比值对应回三条边。",
  };
}

function answerGuided(problem: GuidedSolveProblem, answerKey: GuidedAnswerKey, payload: AnswerPayload): { correct: boolean; hint?: string } {
  if (payload.type !== "guidedSolve") {
    throw appError("ANSWER_INVALID", "Payload type mismatch");
  }
  const { stepKey, value } = payload;
  if (stepKey === "ratio") {
    const roles = Object.keys(answerKey.zRoles) as Role[];
    const correct = roles.every((role) => {
      const parsed = parseLengthInput(value[role] || "");
      const expected = parseLengthInput(answerKey.zRoles[role] || "");
      return parsed && expected ? lengthsEqual(parsed, expected) : false;
    });
    if (correct) {
      problem.stepState.ratio = {
        done: true,
        value: roles.map((role) => `${role}=${answerKey.zRoles[role]}z`).join(", "),
      };
    }
    return {
      correct,
      hint: correct ? undefined : "先把两条已知边化成最简的 z 比。",
    };
  }
  if (stepKey === "third") {
    const parsed = parseLengthInput(value.third || "");
    const expected = parseLengthInput(answerKey.thirdZ);
    const correct = Boolean(parsed && expected && lengthsEqual(parsed, expected));
    if (correct) {
      problem.stepState.third = {
        done: true,
        value: `${answerKey.thirdRole}=${answerKey.thirdZ}z`,
      };
    }
    return {
      correct,
      hint: correct ? undefined : "第三边要基于前一步的 z 比补出。",
    };
  }
  if (stepKey === "final") {
    const numerator = parseLengthInput(value.numerator || "");
    const denominator = parseLengthInput(value.denominator || "");
    const expectedNumerator = parseLengthInput(answerKey.finalNumerator);
    const expectedDenominator = parseLengthInput(answerKey.finalDenominator);
    const correct = Boolean(
      numerator &&
        denominator &&
        expectedNumerator &&
        expectedDenominator &&
        lengthsEqual(numerator, expectedNumerator) &&
        lengthsEqual(denominator, expectedDenominator),
    );
    if (correct) {
      problem.stepState.final = {
        done: true,
        value: `${value.numerator}/${value.denominator}`,
      };
    }
    return {
      correct,
      hint: correct ? undefined : "最后一步把分子边和分母边代回目标三角比。",
    };
  }
  throw appError("ANSWER_INVALID", "Unsupported guided step");
}

function allowedActionTypes(problem: Problem): Set<RuntimeActionEvent["type"]> {
  return new Set(
    buildFlow(problem).steps.flatMap((step) => (step.status === "active" ? step.allowedActions.map((action) => action.type) : [])),
  );
}

function parseRuntimeSubmit(problem: Problem, action: RuntimeActionEvent): AnswerPayload {
  if (action.type !== "submit") {
    throw appError("ACTION_NOT_ALLOWED", "Only submit actions can be evaluated by the current runtime adapter");
  }

  if (problem.type === "meaning") {
    const [numeratorRole, denominatorRole] = (action.value || "").split("|") as [Role, Role];
    if (!numeratorRole || !denominatorRole) {
      throw appError("ANSWER_INVALID", "Meaning submit payload is invalid");
    }
    return {
      type: "meaning",
      numeratorRole,
      denominatorRole,
    };
  }

  if (problem.type === "ratioToSide") {
    const placements = JSON.parse(action.value || "{}") as Record<Side, string>;
    return {
      type: "ratioToSide",
      placements,
    };
  }

  const value = JSON.parse(action.value || "{}") as Record<string, string>;
  const stepKey = action.stepId as GuidedStepKey;
  if (!stepKey) {
    throw appError("ANSWER_INVALID", "Guided submit step is required");
  }
  return {
    type: "guidedSolve",
    stepKey,
    value,
  };
}

export function submitRuntimeAction(
  sessionId: string,
  instanceId: string,
  action: RuntimeActionEvent,
): RuntimeActionResponse {
  const session = getSession(sessionId);
  if (!session) throw appError("SESSION_NOT_FOUND", "Session not found", 404);
  if (session.finished) throw appError("SESSION_FINISHED", "Session already finished", 409);

  const records = loadProblemRows(sessionId);
  const activeRecord = records[session.current_index];
  if (!activeRecord || activeRecord.publicProblem.id !== instanceId) {
    throw appError("INSTANCE_NOT_ACTIVE", "Current instance is not active", 409);
  }

  const problem = activeRecord.publicProblem;
  if (!allowedActionTypes(problem).has(action.type)) {
    throw appError("ACTION_NOT_ALLOWED", "Current step does not allow this action", 409);
  }

  if (action.type === "clear") {
    return {
      accepted: true,
      evaluation: "progress",
      runtimeState: buildRuntimeState(problem, "answering"),
      runtime: buildRuntime(problem, "answering"),
      nextIndex: session.current_index,
      phase: "answering",
      feedback: buildFeedbackPacket(problem, "progress"),
    };
  }

  if (action.type !== "submit") {
    return {
      accepted: true,
      evaluation: "progress",
      runtimeState: buildRuntimeState(problem, "answering"),
      runtime: buildRuntime(problem, "answering"),
      nextIndex: session.current_index,
      phase: "answering",
      feedback: buildFeedbackPacket(problem, "progress"),
    };
  }

  const legacy = submitAnswer(sessionId, instanceId, parseRuntimeSubmit(problem, action));
  return {
    accepted: true,
    evaluation: legacy.correct ? (legacy.phase === "answering" ? "progress" : "correct") : "wrong",
    runtimeState: legacy.runtime?.runtimeState || buildRuntimeState(legacy.problemState, legacy.phase),
    runtime: legacy.runtime,
    feedback: legacy.feedback,
    nextIndex: legacy.nextIndex,
    phase: legacy.phase,
  };
}

export function submitAnswer(sessionId: string, problemId: string, payload: AnswerPayload): AnswerResponse {
  const session = getSession(sessionId);
  if (!session) throw appError("SESSION_NOT_FOUND", "Session not found", 404);
  if (session.finished) throw appError("SESSION_FINISHED", "Session already finished", 409);
  const records = loadProblemRows(sessionId);
  const record = records.find((item) => item.publicProblem.id === problemId);
  if (!record) throw appError("PROBLEM_NOT_FOUND", "Problem not found", 404);

  const problem = record.publicProblem;
  problem.attempts += 1;

  let result: { correct: boolean; hint?: string };
  if (problem.type === "meaning") {
    result = answerMeaning(problem, record.answerKey as MeaningAnswerKey, payload);
  } else if (problem.type === "ratioToSide") {
    result = answerRatio(problem, record.answerKey as RatioAnswerKey, payload);
  } else {
    result = answerGuided(problem, record.answerKey as GuidedAnswerKey, payload);
  }

  let nextIndex = session.current_index;
  let phase: SessionPhase = result.correct ? "correct_pause" : "wrong_feedback";

  if (result.correct) {
    problem.status = "correct";
    if (problem.firstTryCorrect === null) problem.firstTryCorrect = problem.attempts === 1;
    const isSolved =
      problem.type !== "guidedSolve" ||
      (problem.stepState.ratio.done && problem.stepState.third.done && problem.stepState.final.done);
    if (isSolved) {
      if (session.current_index >= records.length - 1) {
        phase = "group_finished";
        nextIndex = session.current_index;
      } else {
        nextIndex = session.current_index + 1;
      }
    } else {
      phase = "answering";
    }
  } else {
    problem.status = "wrong";
    if (problem.firstTryCorrect === null) problem.firstTryCorrect = false;
  }

  problem.renderSchema = buildRenderSchema(problem);

  saveProblem(problem, record.answerKey);
  db.prepare(`UPDATE practice_sessions SET current_index = ?, phase = ? WHERE id = ?`).run(
    nextIndex,
    phase,
    sessionId,
  );

  return {
    correct: result.correct,
    allSolved: phase === "group_finished",
    hint: result.hint,
    problemState: problem,
    nextIndex,
    phase,
    runtime: buildRuntime(problem, phase),
    feedback: buildFeedbackPacket(problem, result.correct ? "correct" : "wrong"),
  };
}

export function restorePractice(sessionId: string): RestorePracticeResponse {
  const session = getSession(sessionId);
  if (!session) throw appError("SESSION_NOT_FOUND", "Session not found", 404);
  const elapsedMs = session.finished_at
    ? Date.parse(session.finished_at) - Date.parse(session.started_at)
    : Date.now() - Date.parse(session.started_at);
  return {
    sessionId: session.id,
    taskId: session.task_id,
    studentName: session.student_name,
    currentIndex: session.current_index,
    instanceCount: loadProblemRows(sessionId).length,
    elapsedMs: Math.max(0, elapsedMs),
    phase: session.phase,
    runtime: (() => {
      const current = loadProblemRows(sessionId)[session.current_index]?.publicProblem;
      return current ? buildRuntime(current, session.phase) : undefined;
    })(),
    legacy: {
      problems: loadProblemRows(sessionId).map((item) => item.publicProblem),
    },
  };
}

function computeStats(problems: Problem[]) {
  const correctCount = problems.filter((problem) => problem.firstTryCorrect).length;
  return {
    correctCount,
    accuracy: problems.length ? correctCount / problems.length : 0,
  };
}

function buildHistory(taskId: TaskId, studentName: string) {
  const rows = db
    .prepare(
      `SELECT snapshot_json
       FROM practice_results
       WHERE task_id = ? AND student_name = ?
       ORDER BY cleared_at DESC
       LIMIT 10`,
    )
    .all(taskId, studentName) as Array<{ snapshot_json: string }>;
  return rows
    .map((row) => JSON.parse(row.snapshot_json) as ResultSnapshot)
    .reverse()
    .map((item) => ({
      elapsedMs: item.elapsedMs,
      clearedAt: item.clearedAt,
    }));
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function finishPractice(sessionId: string): FinishPracticeResponse {
  const existing = db
    .prepare(`SELECT snapshot_json FROM practice_results WHERE session_id = ?`)
    .get(sessionId) as { snapshot_json: string } | undefined;
  if (existing) {
    return {
      sessionId,
      resultSnapshot: JSON.parse(existing.snapshot_json) as ResultSnapshot,
      alreadyFinished: true,
    };
  }

  const session = getSession(sessionId);
  if (!session) throw appError("SESSION_NOT_FOUND", "Session not found", 404);
  const problems = loadProblemRows(sessionId).map((item) => item.publicProblem);
  const finishedAt = new Date().toISOString();
  const elapsedMs = Math.max(0, Date.parse(finishedAt) - Date.parse(session.started_at));
  const stats = computeStats(problems);

  const previous = db
    .prepare(
      `SELECT elapsed_ms
       FROM practice_results
       WHERE task_id = ? AND student_name = ?
       ORDER BY cleared_at DESC
       LIMIT 1`,
    )
    .get(session.task_id, session.student_name) as { elapsed_ms: number } | undefined;

  const history = buildHistory(session.task_id, session.student_name);
  const snapshot: ResultSnapshot = {
    sessionId,
    taskId: session.task_id,
    studentName: session.student_name,
    startedAt: session.started_at,
    clearedAt: finishedAt,
    title: `${groupLabel(session.task_id)} 已完成`,
    groupLabel: TASK_LABELS[session.task_id],
    elapsedMs,
    bestMs: history.length ? Math.min(...history.map((item) => item.elapsedMs), elapsedMs) : elapsedMs,
    avgMs: average([...history.map((item) => item.elapsedMs), elapsedMs].slice(-5)),
    copy: `本次共完成 ${problems.length} 题，可查看详细结果与最近趋势。`,
    problemCount: problems.length,
    firstTryAccuracy: stats.accuracy,
    firstTryCorrectCount: stats.correctCount,
    color: TASK_COLORS[session.task_id],
    deltaVsPreviousMs: previous ? elapsedMs - previous.elapsed_ms : null,
    history: [...history, { elapsedMs, clearedAt: finishedAt }],
  };

  db.prepare(
    `UPDATE practice_sessions SET phase = ?, finished = 1, finished_at = ? WHERE id = ?`,
  ).run("group_finished", finishedAt, sessionId);
  db.prepare(
    `INSERT INTO practice_results (session_id, task_id, student_name, elapsed_ms, problem_count, first_try_accuracy, first_try_correct_count, started_at, cleared_at, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    session.task_id,
    session.student_name,
    elapsedMs,
    problems.length,
    stats.accuracy,
    stats.correctCount,
    session.started_at,
    finishedAt,
    JSON.stringify(snapshot),
  );

  return { sessionId, resultSnapshot: snapshot };
}

export function getResult(sessionId: string): ResultSnapshot {
  const row = db
    .prepare(`SELECT snapshot_json FROM practice_results WHERE session_id = ?`)
    .get(sessionId) as { snapshot_json: string } | undefined;
  if (!row) throw appError("SESSION_NOT_FOUND", "Result not found", 404);
  return JSON.parse(row.snapshot_json) as ResultSnapshot;
}

export function getTaskHistory(taskId: TaskId, studentName: string, limit = 5) {
  return db
    .prepare(
      `SELECT student_name, elapsed_ms, cleared_at, problem_count, first_try_accuracy
       FROM practice_results
       WHERE task_id = ? AND student_name = ?
       ORDER BY cleared_at DESC
       LIMIT ?`,
    )
    .all(taskId, studentName, limit)
    .map((row: any) => ({
      studentName: row.student_name as string,
      elapsedMs: row.elapsed_ms as number,
      clearedAt: row.cleared_at as string,
      problemCount: row.problem_count as number,
      firstTryAccuracy: row.first_try_accuracy as number,
    }))
    .reverse();
}
