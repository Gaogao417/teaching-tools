import { describe, expect, it, vi } from "vitest";
import { COACH_MEDIA_PROTOCOL_VERSION, type CoachTurnEvent } from "../../../../../shared/coachMedia";
import type { CoachDirective, CoachTurnResponse, StudentTrace } from "../../../../../shared/actionRuntime";
import type { MediaSessionController } from "../../audio/MediaSessionController";
import {
  CoachController,
  reduceCoachThread,
  type CoachControllerDeps,
  type CoachThreadEvent,
  type CoachTurnPlanContext,
} from "../CoachController";

type TurnPayload = CoachTurnEvent extends infer E
  ? E extends { version: number; correlationId: string; sessionId: string; sequence: number; at: string }
    ? Omit<E, "version" | "correlationId" | "sessionId" | "sequence" | "at">
    : never
  : never;

function envelope(event: TurnPayload): CoachTurnEvent {
  return {
    ...event,
    version: COACH_MEDIA_PROTOCOL_VERSION,
    correlationId: "c-test",
    sessionId: "s1",
    sequence: 0,
    at: "2026-08-13T00:00:00.000Z",
  } as CoachTurnEvent;
}

function makeContext(overrides?: Partial<CoachTurnPlanContext>): CoachTurnPlanContext {
  return {
    transport: "stream",
    local: false,
    sessionId: "s1",
    exerciseId: "e1",
    mode: "guided-practice",
    currentActionId: "a1",
    studentText: "",
    previousConversation: [],
    ...overrides,
  };
}

function fakeMedia() {
  return {
    startAudioStream: vi.fn(() => ({ appendChunk: vi.fn(), complete: vi.fn() })),
    stop: vi.fn(),
  } as unknown as MediaSessionController;
}

function makeDeps() {
  const media = fakeMedia();
  const runtime = {
    recordAssistance: vi.fn(),
    getTrace: vi.fn(() => ({ selectedObjectIds: [] }) as unknown as StudentTrace),
    applyCoach: vi.fn(),
  };
  const events: CoachThreadEvent[] = [];
  const playSpeechUrl = vi.fn();
  const stream = vi.fn();
  const request = vi.fn();
  const deps: CoachControllerDeps = {
    media,
    client: { stream, request },
    callbacks: { runtime, playSpeechUrl, onThreadEvent: (e) => events.push(e) },
  };
  return { media, runtime, events, playSpeechUrl, stream, request, deps };
}

const directive: CoachDirective = {
  directiveId: "d1",
  messageLatex: "因为平行",
  spokenText: "因为平行",
  tone: "explain",
  highlightObjectIds: [],
  suggestedActionId: "a1",
};

describe("CoachController — the coach turn orchestration boundary (ADR-005)", () => {
  it("drives the stream transport: applies the directive, feeds audio to the media session, emits thread events", async () => {
    const { media, runtime, events, stream, deps } = makeDeps();
    const controller = new CoachController(deps);
    stream.mockImplementation(async (_payload, onEvent: (event: CoachTurnEvent) => void) => {
      onEvent(envelope({ type: "turn.transcript.delta", role: "coach", text: "因为" }));
      onEvent(envelope({ type: "turn.transcript.delta", role: "coach", text: "平行" }));
      onEvent(envelope({ type: "turn.audio.delta", segmentId: "seg1", audioBase64: "AAAA", mimeType: "audio/mpeg" }));
      onEvent(envelope({ type: "turn.directive", directive }));
      onEvent(envelope({ type: "turn.completed" }));
    });

    const started = await controller.startTurn({ message: "为什么？" }, makeContext(), "coach");

    expect(started).toBe(true);
    expect(runtime.recordAssistance).toHaveBeenCalledWith("coach");
    expect(runtime.applyCoach).toHaveBeenCalledWith(directive);
    expect(media.startAudioStream).toHaveBeenCalledWith("coach-turn", expect.objectContaining({ correlationId: "c-test" }));
    // Thread: student turn + streamed coach deltas + final directive bubble.
    expect(events.find((e) => e.type === "student-turn")).toBeDefined();
    expect(events.filter((e) => e.type === "coach-upsert").map((e) => (e as { text: string }).text)).toEqual(["因为", "因为平行", "因为平行"]);
    expect(controller.getStatus().busy).toBe(false);
  });

  it("cancel() aborts the in-flight turn (AbortSignal) and stops coach-turn playback", async () => {
    const { media, runtime, stream, deps } = makeDeps();
    const controller = new CoachController(deps);
    let signal!: AbortSignal;
    stream.mockImplementation((_p: unknown, _onEvent: (event: CoachTurnEvent) => void, sig: AbortSignal) => {
      signal = sig;
      return new Promise<void>((_, reject) => sig.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });

    const promise = controller.startTurn({ message: "q" }, makeContext(), "coach");
    // The turn started and is busy; cancellation is driven by the controller.
    expect(controller.getStatus().busy).toBe(true);
    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(false);
    controller.cancel("action-switch");
    expect(signal.aborted).toBe(true);
    await promise;

    expect(controller.getStatus().busy).toBe(false);
    expect(media.stop).toHaveBeenCalledWith("coach-turn");
    // Cancellation must NOT apply a failure directive into the runtime.
    expect(runtime.applyCoach).not.toHaveBeenCalled();
  });

  it("the hint assistance kind is forwarded for '没听懂' messages", async () => {
    const { runtime, stream, deps } = makeDeps();
    const controller = new CoachController(deps);
    stream.mockResolvedValue(undefined);
    // No directive -> throws "ended without a directive" -> failure path.
    await controller.startTurn({ message: "我没听懂这一步" }, makeContext(), "hint");
    expect(runtime.recordAssistance).toHaveBeenCalledWith("hint");
  });

  it("drives the request-response transport and plays the reply speech url", async () => {
    const { runtime, playSpeechUrl, request, deps } = makeDeps();
    const controller = new CoachController(deps);
    const response: CoachTurnResponse = {
      directive,
      transcript: "你好",
      speech: { audioUrl: "https://example/reply.mp3" },
    };
    request.mockResolvedValue(response);

    const started = await controller.startTurn({ message: "hi" }, makeContext({ transport: "request-response" }), "coach");

    expect(started).toBe(true);
    expect(runtime.applyCoach).toHaveBeenCalledWith(directive);
    expect(playSpeechUrl).toHaveBeenCalledWith("https://example/reply.mp3");
  });

  it("a transport failure (not a cancellation) applies a failure directive and emits an error bubble", async () => {
    const { runtime, events, stream, deps } = makeDeps();
    const controller = new CoachController(deps);
    stream.mockRejectedValue(new Error("network down"));

    const started = await controller.startTurn({ audio: { dataUrl: "data:audio/webm;base64,AAAA" } }, makeContext(), "coach");

    expect(started).toBe(true);
    expect(runtime.applyCoach).toHaveBeenCalledWith(expect.objectContaining({ tone: "prompt", suggestedActionId: "a1" }));
    expect(events.some((e) => e.type === "coach-message" && e.error)).toBe(true);
    // The student audio turn is flagged as errored.
    expect(events.some((e) => e.type === "student-error" && e.error === true)).toBe(true);
    expect(controller.getStatus().busy).toBe(false);
  });

  it("guards: no message and no audio is a no-op that does not record assistance", async () => {
    const { runtime, stream, deps } = makeDeps();
    const controller = new CoachController(deps);
    const started = await controller.startTurn({}, makeContext({ studentText: "   " }), "coach");
    expect(started).toBe(false);
    expect(runtime.recordAssistance).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });

  it("guards: a second startTurn while one is in flight is rejected without touching the transport", async () => {
    const { stream, deps } = makeDeps();
    const controller = new CoachController(deps);
    stream.mockImplementation((_p: unknown, _onEvent: (event: CoachTurnEvent) => void, sig: AbortSignal) =>
      new Promise<void>((_, reject) => sig.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
    );

    const first = controller.startTurn({ message: "q1" }, makeContext(), "coach");
    expect(controller.getStatus().busy).toBe(true);
    const secondStarted = await controller.startTurn({ message: "q2" }, makeContext(), "coach");
    expect(secondStarted).toBe(false);
    expect(stream).toHaveBeenCalledTimes(1);

    controller.cancel("done");
    await first;
    expect(controller.getStatus().busy).toBe(false);
  });
});

describe("reduceCoachThread", () => {
  it("reduces the event stream into thread bubbles matching the legacy inline semantics", () => {
    let thread = reduceCoachThread([], { type: "student-turn", id: "s1", text: "hi", pending: false });
    expect(thread).toEqual([{ id: "s1", role: "student", text: "hi", pending: false }]);

    thread = reduceCoachThread(thread, { type: "coach-upsert", id: "c1", text: "an", pending: true });
    expect(thread[1]).toMatchObject({ id: "c1", role: "coach", text: "an", pending: true });
    // Upsert replaces the same id rather than appending.
    thread = reduceCoachThread(thread, { type: "coach-upsert", id: "c1", text: "answer", pending: false });
    expect(thread.filter((t) => t.id === "c1")).toHaveLength(1);
    expect(thread[1]).toMatchObject({ text: "answer", pending: false });

    thread = reduceCoachThread(thread, { type: "student-transcribed", id: "s1", text: "recognized" });
    expect(thread[0]).toMatchObject({ id: "s1", text: "recognized", pending: false });

    thread = reduceCoachThread(thread, { type: "student-error", id: "s1", error: true });
    expect(thread[0]).toMatchObject({ id: "s1", error: true });

    thread = reduceCoachThread(thread, { type: "coach-message", id: "c2", text: "offline", error: true });
    expect(thread[thread.length - 1]).toMatchObject({ id: "c2", role: "coach", text: "offline", error: true });
  });
});
