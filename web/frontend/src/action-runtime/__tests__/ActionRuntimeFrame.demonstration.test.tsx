/**
 * 波次 G 任务 2（(a) 第一层）：ActionRuntimeFrame demonstration 形态测试。
 *
 * 演示计划（mode="demonstration"）走独立只读渲染：板书按服务端披露快照
 * 出现、画布为只读题图（实体全 disabled）、无答题输入/确认按钮/播放条
 * （推进权在 Tutor 会话）、不产生 evidence（不调 evaluateAction/
 * checkpointAction）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionPlanResponse, ExercisePlan } from "../../../../shared/actionRuntime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const evaluateAction = vi.fn();
const checkpointAction = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    checkpointAction,
    evaluateAction,
    askActionCoach: vi.fn(),
    conductActionCoach: vi.fn(),
    synthesizeActionSpeech: vi.fn().mockResolvedValue({ audioUrl: "https://example/t.mp3" }),
    streamActionSpeech: vi.fn().mockResolvedValue({ audioUrl: "https://example/t.mp3" }),
    reportVoiceTelemetry: vi.fn().mockResolvedValue({ accepted: true }),
  },
}));
vi.mock("../../geometry/react/GeometryCanvas", () => ({
  GeometryCanvasSurface: () => <div data-testid="geometry-canvas-stub" />,
}));

const { ActionRuntimeFrame } = await import("../react/ActionRuntimeFrame");

/** demonstration 形态计划：两个已披露 enter-text 步 + 板书快照 + 题图。 */
function demonstrationResponse(): ActionPlanResponse {
  const actions: ExercisePlan["actions"] = [
    {
      actionId: "g2-step-1",
      sourceStepId: "g2-step-1",
      kind: "enter-text",
      version: 1,
      title: "第(1)问结论",
      instruction: "写出证明结论。",
      input: { placeholder: "写出规范答案" },
      capabilities: [],
      answerSlots: [],
      validationPolicy: "server-authoritative",
      submitOnComplete: true,
    },
  ];
  return {
    sessionId: "TS-7002",
    plan: {
      planVersion: 5,
      exerciseId: "tutor-demo:TP-SMV-002",
      revision: 9,
      mode: "demonstration",
      metadata: { taskId: "goldenMinhangCross2020", title: "老师演示", promptLatex: "如图。", skillTags: [] },
      world: {
        revision: 9,
        geometry: {
          viewBox: { width: 9, height: 6 },
          points: [
            { id: "A", x: 0, y: 6 },
            { id: "B", x: -4, y: 0 },
          ],
          segments: [{ id: "AB", from: "A", to: "B" }],
        },
      },
      solutionBoardContexts: [
        {
          actionId: "g2-step-1",
          stage: "enter",
          solutionRevision: "demonstration",
          board: {
            schemaVersion: 1,
            documentId: "SC/solution",
            headingLatex: "解：",
            expressions: [
              { expressionId: "g2-step-1/solution-1", sourceStepId: "g2-step-1", latexTemplate: "\\because AD \\cdot OC = AB \\cdot OD", slotValues: {}, phase: "complete" },
              { expressionId: "g2-step-1/solution-2", sourceStepId: "g2-step-1", latexTemplate: "\\therefore \\frac{AD}{OD} = \\frac{AB}{OC}", slotValues: {}, phase: "complete" },
              { expressionId: "g2-step-2/solution-3", sourceStepId: "g2-step-2", latexTemplate: "第 2 小问行（未披露）", slotValues: {}, phase: "hidden" },
            ],
          },
        },
      ],
      coach: { profileId: "tutor-demonstration-v1", displayName: "一对一老师", avatarId: "school", tone: "supportive" },
      actions,
      currentActionId: "g2-step-1",
      completedActionIds: [],
      runtimeCapabilities: {
        practiceValidation: "server-authoritative",
        trainingSync: "local-only",
        narrationTransport: "off",
        coachTurnTransport: "request-response",
        liveCoach: false,
      },
    },
  };
}

function mount(plan: ActionPlanResponse): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  void act(() => root.render(<ActionRuntimeFrame response={plan} />));
  return { container, unmount: () => { void act(() => root.unmount()); container.remove(); } };
}

describe("ActionRuntimeFrame demonstration 形态（波次 G 任务 2）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("只读渲染：演示容器 + 板书披露行 + 只读画布；无答题区/确认/播放条", () => {
    const { container, unmount } = mount(demonstrationResponse());
    const demo = container.querySelector("[data-testid='tutor-demonstration']");
    expect(demo).toBeTruthy();
    expect(demo!.className).toContain("action-runtime-demonstration");
    // 演示容器不是操作 workspace（既有 e2e 的 action-runtime-workspace 断言不受影响）。
    expect(container.querySelector("[data-testid='action-runtime-workspace']")).toBeNull();
    // 板书：披露的 2 行可见，未披露行（phase hidden）不渲染。
    const lines = container.querySelectorAll(".solution-board-line");
    expect(lines.length).toBe(2);
    expect(container.textContent).not.toContain("未披露");
    // 画布渲染（只读题图）。
    expect(container.querySelectorAll("[data-testid='geometry-canvas-stub']").length).toBe(1);
    // 无答题输入、无确认/撤销、无播放条（推进权在会话）。
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".topic-action-playback")).toBeNull();
    // 不产生 evidence：evaluateAction/checkpointAction 零调用。
    expect(evaluateAction).not.toHaveBeenCalled();
    expect(checkpointAction).not.toHaveBeenCalled();
    unmount();
  });
});
