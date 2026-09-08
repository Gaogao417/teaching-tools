/**
 * F7 Step 8 — TutorLearnExperience canonical 双 mic 接线（组件级）。
 *
 * 覆盖：
 * - Coach mic（assistance 通道）：canonical 不再禁用；共享外层
 *   PresentationRuntime 的同一 MediaSessionController；录音开始即锁定通道；
 * - mainline answer mic：answer_input 的独立 affordance（其他 participation
 *   不渲染）；与 Coach mic 共享同一媒体 session 实例；
 * - 录音 → ASR（经注入的 runtimeClient.transcribe，零 legacy api.tutorAsr）→
 *   fresh 自动提交 utterance(channel)；
 * - stale：录音中 revision 推进 → transcript 只填对应通道草稿 + 确认提示，
 *   零自动提交；
 * - ASR 系统失败：可见提示（非学生错误）；
 * - 权限拒绝：可见提示（recorder.onError → notice）。
 *
 * useCoachRecorder 以实例注册 mock（按 owner 定位 coach/answer 接线）；
 * runtimeClient/api 经模块依赖注入（canonical 链不触 legacy API）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recorderOptionsRegistry: Record<string, {
  owner?: string;
  disabled: boolean;
  media?: unknown;
  interruptPlaybackOnStart?: boolean;
  captureBusyMessage?: string;
  onRecordingStart?: () => void;
  onAudio: (audio: { dataUrl: string; durationMs?: number; mimeType?: string }) => void;
  onError: (message: string) => void;
}> = {};

// Match the real hook: callbacks remain stable across component renders.
// An unstable cancel triggers the production session cleanup and drops capture.
const recorderControlsRegistry: Record<string, { recording: boolean; toggle: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }> = {};

vi.mock("../../../presentation/coach/useCoachRecorder", () => ({
  useCoachRecorder: (options: typeof recorderOptionsRegistry[string]) => {
    recorderOptionsRegistry[options.owner ?? "unknown"] = options;
    const owner = options.owner ?? "unknown";
    return recorderControlsRegistry[owner] ??= { recording: false, toggle: vi.fn(), stop: vi.fn(), cancel: vi.fn() };
  },
}));

vi.mock("../../../api/client", () => ({
  api: {
    startLearnExperience: vi.fn(),
    getTutorSession: vi.fn(),
    submitTutorTurn: vi.fn(),
    completeTutorVoice: vi.fn(),
    completeTutorSession: vi.fn(),
    tutorAsr: vi.fn(),
    streamActionSpeech: vi.fn().mockRejectedValue(new Error("tts unavailable")),
    recordSimilarityLearnProgress: vi.fn().mockResolvedValue({ ok: true }),
  },
  ResponseSchemaError: class extends Error {},
}));

const { TutorLearnExperience } = await import("../TutorLearnExperience");
const { TutorRuntimeHttpError } = await import("../../../api/tutorRuntimeClient");
import type { TutorRuntimeClient } from "../../../api/tutorRuntimeClient";
const { RUNTIME_SESSION_ID, RUNTIME_TASK_ID, validRuntimeSnapshot, runtimeSnapshotRaw, validFromRaw } = await import("../../../action-runtime/tutor/__tests__/runtimeSnapshotFixture");
import type { TaskId } from "../../../../../shared/contracts";

const asrResult = (transcript: string, observedRevision: number) => ({
  sessionId: RUNTIME_SESSION_ID,
  observedRevision,
  transcript,
  model: "qwen3-asr-flash",
});

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

function mountExperience(client: TutorRuntimeClient): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  void act(() => root.render(
    <BrowserRouter>
      <TutorLearnExperience
        taskId={RUNTIME_TASK_ID as TaskId}
        studentId="step8-component-student"
        onLegacy={() => undefined}
        runtimeClient={client}
      />
    </BrowserRouter>,
  ));
  return { container, unmount: () => { void act(() => root.unmount()); container.remove(); } };
}

async function waitForDom(container: HTMLElement, predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}

/** canonical 就绪：页面根节点携带会话 id（start 已采用、sessionId 已落 UI）。 */
async function waitForSession(container: HTMLElement): Promise<void> {
  await waitForDom(container, () => container.querySelector(`[data-session-id="${RUNTIME_SESSION_ID}"]`) !== null);
}

describe("TutorLearnExperience Step 8：canonical 双 mic 接线", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(recorderOptionsRegistry)) delete recorderOptionsRegistry[key];
    for (const key of Object.keys(recorderControlsRegistry)) delete recorderControlsRegistry[key];
  });

  it("Coach mic（assistance）：canonical 启用 + 共享外层媒体 session + 录音打断播放；权限拒绝有可见提示", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    const { container, unmount } = mountExperience(client);
    await waitForSession(container);
    const coach = recorderOptionsRegistry["coach"];
    expect(coach).toBeDefined();
    expect(coach.disabled).toBe(false);
    expect(coach.media).toBeDefined();
    expect(coach.interruptPlaybackOnStart).toBe(true);
    // canonical 链零 legacy ASR 调用。
    const apiModule = await import("../../../api/client");
    expect(apiModule.api.tutorAsr).not.toHaveBeenCalled();
    // 权限拒绝：recorder.onError → 页面可见提示（非学生错误、不提交）。
    await act(async () => { coach.onError("没有获得麦克风权限，请允许录音或改用文字提问。"); });
    await waitForDom(container, () => container.textContent!.includes("没有获得麦克风权限"));
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    unmount();
  });

  it("mainline mic：answer_input 作答与 confirm_input 理解反馈独立文案；与 Coach mic 共享同一媒体 session 实例", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    const { container, unmount } = mountExperience(client);
    await waitForDom(container, () => container.querySelector("[data-testid='tutor-answer-mic']") !== null);
    const answerMic = container.querySelector<HTMLButtonElement>("[data-testid='tutor-answer-mic']")!;
    expect(answerMic.getAttribute("aria-label")).toBe("语音回答");
    expect(answerMic.disabled).toBe(false);
    const coach = recorderOptionsRegistry["coach"];
    const answer = recorderOptionsRegistry["answer"];
    expect(answer).toBeDefined();
    // 双 mic 共享同一 MediaSessionController 实例（外层 PresentationRuntime 媒体
    // session 唯一属主；录音互斥经同一 capture lease）。
    expect(answer.media).toBeDefined();
    expect(answer.media).toBe(coach.media);
    unmount();

    // confirm_input：复用主线媒体链，呈现理解反馈入口。
    const second = makeClient();
    second.mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    const mounted = mountExperience(second.client);
    await waitForDom(mounted.container, () => mounted.container.querySelector("[data-testid='tutor-confirm-input']") !== null);
    expect(mounted.container.querySelector("[data-testid='tutor-answer-mic']")).toBeNull();
    expect(mounted.container.querySelector("[data-testid='tutor-feedback-mic']")).not.toBeNull();
    mounted.unmount();
  });

  it("Coach mic 全链：录音开始锁 assistance → ASR → fresh → 自动提交 utterance(assistance)", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    mocks.transcribe.mockResolvedValue(asrResult("为什么要作这条平行线？", 12));
    mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 13 }));
    const { container, unmount } = mountExperience(client);
    await waitForSession(container);
    const coach = recorderOptionsRegistry["coach"];
    await act(async () => { coach.onRecordingStart?.(); });
    await act(async () => {
      coach.onAudio({ dataUrl: "data:audio/webm;codecs=opus;base64,AAAA", mimeType: "audio/webm;codecs=opus", durationMs: 1200 });
    });
    await waitForDom(container, () => mocks.submitStudentInput.mock.calls.length > 0, 8000);
    expect(mocks.transcribe).toHaveBeenCalledWith(RUNTIME_SESSION_ID, {
      audio: { dataUrl: "data:audio/webm;codecs=opus;base64,AAAA", mimeType: "audio/webm;codecs=opus", durationMs: 1200 },
      clientRequestId: expect.any(String),
    });
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "utterance", channel: "assistance", text: "为什么要作这条平行线？" },
      12,
      expect.any(String),
    );
    unmount();
  });

  it("answer mic 全链：录音开始锁 mainline → ASR → fresh → 自动提交 utterance(mainline)", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "answer_input", revision: 12 }));
    mocks.transcribe.mockResolvedValue(asrResult("因为翻折保持对应边长度相等", 12));
    mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 13 }));
    const { container, unmount } = mountExperience(client);
    await waitForDom(container, () => recorderOptionsRegistry["answer"] !== undefined && container.querySelector('[data-testid="tutor-answer-mic"]:not(:disabled)') !== null, 8000);
    const answer = recorderOptionsRegistry["answer"];
    await act(async () => { answer.onRecordingStart?.(); });
    await act(async () => {
      answer.onAudio({ dataUrl: "data:audio/webm;codecs=opus;base64,BBBB", mimeType: "audio/webm;codecs=opus", durationMs: 900 });
    });
    await waitForDom(container, () => mocks.submitStudentInput.mock.calls.length > 0);
    expect(mocks.submitStudentInput).toHaveBeenCalledWith(
      RUNTIME_SESSION_ID,
      { kind: "utterance", channel: "mainline", text: "因为翻折保持对应边长度相等" },
      12,
      expect.any(String),
    );
    unmount();
  });

  it("stale：录音中 revision 推进（点确认 CTA）→ transcript 只填 Coach composer 草稿 + 确认提示，零自动提交", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({ participationKind: "continue_input", revision: 13 }));
    const { container, unmount } = mountExperience(client);
    await waitForDom(container, () => container.querySelector("[data-testid='tutor-confirm-input']") !== null);
    const coach = recorderOptionsRegistry["coach"];
    await act(async () => { coach.onRecordingStart?.(); });
    // 录音期间：学生点「确认」推进 revision（捕获值 12 不更新）。
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='tutor-confirm-input']")!.click();
    });
    await waitForDom(container, () => mocks.submitStudentInput.mock.calls.length > 0);
    mocks.transcribe.mockResolvedValue(asrResult("迟到的提问", 12));
    await act(async () => {
      coach.onAudio({ dataUrl: "data:audio/webm;codecs=opus;base64,CCCC", mimeType: "audio/webm;codecs=opus", durationMs: 700 });
    });
    // 草稿填入 assistance composer（录音开始时锁定的通道）+ 确认提示可见。
    await waitForDom(container, () => {
      const composer = container.querySelector<HTMLInputElement>(".topic-coach-question input");
      return composer !== null && composer.value === "迟到的提问";
    });
    expect(container.textContent).toContain("请确认后再发送");
    // 零自动提交：submitStudentInput 仅此前的 control confirm 一次。
    expect(mocks.submitStudentInput).toHaveBeenCalledTimes(1);
    expect(mocks.submitStudentInput.mock.calls[0][1]).toMatchObject({ kind: "control", command: "confirm" });
    unmount();
  });

  it("text failure preserves the composer; confirmed same-key retry clears it", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    mocks.submitStudentInput.mockRejectedValueOnce(new TypeError("fetch failed"));
    mocks.submitStudentInput.mockResolvedValueOnce(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 13 }));
    const { container, unmount } = mountExperience(client);
    try {
      await waitForSession(container);
      const input = container.querySelector<HTMLInputElement>(".topic-coach-question input")!;
      const text = "翻折后C和E之间是什么关系？";
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { container.querySelector<HTMLButtonElement>(".topic-coach-send")!.click(); });
      expect(mocks.submitStudentInput).toHaveBeenCalledTimes(1);
      expect(input.value).toBe(text);
      await act(async () => { container.querySelector<HTMLButtonElement>(".topic-coach-send")!.click(); });
      expect(mocks.submitStudentInput).toHaveBeenCalledTimes(2);
      expect(mocks.submitStudentInput.mock.calls[1]).toEqual(mocks.submitStudentInput.mock.calls[0]);
      expect(input.value).toBe("");
    } finally {
      unmount();
    }
  });

  it("ASR unavailable：可见系统提示（tutor-speech-notice），不映射学生错误、零提交", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    mocks.transcribe.mockRejectedValue(new TutorRuntimeHttpError(503, "ASR_UNAVAILABLE", "down"));
    const { container, unmount } = mountExperience(client);
    await waitForSession(container);
    const coach = recorderOptionsRegistry["coach"];
    await act(async () => { coach.onRecordingStart?.(); });
    await act(async () => {
      coach.onAudio({ dataUrl: "data:audio/webm;codecs=opus;base64,DDDD", mimeType: "audio/webm;codecs=opus", durationMs: 500 });
    });
    await waitForDom(container, () => container.querySelector("[data-testid='tutor-speech-notice']") !== null);
    expect(container.querySelector("[data-testid='tutor-speech-notice']")!.textContent).toContain("语音识别暂不可用");
    expect(mocks.submitStudentInput).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='tutor-error']")).toBeNull();
    unmount();
  });
});


describe("C3 Teach 语音理解反馈", () => {
  it.each(["这一步听懂了，继续", "我还是没懂这个比例", "懂了，所以这两条边是相等的"])("confirm_input ASR 沿 mainline 传原话：%s", async (text) => {
    vi.clearAllMocks();
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 12 }));
    mocks.transcribe.mockResolvedValue(asrResult(text, 12));
    mocks.submitStudentInput.mockResolvedValue(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 13 }));
    const { container, unmount } = mountExperience(client);
    try {
      await waitForDom(container, () => container.querySelector("[data-testid='tutor-feedback-mic']") !== null);
      const feedback = recorderOptionsRegistry["answer"];
      expect(feedback.disabled).toBe(false);
      expect(feedback.media).toBe(recorderOptionsRegistry["coach"].media);
      await act(async () => { feedback.onRecordingStart?.(); feedback.onAudio({ dataUrl: "data:audio/webm;base64,AAAA", mimeType: "audio/webm" }); });
      await waitForDom(container, () => mocks.submitStudentInput.mock.calls.length > 0);
      expect(mocks.submitStudentInput).toHaveBeenCalledTimes(1);
      expect(mocks.submitStudentInput).toHaveBeenCalledWith(RUNTIME_SESSION_ID,
        { kind: "utterance", channel: "mainline", text }, 12, expect.any(String));
      expect(mocks.submitActionEvidence).not.toHaveBeenCalled();
      expect(mocks.reportPresentationOutcome).not.toHaveBeenCalled();
    } finally { unmount(); }
  });
  it("TTS failure ack exposes recovery even with generation idle, without replaying outcome or faking presented", async () => {
    const { client, mocks } = makeClient();
    mocks.start.mockResolvedValue(validRuntimeSnapshot({ participationKind: "listen_only", revision: 12, pendingPresentation: true }));
    const raw = runtimeSnapshotRaw({ participationKind: "listen_only", revision: 13 });
    (raw.views as { status: Record<string, unknown> }).status.last_failure = {
      category: "presentation_action_failure", event_type: "presentation_failed", sequence: 12, failure_class: "provider_failure",
    };
    const acknowledged = validFromRaw({ ...raw, generation: { status: "idle" }, scope: null });
    let acknowledge!: (value: typeof acknowledged) => void;
    mocks.reportPresentationOutcome.mockReturnValue(new Promise(resolve => { acknowledge = resolve; }));
    let recovered!: (value: typeof acknowledged) => void;
    mocks.submitStudentInput.mockReturnValue(new Promise(resolve => { recovered = resolve; }));
    const { container, unmount } = mountExperience(client);
    try {
      await waitForDom(container, () => mocks.reportPresentationOutcome.mock.calls.length === 1);
      expect(container.querySelector('[data-testid="tutor-presentation-retry"]')).toBeNull();
      expect(JSON.stringify(mocks.reportPresentationOutcome.mock.calls[0])).toContain('"failed"');
      expect(JSON.stringify(mocks.reportPresentationOutcome.mock.calls[0])).toContain('provider_failure');
      await act(async () => { acknowledge(acknowledged); });
      await waitForDom(container, () => container.querySelector('[data-testid="tutor-presentation-retry"]') !== null);
      expect(container.querySelector('[data-testid="tutor-presentation-failure"]')!.textContent).toContain("服务暂时失败");
      expect(container.textContent).not.toContain("老师讲解中");
      const retry = container.querySelector<HTMLButtonElement>('[data-testid="tutor-presentation-retry"]')!;
      await act(async () => { retry.click(); });
      expect(mocks.submitStudentInput).toHaveBeenCalledWith(RUNTIME_SESSION_ID, { kind: "control", command: "retry_recovery" }, 13, expect.any(String));
      expect(retry.disabled).toBe(true);
      await act(async () => { retry.click(); });
      expect(mocks.submitStudentInput).toHaveBeenCalledTimes(1);
      await act(async () => { recovered(validRuntimeSnapshot({ participationKind: "confirm_input", revision: 14 })); });
      await waitForDom(container, () => container.querySelector('[data-testid="tutor-presentation-retry"]') === null);
      expect(mocks.reportPresentationOutcome).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(mocks.reportPresentationOutcome.mock.calls)).not.toContain('"presented"');
    } finally { unmount(); }
  });

});

it("missing mainline capture reports a visible error and never calls ASR",async()=>{
 const{client,mocks}=makeClient();mocks.start.mockResolvedValue(validRuntimeSnapshot({participationKind:"answer_input",revision:12}));const{container,unmount}=mountExperience(client);
 await waitForDom(container,()=>container.querySelector('[data-testid="tutor-answer-mic"]:not(:disabled)')!==null);
 await act(async()=>recorderOptionsRegistry.answer.onAudio({dataUrl:"data:audio/webm;base64,BBBB",durationMs:900}));
 await waitForDom(container,()=>container.textContent?.includes("当前不能提交这段语音，请用文字输入。")===true);expect(mocks.transcribe).not.toHaveBeenCalled();expect(mocks.submitStudentInput).not.toHaveBeenCalled();unmount();
});
