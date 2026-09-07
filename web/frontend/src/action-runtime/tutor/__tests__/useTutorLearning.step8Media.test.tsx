/**
 * F7 Step 8 — useTutorLearning 录音 + ASR + stale 防护 + barge-in ①②③④ 链。
 *
 * 覆盖（PLAN §3 Step 8 / spec §2.9 / S1 交叉规则）：
 * - lockRecordingChannel：录音开始时锁定通道并捕获 {sessionId, revision}（不可
 *   变捕获）；通道不合法/完成态返回 undefined；
 * - transcribeRecording：经当前 client 的 POST /asr（observe-only，零 legacy
 *   API）；fresh（session/revision/通道/observed_revision 全一致）→ 自动提交
 *   utterance(channel, text)；
 * - stale 负例：revision 漂移 / session 漂移 / 通道不再合法 / observed_revision
 *   不一致 → 只进草稿（speechPendingTranscript），零自动提交；
 * - ASR 系统失败（503/422）→ 可见提示（speechNotice），不映射学生错误、零提交；
 * - barge-in 顺序：①中断 adapter → ②interrupted outcome 上报并采用新 snapshot
 *   → ③显式 control.barge_in → ④新 sequence 进入同一 adopt 流程；无活跃交付
 *   零上报零 control；②网络失败不提交 ③。
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
  pendingVoicePresentation,
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
    const tutor = useTutorLearning({ taskId: RUNTIME_TASK_ID as TaskId, studentId: "step8-media-student", runtimeClient: client });
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

const AUDIO = { dataUrl: "data:audio/webm;codecs=opus;base64,AAAA", mimeType: "audio/webm;codecs=opus", durationMs: 1200 };

/** 录音期间快照漂移用的可控 ASR 响应。 */
function asrResult(transcript: string, observedRevision: number): { sessionId: string; observedRevision: number; transcript: string; model: string } {
  return { sessionId: RUNTIME_SESSION_ID, observedRevision, transcript, model: "qwen3-asr-flash" };
}

/** 新 sequence 的 voice 交付（barge_in 后 Navigator 生成；与 PS-0001 不同键）。 */
function pendingVoicePresentationSeq2(revision: number): Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(pendingVoicePresentation(revision))) as {
    sequence_id: string;
    action_id: string;
    action: { voice_action: { action_id: string } };
  };
  raw.sequence_id = "PS-0002";
  raw.action_id = "VA-bt02-narrate";
  raw.action.voice_action.action_id = "VA-bt02-narrate";
  return raw as unknown as Record<string, unknown>;
}

describe("useTutorLearning Step 8：录音 + ASR + stale 防护", () => {
  let harness: ReturnType<typeof mountHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    mediaHarness.reset();
  });

  afterEach(() => {
    harness?.unmount();
  });

  it("lockRecordingChannel：录音开始时锁定通道并捕获 session/revision；mainline 仅 answer/confirm、assistance 按 availability、完成态关闭", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    const capture = harness.tutor().lockRecordingChannel("mainline");
    expect(capture).toEqual({ captureId: expect.any(String), channel: "mainline", sessionId: RUNTIME_SESSION_ID, revision: 12 });
    expect(harness.tutor().lockRecordingChannel("assistance")).toEqual({ captureId: expect.any(String), channel: "assistance", sessionId: RUNTIME_SESSION_ID, revision: 12 });
    expect(harness.tutor().mediaSession).toBeDefined();

    // C3：confirm_input 也可从独立主线入口录音理解反馈。
    mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 13 }));
    await act(async () => { await harness.tutor().submitControl("confirm"); });
    expect(harness.tutor().lockRecordingChannel("mainline")).toBeDefined();
    expect(harness.tutor().lockRecordingChannel("assistance")).toBeDefined();

    // assistance：coach assistance_available=false → 不合法。
    const raw = runtimeSnapshotRaw({ participationKind: "confirm_input", revision: 14 });
    (raw.views as { coach_panel_view: { assistance_available: boolean } }).coach_panel_view.assistance_available = false;
    mocks.restore.mockResolvedValue(validFromRaw(raw));
    await act(async () => { await harness.tutor().retrySync(); });
    expect(harness.tutor().lockRecordingChannel("assistance")).toBeUndefined();

    // 完成态：两通道全关。
    mocks.restore.mockResolvedValue(validRuntimeSnapshot({ participationKind: "read_only_completed", revision: 15 }));
    await act(async () => { await harness.tutor().retrySync(); });
    expect(harness.tutor().lockRecordingChannel("mainline")).toBeUndefined();
    expect(harness.tutor().lockRecordingChannel("assistance")).toBeUndefined();
  });

  it("ASR 经当前 client /asr（精确请求体）；fresh → 自动提交 utterance(channel, text)（捕获 revision）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    mocks.transcribe.mockResolvedValue(asrResult("  识别第一组子母型  ", 12));
    mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 13 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    const capture = harness.tutor().lockRecordingChannel("mainline");
    if (!capture) throw new Error("capture expected");
    await act(async () => { await harness.tutor().transcribeRecording(capture, AUDIO); });
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    expect(mocks.transcribe).toHaveBeenCalledWith(RUNTIME_SESSION_ID, {
      audio: { dataUrl: AUDIO.dataUrl, mimeType: AUDIO.mimeType, durationMs: AUDIO.durationMs },
      clientRequestId: expect.any(String),
    });
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "utterance", channel: "mainline", text: "识别第一组子母型" },
      12,
      expect.any(String),
    );
    const tutor = harness.tutor();
    expect(tutor.speechPendingTranscript).toBeUndefined();
    expect(tutor.speechNotice).toBeUndefined();
    expect(tutor.speechAsrBusy).toBe(false);
  });

  it("stale：录音中 revision 推进 → transcript 只进对应通道草稿（speechPendingTranscript），零自动提交；捕获值不被悄悄更新", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    const capture = harness.tutor().lockRecordingChannel("mainline");
    if (!capture) throw new Error("capture expected");
    let releaseAsr!: (value: unknown) => void;
    mocks.transcribe.mockImplementationOnce(() => new Promise((resolve) => { releaseAsr = resolve; }));
    let pendingCall!: Promise<void>;
    await act(async () => { pendingCall = harness.tutor().transcribeRecording(capture, AUDIO); });
    // 录音期间：学生文字回答推进 revision（捕获值 12 不更新）。
    mocks.submitStudentInput.mockResolvedValueOnce(validRuntimeSnapshot({ participationKind: "answer_input", revision: 13 }));
    await act(async () => { await harness.tutor().submitUtterance("mainline", "先文字回答"); });
    await act(async () => {
      releaseAsr(asrResult("迟到的话", 12));
      await pendingCall;
    });
    expect(mocks.submitStudentInput).toHaveBeenCalledTimes(1);
    expect(mocks.submitStudentInput.mock.calls[0][1]).toMatchObject({ kind: "utterance", channel: "mainline", text: "先文字回答" });
    expect(harness.tutor().speechPendingTranscript).toEqual({ source: expect.objectContaining({ captureId: expect.any(String) }), channel: "mainline", text: "迟到的话" });
    await act(async () => { harness.tutor().clearSpeechPendingTranscript(); });
    expect(harness.tutor().speechPendingTranscript).toBeUndefined();
  });

  it("stale：session 漂移（ASR 在途时 restore 到新会话）→ 草稿，零自动提交", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    const capture = harness.tutor().lockRecordingChannel("mainline");
    if (!capture) throw new Error("capture expected");
    let releaseAsr!: (value: unknown) => void;
    mocks.transcribe.mockImplementationOnce(() => new Promise((resolve) => { releaseAsr = resolve; }));
    let pendingCall!: Promise<void>;
    await act(async () => { pendingCall = harness.tutor().transcribeRecording(capture, AUDIO); });
    const sessionBRaw = JSON.parse(JSON.stringify(runtimeSnapshotRaw({ participationKind: "answer_input", revision: 12 }))) as {
      session_id: string;
      views: { student_workspace_view: { session_id: string }; coach_panel_view: { session_id: string }; status: { session_id: string } };
    };
    for (const target of [sessionBRaw, sessionBRaw.views.student_workspace_view, sessionBRaw.views.coach_panel_view, sessionBRaw.views.status]) {
      target.session_id = "TS-99000802";
    }
    mocks.restore.mockResolvedValue(validFromRaw(sessionBRaw));
    await act(async () => { await harness.tutor().restore("TS-99000802"); });
    await act(async () => {
      releaseAsr(asrResult("另一会话里的话", 12));
      await pendingCall;
    });
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    expect(harness.tutor().speechPendingTranscript).toEqual({ source: expect.objectContaining({ captureId: expect.any(String) }), channel: "mainline", text: "另一会话里的话" });
  });

  it("stale：主线参与任务已改变（answer_input → confirm_input，revision 不变）→ 草稿，零自动提交", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    const capture = harness.tutor().lockRecordingChannel("mainline");
    if (!capture) throw new Error("capture expected");
    // 同 revision 下 participation 离开 answer_input（服务端投影变化）。
    mocks.restore.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    await act(async () => { await harness.tutor().retrySync(); });
    mocks.transcribe.mockResolvedValue(asrResult("通道已换的话", 12));
    await act(async () => { await harness.tutor().transcribeRecording(capture, AUDIO); });
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    expect(harness.tutor().speechPendingTranscript).toEqual({ source: expect.objectContaining({ captureId: expect.any(String) }), channel: "mainline", text: "通道已换的话" });
  });

  it.each([
    ["confirm_input", 13], ["answer_input", 12], ["workspace_input", 12], ["continue_input", 12],
  ])("C3 confirm 录音后状态变为 %s/rev%s：原话仅回填草稿，不成为新任务证据", async (kind, revision) => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    const capture = harness.tutor().lockRecordingChannel("mainline");
    expect(capture).toBeDefined();
    mocks.restore.mockResolvedValue(validRuntimeSnapshot({ participationKind: String(kind), revision: Number(revision) }));
    await act(async () => { await harness.tutor().retrySync(); });
    mocks.transcribe.mockResolvedValue(asrResult("这一步听懂了，继续", 12));
    await act(async () => { await harness.tutor().transcribeRecording(capture!, AUDIO); });
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    expect(harness.tutor().speechPendingTranscript).toMatchObject({ channel: "mainline", text: "这一步听懂了，继续" });
  });

  it.each(["workspace_input", "continue_input", "listen_only"])("C3 不开放 %s 的主线录音", async (participationKind) => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind, revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    expect(harness.tutor().lockRecordingChannel("mainline")).toBeUndefined();
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
  });

  it("stale：ASR observed_revision 与捕获不一致 → 草稿，零自动提交", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    const capture = harness.tutor().lockRecordingChannel("assistance");
    if (!capture) throw new Error("capture expected");
    mocks.transcribe.mockResolvedValue(asrResult("服务端已推进的话", 15));
    await act(async () => { await harness.tutor().transcribeRecording(capture, AUDIO); });
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    expect(harness.tutor().speechPendingTranscript).toEqual({ source: expect.objectContaining({ captureId: expect.any(String) }), channel: "assistance", text: "服务端已推进的话" });
  });

  it("ASR 系统失败：ASR_UNAVAILABLE → 可见提示（非学生错误、零提交、零 protocolError）；空转写同", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    const capture = harness.tutor().lockRecordingChannel("assistance");
    if (!capture) throw new Error("capture expected");
    mocks.transcribe.mockRejectedValueOnce(new TutorRuntimeHttpError(503, "ASR_UNAVAILABLE", "down"));
    await act(async () => { await harness.tutor().transcribeRecording(capture, AUDIO); });
    const tutor = harness.tutor();
    expect(tutor.speechNotice).toContain("语音识别暂不可用");
    expect(tutor.speechAsrBusy).toBe(false);
    expect(tutor.protocolError).toBeUndefined();
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    // 空转写（422 EMPTY_TRANSCRIPT / 200 空 transcript 均不提交）。
    mocks.transcribe.mockRejectedValueOnce(new TutorRuntimeHttpError(422, "EMPTY_TRANSCRIPT", "empty"));
    await act(async () => { await harness.tutor().transcribeRecording(harness.tutor().lockRecordingChannel("assistance")!, AUDIO); });
    expect(harness.tutor().speechNotice).toContain("没有听到内容");
    mocks.transcribe.mockResolvedValueOnce(asrResult("   ", 12));
    await act(async () => { await harness.tutor().transcribeRecording(harness.tutor().lockRecordingChannel("assistance")!, AUDIO); });
    expect(harness.tutor().speechNotice).toContain("没有听到内容");
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    await act(async () => { harness.tutor().clearSpeechNotice(); });
    expect(harness.tutor().speechNotice).toBeUndefined();
  });
  it("new capture fences a late ASR result and old finally cannot clear the new request busy state", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    let releaseOld!: (value: ReturnType<typeof asrResult>) => void;
    let releaseNew!: (value: ReturnType<typeof asrResult>) => void;
    mocks.transcribe.mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { releaseNew = resolve; }));
    const old = harness.tutor().lockRecordingChannel("mainline")!;
    let first!: Promise<void>; let second!: Promise<void>;
    await act(async () => { first = harness.tutor().transcribeRecording(old, AUDIO); });
    const current = harness.tutor().lockRecordingChannel("assistance")!;
    expect(current.captureId).not.toBe(old.captureId);
    await act(async () => { second = harness.tutor().transcribeRecording(current, AUDIO); });
    await act(async () => { releaseOld(asrResult("旧录音", 12)); await first; });
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    expect(harness.tutor().speechPendingTranscript).toBeUndefined();
    expect(harness.tutor().speechAsrBusy).toBe(true);
    mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 13 }));
    await act(async () => { releaseNew(asrResult("新录音", 12)); await second; });
    expect(mocks.submitStudentInput).toHaveBeenCalledTimes(1);
    expect(mocks.submitStudentInput.mock.calls[0][1]).toMatchObject({ channel: "assistance", text: "新录音" });
    expect(harness.tutor().speechAsrBusy).toBe(false);
  });

  it("one capture cannot submit two utterances through repeated audio callbacks", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    mocks.transcribe.mockResolvedValue(asrResult("重复回调", 12));
    mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    const capture = harness.tutor().lockRecordingChannel("mainline")!;
    await act(async () => { await harness.tutor().transcribeRecording(capture, AUDIO); });
    await act(async () => { await harness.tutor().transcribeRecording(capture, AUDIO); });
    expect(mocks.transcribe).toHaveBeenCalledTimes(1);
    expect(mocks.submitStudentInput).toHaveBeenCalledTimes(1);
  });

});

describe("useTutorLearning Step 8：barge-in ①②③④ 因果链", () => {
  let harness: ReturnType<typeof mountHarness>;

  beforeEach(() => {
    vi.clearAllMocks();
    mediaHarness.reset();
  });

  afterEach(() => {
    harness?.unmount();
  });

  it("顺序固定：①中断 adapter → ②interrupted outcome（采用新 snapshot）→ ③control.barge_in → ④新 sequence 进入同一 adopt 流程", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    // ② interrupted outcome 响应：服务端推进到 rev 13（无 pending，等 barge_in）。
    mocks.reportPresentationOutcome.mockResolvedValueOnce(validRuntimeSnapshot({ revision: 13 }));
    // ③ control.barge_in 响应：Navigator 新 sequence（PS-0002）。
    mocks.submitStudentInput.mockResolvedValueOnce(validRuntimeSnapshot({ pendingPresentation: pendingVoicePresentationSeq2(14), revision: 14 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting" && tutor.runtimePresentationPhase.kind === "voice");
    });
    expect(harness.tutor().bargeInAvailable).toBe(true);
    await act(async () => { await harness.tutor().bargeIn(); });
    // ② interrupted outcome 精确请求体（expected_revision = delivery.session_revision）。
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      "VA-bt01-narrate",
      expect.objectContaining({ sequenceId: "PS-0001", ordinal: 0, outcome: "interrupted", expectedRevision: 12 }),
    );
    // 因果顺序：interrupted outcome 先于 control.barge_in 提交。
    expect(mocks.reportPresentationOutcome.mock.invocationCallOrder[0]).toBeLessThan(mocks.submitStudentInput.mock.invocationCallOrder[0]);
    // ③ 显式 control.barge_in（revision 取 interrupted outcome 采用后的 13）。
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "control", command: "barge_in" },
      13,
      expect.any(String),
    );
    // ④ 新 sequence 经同一 adopt 流程执行（PS-0002 新键 → presenting）。
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting" && tutor.runtimePresentationPhase.actionId === "VA-bt02-narrate");
    });
  });

  it("无活跃可中断交付（idle）→ 零 outcome、零 control（不伪造 interrupted）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => { await harness.tutor().bargeIn(); });
    expect(mocks.reportPresentationOutcome).not.toHaveBeenCalled();
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
  });

  it("② interrupted outcome 网络失败 → 不提交 ③ control.barge_in（不盲发 stale revision control）", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    mocks.reportPresentationOutcome.mockRejectedValueOnce(new TypeError("fetch failed"));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting");
    });
    await act(async () => { await harness.tutor().bargeIn(); });
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    expect(harness.tutor().runtimeFailureNotice).toContain("网络失败");
  });
  it.each([403, 409])("interrupted 回执被 %i 拒绝：不提交 control，不自动重试", async (status) => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    mocks.reportPresentationOutcome.mockRejectedValueOnce(new TutorRuntimeHttpError(status, "REVISION_CONFLICT", "rejected"));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting");
    });
    await act(async () => { await harness.tutor().bargeIn(); });
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    expect(harness.tutor().runtimeFailureNotice).toContain("被拒绝");
  });
  it("200 内 revision-conflict：不提交 control，不自动重试", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ pendingPresentation: true, revision: 12 }));
    mocks.reportPresentationOutcome.mockResolvedValueOnce(validFromRaw(runtimeSnapshotRaw({
      revision: 13,
      turn: { status: "revision-conflict", failure: { category: "presentation", failure_class: "STALE_REVISION", retryable: true } },
    })));
    harness = mountHarness(client);
    await act(async () => { await harness.tutor().start(); });
    await act(async () => {
      await waitForTutor(harness, (tutor) => tutor.runtimePresentationPhase.phase === "presenting");
    });
    await act(async () => { await harness.tutor().bargeIn(); });
    expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    expect(harness.tutor().runtimeFailureNotice).toContain("未被接受");
  });
});
