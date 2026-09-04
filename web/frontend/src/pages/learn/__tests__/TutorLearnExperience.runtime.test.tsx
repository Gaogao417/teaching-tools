/**
 * F7 Step 5 — TutorLearnExperience canonical Runtime 数据源模式。
 * 覆盖：runtimeClient 注入（无 vnext prop）、参与区按 canonical participation
 * kind 驱动既有控件形态（confirm/continue/answer/inquiry/listen/completed）、
 * active_action 挂载 ActionRuntimeFrame（pending 呈现期间不挂载）、协议错误
 * 呈现（保留最后合法快照 + 重新同步）、turn failure 提示。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TutorLearnExperience } from "../TutorLearnExperience";
import type { TutorRuntimeClient } from "../../../api/tutorRuntimeClient";
import { ProtocolParseError } from "../../../api/tutorRuntimeClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import {
  RUNTIME_SESSION_ID,
  RUNTIME_TASK_ID,
  validRuntimeSnapshot,
} from "../../../action-runtime/tutor/__tests__/runtimeSnapshotFixture";

function makeClient(): { client: TutorRuntimeClient; mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const mocks = {
    availability: vi.fn(),
    start: vi.fn(),
    restore: vi.fn(),
    submitStudentInput: vi.fn(),
    submitActionEvidence: vi.fn(),
    submitWorkspaceCommand: vi.fn(),
    reportPresentationOutcome: vi.fn(),
    transcribe: vi.fn(),
  };
  return { client: mocks as unknown as TutorRuntimeClient, mocks };
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let onLegacy: () => void;

function mount(client: TutorRuntimeClient, restoreSessionId?: string): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter>
        <TutorLearnExperience
          taskId={RUNTIME_TASK_ID as never}
          studentId="runtime-test-student"
          {...(restoreSessionId ? { restoreSessionId } : {})}
          runtimeClient={client}
          onLegacy={onLegacy}
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

/** React 受控输入赋值（native setter + input 事件——绕过 React 值追踪器）。 */
function setInputValue(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  onLegacy = vi.fn();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
  container = undefined;
});

describe("TutorLearnExperience（canonical Runtime 数据源）", () => {
  it("start 走 runtimeClient（不触旧 /experience）；confirm_input → 确认 CTA 提交 control.confirm", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 13 }));
    mount(client);
    await settle();
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({ taskId: RUNTIME_TASK_ID }));
    const confirm = container!.querySelector<HTMLButtonElement>('[data-testid="tutor-confirm-input"]');
    expect(confirm).not.toBeNull();
    await act(async () => {
      confirm!.click();
      await Promise.resolve();
    });
    await settle();
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "control", command: "confirm" },
      12,
      expect.any(String),
    );
    expect(container!.querySelector('[data-testid="tutor-submit-answer"]')).not.toBeNull();
  });

  it("answer_input → 既有回答表单提交 utterance(channel=mainline)；listen_only → 状态说明（无输入）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    mount(client);
    await settle();
    const input = container!.querySelector<HTMLInputElement>('[data-testid="tutor-participation"] input');
    expect(input).not.toBeNull();
    await act(async () => {
      setInputValue(input!, "识别第一组子母型");
    });
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="tutor-submit-answer"]')!.click();
      await Promise.resolve();
    });
    await settle();
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "utterance", channel: "mainline", text: "识别第一组子母型" },
      12,
      expect.any(String),
    );
  });

  it("listen_only（呈现中）：状态说明、无主线输入控件；continue_input → 继续 CTA 提交 control.continue", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "listen_only", revision: 5 }));
    mount(client);
    await settle();
    expect(container!.querySelector('[data-testid="tutor-participation"]')?.textContent).toContain("听老师讲解");
    expect(container!.querySelector('[data-testid="tutor-submit-answer"]')).toBeNull();

    mocks.restore.mockResolvedValue(validRuntimeSnapshot({ participationKind: "continue_input", revision: 6 }));
    mount(client, RUNTIME_SESSION_ID);
    await settle();
    const cont = container!.querySelector<HTMLButtonElement>('[data-testid="tutor-continue-input"]');
    expect(cont).not.toBeNull();
    await act(async () => {
      cont!.click();
      await Promise.resolve();
    });
    await settle();
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "control", command: "continue" },
      6,
      expect.any(String),
    );
  });

  it("temporarily_paused_for_inquiry：ready_to_return 时出返回主线 CTA（control.return_to_mainline）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({
      participationKind: "temporarily_paused_for_inquiry",
      inquiryReadyToReturn: true,
      revision: 8,
    }));
    mount(client);
    await settle();
    const back = container!.querySelector<HTMLButtonElement>('[data-testid="tutor-inquiry-return"]');
    expect(back).not.toBeNull();
    await act(async () => {
      back!.click();
      await Promise.resolve();
    });
    await settle();
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "control", command: "return_to_mainline" },
      8,
      expect.any(String),
    );
  });

  it("read_only_completed：完成回顾 + 开始训练（无参与输入）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "read_only_completed" }));
    mount(client);
    await settle();
    expect(container!.querySelector('[data-testid="tutor-completed"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="tutor-start-practice"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="tutor-submit-answer"]')).toBeNull();
  });

  it("workspace_input：pending 呈现期间（无 active_action）不挂载 Frame；active_action 下发才挂载", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({
      participationKind: "workspace_input",
      activeAction: false,
      pendingPresentation: true,
    }));
    mount(client);
    await settle();
    expect(container!.querySelector('[data-testid="tutor-participation"]')?.textContent).toContain("画布");
    expect(container!.querySelector(".geometry-canvas, .action-runtime-frame, .action-runtime-workspace")).toBeNull();

    mocks.restore.mockResolvedValue(validRuntimeSnapshot({ participationKind: "workspace_input", revision: 30 }));
    mount(client, RUNTIME_SESSION_ID);
    await settle();
    expect(container!.querySelector(".geometry-canvas, .action-runtime-frame, .action-runtime-workspace")).not.toBeNull();
  });

  it("协议错误：保留最后合法快照 UI + 显式 protocol error 与重新同步入口", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    mount(client);
    await settle();
    mocks.submitStudentInput.mockRejectedValue(new ProtocolParseError(["render: Required"]));
    const confirm = container!.querySelector<HTMLButtonElement>('[data-testid="tutor-confirm-input"]');
    await act(async () => {
      confirm!.click();
      await Promise.resolve();
    });
    await settle();
    expect(container!.querySelector('[data-testid="tutor-protocol-error"]')).not.toBeNull();
    // 最后合法快照仍在（确认按钮渲染自旧快照 revision=12 的 participation）。
    expect(container!.querySelector('[data-testid="tutor-confirm-input"]')).not.toBeNull();
    mocks.restore.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 13 }));
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="tutor-protocol-retry"]')!.click();
      await Promise.resolve();
    });
    await settle();
    expect(container!.querySelector('[data-testid="tutor-protocol-error"]')).toBeNull();
    expect(container!.querySelector('[data-testid="tutor-submit-answer"]')).not.toBeNull();
  });

  it("turn failure（200 + revision-conflict）：提示可见；system failure 不显示答错", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    mount(client);
    await settle();
    mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({
      participationKind: "answer_input",
      revision: 12,
      turn: { status: "revision-conflict", failure: { category: "turn", failure_class: "STALE_REVISION", retryable: true } },
    }));
    const input = container!.querySelector<HTMLInputElement>('[data-testid="tutor-participation"] input');
    await act(async () => {
      setInputValue(input!, "答");
    });
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="tutor-submit-answer"]')!.click();
      await Promise.resolve();
    });
    await settle();
    const notice = container!.querySelector('[data-testid="tutor-turn-failure"]');
    expect(notice?.textContent).toContain("STALE_REVISION");
  });
});
