/**
 * F7 P2（S1 R1/R8 + 生成生命周期规格）— useTutorLearning generation 状态与轮询。
 *
 * 覆盖：
 * - runtimeGeneration view-model：unprojected（旧 projector 无字段）/idle/
 *   pending(running|waiting_retry)/failed(error_class 含 RETRY_EXHAUSTED)；
 * - 只读轮询：仅 pending 时 GET restore（零模型调用语义）；退避；waiting_retry
 *   对齐 retry_at；离开 pending/卸载即停；
 * - 轮询采用已提交结果（pending_presentation 进入同一 PresentationRuntime
 *   adopt 流程——已提交未交付结果恢复呈现）；
 * - 迟到查询不回退 revision（低 revision 快照被拒，轮询继续）；
 * - 轮询网络失败：保留最后合法快照、按退避重试、不写 error（后台读）；
 * - 轮询 404：停轮 + 显式错误；
 * - failed 后「重新尝试」走既有 control.retry_recovery。
 */
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TutorRuntimeClient } from "../../../api/tutorRuntimeClient";
import { ProtocolParseError, TutorRuntimeHttpError } from "../../../api/tutorRuntimeClient";
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
  validFromRaw,
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
    const tutor = useTutorLearning({ taskId: RUNTIME_TASK_ID as TaskId, studentId: "p2-generation-student", runtimeClient: client });
    latest = tutor;
    return <div data-testid="phase">{tutor.phase}</div>;
  }
  void act(() => root.render(<StrictMode><Harness /></StrictMode>));
  return {
    tutor: () => latest!,
    unmount: () => { void act(() => root.unmount()); container.remove(); },
  };
}

/** S1 冻结字段投影（generation/scope 成对——与 s1-http-field-cases 合法形态一致）。 */
function generationProjection(
  generation: Record<string, unknown>,
  scope: Record<string, unknown> | null = { kind: "approved", protocol_id: "PR-SMV-001", beat_id: "BT-04" },
): Record<string, unknown> {
  return { generation, scope };
}

function pendingRunning(attempt = 1): Record<string, unknown> {
  return generationProjection({ status: "pending", request_id: "GR-TS4242-0001", phase: "running", attempt, max_attempts: 3 });
}

function pendingWaitingRetry(attempt: number, retryAt: string): Record<string, unknown> {
  return generationProjection({ status: "pending", request_id: "GR-TS4242-0001", phase: "waiting_retry", attempt, max_attempts: 3, retry_at: retryAt });
}

function failedExhausted(): Record<string, unknown> {
  return generationProjection({ status: "failed", request_id: "GR-TS4242-0001", error_class: "RETRY_EXHAUSTED", attempt: 3, max_attempts: 3 });
}

function idleProjection(): Record<string, unknown> {
  return generationProjection({ status: "idle" }, null);
}

function withGeneration(options: Parameters<typeof runtimeSnapshotRaw>[0], projection: Record<string, unknown>): ReturnType<typeof validRuntimeSnapshot> {
  return validFromRaw(runtimeSnapshotRaw({ ...options, overrides: projection }));
}

describe("useTutorLearning P2：generation view-model 与只读轮询", () => {
  let harness: ReturnType<typeof mountHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    mediaHarness.reset();
  });

  afterEach(() => {
    harness?.unmount();
    vi.useRealTimers();
  });

  it("view-model：unprojected（无字段）不轮询、不显示；idle/failed 如实投影", async () => {
    vi.useFakeTimers();
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    expect(harness.tutor().runtimeGeneration).toEqual({ kind: "unprojected" });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mocks.restore).not.toHaveBeenCalled();

    // idle 投影（retrySync 是显式读——不计入轮询；此后清零再验证不轮询）。
    mocks.restore.mockResolvedValue(withGeneration({ participationKind: "confirm_input", revision: 13 }, idleProjection()));
    await act(async () => { await harness.tutor().retrySync(); });
    expect(harness.tutor().runtimeGeneration).toEqual({ kind: "idle" });
    mocks.restore.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mocks.restore).not.toHaveBeenCalled();

    // failed 投影（RETRY_EXHAUSTED）。
    mocks.restore.mockResolvedValue(withGeneration({ participationKind: "confirm_input", revision: 14 }, failedExhausted()));
    await act(async () => { await harness.tutor().retrySync(); });
    expect(harness.tutor().runtimeGeneration).toEqual({ kind: "failed", errorClass: "RETRY_EXHAUSTED", requestId: "GR-TS4242-0001" });
    mocks.restore.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("pending(running)：仅读轮询 GET restore、退避重试、采用仍 pending 的快照继续轮询", async () => {
    vi.useFakeTimers();
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(withGeneration({ participationKind: "confirm_input", revision: 12 }, pendingRunning()));
    // 每次轮询仍 pending（attempt 推进——快照仍被采用，轮询继续）。
    mocks.restore.mockImplementation(async () => withGeneration({ participationKind: "confirm_input", revision: 12 }, pendingRunning(2)));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    expect(harness.tutor().runtimeGeneration).toMatchObject({ kind: "pending", phase: "running", attempt: 1, maxAttempts: 3 });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(mocks.restore).toHaveBeenCalledWith(RUNTIME_SESSION_ID);
    expect(harness.tutor().runtimeGeneration).toMatchObject({ kind: "pending", attempt: 2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.restore).toHaveBeenCalledTimes(2);
  });

  it("pending→idle：轮询停止（不额外 GET）；已提交结果经同一 adopt 流程恢复呈现", async () => {
    vi.useFakeTimers();
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(withGeneration({ participationKind: "confirm_input", revision: 12 }, pendingRunning()));
    mocks.restore.mockResolvedValueOnce(withGeneration(
      { pendingPresentation: true, revision: 13 },
      idleProjection(),
    ));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    // 已提交未交付结果：generation idle + pending_presentation → PresentationRuntime 呈现中。
    expect(harness.tutor().runtimeGeneration).toEqual({ kind: "idle" });
    expect(harness.tutor().runtimePendingPresentation).toBeDefined();
    expect(harness.tutor().runtimePresentationPhase).toMatchObject({ phase: "presenting", kind: "voice" });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mocks.restore).toHaveBeenCalledTimes(1); // 离开 pending 即停轮
  });

  it("waiting_retry：首次轮询对齐 retry_at（不早于基础退避）；卸载即停", async () => {
    vi.useFakeTimers();
    const { client, mocks } = makeClient();
    const retryAt = new Date(Date.now() + 4000).toISOString();
    mocks.start.mockResolvedValue(withGeneration({ participationKind: "confirm_input", revision: 12 }, pendingWaitingRetry(1, retryAt)));
    mocks.restore.mockResolvedValue(withGeneration({ participationKind: "confirm_input", revision: 12 }, pendingRunning(2)));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    expect(harness.tutor().runtimeGeneration).toMatchObject({ kind: "pending", phase: "waiting_retry", retryAt: retryAt });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.restore).not.toHaveBeenCalled(); // retry_at 4s 后——2s 时未到点
    await act(async () => { await vi.advanceTimersByTimeAsync(2300); });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    // 卸载即停（再无 GET）。
    harness.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
  });

  it("迟到查询不回退 revision：低 revision 轮询响应被拒后轮询继续", async () => {
    vi.useFakeTimers();
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(withGeneration({ participationKind: "confirm_input", revision: 12 }, pendingRunning()));
    // 第一轮：服务端乱序回低 revision（迟到查询）——不采用（快照保持 12）。
    mocks.restore.mockResolvedValueOnce(withGeneration({ participationKind: "confirm_input", revision: 11 }, pendingRunning()));
    // 第二轮：正常回 committed idle。
    mocks.restore.mockResolvedValueOnce(withGeneration({ participationKind: "confirm_input", revision: 13 }, idleProjection()));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(harness.tutor().revision).toBe(12); // 未回退
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.restore).toHaveBeenCalledTimes(2);
    expect(harness.tutor().revision).toBe(13);
    expect(harness.tutor().runtimeGeneration).toEqual({ kind: "idle" });
  });

  it("轮询网络失败：保留最后合法快照、按退避重试、不写 error/protocolError", async () => {
    vi.useFakeTimers();
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(withGeneration({ participationKind: "confirm_input", revision: 12 }, pendingRunning()));
    mocks.restore.mockRejectedValueOnce(new TypeError("fetch failed"));
    mocks.restore.mockResolvedValueOnce(withGeneration({ participationKind: "confirm_input", revision: 13 }, idleProjection()));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    const tutor = harness.tutor();
    expect(tutor.error).toBeUndefined();
    expect(tutor.protocolError).toBeUndefined();
    expect(tutor.phase).not.toBe("recovering");
    expect(tutor.runtimeGeneration).toMatchObject({ kind: "pending" });
    // 基础退避后重试成功 → idle。
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.restore).toHaveBeenCalledTimes(2);
    expect(harness.tutor().runtimeGeneration).toEqual({ kind: "idle" });
  });

  it("轮询 404：停轮 + 显式错误（recovering）", async () => {
    vi.useFakeTimers();
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(withGeneration({ participationKind: "confirm_input", revision: 12 }, pendingRunning()));
    mocks.restore.mockRejectedValue(new TutorRuntimeHttpError(404, "SESSION_NOT_FOUND"));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(harness.tutor().error).toContain("SESSION_NOT_FOUND");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.restore).toHaveBeenCalledTimes(1); // 停轮
  });

  it("轮询协议解析失败：recoverable protocol error、停轮", async () => {
    vi.useFakeTimers();
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(withGeneration({ participationKind: "confirm_input", revision: 12 }, pendingRunning()));
    mocks.restore.mockRejectedValue(new ProtocolParseError(["generation: 伪造字段"]));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(harness.tutor().protocolError).toContain("伪造字段");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
  });

  it("failed 后重新尝试：走既有 control.retry_recovery（服务端新预算新任务）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(withGeneration({ participationKind: "confirm_input", revision: 12 }, failedExhausted()));
    mocks.submitStudentInput.mockResolvedValueOnce(withGeneration({ participationKind: "confirm_input", revision: 13 }, pendingRunning()));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    expect(harness.tutor().runtimeGeneration).toMatchObject({ kind: "failed", errorClass: "RETRY_EXHAUSTED" });
    await act(async () => { harness.tutor().retryGeneration(); });
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "control", command: "retry_recovery" },
      12,
      expect.any(String),
    );
    expect(harness.tutor().runtimeGeneration).toMatchObject({ kind: "pending", phase: "running" });
  });

  it("旧在线负例仍拒：pending 投影携带 pending_presentation 的快照无法进入 hook（fail closed）", () => {
    const raw = runtimeSnapshotRaw({ pendingPresentation: true, revision: 12 });
    const forged = { ...raw, ...pendingRunning() };
    expect(() => validFromRaw(forged as Record<string, unknown>)).toThrowError(/generation-pending/);
  });
});
