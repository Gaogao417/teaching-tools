/**
 * 波次 F 任务 3：dock 预览气泡测试。
 *
 * 收起指导栏后，新老师消息在 dock 头像显示预览气泡（复用
 * topic-coach-dock-preview 样式与 legacy 行为：新消息更新、展开清除、
 * 未读点持续）；展开后气泡与未读点都清除。
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
    session_id: "TS-6401", revision: 2, client_turn_id: "ct-1", idempotent_replay: false,
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
    scenario_id: "SC-DOCK-1",
    binding: { artifact_id: "TB-1", default_plan: "TP-1", variants: [], alternates_available: false },
    question: { artifact_id: "QT-1", stem: "题干", subquestions: [] },
    session_id: "TS-6401",
    opening: turn(),
  };
}

function mount(initial: TutorExperienceResponse): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  void act(() => root.render(
    <BrowserRouter>
      <TutorLearnExperience taskId={TASK} studentId="student-dock" initial={initial} onLegacy={() => undefined} />
    </BrowserRouter>,
  ));
  return { container, unmount: () => { void act(() => root.unmount()); container.remove(); } };
}

async function collapseRail(container: HTMLElement): Promise<void> {
  const close = container.querySelector("button[aria-label='收起指导栏']");
  expect(close).toBeTruthy();
  await act(async () => { close!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

async function newTutorMessage(container: HTMLElement, text: string): Promise<void> {
  submitTutorTurn.mockResolvedValue(turn({
    voice: [{ action_id: `v-${Math.random().toString(36).slice(2, 6)}`, text, interruptible: true }],
  }));
  const input = container.querySelector<HTMLInputElement>("input[aria-label='回答输入']");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input!, "好的");
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector("[data-testid='tutor-submit-answer']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("TutorLearnExperience dock 预览气泡（波次 F 任务 3）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeTutorVoice.mockResolvedValue(null);
    completeTutorSession.mockResolvedValue({ session_id: "TS-6401", completed: true });
    submitTutorTurn.mockResolvedValue(turn());
    getLearnSolutionBoard.mockResolvedValue({ task_id: TASK, scenario_id: "SC-DOCK-1", board: null });
  });

  it("收起 → 新老师消息 → 气泡出现（含未读点）→ 展开清除", async () => {
    const { container, unmount } = mount(experience());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-state']")).toBeTruthy());

    // 展开状态：无气泡（legacy 行为——气泡只服务收起态）。
    expect(container.querySelector(".topic-coach-dock-preview")).toBeNull();

    await collapseRail(container);
    expect(container.querySelector(".topic-coach-dock-preview")).toBeNull();

    // 收起后新老师消息：dock 头像出现预览气泡 + 未读点。
    await newTutorMessage(container, "很好，我们看下一步的平行关系。");
    await vi.waitFor(() => expect(container.querySelector(".topic-coach-dock-preview")).toBeTruthy());
    expect(container.querySelector(".topic-coach-dock-preview")!.textContent).toContain("很好，我们看下一步的平行关系。");
    expect(container.querySelector(".topic-coach-dock-unread")).toBeTruthy();

    // 展开：气泡与未读点都清除，指导栏恢复。
    await act(async () => {
      container.querySelector("button[aria-label='展开一对一老师']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector(".topic-coach-dock-preview")).toBeNull();
    expect(container.querySelector(".topic-coach-dock-unread")).toBeNull();
    expect(container.querySelector(".ks-focus-rail-drawer.is-open")).toBeTruthy();
    unmount();
  });

  it("新消息更新气泡内容（后一条覆盖前一条）", async () => {
    const { container, unmount } = mount(experience());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-state']")).toBeTruthy());
    await collapseRail(container);

    await newTutorMessage(container, "第一条新消息。");
    await vi.waitFor(() => expect(container.querySelector(".topic-coach-dock-preview")!.textContent).toContain("第一条新消息。"));

    await newTutorMessage(container, "第二条新消息覆盖。");
    await vi.waitFor(() => expect(container.querySelector(".topic-coach-dock-preview")!.textContent).toContain("第二条新消息覆盖。"));
    unmount();
  });
});
