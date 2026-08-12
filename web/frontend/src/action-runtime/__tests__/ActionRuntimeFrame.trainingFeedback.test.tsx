import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ActionPlanResponse, ExercisePlan } from "../../../../shared/actionRuntime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Full api surface mock so the Frame's eval/checkpoint/training-sync/coach/
// narration effects never reach the network during these tests.
vi.mock("../../api/client", () => ({
  api: {
    checkpointAction: vi.fn().mockResolvedValue({ accepted: true }),
    evaluateAction: vi.fn(),
    askActionCoach: vi.fn(),
    conductActionCoach: vi.fn(),
    streamActionCoach: vi.fn(),
    synthesizeActionSpeech: vi.fn().mockResolvedValue({ audioUrl: "https://example/test.mp3", model: "test", voice: "test" }),
    streamActionSpeech: vi.fn().mockResolvedValue({ audioUrl: "https://example/test.mp3", model: "test", voice: "test" }),
    uploadTrainingRecord: vi.fn().mockResolvedValue({ accepted: true, recordId: "r" }),
    reportVoiceTelemetry: vi.fn().mockResolvedValue({ accepted: true }),
  },
}));
// The training sync queue persists to localStorage; stub it so the Frame's
// guided-practice training-sync effect never touches real storage in jsdom.
vi.mock("../../persistence/training/trainingSyncQueue", () => ({
  getTrainingSyncQueue: () => ({
    enqueue: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    snapshot: () => [],
  }),
}));
// Deterministic canvas stub: one button per interactable point/line so a test
// can drive OBJECT.SELECTED for a wrong point (C0) and the correct point (T).
vi.mock("../../geometry/react/GeometryCanvas", () => ({
  GeometryCanvasSurface: ({ onClickEntity }: {
    onClickEntity: (entity: { kind: "point" | "line"; id: string }) => void;
  }) => (
    <div data-testid="production-canvas">
      {(["T", "C0", "C1"] as const).map((id) => (
        <button key={id} type="button" data-testid={`point-${id}`} onClick={() => onClickEntity({ kind: "point", id })}>{id}</button>
      ))}
      <button type="button" data-testid="line-S" onClick={() => onClickEntity({ kind: "line", id: "S" })}>S</button>
    </div>
  ),
}));

const { ActionRuntimeFrame } = await import("../react/ActionRuntimeFrame");
const { createActionPageRuntime } = await import("../pageRuntime");

const WRONG_MESSAGE = "这个对象不是当前动作需要的对象。";

// A single make-parallel Action whose through-point is T and reference line is
// S, but which accepts T/C0/C1 as plausible point candidates. Selecting C0 is a
// wrong candidate the local-training guard rejects; selecting T is correct.
function localTrainingResponse(): ActionPlanResponse {
  return {
    sessionId: "feedback-session",
    plan: {
      planVersion: 5, exerciseId: "feedback-exercise", revision: 0, mode: "guided-practice",
      metadata: { taskId: "auxiliaryTwoRatios", title: "辅助线", promptLatex: "prompt", skillTags: [] },
      world: {
        revision: 0,
        geometry: {
          viewBox: { width: 10, height: 10 },
          points: [{ id: "T", x: 0, y: 1 }, { id: "C0", x: 0, y: 0 }, { id: "C1", x: 1, y: 0 }],
          segments: [{ id: "S", from: "C0", to: "C1" }],
        },
      },
      coach: { profileId: "coach", displayName: "老师", avatarId: "school", tone: "supportive" },
      actions: [{
        actionId: "step/make", sourceStepId: "step", kind: "make-parallel", version: 1,
        title: "作平行线", instruction: "选择点和线",
        input: { throughPointId: "T", referenceLineId: "S", availablePointIds: ["T", "C0", "C1"], availableLineIds: ["S"], outputLineId: "P", outputLineLabel: "TP" },
        capabilities: ["agent:select-object", "agent:back", "agent:clear"], answerSlots: [],
        validationPolicy: "local-training", submitOnComplete: false,
      }],
      currentActionId: "step/make", completedActionIds: [],
      runtimeCapabilities: { practiceValidation: "local-training", trainingSync: "async-records", narrationTransport: "url", coachTurnTransport: "request-response", liveCoach: true },
    },
  };
}

function localTrainingPlan(): ExercisePlan {
  return localTrainingResponse().plan;
}

describe("ActionRuntimeFrame wrong-candidate training feedback (ADR-006)", () => {
  it("renders visual+textual wrong feedback in the same render cycle as the wrong attempt, then clears on correction", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<ActionRuntimeFrame response={localTrainingResponse()} />));

    // No wrong feedback before any wrong attempt.
    expect(container.querySelector('[data-testid="training-feedback"]')).toBeNull();

    // Wrong candidate (C0 is plausible but not the through-point T).
    const wrong = container.querySelector<HTMLButtonElement>('[data-testid="point-C0"]')!;
    await act(async () => wrong.click());

    const feedback = container.querySelector<HTMLElement>('[data-testid="training-feedback"]');
    expect(feedback).not.toBeNull();
    // Textual feedback lands in the same render cycle as the wrong attempt.
    expect(feedback!.textContent).toContain(WRONG_MESSAGE);
    // Wrong-tone styling signal is present.
    expect(feedback!.getAttribute("data-feedback-tone")).toBe("wrong");
    // The Action prompt bubble is untouched (additive rendering; no coach-stream regression).
    expect(container.querySelector('[aria-label="当前 Action 讲解"]')?.textContent).toContain("选择点和线");

    // Correct candidate (T) clears the feedback in the next render cycle.
    const correct = container.querySelector<HTMLButtonElement>('[data-testid="point-T"]')!;
    await act(async () => correct.click());
    expect(container.querySelector('[data-testid="training-feedback"]')).toBeNull();

    await act(async () => root.unmount());
    document.body.removeChild(container);
  });

  it("feedback wiring does not alter the recorded attempt/metrics — the recorder still sees the same wrong attempt", () => {
    // Wrong candidate: the feedback view goes active AND the recorder still
    // records exactly one "wrong" attempt — proving the feedback projection is
    // purely additive to guard/recording/metrics (correctness unchanged).
    const runtime = createActionPageRuntime(localTrainingPlan());
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C0" });

    const afterWrong = runtime.getView();
    expect(afterWrong.feedback?.active).toBe(true);
    expect(afterWrong.feedback?.tone).toBe("wrong");
    expect(afterWrong.feedback?.messageLatex).toBe(WRONG_MESSAGE);
    expect(afterWrong.feedback?.highlightObjectIds).toContain("C0");
    // Recorder/metrics are unchanged by the feedback wiring.
    expect(runtime.getTrace().wrongAttempts).toBe(1);
    expect(runtime.getTrainingSnapshot().attempts.map((attempt) => attempt.outcome)).toEqual(["wrong"]);

    // A subsequent correct candidate clears the feedback and records correct-partial.
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "T" });
    expect(runtime.getView().feedback).toBeUndefined();
    expect(runtime.getTrainingSnapshot().attempts.map((attempt) => attempt.outcome)).toEqual(["wrong", "correct-partial"]);
    runtime.stop();
  });

  it("BACK and CLEAR clear the wrong feedback without changing the already-recorded wrong attempt", () => {
    for (const clearingEvent of [{ type: "BACK" } as const, { type: "CLEAR" } as const]) {
      const runtime = createActionPageRuntime(localTrainingPlan());
      runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C0" });
      expect(runtime.getView().feedback?.active).toBe(true);
      expect(runtime.getTrace().wrongAttempts).toBe(1);

      runtime.send(clearingEvent);
      // Feedback is cleared...
      expect(runtime.getView().feedback).toBeUndefined();
      // ...but the recorded wrong attempt and counter are untouched (no re-record, no erase).
      expect(runtime.getTrace().wrongAttempts).toBe(1);
      expect(runtime.getTrainingSnapshot().attempts.map((attempt) => attempt.outcome)).toEqual(["wrong"]);
      runtime.stop();
    }
  });
});
