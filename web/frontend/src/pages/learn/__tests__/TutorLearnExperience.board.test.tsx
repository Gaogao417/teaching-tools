/**
 * 波次 F 任务 1：完成页板书回顾测试。
 *
 * - 板书只在 question_completed 后从既有内容面（GET /api/learn/:taskId/
 *   solution-board）拉取，scenario 用 /experience 的 scenario_id；
 * - 复用 SolutionBoardPanel 渲染整板投影（全部表达式可见）；
 * - 无板书（board:null）或拉取失败时完成页保持可用。
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
import type { SolutionBoardProjection } from "../../../../../shared/solutionBoard";
import type { TaskId } from "../../../../../shared/contracts";

const TASK = "parallelLineRatios" as TaskId;
const SCENARIO_ID = "SC-BOARD-1";

function turn(overrides: Partial<TutorTurnResponse> = {}): TutorTurnResponse {
  return {
    session_id: "TS-6201", revision: 3, client_turn_id: "ct-1", idempotent_replay: false,
    mode: "teach",
    current_checkpoint: { checkpoint_id: "CP2", part_id: "1", route_id: "R1" },
    decision: null,
    voice: [],
    workspace: [],
    event_cursor: 6,
    ...overrides,
  };
}

function experience(): TutorExperienceResponse {
  return {
    kind: "tutor",
    task_id: TASK,
    scenario_id: SCENARIO_ID,
    binding: { artifact_id: "TB-1", default_plan: "TP-1", variants: [], alternates_available: false },
    question: { artifact_id: "QT-1", stem: "题干", subquestions: [] },
    session_id: "TS-6201",
    opening: turn(),
  };
}

const BOARD: SolutionBoardProjection = {
  schemaVersion: 1,
  documentId: "SB-REVIEW-1",
  headingLatex: "$\\text{解答}$",
  expressions: [
    { expressionId: "E1", sourceStepId: "step-1", latexTemplate: "$AD=3$", slotValues: {}, phase: "complete" },
    { expressionId: "E2", sourceStepId: "step-2", latexTemplate: "$\\therefore AD=3$", slotValues: {}, phase: "complete" },
  ],
};

function mount(initial: TutorExperienceResponse): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  void act(() => root.render(
    <BrowserRouter>
      <TutorLearnExperience taskId={TASK} studentId="student-board" initial={initial} onLegacy={() => undefined} />
    </BrowserRouter>,
  ));
  return { container, unmount: () => { void act(() => root.unmount()); container.remove(); } };
}

async function submitAnswer(container: HTMLElement): Promise<void> {
  const input = container.querySelector<HTMLInputElement>("input[aria-label='回答输入']");
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input!, "因为平行线分线段成比例");
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector("[data-testid='tutor-submit-answer']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("TutorLearnExperience 完成页板书回顾（波次 F 任务 1）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeTutorVoice.mockResolvedValue(null);
    completeTutorSession.mockResolvedValue({ session_id: "TS-6201", completed: true });
    submitTutorTurn.mockResolvedValue(turn());
  });

  it("未完成：不拉取板书（内容面只在 question_completed 后可见）", async () => {
    const { container, unmount } = mount(experience());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-state']")).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    expect(getLearnSolutionBoard).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='tutor-solution-board']")).toBeNull();
    unmount();
  });

  it("question_completed → 拉取一次（taskId + experience 的 scenario_id）→ SolutionBoardPanel 渲染整板", async () => {
    getLearnSolutionBoard.mockResolvedValue({ task_id: TASK, scenario_id: SCENARIO_ID, board: BOARD });
    submitTutorTurn.mockResolvedValue(turn({ question_completed: true }));
    const { container, unmount } = mount(experience());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-state']")).toBeTruthy());

    await submitAnswer(container);

    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-completed']")).toBeTruthy());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-solution-board']")).toBeTruthy());
    expect(getLearnSolutionBoard).toHaveBeenCalledTimes(1);
    expect(getLearnSolutionBoard).toHaveBeenCalledWith(TASK, SCENARIO_ID);
    const lines = container.querySelectorAll(".tutor-learn-board .solution-board-line");
    expect(lines).toHaveLength(2);
    expect(lines[0].getAttribute("data-expression-id")).toBe("E1");
    expect(lines[0].className).toContain("is-complete");
    unmount();
  });

  it("无板书（board:null）或拉取失败：完成页保持可用，不渲染板书、不报错", async () => {
    getLearnSolutionBoard.mockResolvedValue({ task_id: TASK, scenario_id: SCENARIO_ID, board: null });
    submitTutorTurn.mockResolvedValue(turn({ question_completed: true }));
    const first = mount(experience());
    await vi.waitFor(() => expect(first.container.querySelector("[data-testid='tutor-state']")).toBeTruthy());
    await submitAnswer(first.container);
    await vi.waitFor(() => expect(first.container.querySelector("[data-testid='tutor-completed']")).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    expect(first.container.querySelector("[data-testid='tutor-solution-board']")).toBeNull();
    expect(first.container.querySelector("[data-testid='tutor-start-practice']")).toBeTruthy();
    first.unmount();

    // 拉取失败（网络错）：完成页同样保持可用。
    getLearnSolutionBoard.mockReset();
    getLearnSolutionBoard.mockRejectedValue(new Error("network down"));
    submitTutorTurn.mockResolvedValue(turn({ question_completed: true }));
    const second = mount(experience());
    await vi.waitFor(() => expect(second.container.querySelector("[data-testid='tutor-state']")).toBeTruthy());
    await submitAnswer(second.container);
    await vi.waitFor(() => expect(second.container.querySelector("[data-testid='tutor-completed']")).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    expect(second.container.querySelector("[data-testid='tutor-solution-board']")).toBeNull();
    expect(second.container.querySelector(".tutor-learn-error")).toBeNull();
    second.unmount();
  });
});
