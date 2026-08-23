/**
 * 波次 F 任务 2：快捷提问 chips 测试。
 *
 * composer 的快捷提问一键发送 question_asked（复用现有提问通道，
 * 不经过「回答/提问」切换，无新输入合同）；chips 只在未完成阶段出现。
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
    session_id: "TS-6301", revision: 2, client_turn_id: "ct-1", idempotent_replay: false,
    mode: "teach",
    current_checkpoint: { checkpoint_id: "CP1", part_id: "1", route_id: "R1" },
    decision: null,
    voice: [],
    workspace: [],
    event_cursor: 4,
    ...overrides,
  };
}

function experience(): TutorExperienceResponse {
  return {
    kind: "tutor",
    task_id: TASK,
    scenario_id: "SC-QUICK-1",
    binding: { artifact_id: "TB-1", default_plan: "TP-1", variants: [], alternates_available: false },
    question: { artifact_id: "QT-1", stem: "题干", subquestions: [] },
    session_id: "TS-6301",
    opening: turn(),
  };
}

function mount(initial: TutorExperienceResponse): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  void act(() => root.render(
    <BrowserRouter>
      <TutorLearnExperience taskId={TASK} studentId="student-quick" initial={initial} onLegacy={() => undefined} />
    </BrowserRouter>,
  ));
  return { container, unmount: () => { void act(() => root.unmount()); container.remove(); } };
}

describe("TutorLearnExperience 快捷提问 chips（波次 F 任务 2）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeTutorVoice.mockResolvedValue(null);
    completeTutorSession.mockResolvedValue({ session_id: "TS-6301", completed: true });
    submitTutorTurn.mockResolvedValue(turn());
    getLearnSolutionBoard.mockResolvedValue({ task_id: TASK, scenario_id: "SC-QUICK-1", board: null });
  });

  it("渲染三枚 chips；点击一键发送 question_asked 与预设文案（不经过 composerMode）", async () => {
    const { container, unmount } = mount(experience());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-state']")).toBeTruthy());

    const chips = container.querySelectorAll(".tutor-learn-quick-asks button");
    expect(chips).toHaveLength(3);
    expect([...chips].map((chip) => chip.textContent)).toEqual(["这步没懂", "换种说法", "给点提示"]);

    await act(async () => {
      container.querySelector("[data-testid='tutor-quick-ask-lost']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(submitTutorTurn).toHaveBeenCalledTimes(1);
    expect(submitTutorTurn.mock.calls[0][3]).toEqual({
      input_kind: "question_asked",
      text: "这一步我没听懂，能再讲一遍吗？",
    });

    await act(async () => {
      container.querySelector("[data-testid='tutor-quick-ask-rephrase']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(submitTutorTurn.mock.calls[1][3]).toEqual({
      input_kind: "question_asked",
      text: "能换一种说法再解释一下这一步吗？",
    });
    unmount();
  });

  it("提问进对话记录（学生条目带（问）前缀），老师回答走同一回合通道", async () => {
    const { container, unmount } = mount(experience());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-state']")).toBeTruthy());
    submitTutorTurn.mockResolvedValue(turn({
      voice: [{ action_id: "v-1", text: "我们换一个角度看这两个三角形。", interruptible: true }],
    }));

    await act(async () => {
      container.querySelector("[data-testid='tutor-quick-ask-rephrase']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='tutor-transcript']")!.textContent).toContain("（问）能换一种说法再解释一下这一步吗？");
    });
    await vi.waitFor(() => {
      expect(container.querySelector("[data-testid='tutor-transcript']")!.textContent).toContain("我们换一个角度看这两个三角形。");
    });
    unmount();
  });
});
