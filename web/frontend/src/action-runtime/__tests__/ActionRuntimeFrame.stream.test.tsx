import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { COACH_MEDIA_PROTOCOL_VERSION, type CoachTurnEvent } from "../../../../shared/coachMedia";
import type { ActionPlanResponse, CoachDirective } from "../../../../shared/actionRuntime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const streamActionCoach = vi.fn();
const conductActionCoach = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    checkpointAction: vi.fn(),
    evaluateAction: vi.fn(),
    askActionCoach: vi.fn(),
    conductActionCoach,
    streamActionCoach,
    synthesizeActionSpeech: vi.fn().mockResolvedValue({ audioUrl: "https://example/test.mp3", model: "test", voice: "test" }),
    reportVoiceTelemetry: vi.fn().mockResolvedValue({ accepted: true }),
  },
}));
vi.mock("../../geometry/react/GeometryCanvas", () => ({
  GeometryCanvasSurface: ({ onClickEntity }: { onClickEntity: (entity: { kind: "point"; id: string }) => void }) =>
    <button type="button" data-testid="production-canvas" onClick={() => onClickEntity({ kind: "point", id: "T" })}>T</button>,
}));

const { ActionRuntimeFrame } = await import("../react/ActionRuntimeFrame");

type TurnPayload = CoachTurnEvent extends infer E
  ? E extends { version: number; correlationId: string; sessionId: string; sequence: number; at: string }
    ? Omit<E, "version" | "correlationId" | "sessionId" | "sequence" | "at">
    : never
  : never;

function envelope(event: TurnPayload): CoachTurnEvent {
  return {
    ...event,
    version: COACH_MEDIA_PROTOCOL_VERSION,
    correlationId: "c-stream",
    sessionId: "learn:auxiliaryTwoRatios",
    sequence: 0,
    at: "2026-08-12T00:00:00.000Z",
  } as CoachTurnEvent;
}

function streamResponse(): ActionPlanResponse {
  return {
    sessionId: "learn:auxiliaryTwoRatios",
    plan: {
      planVersion: 5, exerciseId: "browser-exercise", revision: 0, mode: "learn",
      metadata: { taskId: "auxiliaryTwoRatios", title: "辅助线", promptLatex: "prompt", skillTags: [] },
      world: { revision: 0, geometry: { viewBox: { width: 10, height: 10 }, points: [{ id: "T", x: 0, y: 1 }, { id: "A", x: 0, y: 0 }, { id: "B", x: 2, y: 0 }], segments: [{ id: "AB", from: "A", to: "B" }] } },
      coach: { profileId: "coach", displayName: "老师", avatarId: "school", tone: "supportive" },
      actions: [{ actionId: "make", sourceStepId: "step", kind: "make-parallel", version: 1, title: "作平行线", instruction: "选择点和线", input: { availablePointIds: ["T"], availableLineIds: ["AB"], outputLineId: "P", outputLineLabel: "TP" }, capabilities: ["agent:select-object", "agent:back", "agent:clear"], answerSlots: [], validationPolicy: "local-demonstration", submitOnComplete: true }],
      currentActionId: "make", completedActionIds: [],
      runtimeCapabilities: { practiceValidation: "local-training", trainingSync: "async-records", narrationTransport: "url", coachTurnTransport: "stream", liveCoach: false },
    },
  };
}

describe("ActionRuntimeFrame streaming coach", () => {
  it("uses the stream path, shows the streamed reply, and never overwrites the Action explanation bubble", async () => {
    streamActionCoach.mockClear();
    conductActionCoach.mockClear();
    const directive: CoachDirective = {
      directiveId: "coach-stream-1",
      messageLatex: "因为要构造平行关系，所以先过点作平行线。",
      spokenText: "因为要构造平行关系，所以先过点作平行线。",
      tone: "explain", highlightObjectIds: [], suggestedActionId: "make",
    };
    streamActionCoach.mockImplementation(async (_payload: unknown, onEvent: (event: CoachTurnEvent) => void) => {
      onEvent(envelope({ type: "turn.started" }));
      onEvent(envelope({ type: "turn.transcript.delta", role: "coach", text: "因为要构造" }));
      onEvent(envelope({ type: "turn.transcript.delta", role: "coach", text: "平行关系，所以先过点作平行线。" }));
      onEvent(envelope({ type: "turn.directive", directive }));
      onEvent(envelope({ type: "turn.completed" }));
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<ActionRuntimeFrame response={streamResponse()} local />));

    const input = container.querySelector<HTMLInputElement>(".topic-coach-question input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "为什么要作平行线？");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const send = container.querySelector<HTMLButtonElement>('[aria-label="发送问题"]')!;
    await act(async () => send.click());

    expect(streamActionCoach).toHaveBeenCalledTimes(1);
    expect(conductActionCoach).not.toHaveBeenCalled();
    expect(container.textContent).toContain("因为要构造平行关系，所以先过点作平行线。");
    // The Action explanation bubble keeps showing only the Action prompt, never the coach reply.
    const actionBubble = container.querySelector('[aria-label="当前 Action 讲解"]');
    expect(actionBubble).not.toBeNull();
    expect(actionBubble!.textContent).toContain("选择点和线");
    expect(actionBubble!.textContent).not.toContain("因为要构造平行关系");

    await act(async () => root.unmount());
    document.body.removeChild(container);
  });
});
