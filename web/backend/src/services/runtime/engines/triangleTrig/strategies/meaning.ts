import type { Side } from "../../../../../../../shared/triangleTrig";
import { ROLE_BY_TRIG, roleForSide } from "../shared";
import type {
  MeaningEngineState,
  RuntimeDraftPayload,
  TriangleTrigSeed,
  TriangleTrigTaskStrategy,
} from "../types";

export const meaningStrategy: TriangleTrigTaskStrategy<MeaningEngineState> = {
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
