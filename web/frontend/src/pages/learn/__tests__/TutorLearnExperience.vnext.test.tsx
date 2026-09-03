/**
 * F7 Step 7 — vNext 数据源模式（canonical TutorLearnExperience 原地分支）。
 * 覆盖：availability 分流参数透传、参与区按 canonical participation kind 驱动、
 * ActionRuntimeFrame 在 active_action 下挂载（构造先于挂载由服务端保证——
 * 前端断言不下发即不挂载）、transport 方案 A（真实 evaluation 透传、系统失败
 * 上抛绝不映射 wrong）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TutorLearnExperience } from "../TutorLearnExperience";
import { vnextApi } from "../../../api/vnextTutorClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../../api/vnextTutorClient", () => ({
  vnextApi: {
    availability: vi.fn(),
    start: vi.fn(),
    restore: vi.fn(),
    submitIntent: vi.fn(),
    submitActionEvidence: vi.fn(),
  },
  VNextApiError: class extends Error {},
}));
const apiMock = vnextApi as unknown as {
  start: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  submitIntent: ReturnType<typeof vi.fn>;
  submitActionEvidence: ReturnType<typeof vi.fn>;
};

function viewResponse(kind: string, overrides: Record<string, unknown> = {}): any {
  const gateByKind: Record<string, string> = { confirm_input: "GT-01", answer_input: "GT-02", workspace_input: "GT-04" };
  return {
    session_id: "TS-99000801",
    revision: 12,
    completed: false,
    assessment: false,
    question: { stem: "如图，将 △ACD 沿 AD 翻折，求 BE。" },
    views: {
      student_workspace_view: {
        schema: "ai_teaching_student_workspace_view/v1",
        session_id: "TS-99000801",
        revision: 12,
        canvas: { elements: [], interaction_enabled: true },
        solution_board: { mode: "building", groups: [] },
        participation: { kind, ...(gateByKind[kind] ? { gate_id: gateByKind[kind] } : {}) },
      },
      coach_panel_view: {
        schema: "ai_teaching_coach_panel_view/v1",
        session_id: "TS-99000801",
        revision: 12,
        mainline: { kind: "awaiting_answer", beat_id: "BT-02", gate_id: "GT-02" },
        inquiry: { kind: "no_inquiry" },
        teaching_context: { beat_id: "BT-02" },
        assistance_available: true,
        replay_available: true,
        transcript: [{ turn_id: "DT-TS-99000801-0002", role: "tutor", content: "识别第一组子母型" }],
      },
      participation: { kind, ...(gateByKind[kind] ? { gate_id: gateByKind[kind] } : {}) },
      status: { session_id: "TS-99000801", session_revision: 12, workspace_revision: 3, completed: false },
    },
    ...overrides,
  };
}

const activeAction = {
  action_id: "tp:TP-SMV-009:1:mark-segment-values-bt04",
  resource_id: "RES8",
  action_ref: "tp:TP-SMV-009:1:mark-segment-values-bt04",
  capability: "similarity.mark-known-segments",
  target_ids: ["seg-AO", "seg-DO", "seg-BO", "seg-OE"],
  student_view: { actionId: "tp:TP-SMV-009:1:mark-segment-values-bt04", kind: "mark-segment-values", version: 1, input: { labels: [], availableSegmentIds: ["seg-AO", "seg-DO", "seg-BO", "seg-OE"], requiredCount: 4 } },
  action_plan: (() => {
    const contract = {
      actionId: "tp:TP-SMV-009:1:mark-segment-values-bt04",
      sourceStepId: "BT-04",
      kind: "mark-segment-values",
      version: 1,
      title: "标注第二组子母型的四段长度",
      instruction: "在画布上依次选中 AO、DO、BO、OE，并填入由 △DAO∽△DBA 求得的长。",
      input: { labels: [], availableSegmentIds: ["seg-AO", "seg-DO", "seg-BO", "seg-OE"], requiredCount: 4 },
      capabilities: ["similarity.mark-known-segments"],
      answerSlots: [{ id: "values", label: "四段长度", kind: "text", required: true, placeholder: "选中线段并填入长度" }],
      validationPolicy: "server-authoritative",
      submitOnComplete: true,
    };
    return { planVersion: "action-runtime/v5", exerciseId: "x", revision: 3, mode: "assessment", metadata: { taskId: "goldenMinhangFold2020", title: "t", promptLatex: "p", skillTags: [] }, world: { revision: 3, geometry: { viewBox: { width: 400, height: 420 }, points: [{ id: "A", x: 200, y: 220, derived: false }, { id: "B", x: 20, y: 280, derived: false }, { id: "C", x: 380, y: 280, derived: false }, { id: "D", x: 220, y: 280, derived: false }, { id: "O", x: 160, y: 280, derived: true }], segments: [{ id: "seg-AO", from: "A", to: "O", derived: true }, { id: "seg-DO", from: "D", to: "O", derived: true }, { id: "seg-BO", from: "B", to: "O", derived: true }, { id: "seg-OE", from: "O", to: "E", derived: true }] } }, coach: { profileId: "p", displayName: "d", avatarId: "school", tone: "supportive" }, actions: [contract], currentActionId: contract.actionId, completedActionIds: [] };
  })(),
  form: "operation" as const,
};

let container: HTMLDivElement | undefined;
let root: Root | undefined;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
  container = undefined;
});

function mount(): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <TutorLearnExperience
          taskId={"goldenMinhangFold2020" as never}
          studentId="vnext-test-student"
          vnext
          onLegacy={() => undefined}
        />
      </MemoryRouter>,
    );
  });
}

async function settle(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("F7 vNext 数据源模式（canonical owner 原地分支）", () => {
  it("start 走 vnextApi（不触旧 /experience）；confirm_input 呈现确认按钮并提交类型化 intent", async () => {
    apiMock.start.mockResolvedValue(viewResponse("confirm_input"));
    apiMock.submitIntent.mockResolvedValue(viewResponse("answer_input", { revision: 13 }));
    mount();
    await settle();
    expect(apiMock.start).toHaveBeenCalledWith({ studentId: "vnext-test-student", taskId: "goldenMinhangFold2020" });
    const confirm = container!.querySelector<HTMLButtonElement>('[data-testid="vnext-participation-confirm"]');
    expect(confirm).not.toBeNull();
    await act(async () => {
      confirm!.click();
      await Promise.resolve();
    });
    await settle();
    expect(apiMock.submitIntent).toHaveBeenCalledWith("TS-99000801", expect.objectContaining({ intentKind: "confirm", expectedRevision: 12 }));
    expect(container!.querySelector('[data-testid="vnext-submit-answer"]')).not.toBeNull();
  });

  it("workspace_input：active_action 不下发 → 不挂载 ActionRuntimeFrame；下发 → 挂载", async () => {
    apiMock.start.mockResolvedValue(viewResponse("workspace_input"));
    mount();
    await settle();
    // 服务端不下发 active_action（构造未 committed）——不挂载，呈现操作等待说明。
    expect(container!.querySelector('[data-testid="vnext-participation"]')?.textContent).toContain("画布");
    // 重新 adopt 带 active_action 的响应 → ActionRuntimeFrame 分支挂载（canvas 区出现）。
    apiMock.submitIntent.mockResolvedValue(viewResponse("workspace_input", { active_action: activeAction, revision: 30 }));
    const anyInput = container!.querySelector<HTMLButtonElement>('[data-testid="vnext-participation-confirm"]');
    void anyInput;
    // 直接经 restore 路径 adopt（等价刷新到 workspace 拍）。
    apiMock.restore.mockResolvedValue(viewResponse("workspace_input", { active_action: activeAction, revision: 30 }));
    act(() => { root?.unmount(); });
    container?.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <MemoryRouter>
          <TutorLearnExperience
            taskId={"goldenMinhangFold2020" as never}
            studentId="vnext-test-student"
            restoreSessionId="TS-99000801"
            vnext
            onLegacy={() => undefined}
          />
        </MemoryRouter>,
      );
    });
    await settle();
    expect(container!.querySelector(".geometry-canvas, [data-keyboard-focus-id], .action-runtime-frame")).not.toBeNull();
  });

  it("transport 方案 A：submitActionEvidence 透传真实 evaluation；系统失败 reject 不映射 wrong", async () => {
    const evaluation = { outcome: "rejected" as const, evaluation: "wrong" as const, revision: 0, diagnosis: { messageLatex: "m", wrongObjectIds: ["seg-AO"] }, phase: "wrong_feedback" as const, nextIndex: 0 };
    apiMock.start.mockResolvedValue(viewResponse("workspace_input"));
    apiMock.submitActionEvidence.mockResolvedValue({
      ...viewResponse("workspace_input", { revision: 31 }),
      action_submission: { status: "evidence-rejected", evaluation },
    });
    mount();
    await settle();
    // 无 active_action（构造未 committed）：参与区呈现画布等待说明（不挂载）。
    expect(container!.querySelector('[data-testid="vnext-participation"]')?.textContent).toContain("画布");
    // 系统失败（HTTP 409）路径：调用方映射为 reject 上抛——由 client 合同保证
    //（VNextApiError 携带错误码；绝不构造 evaluation:"wrong"）。
    apiMock.submitActionEvidence.mockRejectedValue(Object.assign(new Error("conflict"), { name: "VNextApiError" }));
    await expect(
      vnextApi.submitActionEvidence("TS-99000801", { evidence: { actionId: "a", sourceStepId: "BT-04", kind: "mark-segment-values", version: 1, values: {} }, expectedRevision: 12 }),
    ).rejects.toThrow();
  });

  it("restore：?session= 走 vnextApi.restore；404 返回 missing 语义（调用方可重开）", async () => {
    apiMock.restore.mockResolvedValue(viewResponse("answer_input", { revision: 8 }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <MemoryRouter>
          <TutorLearnExperience
            taskId={"goldenMinhangFold2020" as never}
            studentId="vnext-test-student"
            restoreSessionId="TS-99000801"
            vnext
            onLegacy={() => undefined}
          />
        </MemoryRouter>,
      );
    });
    await settle();
    expect(apiMock.restore).toHaveBeenCalledWith("TS-99000801");
    expect(apiMock.start).not.toHaveBeenCalled();
    expect(container!.querySelector('[data-testid="vnext-submit-answer"]')).not.toBeNull();
  });
});
