import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ActionPlanResponse } from "../../../../shared/actionRuntime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const checkpointAction = vi.fn();
const evaluateAction = vi.fn();
const conductActionCoach = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    checkpointAction,
    evaluateAction,
    askActionCoach: vi.fn(),
    conductActionCoach,
  },
}));
vi.mock("../../geometry/react/GeometryCanvas", () => ({
  GeometryCanvasSurface: ({ view, onClickEntity }: {
    view: { preview?: { type: string } };
    onClickEntity: (entity: { kind: "point"; id: string }) => void;
  }) => <button type="button" data-testid="production-canvas" data-preview={view.preview?.type || "none"} onClick={() => onClickEntity({ kind: "point", id: "T" })}>T</button>,
}));

const { ActionRuntimeFrame } = await import("../react/ActionRuntimeFrame");

function response(): ActionPlanResponse {
  return {
    sessionId: "browser-session",
    plan: {
      planVersion: 4, exerciseId: "browser-exercise", revision: 0, mode: "guided-practice",
      metadata: { taskId: "auxiliaryTwoRatios", title: "辅助线", promptLatex: "prompt", skillTags: [] },
      world: {
        revision: 0,
        geometry: {
          viewBox: { width: 10, height: 10 },
          points: [{ id: "T", x: 0, y: 1 }, { id: "A", x: 0, y: 0 }, { id: "B", x: 2, y: 0 }],
          segments: [{ id: "AB", from: "A", to: "B" }],
        },
      },
      solutionBoardContexts: [{
        actionId: "make",
        stage: "enter",
        solutionRevision: "browser-v1",
        board: {
          schemaVersion: 1,
          documentId: "browser-solution",
          headingLatex: "\\text{解：}",
          expressions: [{
            expressionId: "construction",
            sourceStepId: "step",
            latexTemplate: "\\text{过 }{{through}}\\text{ 作 }{{helper}}\\parallel {{reference}}",
            slotValues: { through: "T", helper: "TP", reference: "AB" },
            phase: "complete",
          }],
        },
      }],
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
    expect(container.querySelector(".solution-board-panel")).not.toBeNull();
    expect(container.querySelector(".exercise-step")).toBeNull();
    expect(container.querySelector(".action-interaction-panel")).toBeNull();
    expect(container.querySelector(".topic-geometry-entity-chip")).toBeNull();
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

  it("keeps Learn paused for student feedback, answers text questions, then demonstrates on confirmation", async () => {
    conductActionCoach.mockResolvedValue({
      directive: {
        directiveId: "coach-turn-1",
        messageLatex: "因为要构造平行关系，所以先过点作平行线。",
        spokenText: "因为要构造平行关系，所以先过点作平行线。",
        tone: "explain",
        highlightObjectIds: [],
        suggestedActionId: "make",
      },
      providers: { answer: "claude-code-glm-5.2" },
    });
    const learnResponse = response();
    learnResponse.sessionId = "learn:auxiliaryTwoRatios";
    learnResponse.plan.mode = "learn";
    const firstLearnAction = learnResponse.plan.actions[0];
    if (firstLearnAction.kind !== "make-parallel") throw new Error("fixture must start with make-parallel");
    learnResponse.plan.actions[0] = {
      ...firstLearnAction,
      validationPolicy: "local-teaching",
      input: {
        ...firstLearnAction.input,
        throughPointId: "T",
        referenceLineId: "AB",
      },
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<ActionRuntimeFrame response={learnResponse} local />));

    expect(container.textContent).toContain("已暂停，等待学生回应后继续演示");
    const input = container.querySelector<HTMLInputElement>('.topic-coach-question input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "为什么要作平行线？");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>('[aria-label="发送问题"]')!;
    await act(async () => send.click());
    expect(conductActionCoach).toHaveBeenCalledWith(expect.objectContaining({
      context: { kind: "learn", taskId: "auxiliaryTwoRatios" },
      studentMessage: "为什么要作平行线？",
    }));
    expect(container.textContent).toContain("因为要构造平行关系");

    const next = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "明白，继续")!;
    await act(async () => next.click());
    expect(container.textContent).toContain("本题讲解完成");

    await act(async () => root.unmount());
    document.body.removeChild(container);
  });
});
