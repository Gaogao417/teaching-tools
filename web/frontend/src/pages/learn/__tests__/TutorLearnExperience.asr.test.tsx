/**
 * Phase 5 UI 集成（波次 C）：TutorLearnExperience 的 ASR 接线测试。
 *
 * 录音产物先走 /api/tutor-sessions/:id/asr，转写文本再进统一输入合同
 * （回答/提问按当前 composer 模式）——不出现第二套输入通道。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const startLearnExperience = vi.fn();
const submitTutorTurn = vi.fn();
const completeTutorVoice = vi.fn();
const tutorAsr = vi.fn();
const recordSimilarityLearnProgress = vi.fn();

vi.mock("../../../api/client", () => ({
  api: {
    startLearnExperience,
    getTutorSession: vi.fn(),
    submitTutorTurn,
    completeTutorVoice,
    completeTutorSession: vi.fn(),
    tutorAsr,
    streamActionSpeech: vi.fn().mockRejectedValue(new Error("tts unavailable")),
    recordSimilarityLearnProgress,
  },
}));
vi.mock("../../../presentation/audio/MediaSessionController", () => ({
  MediaSessionController: class {
    subscribe() { return () => undefined; }
    stop() {}
    dispose() {}
    replay() {}
  },
}));
vi.mock("../../../presentation/narration/NarrationController", () => ({
  NarrationController: class {
    enter = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn();
    replay = vi.fn();
  },
}));

const recorderCallbacks: { onAudio?: (audio: { dataUrl: string; durationMs?: number }) => void } = {};
/** 有状态 recorder mock：测试可直接置 recording 并收到 toggle 调用。 */
const recorderState: { recording: boolean; toggle: ReturnType<typeof vi.fn> } = {
  recording: false,
  toggle: vi.fn(() => { recorderState.recording = !recorderState.recording; }),
};
vi.mock("../../../presentation/coach/useCoachRecorder", () => ({
  useCoachRecorder: (options: { onAudio: (audio: { dataUrl: string; durationMs?: number }) => void }) => {
    recorderCallbacks.onAudio = options.onAudio;
    return { recording: recorderState.recording, toggle: recorderState.toggle };
  },
}));

const { TutorLearnExperience } = await import("../TutorLearnExperience");
import type { TutorExperienceResponse, TutorTurnResponse } from "../../../../../shared/tutorExperience";
import type { TaskId } from "../../../../../shared/contracts";

const TASK = "parallelLineRatios" as TaskId;

function turn(): TutorTurnResponse {
  return {
    session_id: "TS-6001", revision: 2, client_turn_id: "system.open", idempotent_replay: false,
    mode: "teach",
    current_checkpoint: { checkpoint_id: "CP1", part_id: "1", route_id: "R1" },
    decision: null,
    voice: [],
    workspace: [],
    event_cursor: 3,
  };
}

function experience(): TutorExperienceResponse {
  return {
    kind: "tutor",
    task_id: TASK,
    scenario_id: "SC-1",
    binding: { artifact_id: "TB-1", default_plan: "TP-1", variants: [], alternates_available: false },
    question: { artifact_id: "QT-1", stem: "题干", subquestions: [] },
    session_id: "TS-6001",
    opening: turn(),
  };
}

function mount(): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  void act(() => root.render(
    <BrowserRouter>
      <TutorLearnExperience taskId={TASK} studentId="student-asr" initial={experience()} onLegacy={() => undefined} />
    </BrowserRouter>,
  ));
  return { container, unmount: () => { void act(() => root.unmount()); container.remove(); } };
}

describe("TutorLearnExperience ASR 接线", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorderState.recording = false;
    completeTutorVoice.mockResolvedValue(null);
    recordSimilarityLearnProgress.mockResolvedValue({ ok: true });
  });

  it("录音 → tutorAsr 转写 → 回答模式提交 reasoning_utterance", async () => {
    submitTutorTurn.mockResolvedValue(turn());
    tutorAsr.mockResolvedValue({ transcript: "内错角相等", model: "qwen3-asr-flash" });
    const { container, unmount } = mount();
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-state']")).toBeTruthy());
    expect(recorderCallbacks.onAudio).toBeTruthy();
    await act(async () => {
      recorderCallbacks.onAudio!({ dataUrl: "data:audio/webm;codecs=opus;base64,AAAA", durationMs: 1200 });
    });
    await vi.waitFor(() => expect(tutorAsr).toHaveBeenCalledWith("TS-6001", { dataUrl: "data:audio/webm;codecs=opus;base64,AAAA", durationMs: 1200 }));
    await vi.waitFor(() =>
      expect(submitTutorTurn).toHaveBeenCalledWith("TS-6001", expect.stringMatching(/^turn-/), 2, {
        input_kind: "reasoning_utterance",
        text: "内错角相等",
      }));
    unmount();
  });

  it("波次 E 回归：录音中停止键可点（旧实现 disabled 含 recording 永远禁用）", async () => {
    recorderState.recording = true;
    const { container, unmount } = mount();
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-state']")).toBeTruthy());
    // 录音中：按钮可点且语义为结束录音（旧实现 disabled 含 recorder.recording，
    // 「停止录音」永远点不了——教师实测报告的缺陷）。
    const mic = container.querySelector("[data-testid='tutor-record']") as HTMLButtonElement;
    expect(mic.disabled).toBe(false);
    expect(mic.getAttribute("aria-label")).toBe("结束录音");
    expect(container.textContent).toContain("正在听");
    await act(async () => {
      mic.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(recorderState.toggle).toHaveBeenCalled();
    unmount();
  });

  it("波次 E 回归：topic coach dock 壳——收起指导栏 → dock 头像展开", async () => {
    const { container, unmount } = mount();
    await vi.waitFor(() => expect(container.querySelector(".topic-coach-panel")).toBeTruthy());
    expect(container.querySelector("[aria-label='重播老师语音']")).toBeTruthy();
    await act(async () => {
      container.querySelector("[aria-label='收起指导栏']")!.dispatchEvent(new Event("click", { bubbles: true }));
    });
    await vi.waitFor(() => expect(container.querySelector(".ks-focus-rail-drawer")!.classList.contains("is-closed")).toBe(true));
    await act(async () => {
      container.querySelector(".topic-coach-dock-avatar")!.dispatchEvent(new Event("click", { bubbles: true }));
    });
    await vi.waitFor(() => expect(container.querySelector(".ks-focus-rail-drawer")!.classList.contains("is-open")).toBe(true));
    unmount();
  });

  it("提问模式下录音 → question_asked（同一 ASR 通道）", async () => {
    submitTutorTurn.mockResolvedValue(turn());
    tutorAsr.mockResolvedValue({ transcript: "为什么要作这条平行线？", model: "qwen3-asr-flash" });
    const { container, unmount } = mount();
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-state']")).toBeTruthy());
    await act(async () => {
      const questionMode = [...container.querySelectorAll("button")].find((button) => button.textContent === "提问"
        && button.closest(".tutor-learn-composer-mode"));
      questionMode!.click();
    });
    await act(async () => {
      recorderCallbacks.onAudio!({ dataUrl: "data:audio/webm;codecs=opus;base64,AAAA" });
    });
    await vi.waitFor(() =>
      expect(submitTutorTurn).toHaveBeenLastCalledWith("TS-6001", expect.stringMatching(/^turn-/), 2, {
        input_kind: "question_asked",
        text: "为什么要作这条平行线？",
      }));
    unmount();
  });

  it("ASR 不可用 → 降级提示，不伪装成功", async () => {
    tutorAsr.mockRejectedValue(new Error("ASR_UNAVAILABLE"));
    const { container, unmount } = mount();
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-state']")).toBeTruthy());
    await act(async () => {
      recorderCallbacks.onAudio!({ dataUrl: "data:audio/webm;codecs=opus;base64,AAAA" });
    });
    await vi.waitFor(() => expect(container.textContent).toContain("语音识别暂不可用"));
    expect(submitTutorTurn).not.toHaveBeenCalled();
    unmount();
  });
});
