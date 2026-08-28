/**
 * VS1（mvp/vs-01 REQ-04/L-05）：完成页板书回顾测试——来自统一
 * StudentWorkspaceView（同一会话同一投影），不再走 completion-only
 * board fetch。
 *
 * - question_completed 后完成页渲染 view.solutionBoard 的可见行；
 * - 完成前板书在讲解/操作分支已存在（AC-01：不是完成后才突然出现）；
 * - 无可见行时完成页保持可用（不渲染板书面、不报错）。
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

vi.mock("../../../api/client", () => ({
  api: {
    startLearnExperience,
    getTutorSession: vi.fn(),
    submitTutorTurn,
    completeTutorVoice,
    completeTutorSession,
    tutorAsr: vi.fn(),
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
import { studentWorkspaceViewFixture } from "../../../action-runtime/tutor/tutorTestFixtures";

const TASK = "parallelLineRatios" as TaskId;

function turn(overrides: Partial<TutorTurnResponse> = {}): TutorTurnResponse {
  return {
    session_id: "TS-6201", revision: 3, client_turn_id: "ct-1", idempotent_replay: false,
    mode: "teach",
    current_checkpoint: { checkpoint_id: "CP2", part_id: "1", route_id: "R1", index: 2, total: 3 },
    decision: null,
    voice: [],
    workspace: [],
    workspace_view: studentWorkspaceViewFixture({ sessionId: "TS-6201", revision: 3 }),
    event_cursor: 6,
    ...overrides,
  };
}

function experience(): TutorExperienceResponse {
  return {
    kind: "tutor",
    task_id: TASK,
    scenario_id: "SC-BOARD-1",
    binding: { artifact_id: "TB-1", default_plan: "TP-1", variants: [], alternates_available: false },
    question: { artifact_id: "QT-1", stem: "题干", subquestions: [] },
    session_id: "TS-6201",
    opening: turn(),
  };
}

/** 完成时刻的统一 View：服务端披露整板（全部小问完成）。 */
function completedBoardView() {
  return studentWorkspaceViewFixture({
    sessionId: "TS-6201",
    revision: 4,
    participation: { mode: "review" },
    solutionBoard: {
      headingLatex: "$\\text{解答}$",
      visibleExpressions: [
        { expressionId: "E1", sourceStepId: "step-1", latex: "$AD=3$", isCurrent: false, isComplete: true },
        { expressionId: "E2", sourceStepId: "step-2", latex: "$\\therefore AD=3$", isCurrent: true, isComplete: true },
      ],
    },
  });
}

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

describe("TutorLearnExperience 完成页板书回顾（VS1 统一 View）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeTutorVoice.mockResolvedValue(null);
    completeTutorSession.mockResolvedValue({ session_id: "TS-6201", completed: true });
    submitTutorTurn.mockResolvedValue(turn());
  });

  it("未完成：完成页面板不出现（讲解分支板书面已就位，AC-01）", async () => {
    const { container, unmount } = mount(experience());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='region-status']")).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    // 讲解分支：region-solution-board（empty surface）存在——不是完成后才出现。
    expect(container.querySelector("[data-testid='region-solution-board']")).toBeTruthy();
    // 完成页面板（tutor-solution-board）不出现。
    expect(container.querySelector("[data-testid='tutor-solution-board']")).toBeNull();
    unmount();
  });

  it("question_completed → 完成页渲染统一 View 披露的整板（无第二份 Board 拉取）", async () => {
    submitTutorTurn.mockResolvedValue(turn({ question_completed: true, workspace_view: completedBoardView() }));
    const { container, unmount } = mount(experience());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='region-status']")).toBeTruthy());

    await submitAnswer(container);

    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-completed']")).toBeTruthy());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-solution-board']")).toBeTruthy());
    const lines = container.querySelectorAll(".tutor-learn-board .solution-board-line");
    expect(lines).toHaveLength(2);
    expect(lines[0].getAttribute("data-expression-id")).toBe("E1");
    expect(lines[0].className).toContain("is-complete");
    unmount();
  });

  it("完成时无可见板书行：完成页保持可用，不渲染板书面、不报错", async () => {
    submitTutorTurn.mockResolvedValue(turn({
      question_completed: true,
      workspace_view: studentWorkspaceViewFixture({ sessionId: "TS-6201", revision: 4, participation: { mode: "review" } }),
    }));
    const { container, unmount } = mount(experience());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='region-status']")).toBeTruthy());
    await submitAnswer(container);
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-completed']")).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector("[data-testid='tutor-solution-board']")).toBeNull();
    expect(container.querySelector("[data-testid='tutor-start-practice']")).toBeTruthy();
    expect(container.querySelector(".tutor-learn-error")).toBeNull();
    unmount();
  });
});
