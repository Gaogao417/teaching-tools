import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ActionPlanResponse } from "../../../../shared/actionRuntime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const checkpointAction = vi.fn();
const evaluateAction = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    checkpointAction,
    evaluateAction,
    askActionCoach: vi.fn(),
  },
}));
vi.mock("../../geometry/react/GeometryCanvas", () => ({
  GeometryCanvasSurface: ({ view }: { view: { preview?: { type: string } } }) => <div data-testid="production-canvas" data-preview={view.preview?.type || "none"} />,
}));

const { ActionRuntimeFrame } = await import("../react/ActionRuntimeFrame");

function response(): ActionPlanResponse {
  return {
    sessionId: "browser-session",
    plan: {
      planVersion: 2, exerciseId: "browser-exercise", revision: 0, mode: "guided-practice",
      metadata: { taskId: "auxiliaryTwoRatios", title: "辅助线", promptLatex: "prompt", skillTags: [] },
      world: {
        revision: 0,
        geometry: {
          viewBox: { width: 10, height: 10 },
          points: [{ id: "T", x: 0, y: 1 }, { id: "A", x: 0, y: 0 }, { id: "B", x: 2, y: 0 }],
          segments: [{ id: "AB", from: "A", to: "B" }],
        },
      },
      coach: { profileId: "coach", displayName: "老师", avatarId: "school", tone: "supportive" },
      actions: [{
        actionId: "make", sourceStepId: "step", kind: "make-parallel", version: 1,
        title: "作平行线", instruction: "选择点和线", input: { availablePointIds: ["T"], availableLineIds: ["AB"], outputLineId: "P", outputLineLabel: "TP" },
        capabilities: ["agent:select-object", "agent:back", "agent:clear"], answerSlots: [], validationPolicy: "server-authoritative", submitOnComplete: true,
      }],
      currentActionId: "make", completedActionIds: [],
    },
  };
}

describe("ActionRuntimeFrame browser/accessibility contract", () => {
  it("supports mouse/keyboard-focusable semantic controls, aria-live coach, Canvas preview and local undo with zero requests", async () => {
    checkpointAction.mockClear();
    evaluateAction.mockClear();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<ActionRuntimeFrame response={response()} />));

    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    const point = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "T")!;
    point.focus();
    expect(document.activeElement).toBe(point);
    await act(async () => point.click());
    expect(container.querySelector('[data-testid="production-canvas"]')?.getAttribute("data-preview")).toBe("none");

    const undo = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "撤销")!;
    expect(undo.disabled).toBe(false);
    await act(async () => undo.click());
    expect(checkpointAction).not.toHaveBeenCalled();
    expect(evaluateAction).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    document.body.removeChild(container);
  });
});
