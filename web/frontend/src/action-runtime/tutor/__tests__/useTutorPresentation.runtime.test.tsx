/**
 * F7 Step 6 — useTutorLearning × PresentationRuntime 接线（canonical 链）。
 * 覆盖：voice 交付全链（presenting → 真实 ended 事件 → outcome 精确请求体 →
 * 响应快照经同一 adopt 门禁 → idle）、StrictMode 完整生命周期单次执行、
 * barge-in（InterruptCurrent → interrupted 上报）、geometry 交付在真实完成
 * 信号源未接（Step 7）时的暂停语义、replay 零上报、卸载后迟到响应静默丢弃。
 *
 * MediaSessionController/NarrationController 以可控 harness mock（同
 * useTutorLearning.test.tsx 的模块 mock 纪律）；client 经 props 注入。
 */
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TutorRuntimeClient } from "../../../api/tutorRuntimeClient";
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

const { useTutorLearning } = await import("../useTutorLearning");
const {
  RUNTIME_SESSION_ID,
  RUNTIME_TASK_ID,
  pendingGeometryPresentation,
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

function mountHarness(client: TutorRuntimeClient, options?: { strictMode?: boolean }): {
  tutor: () => Tutor;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latest: Tutor | undefined;
  function Harness() {
    const tutor = useTutorLearning({ taskId: RUNTIME_TASK_ID as TaskId, studentId: "runtime-test-student", runtimeClient: client });
    latest = tutor;
    return <div data-testid="phase">{tutor.phase}</div>;
  }
  const tree = options?.strictMode ? <StrictMode><Harness /></StrictMode> : <Harness />;
  void act(() => root.render(tree));
  return {
    tutor: () => latest!,
    unmount: () => { void act(() => root.unmount()); container.remove(); },
  };
}

/** 事件发射 + 微任务排空：独立 act（act 环境下微任务链里的 setState 只在
 *  act 回调自身的 await 边界冲刷——与轮询同 act 会互相等待）。 */
async function emitAndDrain(emit: () => void): Promise<void> {
  await act(async () => {
    emit();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function waitForTutor(harness: { tutor: () => Tutor }, predicate: (tutor: Tutor) => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate(harness.tutor())) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate(harness.tutor())).toBe(true);
}

describe("useTutorLearning × PresentationRuntime（canonical 链接线）", () => {
  let harness: ReturnType<typeof mountHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    mediaHarness.reset();
  });

  afterEach(() => {
    harness?.unmount();
  });

  it("voice 交付全链：presenting → 本次播放 ended → outcome 精确请求体 → 响应经同一 adopt → idle；replay 零上报", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    mocks.reportPresentationOutcome.mockResolvedValue(validRuntimeSnapshot({ revision: 13 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting" && tutor.runtimePresentationPhase.kind === "voice");
    });
    const controls = harness.tutor().playbackControls;
    expect(controls?.source).toBe("canonical");
    expect(controls?.source === "canonical" && controls.phase.phase === "presenting" && controls.phase.interruptible).toBe(true);
    expect(harness.tutor().bargeInAvailable).toBe(true);
    // 播放未结束：不提前上报。
    expect(mocks.reportPresentationOutcome).not.toHaveBeenCalled();
    // 本次播放的真实 ended（独立 act 排空微任务链：presented → outcome 上报 →
    // 响应采用 → idle；outcome-pending 为瞬态，由 controller 单测锁定）。
    const generation = mediaHarness.state.generation;
    await emitAndDrain(() => mediaHarness.emitPlayback({ type: "ended", owner: "narration", generation }));
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "idle");
    });
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      "VA-bt01-narrate",
      {
        sequenceId: "PS-0001",
        ordinal: 0,
        outcome: "presented",
        clientRequestId: "pres-outcome:TS-99000801:PS-0001:0:VA-bt01-narrate:presented",
        expectedRevision: 12,
      },
    );
    expect(harness.tutor().runtimeSnapshot?.revision).toBe(13);
    // replay：纯缓存回放（media idle + 缓存在 → 门控放行），零上报。
    mediaHarness.markIdle();
    await act(async () => { harness.tutor().replayNarration(); });
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
  });

  it("StrictMode 完整生命周期（setup→cleanup→setup）：voice 单次执行、outcome 单次上报", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    mocks.reportPresentationOutcome.mockResolvedValue(validRuntimeSnapshot({ revision: 13 }));
    harness = mountHarness(client, { strictMode: true });
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting");
    });
    const generation = mediaHarness.state.generation;
    await emitAndDrain(() => mediaHarness.emitPlayback({ type: "ended", owner: "narration", generation }));
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "idle");
    });
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
  });

  it("barge-in（InterruptCurrent）：abort 本次播放 → interrupted 上报 → 采用返回快照", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    mocks.reportPresentationOutcome.mockResolvedValue(validRuntimeSnapshot({ revision: 14 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting");
    });
    await act(async () => { await harness.tutor().bargeIn(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "idle");
    });
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      "VA-bt01-narrate",
      expect.objectContaining({ outcome: "interrupted", expectedRevision: 12 }),
    );
    expect(harness.tutor().runtimeSnapshot?.revision).toBe(14);
  });

  it("geometry 交付（真实完成信号源未接，Step 7 前）：paused(real-signal-unavailable)、零上报", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({
      pendingPresentation: pendingGeometryPresentation(20, 7),
      canvasElements: [{ element_id: "seg-CO", kind: "segment" }],
      revision: 20,
      workspaceRevision: 7,
    }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "paused");
    });
    const phase = harness.tutor().runtimePresentationPhase;
    expect(phase).toMatchObject({ phase: "paused", reason: "real-signal-unavailable", actionId: "WSA-bt03-construct-0" });
    expect(mocks.reportPresentationOutcome).not.toHaveBeenCalled();
    const controls = harness.tutor().playbackControls;
    expect(controls?.source).toBe("canonical");
    expect(controls?.source === "canonical" && controls.phase.phase === "paused").toBe(true);
  });

  it("卸载后迟到 outcome 响应：静默丢弃（不采用、不二次上报）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    let releaseOutcome: (snapshot: ReturnType<typeof validRuntimeSnapshot>) => void = () => undefined;
    mocks.reportPresentationOutcome.mockImplementation(() => new Promise((resolve) => { releaseOutcome = resolve; }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting");
    });
    const generation = mediaHarness.state.generation;
    await emitAndDrain(() => mediaHarness.emitPlayback({ type: "ended", owner: "narration", generation }));
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    harness.unmount();
    releaseOutcome(validRuntimeSnapshot({ revision: 13 }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1); // 无重试/无二次
  });
});
