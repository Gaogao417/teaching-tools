/**
 * F7 Step 6 — useTutorLearning × PresentationRuntime 接线（canonical 链）。
 * 覆盖：voice 交付全链（presenting → 真实 ended 事件 → outcome 精确请求体 →
 * 响应快照经同一 adopt 门禁 → idle）、StrictMode 完整生命周期单次执行、
 * barge-in（InterruptCurrent → interrupted 上报）、geometry/board 交付在
 * 呈现面未挂载（无真实信号源）时的暂停语义、F7 Step 7 生产接线解除暂停
 *（真实 StudentWorkspaceViewSurface 挂载 → commit 双结算 → presented 上报）、
 * replay 零上报、卸载后迟到响应静默丢弃。
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

vi.mock("../../../geometry/react/jsxgraph-board", () => ({
  mountGeometryBoard: vi.fn((): { board: never; getPointer: () => null; render: () => void; destroy: () => void } => ({
    board: {} as never,
    getPointer: () => null,
    render: () => undefined,
    destroy: () => undefined,
  })),
}));

const { useTutorLearning } = await import("../useTutorLearning");
const { StudentWorkspaceViewSurface } = await import("../../../presentation/canonicalView/StudentWorkspaceViewSurface");
const {
  RUNTIME_SESSION_ID,
  RUNTIME_TASK_ID,
  pendingBoardPresentation,
  pendingGeometryPresentation,
  runtimeGeometry,
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

/** F7 Step 7 集成形态：hook + 真实 StudentWorkspaceViewSurface（VM 注入
 *  geometry/commitSignal）——生产接线解除暂停的关键链路（页面同形接线）。 */
function mountWorkspaceHarness(client: TutorRuntimeClient): {
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
    const surface = tutor.workspaceSurface;
    if (surface.source === "canonical" && surface.view) {
      return (
        <StudentWorkspaceViewSurface
          view={surface.view}
          geometry={surface.geometry}
          commitSignal={surface.commitSignal}
          workspaceExecutionKey={surface.workspaceExecutionKey} boardPresentation={surface.boardPresentation}
        />
      );
    }
    return <div data-testid="workspace-surface-pending" />;
  }
  void act(() => root.render(<Harness />));
  return {
    tutor: () => latest!,
    unmount: () => { void act(() => root.unmount()); container.remove(); },
  };
}

/** 复验 P1-2 场景 harness：surface 挂载可切换（同一 hook 实例跨重渲染保留）。 */
function mountToggleHarness(client: TutorRuntimeClient): {
  tutor: () => Tutor;
  setSurface: (withSurface: boolean) => void;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latest: Tutor | undefined;
  let withSurface = false;
  function Harness() {
    const tutor = useTutorLearning({ taskId: RUNTIME_TASK_ID as TaskId, studentId: "runtime-test-student", runtimeClient: client });
    latest = tutor;
    const surface = tutor.workspaceSurface;
    if (withSurface && surface.source === "canonical" && surface.view) {
      return <StudentWorkspaceViewSurface view={surface.view} geometry={surface.geometry} commitSignal={surface.commitSignal} workspaceExecutionKey={surface.workspaceExecutionKey} boardPresentation={surface.boardPresentation} />;
    }
    return <div data-testid="no-workspace-surface" />;
  }
  void act(() => root.render(<Harness />));
  return {
    tutor: () => latest!,
    setSurface: (next: boolean) => {
      withSurface = next;
      void act(() => root.render(<Harness />));
    },
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

  it("barge-in：①abort 本次播放 → ②interrupted 上报并采用返回快照 → ③显式 control.barge_in（Step 8 完整链）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    mocks.reportPresentationOutcome.mockResolvedValue(validRuntimeSnapshot({ revision: 14 }));
    // ③ control.barge_in 响应（无新 pending：由后续快照交付）。
    mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({ revision: 15 }));
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
    // ②（interrupted outcome 采用后的 revision 14）先于 ③（control.barge_in）。
    expect(mocks.reportPresentationOutcome.mock.invocationCallOrder[0]).toBeLessThan(mocks.submitStudentInput.mock.invocationCallOrder[0]);
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "control", command: "barge_in" },
      14,
      expect.any(String),
    );
    expect(harness.tutor().runtimeSnapshot?.revision).toBe(15);
  });

  it("geometry 交付（呈现面未挂载=无真实信号源，F7 Step 7 语义保留）：paused(real-signal-unavailable)、零上报", async () => {
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

  it("F7 Step 7 生产接线解除暂停（geometry）：真实呈现面挂载 → Canvas/Board 同 revision 双结算 → presented 精确上报", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({
      participationKind: "confirm_input",
      pendingPresentation: pendingGeometryPresentation(20, 7),
      canvasElements: [{ element_id: "seg-CO", kind: "segment" }],
      revision: 20,
      workspaceRevision: 7,
      overrides: { render: { workspace_revision: 7, geometry: runtimeGeometry() } },
    }));
    mocks.reportPresentationOutcome.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 21 }));
    harness = mountWorkspaceHarness(client);
    await act(async () => { await harness.tutor().start(); });
    // adopt 后立即处于 presenting(geometry)（结算链在 jsdom 一帧内完成，
    // 不做跨轮询的中间态断言）。
    expect(harness.tutor().runtimePresentationPhase).toMatchObject({ phase: "presenting", kind: "geometry" });
    // 双结算（canvas post-paint ∧ board settle）经 rAF/setTimeout 触发——计时器
    // 回调必须在 act 内排空（同 emitAndDrain 纪律），controller 的状态更新才
    // 会冲刷：presented → outcome 上报 → 响应采用 → idle。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      "WSA-bt03-construct-0",
      {
        sequenceId: "PS-0003",
        ordinal: 0,
        outcome: "presented",
        clientRequestId: "pres-outcome:TS-99000801:PS-0003:0:WSA-bt03-construct-0:presented",
        expectedRevision: 20,
      },
    );
    expect(harness.tutor().runtimeSnapshot?.revision).toBe(21);
  });

  it("复验 P1-2：先暂停（呈现面未挂载）→ surface 后挂载 → 同一 pending 自动恢复并 presented（不换键不重投）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({
      participationKind: "confirm_input",
      pendingPresentation: pendingGeometryPresentation(20, 7),
      canvasElements: [{ element_id: "seg-CO", kind: "segment" }],
      revision: 20,
      workspaceRevision: 7,
      overrides: { render: { workspace_revision: 7, geometry: runtimeGeometry() } },
    }));
    mocks.reportPresentationOutcome.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 21 }));
    harness = mountToggleHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "paused");
    });
    // paused(real-signal-unavailable)：注册计数不唤醒——保持零上报。
    expect(harness.tutor().runtimePresentationPhase).toMatchObject({ phase: "paused", reason: "real-signal-unavailable" });
    expect(mocks.reportPresentationOutcome).not.toHaveBeenCalled();
    // surface 后挂载：注册 + notifyRealSourceActive → 同一 delivery 重执行 →
    // 双结算 → presented（同一快照对象，无新 adopt、无重复执行）。
    (harness as ReturnType<typeof mountToggleHarness>).setSurface(true);
    // 结算计时器（renderer 信号/board paint）在 act 内排空后再断言终态。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "idle");
    });
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      "WSA-bt03-construct-0",
      expect.objectContaining({ outcome: "presented", expectedRevision: 20 }),
    );
    expect(harness.tutor().runtimeSnapshot?.revision).toBe(21);
  });

  it("F7 Step 7 生产接线解除暂停（board）：板书 reveal 稳定后 presented 上报", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({
      participationKind: "confirm_input",
      pendingPresentation: pendingBoardPresentation(20, 7, ["BE-301"]),
      boardEntries: [{ entry_id: "BE-301", kind: "derivation", content: "\\triangle AOB \\sim \\triangle DOC" }],
      revision: 20,
      workspaceRevision: 7,
      overrides: { render: { workspace_revision: 7, geometry: runtimeGeometry() } },
    }));
    mocks.reportPresentationOutcome.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 21 }));
    harness = mountWorkspaceHarness(client);
    await act(async () => { await harness.tutor().start(); });
    expect(harness.tutor().runtimePresentationPhase).toMatchObject({ phase: "presenting", kind: "board" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      "WSA-bt03-reveal",
      {
        sequenceId: "PS-0003",
        ordinal: 2,
        outcome: "presented",
        clientRequestId: "pres-outcome:TS-99000801:PS-0003:2:WSA-bt03-reveal:presented",
        expectedRevision: 20,
      },
    );
    expect(harness.tutor().runtimeSnapshot?.revision).toBe(21);
  });

  it.each(["reject", "timeout"] as const)("四次复验：%s → failed 无 pending 停留 → 显式 recovery 同 revision 重播；旧缓存/迟到回调不放行", async (failureMode) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    const animateHandles: { finished: Promise<void>; resolve: () => void; reject: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
    const animate = vi.fn((_keyframes: Keyframe[], _options: unknown) => {
      let resolve!: () => void;
      let reject!: (reason?: unknown) => void;
      const finished = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
      const cancel = vi.fn(); // Deliberately keep promise pending to simulate a late browser callback.
      animateHandles.push({ finished, resolve, reject, cancel });
      return { finished, cancel };
    });
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    try {
      const { client, mocks } = makeClient();
      // S0：无 pending、空板书（surface 首挂 = restore，结算 rev 6）。
      mocks.start.mockResolvedValue(validRuntimeSnapshot({
        participationKind: "confirm_input",
        revision: 10,
        workspaceRevision: 6,
        boardEntries: [],
        overrides: { render: { workspace_revision: 6, geometry: runtimeGeometry() } },
      }));
      // 学生 confirm → 服务端进入 board reveal 拍：S1（pending D1，BE-301 applied）。
      mocks.submitStudentInput.mockResolvedValueOnce(validRuntimeSnapshot({
        participationKind: "confirm_input",
        pendingPresentation: pendingBoardPresentation(20, 7, ["BE-301"]),
        boardEntries: [{ entry_id: "BE-301", kind: "derivation", content: "\\triangle AOB \\sim \\triangle DOC" }],
        revision: 20,
        workspaceRevision: 7,
        overrides: { render: { workspace_revision: 7, geometry: runtimeGeometry() } },
      }));
      mocks.reportPresentationOutcome.mockResolvedValueOnce(validRuntimeSnapshot({
        participationKind: "confirm_input", revision: 21, workspaceRevision: 7,
        boardEntries: [{ entry_id: "BE-301", kind: "derivation", content: "\\triangle AOB \\sim \\triangle DOC" }],
        overrides: { render: { workspace_revision: 7, geometry: runtimeGeometry() } },
      }));
      // failed outcome（D1 超时）→ 服务端 retry_recovery 新 sequence（presentation_only：
      // 同 workspace revision 7、同条目；session revision 推进）。
      const recoveryRaw = JSON.parse(JSON.stringify(pendingBoardPresentation(22, 7, ["BE-301"]))) as {
        sequence_id: string; ordinal: number; action_id: string;
        action: { workspace_action: { action_id: string; presentation_only?: boolean } };
      };
      recoveryRaw.sequence_id = "PS-0009";
      recoveryRaw.ordinal = 0;
      recoveryRaw.action_id = "WSA-bt03-reveal-R";
      recoveryRaw.action.workspace_action.action_id = "WSA-bt03-reveal-R";
      recoveryRaw.action.workspace_action.presentation_only = true;
      mocks.submitStudentInput.mockResolvedValueOnce(validRuntimeSnapshot({
        participationKind: "confirm_input",
        pendingPresentation: recoveryRaw,
        boardEntries: [{ entry_id: "BE-301", kind: "derivation", content: "\\triangle AOB \\sim \\triangle DOC" }],
        revision: 22,
        workspaceRevision: 7,
        overrides: { render: { workspace_revision: 7, geometry: runtimeGeometry() } },
      }));
      // D2 presented → S3 收尾。
      mocks.reportPresentationOutcome.mockResolvedValueOnce(validRuntimeSnapshot({
        participationKind: "confirm_input",
        revision: 23,
        workspaceRevision: 7,
        overrides: { render: { workspace_revision: 7, geometry: runtimeGeometry() } },
      }));
      harness = mountWorkspaceHarness(client);
      await act(async () => { await harness.tutor().start(); });
      await act(async () => { vi.advanceTimersByTime(60); });
      await act(async () => { await harness.tutor().submitControl("confirm"); });
      await act(async () => { vi.advanceTimersByTime(60); });
      // S1：D1 presenting(board)，BE-301 reveal 动画在跑。
      expect(harness.tutor().runtimePresentationPhase).toMatchObject({ phase: "presenting", kind: "board" });
      expect(animate).toHaveBeenCalledTimes(1);
      // 动画失败 → 无 settle → adapter 10s 超时 → failed outcome（旧执行不补报 presented）。
      if (failureMode === "reject") await act(async () => { animateHandles[0].reject(); });
      await act(async () => { vi.advanceTimersByTime(10_600); });
      expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
      expect(mocks.reportPresentationOutcome).toHaveBeenCalledWith(
        RUNTIME_SESSION_ID,
        "WSA-bt03-reveal",
        expect.objectContaining({ outcome: "failed", clientRequestId: "pres-outcome:TS-99000801:PS-0003:2:WSA-bt03-reveal:failed", expectedRevision: 20 }),
      );
      // Real failed ack: no pending. Wait long enough for the view-only paint/cache.
      expect(harness.tutor().runtimeSnapshot?.pending_presentation).toBeUndefined();
      if (failureMode === "timeout") expect(animateHandles[0].cancel).toHaveBeenCalledTimes(1);
      await act(async () => { vi.advanceTimersByTime(120); });
      expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
      await act(async () => { await harness.tutor().submitControl("retry_recovery"); });
      expect(mocks.submitStudentInput.mock.calls[1]?.[1]).toMatchObject({ kind: "control", command: "retry_recovery" });
      // S2: new execution at the same workspace revision and with the same targets.

      expect(animate).toHaveBeenCalledTimes(2);
      // Old K1 completion must not settle K2, even after timeout (promise still pending).
      await act(async () => { animateHandles[0].resolve(); vi.advanceTimersByTime(120); });
      expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
      await act(async () => { animateHandles[1].resolve(); });
      await act(async () => { vi.advanceTimersByTime(120); });
      expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(2);
      const secondCall = mocks.reportPresentationOutcome.mock.calls[1];
      expect(secondCall[1]).toBe("WSA-bt03-reveal-R");
      expect(secondCall[2]).toMatchObject({ outcome: "presented", clientRequestId: "pres-outcome:TS-99000801:PS-0009:0:WSA-bt03-reveal-R:presented", expectedRevision: 22 });
      expect(harness.tutor().runtimeSnapshot?.revision).toBe(23);
      expect(harness.tutor().runtimePresentationPhase.phase).toBe("idle");
    } finally {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
      vi.useRealTimers();
    }
  });

  it("REVIEW 回归：播放期间卸载不得上报 interrupted（先失效执行、再停媒体）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting");
    });
    harness.unmount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mocks.reportPresentationOutcome).not.toHaveBeenCalled();
  });

  it("REVIEW 回归：StrictMode 下播放期间卸载同样不得上报 interrupted", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    harness = mountHarness(client, { strictMode: true });
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting");
    });
    harness.unmount();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mocks.reportPresentationOutcome).not.toHaveBeenCalled();
  });

  it("REVIEW2 回归：restore 到新会话后，旧会话 outcome 响应不得把页面切回旧会话", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    let releaseOutcome: (snapshot: ReturnType<typeof validRuntimeSnapshot>) => void = () => undefined;
    mocks.reportPresentationOutcome.mockImplementation(() => new Promise((resolve) => { releaseOutcome = resolve; }));
    /** 会话 TS-99000802 的无 pending 快照（restore 结果）。 */
    const sessionBRaw = JSON.parse(JSON.stringify(runtimeSnapshotRaw({ revision: 40 }))) as {
      session_id: string;
      views: { student_workspace_view: { session_id: string }; coach_panel_view: { session_id: string }; status: { session_id: string } };
    };
    for (const target of [sessionBRaw, sessionBRaw.views.student_workspace_view, sessionBRaw.views.coach_panel_view, sessionBRaw.views.status]) {
      target.session_id = "TS-99000802";
    }
    mocks.restore.mockResolvedValue(validFromRaw(sessionBRaw));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting");
    });
    const generation = mediaHarness.state.generation;
    await emitAndDrain(() => mediaHarness.emitPlayback({ type: "ended", owner: "narration", generation }));
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    // restore 到新会话（页面已采用 TS-99000802）。
    await act(async () => { await harness.tutor().restore("TS-99000802"); });
    expect(harness.tutor().runtimeSnapshot?.session_id).toBe("TS-99000802");
    // 旧会话（TS-99000801）的 outcome 响应到达——页面不得回切。
    await act(async () => {
      releaseOutcome(validRuntimeSnapshot({ revision: 13 }));
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(harness.tutor().runtimeSnapshot?.session_id).toBe("TS-99000802");
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
