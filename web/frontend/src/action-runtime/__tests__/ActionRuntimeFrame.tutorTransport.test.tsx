/**
 * Phase 5 UI 集成（波次 C）：ActionRuntimeFrame 的 tutor transport 边界测试。
 *
 * - transport 存在时 evidence 走 SubmitEvidence（不走 /api/practice/
 *   action-evaluation），legacy checkpoint 不发（Tutor 会话是唯一权威）；
 * - 错误 evaluation → 原 Runtime 反馈（wrong 高亮），不污染 Tutor state
 *   （tutorTurn 由 transport 实现方消费）；
 * - railContent 提供时替换 legacy Coach 栏（不出现第二个老师/两套模型决策）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionPlanResponse } from "../../../../shared/actionRuntime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const evaluateAction = vi.fn();
const checkpointAction = vi.fn();
const conductActionCoach = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    checkpointAction,
    evaluateAction,
    askActionCoach: vi.fn(),
    conductActionCoach,
    synthesizeActionSpeech: vi.fn().mockResolvedValue({ audioUrl: "https://example/t.mp3" }),
    streamActionSpeech: vi.fn().mockResolvedValue({ audioUrl: "https://example/t.mp3" }),
    reportVoiceTelemetry: vi.fn().mockResolvedValue({ accepted: true }),
  },
}));
vi.mock("../../geometry/react/GeometryCanvas", () => ({
  GeometryCanvasSurface: () => <div data-testid="geometry-canvas-stub" />,
}));

const { ActionRuntimeFrame } = await import("../react/ActionRuntimeFrame");

/** 单 action（enter-text）的 tutor workspace 计划（服务端 action_plan 形态）。 */
function tutorWorkspaceResponse(): ActionPlanResponse {
  return {
    sessionId: "TS-7001",
    plan: {
      planVersion: 5,
      exerciseId: "tutor:TP-TST-921:tp:TP-TST-921:1:enter-text",
      revision: 1,
      mode: "assessment",
      metadata: { taskId: "task-tutor-921", title: "智能一对一", promptLatex: "如图，AB \\parallel CD。", skillTags: [] },
      world: { revision: 1 },
      coach: { profileId: "tutor-workspace-v1", displayName: "一对一老师", avatarId: "school", tone: "supportive" },
      actions: [{
        actionId: "tp:TP-TST-921:1:enter-text",
        sourceStepId: "S3",
        kind: "enter-text",
        version: 1,
        title: "本题结论",
        instruction: "根据前面的推理，写出本题的最终结论。",
        input: { placeholder: "写出本题结论" },
        capabilities: ["agent:set-answer", "agent:back", "agent:clear"],
        answerSlots: [{ id: "value", label: "本题结论", kind: "text", required: true, placeholder: "写出本题结论" }],
        validationPolicy: "server-authoritative",
        submitOnComplete: true,
      }],
      currentActionId: "tp:TP-TST-921:1:enter-text",
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

function mount(props: Parameters<typeof ActionRuntimeFrame>[0]): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  void act(() => root.render(<ActionRuntimeFrame {...props} />));
  return { container, unmount: () => { void act(() => root.unmount()); container.remove(); } };
}

async function fillAndSubmit(container: HTMLElement, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>("input[id^='action-slot-']");
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input!, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const submit = [...container.querySelectorAll("button")].find((button) => button.textContent === "确认");
  expect(submit).toBeTruthy();
  await act(async () => { submit!.click(); });
}

describe("ActionRuntimeFrame tutor transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("transport 存在：evidence 走 SubmitEvidence，legacy evaluate/checkpoint 均不请求", async () => {
    const submitEvidence = vi.fn().mockResolvedValue({
      outcome: "accepted", evaluation: "correct", revision: 8, phase: "group_finished", nextIndex: 1,
    });
    const { container, unmount } = mount({
      response: tutorWorkspaceResponse(),
      transport: { submitEvidence },
      railContent: <aside data-testid="tutor-rail">tutor rail</aside>,
    });
    await fillAndSubmit(container, "$\\triangle AOB \\sim \\triangle DOC$");
    await vi.waitFor(() => expect(submitEvidence).toHaveBeenCalledTimes(1));
    const request = submitEvidence.mock.calls[0][0];
    expect(request.sessionId).toBe("TS-7001");
    expect(request.evidence[0]).toMatchObject({ kind: "enter-text", value: "$\\triangle AOB \\sim \\triangle DOC$" });
    expect(evaluateAction).not.toHaveBeenCalled();
    expect(checkpointAction).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='tutor-rail']")).toBeTruthy();
    expect(container.textContent).toContain("tutor rail");
    unmount();
  });

  it("错误 evidence：rejected evaluation → 原 Runtime wrong 反馈（重试面），Tutor state 不受污染", async () => {
    const submitEvidence = vi.fn().mockResolvedValue({
      outcome: "rejected",
      evaluation: "wrong",
      revision: 9,
      diagnosis: { messageLatex: "这一步的答案还不对，检查一下再试。", wrongObjectIds: [], wrongSlotIds: ["value"] },
      phase: "wrong_feedback",
      nextIndex: 0,
    });
    const { container, unmount } = mount({
      response: tutorWorkspaceResponse(),
      transport: { submitEvidence },
      railContent: <aside data-testid="tutor-rail">tutor rail</aside>,
    });
    await fillAndSubmit(container, "错误答案");
    await vi.waitFor(() => expect(submitEvidence).toHaveBeenCalledTimes(1));
    // wrong 反馈可见（工作区 Runtime 反馈横幅），提交入口仍可重试。
    await vi.waitFor(() => expect(container.querySelector("[data-testid='runtime-wrong-feedback']")).toBeTruthy());
    expect(container.querySelector("[data-testid='runtime-wrong-feedback']")?.textContent).toContain("这一步的答案还不对");
    expect(evaluateAction).not.toHaveBeenCalled();
    unmount();
  });
});
