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

import type { TutorRuntimeClient } from "../../web/frontend/src/api/tutorRuntimeClient";
import { TutorRuntimeHttpError } from "../../web/frontend/src/api/tutorRuntimeClient";
import type { TaskId } from "../../web/shared/contracts";

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

vi.mock("../../web/frontend/src/presentation/audio/MediaSessionController", () => ({
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

vi.mock("../../web/frontend/src/presentation/narration/NarrationController", () => ({
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

vi.mock("../../web/frontend/src/api/client", () => ({
  api: {
    streamActionSpeech: vi.fn().mockRejectedValue(new Error("tts unavailable")),
    recordSimilarityLearnProgress: vi.fn().mockResolvedValue({ ok: true }),
  },
  ResponseSchemaError: class extends Error {},
}));

const { useTutorLearning } = await import("../../web/frontend/src/action-runtime/tutor/useTutorLearning");
const {
  RUNTIME_SESSION_ID,
  RUNTIME_TASK_ID,
  runtimeSnapshotRaw,
  validRuntimeSnapshot,
} = await import("../../web/frontend/src/action-runtime/tutor/__tests__/runtimeSnapshotFixture");

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


describe("independent P2-A handshake repro", () => {
 let harness: ReturnType<typeof mountHarness>;
 beforeEach(() => { vi.clearAllMocks(); mediaHarness.reset(); });
 afterEach(() => { harness?.unmount(); });
 it.each([409, 403])("control %i must block microphone gate", async (status) => {
  const {client,mocks}=makeClient();
  mocks.start.mockResolvedValue(validRuntimeSnapshot({pendingPresentation:true,revision:12}));
  mocks.reportPresentationOutcome.mockResolvedValue(validRuntimeSnapshot({revision:13}));
  mocks.submitStudentInput.mockRejectedValue(new TutorRuntimeHttpError(status,status === 409 ? "REVISION_CONFLICT" : "FORBIDDEN","control rejected"));
  harness=mountHarness(client);
  await act(async()=>{await harness.tutor().start();});
  await act(async()=>{await waitForTutor(harness,t=>t.runtimePresentationPhase.phase==="presenting");});
  let allowed: boolean|undefined;
  await act(async()=>{allowed=await harness.tutor().prepareRecordingStart();});
  expect(mocks.submitStudentInput).toHaveBeenCalledTimes(1);
  console.log("CONTROL_REJECTED",{status,allowed,revision:harness.tutor().revision});
  expect(allowed).toBe(false);
 });
 it("pending natural-ended outcome must keep microphone gate waiting", async()=>{
  const {client,mocks}=makeClient();
  mocks.start.mockResolvedValue(validRuntimeSnapshot({pendingPresentation:true,revision:12}));
  let resolveOutcome!: (x: ReturnType<typeof validRuntimeSnapshot>)=>void;
  mocks.reportPresentationOutcome.mockReturnValue(new Promise(r=>{resolveOutcome=r;}));
  harness=mountHarness(client);
  await act(async()=>{await harness.tutor().start();});
  await act(async()=>{await waitForTutor(harness,t=>t.runtimePresentationPhase.phase==="presenting");});
  await act(async()=>{mediaHarness.emitPlayback({type:"ended",owner:"narration",generation:mediaHarness.state.generation});await Promise.resolve();});
  expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
  let resolved=false;let allowed: boolean|undefined;
  await act(async()=>{void harness.tutor().prepareRecordingStart().then(x=>{resolved=true;allowed=x;});await Promise.resolve();});
  console.log("OUTCOME_PENDING",{resolved,allowed,phase:harness.tutor().runtimePresentationPhase});
  const premature=resolved;
  await act(async()=>{resolveOutcome(validRuntimeSnapshot({revision:13}));await Promise.resolve();});
  expect(premature).toBe(false);
 });
});
