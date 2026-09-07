/**
 * F7 P2（R5 裁定时序）— mic→barge-in→capture 因果链（useTutorLearning 侧）。
 *
 * - 在播可中断 voice 时 prepareRecordingStart：①中断 adapter ②interrupted
 *   outcome 结算并采用新 snapshot ③control.barge_in——三步完成后才返回 true；
 *   随后的 lockRecordingChannel 对 barge-in 后采用的新快照捕获最新 revision；
 * - ②结算失败（409 拒绝）→ 返回 false + 可见提示、零 control（等待失败不录音）；
 * - 无活跃可中断交付（idle/生成中无 delivery）→ 直接 true，零 outcome 零
 *   control（不伪造 interrupted）。
 */
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TutorRuntimeClient } from "../../../api/tutorRuntimeClient";
import { TutorRuntimeHttpError } from "../../../api/tutorRuntimeClient";
import type { TaskId } from "../../../../../shared/contracts";

const mediaHarness = vi.hoisted(() => {
  const state = { status: "idle" as string, generation: 0 };
  const stateListeners = new Set<(state: { status: string }) => void>();
  const playbackListeners = new Set<(event: { type: string; owner: string; generation: number }) => void>();
  return {
    state,
    stateListeners,
    playbackListeners,
    reset() {
      state.status = "idle";
      state.generation = 0;
      stateListeners.clear();
      playbackListeners.clear();
    },
    emitState() { for (const listener of stateListeners) listener({ status: state.status }); },
    emitPlayback(event: { type: string; owner: string; generation: number }) {
      for (const listener of playbackListeners) listener(event);
    },
    markPlaying() {
      state.generation += 1;
      state.status = "playing";
      this.emitState();
      return state.generation;
    },
    markIdle() {
      state.status = "idle";
      this.emitState();
    },
  };
});

vi.mock("../../../presentation/audio/MediaSessionController", () => ({
  MediaSessionController: class {
    subscribe(listener: (state: { status: string }) => void) {
      mediaHarness.stateListeners.add(listener);
      return () => mediaHarness.stateListeners.delete(listener);
    }
    subscribePlaybackEvents(listener: (event: { type: string; owner: string; generation: number }) => void) {
      mediaHarness.playbackListeners.add(listener);
      return () => mediaHarness.playbackListeners.delete(listener);
    }
    getState() { return mediaHarness.state; }
    currentGeneration() { return mediaHarness.state.generation; }
    stop() {
      mediaHarness.emitPlayback({ type: "stopped", owner: "narration", generation: mediaHarness.state.generation });
      mediaHarness.markIdle();
    }
    dispose() {}
    setNarrationHoldDuringCapture() {}
    replay() { return Promise.resolve(mediaHarness.markPlaying()); }
  },
}));

vi.mock("../../../presentation/narration/NarrationController", () => ({
  NarrationController: class {
    enter = vi.fn(async () => ({ status: "playing" as const, audioUrl: "https://example/voice.mp3", generation: mediaHarness.markPlaying() }));
    replay = vi.fn(async () => { mediaHarness.state.status = "playing"; mediaHarness.emitState(); return mediaHarness.state.generation; });
    stop = vi.fn(() => {
      mediaHarness.emitPlayback({ type: "stopped", owner: "narration", generation: mediaHarness.state.generation });
      mediaHarness.markIdle();
    });
    has = vi.fn(() => true);
  },
  clearNarrationCacheForTests: () => undefined,
}));

vi.mock("../../../api/client", () => ({
  api: {
    streamActionSpeech: vi.fn().mockRejectedValue(new Error("tts unavailable")),
    recordSimilarityLearnProgress: vi.fn().mockResolvedValue({ ok: true }),
  },
  ResponseSchemaError: class extends Error {},
}));

const { useTutorLearning } = await import("../useTutorLearning");
const {
  RUNTIME_SESSION_ID,
  RUNTIME_TASK_ID,
  runtimeSnapshotRaw,
  validRuntimeSnapshot,
} = await import("./runtimeSnapshotFixture");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

type Tutor = ReturnType<typeof useTutorLearning>;

function mountHarness(client: TutorRuntimeClient): {
  tutor: () => Tutor;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latest: Tutor | undefined;
  function Harness() {
    const tutor = useTutorLearning({ taskId: RUNTIME_TASK_ID as TaskId, studentId: "p2-barge-in-student", runtimeClient: client });
    latest = tutor;
    return <div data-testid="phase">{tutor.phase}</div>;
  }
  void act(() => root.render(<StrictMode><Harness /></StrictMode>));
  return {
    tutor: () => latest!,
    unmount: () => { void act(() => root.unmount()); container.remove(); },
  };
}

async function waitForTutor(harness: { tutor: () => Tutor }, predicate: (tutor: Tutor) => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(harness.tutor())) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate(harness.tutor())).toBe(true);
}

describe("useTutorLearning P2：mic→barge-in→capture 因果链（R5 裁定时序）", () => {
  let harness: ReturnType<typeof mountHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    mediaHarness.reset();
  });

  afterEach(() => {
    harness?.unmount();
  });

  it("在播可中断 voice：prepareRecordingStart 完成 ①②③ 后返回 true；capture 用 barge-in 后新 revision", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    // ② interrupted outcome：服务端推进 rev 13（无 pending，等 control）。
    mocks.reportPresentationOutcome.mockResolvedValueOnce(validRuntimeSnapshot({ revision: 13 }));
    // ③ control.barge_in：Navigator 新快照 rev 14（answer_input——可录音）。
    mocks.submitStudentInput.mockResolvedValueOnce(validRuntimeSnapshot({ participationKind: "answer_input", revision: 14 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting" && tutor.runtimePresentationPhase.kind === "voice");
    });
    let allowed = false;
    await act(async () => { allowed = await harness.tutor().prepareRecordingStart(); });
    expect(allowed).toBe(true);
    // ①②③ 全链：interrupted outcome 先于 control.barge_in。
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      "VA-bt01-narrate",
      expect.objectContaining({ sequenceId: "PS-0001", ordinal: 0, outcome: "interrupted", expectedRevision: 12 }),
    );
    expect(mocks.reportPresentationOutcome.mock.invocationCallOrder[0]).toBeLessThan(mocks.submitStudentInput.mock.invocationCallOrder[0]);
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "control", command: "barge_in" },
      13,
      expect.any(String),
    );
    // 录音开始时对 barge-in 后采用的新快照（rev 14）捕获通道。
    const capture = harness.tutor().lockRecordingChannel("mainline");
    expect(capture).toMatchObject({ channel: "mainline", sessionId: RUNTIME_SESSION_ID, revision: 14 });
  });

  it("②结算失败（409 拒绝）：返回 false、可见提示、零 control——等待失败不录音", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    mocks.reportPresentationOutcome.mockRejectedValueOnce(new TutorRuntimeHttpError(409, "REVISION_CONFLICT", "rejected"));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting");
    });
    let allowed = true;
    await act(async () => { allowed = await harness.tutor().prepareRecordingStart(); });
    expect(allowed).toBe(false);
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    expect(harness.tutor().runtimeFailureNotice).toContain("打断没有成功");
  });

  it("无活跃可中断交付：直接 true、零 outcome 零 control（不伪造 interrupted）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    let allowed = false;
    await act(async () => { allowed = await harness.tutor().prepareRecordingStart(); });
    expect(allowed).toBe(true);
    expect(mocks.reportPresentationOutcome).not.toHaveBeenCalled();
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
  });
});
