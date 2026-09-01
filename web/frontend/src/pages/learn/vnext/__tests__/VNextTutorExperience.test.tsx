/**
 * F7 — vNext 学生体验测试（真实 canonical fixtures 派生的统一视图 + mocked
 * vNext API）。覆盖：ready 渲染三分区、answer 提交走类型化 intent（携带
 * 服务端 revision）、fail-closed 解析（schema 破坏 → region-error 不渲染
 * surfaces）、投影 revision 不一致 → region-error。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VNextTutorExperience } from "../VNextTutorExperience";
import { vnextApi } from "../../../../api/vnextTutorClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixtureModules = {
  ...import.meta.glob("../../../../../../shared/canonical/fixtures/student-workspace-view.positive.json", { eager: true, import: "default" }),
  ...import.meta.glob("../../../../../../shared/canonical/fixtures/coach-panel-view.positive.json", { eager: true, import: "default" }),
} as Record<string, unknown>;

function fixture(name: string): any {
  const entry = Object.entries(fixtureModules).find(([key]) => key.endsWith(`/${name}.json`));
  if (!entry) throw new Error(`fixture not loaded: ${name}`);
  return structuredClone(entry[1]);
}

/** 正例 fixture → 同 session/revision 的 vNext 会话响应（一致性前提）。 */
function sessionResponse(overrides: { workspace?: any; coach?: any; participationKind?: string; revision?: number } = {}): any {
  const workspace = overrides.workspace ?? fixture("student-workspace-view.positive");
  const coach = overrides.coach ?? fixture("coach-panel-view.positive");
  const sessionId = "TS-99000700";
  const revision = overrides.revision ?? 7;
  workspace.session_id = sessionId;
  workspace.revision = revision;
  workspace.participation = { kind: overrides.participationKind ?? "answer_input", gate_id: "GT-02" };
  coach.session_id = sessionId;
  coach.revision = revision;
  return {
    session_id: sessionId,
    revision,
    completed: false,
    assessment: false,
    question: { artifact_id: "QT-SMV-001", question_type: "fill_blank", stem: "如图，将 △ACD 沿 AD 翻折，求 BE。" },
    geometry: null,
    views: {
      student_workspace_view: workspace,
      coach_panel_view: coach,
      participation: workspace.participation,
      status: { session_id: sessionId, session_revision: revision, workspace_revision: 1, completed: false },
    },
  };
}

vi.mock("../../../../api/vnextTutorClient", () => ({
  vnextApi: {
    availability: vi.fn(),
    start: vi.fn(),
    restore: vi.fn(),
    submitIntent: vi.fn(),
    submitWorkspaceCommand: vi.fn(),
  },
  VNextApiError: class extends Error {},
}));
const apiMock = vnextApi as unknown as {
  availability: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  submitIntent: ReturnType<typeof vi.fn>;
  submitWorkspaceCommand: ReturnType<typeof vi.fn>;
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

function mount(props: Parameters<typeof VNextTutorExperience>[0]): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<VNextTutorExperience {...props} />);
  });
}

async function settle(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("F7 VNextTutorExperience（canonical surfaces + fail-closed）", () => {
  it("ready：渲染 Workspace/Coach/Participation 三分区，提交回答走类型化 submit_answer（带服务端 revision）", async () => {
    const response = sessionResponse();
    apiMock.start.mockResolvedValue(response);
    apiMock.submitIntent.mockResolvedValue(sessionResponse({ revision: 8 }));
    mount({ taskId: "goldenMinhangFold2020", studentId: "test-student" });
    await settle();
    expect(apiMock.start).toHaveBeenCalledWith({ studentId: "test-student" });
    expect(container!.querySelector('[data-testid="canonical-student-workspace"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="canonical-coach-panel"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="region-participation"]')).not.toBeNull();
    // 题干来自响应（同一真源，不本地写死）。
    expect(container!.textContent).toContain("翻折");
    // 提交回答：类型化 intent + 服务端 revision（不是自报状态）。
    const input = container!.querySelector<HTMLInputElement>('[aria-label="回答输入"]');
    expect(input).not.toBeNull();
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      nativeSetter.call(input!, "子母型相似，对应边成比例");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = container!.querySelector<HTMLButtonElement>('[data-testid="canonical-submit-answer"]');
    await act(async () => {
      submit!.click();
      await Promise.resolve();
    });
    await settle();
    expect(apiMock.submitIntent).toHaveBeenCalledWith(
      "TS-99000700",
      expect.objectContaining({ intentKind: "submit_answer", text: "子母型相似，对应边成比例", expectedRevision: 7 }),
    );
  });

  it("confirm_input：确认按钮提交 confirm intent", async () => {
    apiMock.start.mockResolvedValue(sessionResponse({ participationKind: "confirm_input" }));
    mount({ taskId: "goldenMinhangFold2020", studentId: "test-student" });
    await settle();
    const confirm = container!.querySelector<HTMLButtonElement>('[data-testid="canonical-participation-confirm"]');
    expect(confirm).not.toBeNull();
    apiMock.submitIntent.mockResolvedValue(sessionResponse({ revision: 8 }));
    await act(async () => {
      confirm!.click();
      await Promise.resolve();
    });
    await settle();
    expect(apiMock.submitIntent).toHaveBeenCalledWith("TS-99000700", expect.objectContaining({ intentKind: "confirm" }));
  });

  it("fail-closed：视图 schema 破坏 → region-error，不渲染任何 surface", async () => {
    const broken = sessionResponse();
    delete broken.views.student_workspace_view.canvas;
    apiMock.start.mockResolvedValue(broken);
    mount({ taskId: "goldenMinhangFold2020", studentId: "test-student" });
    await settle();
    expect(container!.querySelector('[data-testid="vnext-region-error"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="canonical-student-workspace"]')).toBeNull();
    expect(container!.querySelector('[data-testid="canonical-coach-panel"]')).toBeNull();
  });

  it("投影一致性：workspace 与 coach revision 不一致 → region-error（双键防线）", async () => {
    const mismatched = sessionResponse();
    mismatched.views.coach_panel_view.revision = 99;
    apiMock.start.mockResolvedValue(mismatched);
    mount({ taskId: "goldenMinhangFold2020", studentId: "test-student" });
    await settle();
    expect(container!.querySelector('[data-testid="vnext-region-error"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="canonical-student-workspace"]')).toBeNull();
  });

  it("restore：?session= 走 GET restore（refresh/reconnect 服务端重建）", async () => {
    apiMock.restore.mockResolvedValue(sessionResponse());
    mount({ taskId: "goldenMinhangFold2020", studentId: "test-student", restoreSessionId: "TS-99000701" });
    await settle();
    expect(apiMock.restore).toHaveBeenCalledWith("TS-99000701");
    expect(apiMock.start).not.toHaveBeenCalled();
    expect(container!.querySelector('[data-testid="canonical-student-workspace"]')).not.toBeNull();
  });
});
