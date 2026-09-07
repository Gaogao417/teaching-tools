/**
 * F7 P2（R5 裁定时序）— mic→barge-in→capture 因果链（useTutorLearning 侧）。
 *
 * - 在播可中断 voice 时 prepareRecordingStart：①中断 adapter ②interrupted
 *   outcome 结算并采用新 snapshot ③control.barge_in——三步完成后才返回 true；
 *   随后的 lockRecordingChannel 对 barge-in 后采用的新快照捕获最新 revision；
 * - ②结算失败（409 拒绝）→ 返回 false + 可见提示、零 control（等待失败不录音）；
 * - 无活跃可中断交付（idle/生成中无 delivery）→ 直接 true，零 outcome 零
 *   control（不伪造 interrupted）；
 * - P2-A 返工 A1：③ control 被拒（403/409）或网络失败 → 返回 false + 可见
 *   提示、不盲重试——HTTP 结束≠回执被接受，仅 accepted-and-adopted 放行；
 * - P2-A 返工 A2：outcome 未决（自然 ended 回执在途）时门不得提前结算——
 *   等待原回执：接受并采用 → 继续 ③（control 接受 → true）；回执拒绝 →
 *   false + 可见提示、零 control（不补造 interrupted）。
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

  // ---- P2-A 返工（独立验收反例回归）：control 门与 outcome 未决 ---- //

  it.each([403, 409])(
    "P2-A A1：③ control %s 被拒 → prepareRecordingStart resolve false、可见提示、录音不开始（不靠 ASR stale 兜底放行）",
    async (status) => {
      const { client, mocks } = makeClient();
      mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
      // ② interrupted outcome：接受并采用（rev 13）→ 允许进入 ③。
      mocks.reportPresentationOutcome.mockResolvedValueOnce(validRuntimeSnapshot({ revision: 13 }));
      // ③ control.barge_in：HTTP 403/409 = 确定性拒绝——不得放行录音。
      mocks.submitStudentInput.mockRejectedValueOnce(
        new TutorRuntimeHttpError(status, status === 409 ? "REVISION_CONFLICT" : "FORBIDDEN", "control rejected"),
      );
      harness = mountHarness(client);
      await act(async () => { await harness.tutor().start(); });
      await act(async () => {
        await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting" && tutor.runtimePresentationPhase.kind === "voice");
      });
      let allowed = true;
      await act(async () => { allowed = await harness.tutor().prepareRecordingStart(); });
      expect(allowed).toBe(false);
      // 门真的走到了 ③（② 已接受并采用，control 以 rev 13 提交）——失败发生在 control。
      expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
      expect(mocks.submitStudentInput).toHaveBeenCalledTimes(1);
      expect(mocks.submitStudentInput).toHaveBeenCalledWith(
        RUNTIME_SESSION_ID,
        { kind: "control", command: "barge_in" },
        13,
        expect.any(String),
      );
      expect(harness.tutor().runtimeFailureNotice).toContain("录音没有开始");
    },
  );

  it("P2-A A1：③ control 网络失败（5xx）→ false + 可见提示，且不盲重试（幂等 token 留待同键恢复）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    mocks.reportPresentationOutcome.mockResolvedValueOnce(validRuntimeSnapshot({ revision: 13 }));
    mocks.submitStudentInput.mockRejectedValueOnce(new TutorRuntimeHttpError(503, "RUNTIME_UNAVAILABLE", "network"));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting" && tutor.runtimePresentationPhase.kind === "voice");
    });
    let allowed = true;
    await act(async () => { allowed = await harness.tutor().prepareRecordingStart(); });
    expect(allowed).toBe(false);
    // 网络失败不自动重放（服务端状态未知——同键重试由用户/恢复链触发）。
    expect(mocks.submitStudentInput).toHaveBeenCalledTimes(1);
    expect(harness.tutor().runtimeFailureNotice).toContain("录音没有开始");
  });

  it("P2-A A2：outcome 未决（自然 ended 回执在途）→ 门等待结算；接受并采用 + control 接受 → true", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    let resolveOutcome!: (snapshot: ReturnType<typeof validRuntimeSnapshot>) => void;
    mocks.reportPresentationOutcome.mockReturnValue(new Promise((settle) => { resolveOutcome = settle; }));
    // ③ control.barge_in：接受（rev 14 answer_input——可录音）。
    mocks.submitStudentInput.mockResolvedValueOnce(validRuntimeSnapshot({ participationKind: "answer_input", revision: 14 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting" && tutor.runtimePresentationPhase.kind === "voice");
    });
    // 自然播放结束先胜出：真实 presented 回执在途（outcome-pending）。
    await act(async () => {
      mediaHarness.emitPlayback({ type: "ended", owner: "narration", generation: mediaHarness.state.generation });
    });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "outcome-pending");
    });
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    let settled = false;
    let allowed: boolean | undefined;
    let gate: Promise<boolean> | undefined;
    await act(async () => {
      gate = harness.tutor().prepareRecordingStart().then((value) => { settled = true; allowed = value; return value; });
      await Promise.resolve();
    });
    // 回执未决：门不得结算，③ control 不得先行。
    expect(settled).toBe(false);
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    // 回执接受并采用（rev 13）→ 门继续 ③；control 接受并采用 → 放行录音。
    await act(async () => {
      resolveOutcome(validRuntimeSnapshot({ revision: 13 }));
      allowed = await gate;
    });
    expect(allowed).toBe(true);
    expect(mocks.reportPresentationOutcome.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.submitStudentInput.mock.invocationCallOrder[0]);
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "control", command: "barge_in" },
      13,
      expect.any(String),
    );
  });

  it("P2-A A2：outcome 未决 → 回执拒绝 → false + 可见提示、零 control（不补造 interrupted）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    let rejectOutcome!: (failure: unknown) => void;
    mocks.reportPresentationOutcome.mockReturnValue(new Promise((_settle, fail) => { rejectOutcome = fail; }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting" && tutor.runtimePresentationPhase.kind === "voice");
    });
    await act(async () => {
      mediaHarness.emitPlayback({ type: "ended", owner: "narration", generation: mediaHarness.state.generation });
    });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "outcome-pending");
    });
    let settled = false;
    let allowed: boolean | undefined;
    let gate: Promise<boolean> | undefined;
    await act(async () => {
      gate = harness.tutor().prepareRecordingStart().then((value) => { settled = true; allowed = value; return value; });
      await Promise.resolve();
    });
    // 回执未决：门不得结算、control 不得先行。
    expect(settled).toBe(false);
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    // 回执被拒（409 确定性拒绝）→ 门失败：可见提示、不放行录音。
    await act(async () => {
      rejectOutcome(new TutorRuntimeHttpError(409, "REVISION_CONFLICT", "rejected"));
      allowed = await gate;
    });
    expect(allowed).toBe(false);
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    expect(harness.tutor().runtimeFailureNotice).toContain("打断没有成功");
  });
});
