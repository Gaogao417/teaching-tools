/**
 * 波次 G 任务 1：讲解气泡主面测试。
 *
 * topic-coach-bubble（含尾巴样式）是老师当前话术主呈现面：挂 transcript
 * 之上、显示最近一条老师话术、speaking 态有「正在讲」强调；transcript
 * 降级为可折叠历史流（学生条目不进气泡）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const startLearnExperience = vi.fn();
const submitTutorTurn = vi.fn();
const completeTutorVoice = vi.fn();
const completeTutorSession = vi.fn();
const getLearnSolutionBoard = vi.fn();

vi.mock("../../../api/client", () => ({
  api: {
    startLearnExperience,
    getTutorSession: vi.fn(),
    submitTutorTurn,
    completeTutorVoice,
    completeTutorSession,
    tutorAsr: vi.fn(),
    getLearnSolutionBoard,
    streamActionSpeech: vi.fn().mockRejectedValue(new Error("tts unavailable")),
    recordSimilarityLearnProgress: vi.fn().mockResolvedValue({ ok: true }),
  },
}));
vi.mock("../../../presentation/audio/MediaSessionController", () => ({
  MediaSessionController: class {
    subscribe() { return () => undefined; }
    getState() { return { status: "idle" }; }
    stop() {}
    dispose() {}
    replay() {}
  },
}));
/** enter 永不 resolve：speakTurn 停在播放位（speechActive 持续为真，
 *  phase=speaking），用于观察「正在讲」强调态。 */
vi.mock("../../../presentation/narration/NarrationController", () => ({
  NarrationController: class {
    enter = vi.fn().mockImplementation(() => new Promise(() => undefined));
    stop = vi.fn();
    replay = vi.fn();
  },
}));
vi.mock("../../../presentation/coach/useCoachRecorder", () => ({
  useCoachRecorder: () => ({ recording: false, toggle: vi.fn() }),
}));
vi.mock("../../../geometry/react/GeometryCanvas", () => ({
  GeometryCanvasSurface: () => <div data-testid="geometry-figure-stub" />,
}));

const { TutorLearnExperience } = await import("../TutorLearnExperience");
import type { TutorExperienceResponse, TutorTurnResponse } from "../../../../../shared/tutorExperience";
import type { TaskId } from "../../../../../shared/contracts";

const TASK = "parallelLineRatios" as TaskId;

function turn(overrides: Partial<TutorTurnResponse> = {}): TutorTurnResponse {
  return {
    session_id: "TS-6410", revision: 2, client_turn_id: "ct-1", idempotent_replay: false,
    mode: "teach",
    current_checkpoint: { checkpoint_id: "CP1", part_id: "1", route_id: "R1" },
    decision: null,
    voice: [],
    workspace: [],
    event_cursor: 4,
    ...overrides,
  };
}

function experience(openingText?: string): TutorExperienceResponse {
  return {
    kind: "tutor",
    task_id: TASK,
    scenario_id: "SC-BUBBLE-1",
    binding: { artifact_id: "TB-1", default_plan: "TP-1", variants: [], alternates_available: false },
    question: { artifact_id: "QT-1", stem: "题干", subquestions: [] },
    session_id: "TS-6410",
    opening: turn(openingText
      ? { voice: [{ action_id: "VA-1", text: openingText, interruptible: true }] }
      : {}),
  };
}

function mount(initial: TutorExperienceResponse): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  void act(() => root.render(
    <BrowserRouter>
      <TutorLearnExperience taskId={TASK} studentId="student-bubble" initial={initial} onLegacy={() => undefined} />
    </BrowserRouter>,
  ));
  return { container, unmount: () => { void act(() => root.unmount()); container.remove(); } };
}

async function submitAnswer(container: HTMLElement, text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>("input[aria-label='回答输入']");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input!, text);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector("[data-testid='tutor-submit-answer']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("TutorLearnExperience 讲解气泡主面（波次 G 任务 1）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeTutorVoice.mockResolvedValue(null);
    completeTutorSession.mockResolvedValue({ session_id: "TS-6410", completed: true });
    submitTutorTurn.mockResolvedValue(turn());
    getLearnSolutionBoard.mockResolvedValue({ task_id: TASK, scenario_id: "SC-BUBBLE-1", board: null });
  });

  it("气泡显示最新老师话术（开场讲解进入气泡，speaking 态带强调）", async () => {
    const { container, unmount } = mount(experience("我们先看这两个三角形的公共角。"));
    await vi.waitFor(() => {
      const bubble = container.querySelector("[data-testid='tutor-current-speech']");
      expect(bubble).toBeTruthy();
      expect(bubble!.textContent).toContain("我们先看这两个三角形的公共角。");
    });
    // narration 挂起播放位 → speaking 态：气泡带 is-speaking 与「正在讲」徽标。
    await vi.waitFor(() => {
      expect(container.querySelector(".tutor-current-speech")!.classList.contains("is-speaking")).toBe(true);
      expect(container.querySelector("[data-testid='tutor-speaking-badge']")).toBeTruthy();
    });
    unmount();
  });

  it("气泡随回合更新（后一条老师话术覆盖前一条）", async () => {
    const { container, unmount } = mount(experience("第一条老师话术。"));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-current-speech']")!.textContent).toContain("第一条老师话术。"));

    submitTutorTurn.mockResolvedValue(turn({
      voice: [{ action_id: "VA-2", text: "第二条老师话术覆盖。", interruptible: true }],
    }));
    await submitAnswer(container, "我来说这一步");
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-current-speech']")!.textContent).toContain("第二条老师话术覆盖。"));
    unmount();
  });

  it("学生条目不进气泡（学生发言后气泡仍是最近老师话术）", async () => {
    const { container, unmount } = mount(experience("开场讲解话术。"));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-current-speech']")!.textContent).toContain("开场讲解话术。"));

    // 学生发言且回合无老师话术：气泡保持上一条老师话术，不显示学生文本。
    submitTutorTurn.mockResolvedValue(turn());
    await submitAnswer(container, "学生自己的一段推理内容不应出现在气泡里");
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-transcript']")!.textContent).toContain("学生自己的一段推理内容"));
    expect(container.querySelector("[data-testid='tutor-current-speech']")!.textContent).not.toContain("学生自己的一段推理内容");
    expect(container.querySelector("[data-testid='tutor-current-speech']")!.textContent).toContain("开场讲解话术。");
    unmount();
  });

  it("transcript 降级为可折叠历史流（默认折叠，展开见历史条目）", async () => {
    const { container, unmount } = mount(experience("开场讲解话术。"));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-current-speech']")).toBeTruthy());

    // 默认折叠：历史流 hidden，但条目仍在 DOM（textContent 语义不回归）。
    const transcript = container.querySelector("[data-testid='tutor-transcript']")!;
    expect(transcript.hasAttribute("hidden")).toBe(true);
    expect(transcript.textContent).toContain("开场讲解话术。");

    const toggle = container.querySelector("[data-testid='tutor-transcript-toggle']")! as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(container.querySelector("[data-testid='tutor-transcript']")!.hasAttribute("hidden")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    unmount();
  });
});
