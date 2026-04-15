import type {
  FlowSpec,
  RuntimeEvaluation,
  SceneAnchor,
  SceneEntity,
  SessionPhase,
  TaskDefinition,
  TriangleTrigContentDefinition,
} from "../../../../../../shared/contracts";
import type { GuidedStepKey, Role, Side, TriangleTrigTaskId } from "../../../../../../shared/triangleTrig";
import { appError } from "../../platform/errors";
import {
  ROLE_BY_TRIG,
  SIDE_POINTS,
  TRIGS,
  TRIPLE_BANK,
  computeRatioPair,
  formatLength,
  guidedCurrentStep,
  lengthsEqual,
  parseLengthInput,
  randomItem,
  roleForSide,
  sideForRole,
} from "./shared";
import type {
  GuidedEngineState,
  MeaningEngineState,
  RatioEngineState,
  RuntimeDraftPayload,
  TriangleTrigEngineState,
  TriangleTrigSeed,
} from "./types";

export type TriangleTrigProjectionModel = {
  currentStepId: string;
  completedStepIds: string[];
  promptVars: Record<string, string>;
  taskEntities: SceneEntity[];
  anchors: SceneAnchor[];
  flow: FlowSpec;
  defaultHint: string;
  wrongHint: string;
  completedSummary: (stepId: string) => string;
};

export type TriangleTrigSubmitResult = {
  evaluation: RuntimeEvaluation;
  phase: SessionPhase;
};

export type TriangleTrigTaskStrategy<TState extends TriangleTrigEngineState = TriangleTrigEngineState> = {
  createState: (
    task: TaskDefinition,
    content: TriangleTrigContentDefinition,
    index: number,
    seed: TriangleTrigSeed,
  ) => TState;
  reduceSubmit: (
    state: TState,
    payload: RuntimeDraftPayload,
    stepId: string,
  ) => TriangleTrigSubmitResult;
  buildProjectionModel: (
    content: TriangleTrigContentDefinition,
    state: TState,
  ) => TriangleTrigProjectionModel;
};

const meaningStrategy: TriangleTrigTaskStrategy<MeaningEngineState> = {
  createState: (_task, content, index, seed) => ({
    instanceId: seed.instanceId,
    taskId: "meaning",
    contentId: content.id,
    index,
    status: "pending",
    attempts: 0,
    firstTryCorrect: null,
    target: seed.target,
    referenceAngle: seed.referenceAngle,
    answerKey: {
      roles: ROLE_BY_TRIG[seed.target],
    },
  }),
  reduceSubmit: (state, payload) => {
    const selected = payload.selections?.["meaning-selection"] || [];
    const correct =
      selected.length >= 2 &&
      selected
        .slice(0, 2)
        .map((side) => roleForSide(state.referenceAngle, side as Side))
        .every((role, index) => role === state.answerKey.roles[index]);

    if (correct) {
      state.status = "correct";
      return { evaluation: "correct", phase: "correct_pause" };
    }

    state.status = "wrong";
    return { evaluation: "wrong", phase: "wrong_feedback" };
  },
  buildProjectionModel: (content, state) => {
    const currentStepId = "pick-roles";
    return {
      currentStepId,
      completedStepIds: state.status === "correct" ? [currentStepId] : [],
      promptVars: {
        target: state.target.toUpperCase(),
        angle: state.referenceAngle,
      },
      taskEntities: [],
      anchors: [],
      flow: {
        steps: [
          {
            id: currentStepId,
            title: "先选分子，再选分母",
            goal: "在左侧依次点击两条边。",
            status: state.status === "correct" ? "done" : "active",
            allowedActions: [
              { type: "select", target: "meaning-selection", selectionKind: "ordered" },
              { type: "clear", target: "meaning-selection" },
              { type: "submit", stepId: currentStepId },
            ],
            submitMode: "explicit",
          },
        ],
        currentStepId,
        completionPolicy: content.flowTemplate.completionPolicy,
      },
      defaultHint: content.guideTemplate.hint,
      wrongHint: "先看参考角，再判断对边、邻边和斜边。",
      completedSummary: () => "已完成",
    };
  },
};

const ratioToSideStrategy: TriangleTrigTaskStrategy<RatioEngineState> = {
  createState: (_task, content, index, seed) => {
    const triple = randomItem(TRIPLE_BANK);
    return {
      instanceId: seed.instanceId,
      taskId: "ratioToSide",
      contentId: content.id,
      index,
      status: "pending",
      attempts: 0,
      firstTryCorrect: null,
      target: seed.target,
      referenceAngle: seed.referenceAngle,
      ratio: computeRatioPair(triple, seed.target, seed.referenceAngle),
      answerKey: { triple },
    };
  },
  reduceSubmit: (state, payload) => {
    const correct = (["AB", "BC", "AC"] as Side[]).every((side) => {
      const parsed = parseLengthInput(payload.inputs?.[`side-${side}`] || "");
      return parsed ? lengthsEqual(parsed, state.answerKey.triple[side]) : false;
    });

    if (correct) {
      state.status = "correct";
      return { evaluation: "correct", phase: "correct_pause" };
    }

    state.status = "wrong";
    return { evaluation: "wrong", phase: "wrong_feedback" };
  },
  buildProjectionModel: (content, state) => {
    const currentStepId = "fill-lengths";
    return {
      currentStepId,
      completedStepIds: state.status === "correct" ? [currentStepId] : [],
      promptVars: {
        target: state.target.toUpperCase(),
        angle: state.referenceAngle,
        numerator: state.ratio.numerator,
        denominator: state.ratio.denominator,
      },
      taskEntities: [
        {
          id: "ratio-prompt",
          kind: "text",
          text: `${state.target.toUpperCase()} ${state.referenceAngle} = ${state.ratio.numerator}/${state.ratio.denominator}`,
          x: 80,
          y: 34,
          variant: "inline-formula",
        },
      ],
      anchors: (["AB", "BC", "AC"] as Side[]).map((side) => ({
        id: `side-${side}`,
        anchorKind: "value-input",
        entityRef: `edge-${side}`,
        x: SIDE_POINTS[side].input.x,
        y: SIDE_POINTS[side].input.y,
        placeholder: side,
        label: side,
      })),
      flow: {
        steps: [
          {
            id: currentStepId,
            title: "把边长填到左侧图中",
            goal: "填写三边长度后提交。",
            status: state.status === "correct" ? "done" : "active",
            allowedActions: [
              { type: "input", target: "side-AB", valueKind: "length" },
              { type: "input", target: "side-BC", valueKind: "length" },
              { type: "input", target: "side-AC", valueKind: "length" },
              { type: "clear", target: currentStepId },
              { type: "submit", stepId: currentStepId },
            ],
            submitMode: "explicit",
          },
        ],
        currentStepId,
        completionPolicy: content.flowTemplate.completionPolicy,
      },
      defaultHint: content.guideTemplate.hint,
      wrongHint: "先确定参考角，再把比值对应回三条边。",
      completedSummary: () => "已完成",
    };
  },
};

const GUIDED_STEP_IDS = ["ratio", "third", "final"] as const satisfies readonly GuidedStepKey[];

function buildGuidedAnchors(state: GuidedEngineState, step: GuidedStepKey): SceneAnchor[] {
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

function buildGuidedFlow(
  content: TriangleTrigContentDefinition,
  state: GuidedEngineState,
  currentStep: GuidedStepKey,
): FlowSpec {
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

function guidedWrongHint(state: GuidedEngineState): string {
  const step = guidedCurrentStep(state);
  if (step === "ratio") return "先把两条已知边化成最简的 z 比。";
  if (step === "third") return "第三边要基于前一步的 z 比补出。";
  return "最后一步把分子边和分母边代回目标三角比。";
}

function guidedDefaultHint(state: GuidedEngineState): string {
  const step = guidedCurrentStep(state);
  if (step === "ratio") return "先把两条已知边化成 z 比。";
  if (step === "third") return "继续补出第三边。";
  return `最后求 ${state.target.toUpperCase()} ${state.referenceAngle}。`;
}

const guidedSolveStrategy: TriangleTrigTaskStrategy<GuidedEngineState> = {
  createState: (_task, content, index, seed) => {
    const triple = randomItem(TRIPLE_BANK);
    const knownType = randomItem(TRIGS);
    const target = randomItem(TRIGS.filter((item) => item !== knownType));
    const knownRoles = ROLE_BY_TRIG[knownType];
    const thirdRole = (["opposite", "adjacent", "hypotenuse"] as Role[]).find(
      (role) => !knownRoles.includes(role),
    ) as Role;
    const given = knownRoles.map((role) => ({
      edge: sideForRole(seed.referenceAngle, role),
      value: formatLength(triple[sideForRole(seed.referenceAngle, role)]),
      role,
    }));
    const zRoles = Object.fromEntries(
      knownRoles.map((role) => [role, formatLength(triple[sideForRole(seed.referenceAngle, role)])]),
    ) as Partial<Record<Role, string>>;
    const [finalNumRole, finalDenRole] = ROLE_BY_TRIG[target];

    return {
      instanceId: seed.instanceId,
      taskId: "guidedSolve",
      contentId: content.id,
      index,
      status: "pending",
      attempts: 0,
      firstTryCorrect: null,
      target,
      referenceAngle: seed.referenceAngle,
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
        thirdZ: formatLength(triple[sideForRole(seed.referenceAngle, thirdRole)]),
        finalNumerator: formatLength(triple[sideForRole(seed.referenceAngle, finalNumRole)]),
        finalDenominator: formatLength(triple[sideForRole(seed.referenceAngle, finalDenRole)]),
      },
    };
  },
  reduceSubmit: (state, payload, stepId) => {
    if (stepId === "ratio") {
      const roles = Object.keys(state.answerKey.zRoles) as Role[];
      const correct = roles.every((role) => {
        const parsed = parseLengthInput(payload.inputs?.[`ratio-${role}`] || "");
        const expected = parseLengthInput(state.answerKey.zRoles[role] || "");
        return parsed && expected ? lengthsEqual(parsed, expected) : false;
      });

      if (!correct) {
        state.status = "wrong";
        return { evaluation: "wrong", phase: "wrong_feedback" };
      }

      state.stepState.ratio = {
        done: true,
        value: roles.map((role) => `${role}=${state.answerKey.zRoles[role]}z`).join(", "),
      };
      state.status = "pending";
      return { evaluation: "progress", phase: "answering" };
    }

    if (stepId === "third") {
      const parsed = parseLengthInput(payload.inputs?.["third-side"] || "");
      const expected = parseLengthInput(state.answerKey.thirdZ);
      const correct = Boolean(parsed && expected && lengthsEqual(parsed, expected));

      if (!correct) {
        state.status = "wrong";
        return { evaluation: "wrong", phase: "wrong_feedback" };
      }

      state.stepState.third = {
        done: true,
        value: `${state.answerKey.thirdRole}=${state.answerKey.thirdZ}z`,
      };
      state.status = "pending";
      return { evaluation: "progress", phase: "answering" };
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

      if (!correct) {
        state.status = "wrong";
        return { evaluation: "wrong", phase: "wrong_feedback" };
      }

      state.stepState.final = {
        done: true,
        value: `${payload.inputs?.["final-numerator"]}/${payload.inputs?.["final-denominator"]}`,
      };
      state.status = "correct";
      return { evaluation: "correct", phase: "correct_pause" };
    }

    throw appError("ANSWER_INVALID", "Unsupported guided step");
  },
  buildProjectionModel: (content, state) => {
    const currentStepId = guidedCurrentStep(state);
    return {
      currentStepId,
      completedStepIds: GUIDED_STEP_IDS.filter((key) => state.stepState[key].done),
      promptVars: {
        target: state.target.toUpperCase(),
        angle: state.referenceAngle,
        knownType: state.knownType.toUpperCase(),
      },
      taskEntities: [
        {
          id: "guided-known",
          kind: "text",
          text: `已知 ${state.given.map((item) => `${item.edge}=${item.value}`).join("，")}`,
          x: 80,
          y: 34,
          variant: "inline-formula",
        },
        ...(currentStepId === "final"
          ? [
              {
                id: "guided-final-formula",
                kind: "formula" as const,
                label: `${state.target.toUpperCase()} ${state.referenceAngle} =`,
                slots: ["final-numerator", "final-denominator"],
                x: 364,
                y: 330,
                layout: "fraction" as const,
              },
            ]
          : []),
      ],
      anchors: buildGuidedAnchors(state, currentStepId),
      flow: buildGuidedFlow(content, state, currentStepId),
      defaultHint: guidedDefaultHint(state),
      wrongHint: guidedWrongHint(state),
      completedSummary: (stepId) => state.stepState[stepId as GuidedStepKey]?.value || "已完成",
    };
  },
};

const TASK_STRATEGIES = {
  meaning: meaningStrategy,
  ratioToSide: ratioToSideStrategy,
  guidedSolve: guidedSolveStrategy,
} as const;

export function getTriangleTrigTaskStrategy<TTaskId extends TriangleTrigTaskId>(
  taskId: TTaskId,
): TriangleTrigTaskStrategy<Extract<TriangleTrigEngineState, { taskId: TTaskId }>> {
  return TASK_STRATEGIES[taskId] as unknown as TriangleTrigTaskStrategy<
    Extract<TriangleTrigEngineState, { taskId: TTaskId }>
  >;
}
