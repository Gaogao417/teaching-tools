import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceView } from "../types";
import { ActionAnswerFields } from "../react/ActionRuntimeFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function view(focusTargetId?: string): WorkspaceView {
  return {
    actionId: "answer", actionKind: "enter-text", title: "answer", instruction: "answer",
    progress: { current: 1, total: 1 },
    canvas: { entities: {}, selectedObjectIds: [], cursor: "default" },
    answer: { slots: [{ id: "value", label: "答案", kind: "text", value: "", required: true, active: true, status: "empty" }], steps: [] },
    coach: { profileName: "老师", avatarId: "school", messageLatex: "请填写", tone: "prompt", highlightObjectIds: [], focusTargetId },
    controls: { canBack: false, canClear: false, canCancel: true, canHelp: true, canSubmit: false, isSubmitting: false },
  };
}

describe("Action Runtime accessibility", () => {
  it("applies CoachDirective focus to the real answer control with an accessible label", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const send = vi.fn();
    await act(async () => root.render(<ActionAnswerFields runtimeSend={send} view={view("value")} />));
    const input = container.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    expect(input.id).toBe("action-slot-value");
    await act(async () => {
      input.value = "42";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => root.unmount());
    document.body.removeChild(container);
  });
});
