import {
  ActionSpec,
  ExerciseInstance,
  ExerciseRuntimeSpec,
  FeedbackCue,
  FeedbackSpec,
  FlowSpec,
  GuideSpec,
  InteractionZone,
  ProblemStatus,
  RuntimeActionEvent,
  RuntimeEvaluation,
  RuntimeFeedbackPacket,
  SceneAnchor,
  SceneEntity,
  SceneSpec,
  ServerRuntimeState,
  SessionPhase,
  TaskDefinition,
  TriangleTrigContentDefinition,
  XYPoint,
} from "../../../../shared/contracts";
import type { Angle, GuidedStepKey, Role, Side, TriangleTrigTaskId, TrigFunction } from "../../../../shared/triangleTrig";
import type { EngineActionResult, RuntimeEngineState } from "./engineTypes";

type LengthValue = { n: number; s: number };

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

type TriangleTrigBaseState = RuntimeEngineState & {
  instanceId: string;
  taskId: TriangleTrigTaskId;
  contentId: string;
  index: number;
  status: ProblemStatus;
  attempts: number;
  firstTryCorrect: boolean | null;
  target: TrigFunction;
  referenceAngle: Angle;
};

export type MeaningEngineState = TriangleTrigBaseState & {
  taskId: "meaning";
  answerKey: MeaningAnswerKey;
};

export type RatioEngineState = TriangleTrigBaseState & {
  taskId: "ratioToSide";
  ratio: {
    numerator: string;
    denominator: string;
  };
  answerKey: RatioAnswerKey;
};

export type GuidedEngineState = TriangleTrigBaseState & {
  taskId: "guidedSolve";
  knownType: TrigFunction;
  given: Array<{
    edge: Side;
    value: string;
    role: Role;
  }>;
  stepState: Record<
    GuidedStepKey,
    {
      done: boolean;
      value: string;
    }
  >;
  answerKey: GuidedAnswerKey;
};

export type TriangleTrigEngineState =
  | MeaningEngineState
  | RatioEngineState
  | GuidedEngineState;

type RuntimeDraftPayload = {
  selections?: Record<string, string[]>;
  inputs?: Record<string, string>;
};

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

const VERTICES = {
  A: { x: 90, y: 288 },
  B: { x: 320, y: 288 },
  C: { x: 320, y: 110 },
} satisfies Record<"A" | "B" | "C", XYPoint>;

const SIDE_POINTS: Record<Side, {
  label: XYPoint;
  input: XYPoint;
  hitZone: InteractionZone["shape"];
}> = {
  AB: {
    label: { x: 205, y: 316 },
    input: { x: 205, y: 255 },
    hitZone: { type: "lineCorridor", from: "vertex-A", to: "vertex-B", width: 30 },
  },
  BC: {
    label: { x: 348, y: 205 },
    input: { x: 350, y: 205 },
    hitZone: { type: "lineCorridor", from: "vertex-B", to: "vertex-C", width: 30 },
  },
  AC: {
    label: { x: 194, y: 122 },
    input: { x: 200, y: 150 },
    hitZone: {
      type: "polygon",
      points: [
        { x: 82, y: 302 },
        { x: 104, y: 322 },
        { x: 336, y: 124 },
        { x: 314, y: 96 },
      ],
    },
  },
};

function makeLength(n: number, s = 1): LengthValue {
  return { n, s };
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
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
    return makeLength(Math.round(num), 1);
  }
  return null;
}

function lengthsEqual(a: LengthValue, b: LengthValue): boolean {
  return Math.abs(lengthValue(a) - lengthValue(b)) < 0.0001;
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => vars[key] ?? "");
}

function getRoleSideMap(referenceAngle: Angle): Record<Role, Side> {
  if (referenceAngle === "C") {
    return { opposite: "AB", adjacent: "BC", hypotenuse: "AC" };
  }
  return { opposite: "BC", adjacent: "AB", hypotenuse: "AC" };
}

function sideForRole(referenceAngle: Angle, role: Role) {
  return getRoleSideMap(referenceAngle)[role];
}

function roleForSide(referenceAngle: Angle, side: Side): Role {
  const mapping = getRoleSideMap(referenceAngle);
  return ((Object.keys(mapping) as Role[]).find((role) => mapping[role] === side) || "hypotenuse") as Role;
}

function guidedCurrentStep(state: GuidedEngineState): GuidedStepKey {
  return (["ratio", "third", "final"] as const).find((key) => !state.stepState[key].done) || "final";
}

function appError(code: string, message: string, status = 400) {
  return { status, body: { error: { code, message } } };
}

function makeCue(key: string, scope: FeedbackCue["scope"], targetRef?: string): FeedbackCue {
  return { key, scope, targetRef };
}

function buildFeedback(state: TriangleTrigEngineState): FeedbackSpec {
  const currentStepId = buildRuntimeState(state, "answering").currentStepId;
  return {
    correct: [makeCue("correct", "global"), makeCue("highlight-correct", "workspace", currentStepId)],
    wrong: [makeCue("wrong", "global"), makeCue("highlight-wrong", "guide", currentStepId)],
    finish: [makeCue("finish", "global")],
  };
}

function buildFeedbackPacket(state: TriangleTrigEngineState, evaluation: RuntimeEvaluation): RuntimeFeedbackPacket {
  const feedback = buildFeedback(state);
  if (evaluation === "correct") {
    return { global: feedback.correct, workspace: feedback.correct, guide: [] };
  }
  if (evaluation === "wrong") {
    return { global: feedback.wrong, workspace: [], guide: feedback.wrong };
  }
  return { global: [], workspace: [], guide: [] };
}

function buildRuntimeState(state: TriangleTrigEngineState, phase: SessionPhase): ServerRuntimeState {
  const currentStepId =
    state.taskId === "guidedSolve" ? guidedCurrentStep(state) : state.taskId === "meaning" ? "pick-roles" : "fill-lengths";
  const completedStepIds =
    state.taskId === "guidedSolve"
      ? (["ratio", "third", "final"] as GuidedStepKey[]).filter((key) => state.stepState[key].done)
      : state.status === "correct"
        ? [currentStepId]
        : [];

  return {
    phase,
    currentStepId,
    completedStepIds,
    problemStatus: state.status,
    attempts: state.attempts,
  };
}

function buildEntities(state: TriangleTrigEngineState): SceneEntity[] {
  const currentStep = state.taskId === "guidedSolve" ? guidedCurrentStep(state) : null;
  const entities: SceneEntity[] = [
    {
      id: "triangle-main",
      kind: "triangle",
      vertices: VERTICES,
      rightAnglePath: "M292 288 L292 260 L320 260",
      referenceAnglePath:
        state.referenceAngle === "A"
          ? "M124 288 A34 34 0 0 1 111 259"
          : "M320 146 A34 34 0 0 1 290 134",
    },
    { id: "vertex-A", kind: "vertex", x: VERTICES.A.x, y: VERTICES.A.y, label: "A" },
    { id: "vertex-B", kind: "vertex", x: VERTICES.B.x, y: VERTICES.B.y, label: "B" },
    { id: "vertex-C", kind: "vertex", x: VERTICES.C.x, y: VERTICES.C.y, label: "C" },
  ];

  for (const side of ["AB", "BC", "AC"] as Side[]) {
    const [from, to] = side.split("") as Array<"A" | "B" | "C">;
    entities.push({
      id: `edge-${side}`,
      kind: "edge",
      from: `vertex-${from}`,
      to: `vertex-${to}`,
      label: side,
      role: roleForSide(state.referenceAngle, side),
    });
  }

  entities.push({
    id: "scene-angle",
    kind: "text",
    text: `参考角 ${state.referenceAngle}`,
    x: 372,
    y: 40,
    variant: "angle-badge",
  });

  if (state.taskId === "ratioToSide") {
    entities.push({
      id: "ratio-prompt",
      kind: "text",
      text: `${state.target.toUpperCase()} ${state.referenceAngle} = ${state.ratio.numerator}/${state.ratio.denominator}`,
      x: 80,
      y: 34,
      variant: "inline-formula",
    });
  }

  if (state.taskId === "guidedSolve") {
    entities.push({
      id: "guided-known",
      kind: "text",
      text: `已知 ${state.given.map((item) => `${item.edge}=${item.value}`).join("，")}`,
      x: 80,
      y: 34,
      variant: "inline-formula",
    });
    if (currentStep === "final") {
      entities.push({
        id: "guided-final-formula",
        kind: "formula",
        label: `${state.target.toUpperCase()} ${state.referenceAngle} =`,
        slots: ["final-numerator", "final-denominator"],
        x: 364,
        y: 330,
        layout: "fraction",
      });
    }
  }

  return entities;
}

function buildZones(): InteractionZone[] {
  return (["AB", "BC", "AC"] as Side[]).map((side) => ({
    id: `zone-${side}`,
    zoneKind: "edge",
    targetRef: `edge-${side}`,
    shape: SIDE_POINTS[side].hitZone,
    accepts: ["select"],
  }));
}

function buildAnchors(state: TriangleTrigEngineState): SceneAnchor[] {
  if (state.taskId === "meaning") return [];

  if (state.taskId === "ratioToSide") {
    return (["AB", "BC", "AC"] as Side[]).map((side) => ({
      id: `side-${side}`,
      anchorKind: "value-input",
      entityRef: `edge-${side}`,
      x: SIDE_POINTS[side].input.x,
      y: SIDE_POINTS[side].input.y,
      placeholder: side,
      label: side,
    }));
  }

  const step = guidedCurrentStep(state);
  if (step === "ratio") {
    return state.given.map((item) => ({
      id: `ratio-${item.role}`,
      anchorKind: "value-input",
      entityRef: `edge-${item.edge}`,
      x: SIDE_POINTS[item.edge].input.x,
      y: SIDE_POINTS[item.edge].input.y,
      placeholder: `${item.role} 的 z 系数`,
      label: `${item.edge} = ${item.value}`,
    }));
  }

  if (step === "third") {
    const known = new Set(state.given.map((item) => item.edge));
    const thirdSide = (["AB", "BC", "AC"] as Side[]).find((side) => !known.has(side)) || "AC";
    return [
      {
        id: "third-side",
        anchorKind: "value-input",
        entityRef: `edge-${thirdSide}`,
        x: SIDE_POINTS[thirdSide].input.x,
        y: SIDE_POINTS[thirdSide].input.y,
        placeholder: `${thirdSide} 的 z 系数`,
        label: thirdSide,
      },
    ];
  }

  return [
    {
      id: "final-numerator",
      anchorKind: "formula-slot",
      x: 170,
      y: 320,
      placeholder: "分子",
      label: "分子",
    },
    {
      id: "final-denominator",
      anchorKind: "formula-slot",
      x: 170,
      y: 360,
      placeholder: "分母",
      label: "分母",
    },
  ];
}

function buildFlow(content: TriangleTrigContentDefinition, state: TriangleTrigEngineState): FlowSpec {
  if (state.taskId === "meaning") {
    const status = state.status === "correct" ? "done" : "active";
    return {
      steps: [
        {
          id: "pick-roles",
          title: "先选分子，再选分母",
          goal: "在左侧依次点击两条边。",
          status,
          allowedActions: [
            { type: "select", target: "meaning-selection", selectionKind: "ordered" },
            { type: "clear", target: "meaning-selection" },
            { type: "submit", stepId: "pick-roles" },
          ],
          submitMode: "explicit",
        },
      ],
      currentStepId: "pick-roles",
      completionPolicy: content.flowTemplate.completionPolicy,
    };
  }

  if (state.taskId === "ratioToSide") {
    return {
      steps: [
        {
          id: "fill-lengths",
          title: "把边长填到左侧图上",
          goal: "填写三边长度后提交。",
          status: state.status === "correct" ? "done" : "active",
          allowedActions: [
            { type: "input", target: "side-AB", valueKind: "length" },
            { type: "input", target: "side-BC", valueKind: "length" },
            { type: "input", target: "side-AC", valueKind: "length" },
            { type: "clear", target: "fill-lengths" },
            { type: "submit", stepId: "fill-lengths" },
          ],
          submitMode: "explicit",
        },
      ],
      currentStepId: "fill-lengths",
      completionPolicy: content.flowTemplate.completionPolicy,
    };
  }

  const currentStep = guidedCurrentStep(state);
  return {
    steps: [
      {
        id: "ratio",
        title: "写最简 z 比",
        goal: "把两条已知边化成 z 比。",
        status: state.stepState.ratio.done ? "done" : currentStep === "ratio" ? "active" : "locked",
        allowedActions: [
          { type: "input", target: "ratio-opposite", valueKind: "length" },
          { type: "input", target: "ratio-adjacent", valueKind: "length" },
          { type: "input", target: "ratio-hypotenuse", valueKind: "length" },
          { type: "clear", target: "ratio" },
          { type: "submit", stepId: "ratio" },
        ],
        submitMode: "explicit",
      },
      {
        id: "third",
        title: "补出第三边",
        goal: "在左侧补全第三边的 z 系数。",
        status: state.stepState.third.done ? "done" : currentStep === "third" ? "active" : "locked",
        allowedActions: [
          { type: "input", target: "third-side", valueKind: "length" },
          { type: "clear", target: "third" },
          { type: "submit", stepId: "third" },
        ],
        submitMode: "explicit",
      },
      {
        id: "final",
        title: "代回目标三角比",
        goal: `求 ${state.target.toUpperCase()} ${state.referenceAngle}。`,
        status: state.stepState.final.done ? "done" : currentStep === "final" ? "active" : "locked",
        allowedActions: [
          { type: "input", target: "final-numerator", valueKind: "length" },
          { type: "input", target: "final-denominator", valueKind: "length" },
          { type: "clear", target: "final" },
          { type: "submit", stepId: "final" },
        ],
        submitMode: "explicit",
      },
    ],
    currentStepId: currentStep,
    completionPolicy: content.flowTemplate.completionPolicy,
  };
}

function buildGuide(content: TriangleTrigContentDefinition, state: TriangleTrigEngineState, phase: SessionPhase): GuideSpec {
  const flow = buildFlow(content, state);
  return {
    banner: content.guideTemplate.banner,
    hint:
      phase === "wrong_feedback"
        ? currentHint(state)
        : state.taskId === "guidedSolve"
          ? guidedHint(state)
          : content.guideTemplate.hint,
    statusCopy:
      phase === "wrong_feedback" ? "请回到左侧修正当前步骤。" : "左侧负责操作，右侧负责引导。",
    stepItems: content.flowTemplate.guideSteps.map((step) => {
      const flowStep = flow.steps.find((item) => item.id === step.stepId);
      return {
        stepId: step.stepId,
        title: step.title,
        status: flowStep?.status || "locked",
        summary: flowStep?.status === "done" ? completedSummary(state, step.stepId) : step.summary,
      };
    }),
  };
}

function completedSummary(state: TriangleTrigEngineState, stepId: string) {
  if (state.taskId === "guidedSolve") {
    return state.stepState[stepId as GuidedStepKey]?.value || "已完成";
  }
  return "已完成";
}

function currentHint(state: TriangleTrigEngineState) {
  if (state.taskId === "meaning") {
    return "先看参考角，再判断对边、邻边和斜边。";
  }
  if (state.taskId === "ratioToSide") {
    return "先确定参考角，再把比值对应回三条边。";
  }
  const step = guidedCurrentStep(state);
  if (step === "ratio") return "先把两条已知边化成最简的 z 比。";
  if (step === "third") return "第三边要基于前一步的 z 比补出。";
  return "最后一步把分子边和分母边代回目标三角比。";
}

function guidedHint(state: GuidedEngineState) {
  const step = guidedCurrentStep(state);
  if (step === "ratio") return "先把两条已知边化成 z 比。";
  if (step === "third") return "继续补出第三边。";
  return `最后求 ${state.target.toUpperCase()} ${state.referenceAngle}。`;
}

function buildScene(state: TriangleTrigEngineState): SceneSpec {
  return {
    sceneKind: "triangle",
    entities: buildEntities(state),
    zones: buildZones(),
    anchors: buildAnchors(state),
    overlays: [],
  };
}

function buildPrompt(content: TriangleTrigContentDefinition, state: TriangleTrigEngineState) {
  const vars: Record<string, string> = {
    target: state.target.toUpperCase(),
    angle: state.referenceAngle,
  };
  if (state.taskId === "ratioToSide") {
    vars.numerator = state.ratio.numerator;
    vars.denominator = state.ratio.denominator;
  }
  if (state.taskId === "guidedSolve") {
    vars.knownType = state.knownType.toUpperCase();
  }
  return renderTemplate(content.promptTemplate, vars);
}

function buildInstance(
  task: TaskDefinition,
  content: TriangleTrigContentDefinition,
  state: TriangleTrigEngineState,
  phase: SessionPhase,
): ExerciseInstance {
  return {
    instanceId: state.instanceId,
    taskId: task.id,
    engineKind: task.engineKind,
    contentId: content.id,
    prompt: buildPrompt(content, state),
    scene: buildScene(state),
    flow: buildFlow(content, state),
    guide: buildGuide(content, state, phase),
    feedback: buildFeedback(state),
  };
}

function toRuntime(
  task: TaskDefinition,
  content: TriangleTrigContentDefinition,
  state: TriangleTrigEngineState,
  phase: SessionPhase,
): ExerciseRuntimeSpec {
  return {
    instance: buildInstance(task, content, state, phase),
    runtimeState: buildRuntimeState(state, phase),
  };
}

function computeRatioPair(triple: Record<Side, LengthValue>, trig: TrigFunction, angle: Angle) {
  const [numRole, denRole] = ROLE_BY_TRIG[trig];
  const numerator = formatLength(triple[sideForRole(angle, numRole)]);
  const denominator = formatLength(triple[sideForRole(angle, denRole)]);
  return { numerator, denominator };
}

export function createTriangleTrigState(
  task: TaskDefinition,
  content: TriangleTrigContentDefinition,
  index: number,
): TriangleTrigEngineState {
  const target = randomItem(TRIGS);
  const referenceAngle = randomItem(ACUTE_ANGLES);
  const instanceId = crypto.randomUUID();

  if (task.id === "meaning") {
    return {
      instanceId,
      taskId: "meaning",
      contentId: content.id,
      index,
      status: "pending",
      attempts: 0,
      firstTryCorrect: null,
      target,
      referenceAngle,
      answerKey: {
        roles: ROLE_BY_TRIG[target],
      },
    };
  }

  if (task.id === "ratioToSide") {
    const triple = randomItem(TRIPLE_BANK);
    return {
      instanceId,
      taskId: "ratioToSide",
      contentId: content.id,
      index,
      status: "pending",
      attempts: 0,
      firstTryCorrect: null,
      target,
      referenceAngle,
      ratio: computeRatioPair(triple, target, referenceAngle),
      answerKey: { triple },
    };
  }

  const triple = randomItem(TRIPLE_BANK);
  const knownType = randomItem(TRIGS);
  const targetGuided = randomItem(TRIGS.filter((item) => item !== knownType));
  const knownRoles = ROLE_BY_TRIG[knownType];
  const thirdRole = (["opposite", "adjacent", "hypotenuse"] as Role[]).find(
    (role) => !knownRoles.includes(role),
  ) as Role;
  const given = knownRoles.map((role) => ({
    edge: sideForRole(referenceAngle, role),
    value: formatLength(triple[sideForRole(referenceAngle, role)]),
    role,
  }));
  const zRoles = Object.fromEntries(
    knownRoles.map((role) => [role, formatLength(triple[sideForRole(referenceAngle, role)])]),
  ) as Partial<Record<Role, string>>;
  const [finalNumRole, finalDenRole] = ROLE_BY_TRIG[targetGuided];

  return {
    instanceId,
    taskId: "guidedSolve",
    contentId: content.id,
    index,
    status: "pending",
    attempts: 0,
    firstTryCorrect: null,
    target: targetGuided,
    referenceAngle,
    knownType,
    given,
    stepState: {
      ratio: { done: false, value: "" },
      third: { done: false, value: "" },
      final: { done: false, value: "" },
    },
    answerKey: {
      zRoles,
      thirdRole,
      thirdZ: formatLength(triple[sideForRole(referenceAngle, thirdRole)]),
      finalNumerator: formatLength(triple[sideForRole(referenceAngle, finalNumRole)]),
      finalDenominator: formatLength(triple[sideForRole(referenceAngle, finalDenRole)]),
    },
  };
}

function parseDraftPayload(action: RuntimeActionEvent): RuntimeDraftPayload {
  if (action.type !== "submit") return {};
  if (!action.value) return {};
  try {
    return JSON.parse(action.value) as RuntimeDraftPayload;
  } catch (_error) {
    throw appError("ANSWER_INVALID", "Submit payload is invalid JSON");
  }
}

function meaningCorrect(state: MeaningEngineState, payload: RuntimeDraftPayload) {
  const selected = payload.selections?.["meaning-selection"] || [];
  if (selected.length < 2) return false;
  const roles = selected.slice(0, 2).map((side) => roleForSide(state.referenceAngle, side as Side));
  return roles[0] === state.answerKey.roles[0] && roles[1] === state.answerKey.roles[1];
}

function ratioCorrect(state: RatioEngineState, payload: RuntimeDraftPayload) {
  return (["AB", "BC", "AC"] as Side[]).every((side) => {
    const parsed = parseLengthInput(payload.inputs?.[`side-${side}`] || "");
    return parsed ? lengthsEqual(parsed, state.answerKey.triple[side]) : false;
  });
}

function guidedCorrect(state: GuidedEngineState, payload: RuntimeDraftPayload, stepId: string) {
  if (stepId === "ratio") {
    const roles = Object.keys(state.answerKey.zRoles) as Role[];
    const correct = roles.every((role) => {
      const parsed = parseLengthInput(payload.inputs?.[`ratio-${role}`] || "");
      const expected = parseLengthInput(state.answerKey.zRoles[role] || "");
      return parsed && expected ? lengthsEqual(parsed, expected) : false;
    });
    if (correct) {
      state.stepState.ratio = {
        done: true,
        value: roles.map((role) => `${role}=${state.answerKey.zRoles[role]}z`).join(", "),
      };
    }
    return correct;
  }

  if (stepId === "third") {
    const parsed = parseLengthInput(payload.inputs?.["third-side"] || "");
    const expected = parseLengthInput(state.answerKey.thirdZ);
    const correct = Boolean(parsed && expected && lengthsEqual(parsed, expected));
    if (correct) {
      state.stepState.third = {
        done: true,
        value: `${state.answerKey.thirdRole}=${state.answerKey.thirdZ}z`,
      };
    }
    return correct;
  }

  if (stepId === "final") {
    const numerator = parseLengthInput(payload.inputs?.["final-numerator"] || "");
    const denominator = parseLengthInput(payload.inputs?.["final-denominator"] || "");
    const expectedNumerator = parseLengthInput(state.answerKey.finalNumerator);
    const expectedDenominator = parseLengthInput(state.answerKey.finalDenominator);
    const correct = Boolean(
      numerator &&
        denominator &&
        expectedNumerator &&
        expectedDenominator &&
        lengthsEqual(numerator, expectedNumerator) &&
        lengthsEqual(denominator, expectedDenominator),
    );
    if (correct) {
      state.stepState.final = {
        done: true,
        value: `${payload.inputs?.["final-numerator"]}/${payload.inputs?.["final-denominator"]}`,
      };
    }
    return correct;
  }

  throw appError("ANSWER_INVALID", "Unsupported guided step");
}

function cloneState(state: TriangleTrigEngineState): TriangleTrigEngineState {
  return JSON.parse(JSON.stringify(state)) as TriangleTrigEngineState;
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
  const state = cloneState(currentState);

  if (action.type === "clear") {
    const runtime = toRuntime(task, content, state, "answering");
    return {
      accepted: true,
      evaluation: "progress",
      phase: "answering",
      engineState: state,
      runtime,
      feedback: buildFeedbackPacket(state, "progress"),
    };
  }

  if (action.type !== "submit") {
    throw appError("ACTION_NOT_ALLOWED", "Only clear and submit actions are supported");
  }

  state.attempts += 1;
  const payload = parseDraftPayload(action);
  const stepId = action.stepId || buildRuntimeState(state, "answering").currentStepId;

  let correct = false;
  let phase: SessionPhase = "wrong_feedback";
  let evaluation: RuntimeEvaluation = "wrong";

  if (state.taskId === "meaning") {
    correct = meaningCorrect(state, payload);
    if (correct) {
      state.status = "correct";
      if (state.firstTryCorrect === null) state.firstTryCorrect = state.attempts === 1;
      phase = "correct_pause";
      evaluation = "correct";
    } else {
      state.status = "wrong";
    }
  } else if (state.taskId === "ratioToSide") {
    correct = ratioCorrect(state, payload);
    if (correct) {
      state.status = "correct";
      if (state.firstTryCorrect === null) state.firstTryCorrect = state.attempts === 1;
      phase = "correct_pause";
      evaluation = "correct";
    } else {
      state.status = "wrong";
    }
  } else {
    correct = guidedCorrect(state, payload, stepId);
    if (correct) {
      const allDone = state.stepState.ratio.done && state.stepState.third.done && state.stepState.final.done;
      if (allDone) {
        state.status = "correct";
        if (state.firstTryCorrect === null) state.firstTryCorrect = state.attempts === 1;
        phase = "correct_pause";
        evaluation = "correct";
      } else {
        state.status = "pending";
        phase = "answering";
        evaluation = "progress";
      }
    } else {
      state.status = "wrong";
    }
  }

  const runtime = toRuntime(task, content, state, phase);
  return {
    accepted: true,
    evaluation,
    phase,
    engineState: state,
    runtime,
    feedback: buildFeedbackPacket(state, correct ? (phase === "correct_pause" ? "correct" : "progress") : "wrong"),
  };
}

export function buildRuntimeForState(
  task: TaskDefinition,
  content: TriangleTrigContentDefinition,
  state: TriangleTrigEngineState,
  phase: SessionPhase,
) {
  return toRuntime(task, content, state, phase);
}
