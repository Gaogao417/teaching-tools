import type { Side } from "../../../../../../../shared/triangleTrig";
import {
  SIDE_POINTS,
  computeRatioPair,
  lengthsEqual,
  parseLengthInput,
  randomItem,
} from "../shared";
import type {
  RatioEngineState,
  RuntimeDraftPayload,
  TriangleTrigSeed,
  TriangleTrigTaskStrategy,
} from "../types";
import { TRIPLE_BANK } from "../shared";

export const ratioToSideStrategy: TriangleTrigTaskStrategy<RatioEngineState> = {
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
