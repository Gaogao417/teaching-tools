/**
 * Phase 5 UI 集成（波次 C-2 裁定 1）：开场讲解题目画布测试。
 *
 * 几何任务在无 workspace 分支（老师讲解第一段）渲染只读
 * GeometryCanvasSurface：实体全部 disabled、无确认按钮、不产生 evidence；
 * 非几何任务维持现状（不猜图）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const startLearnExperience = vi.fn();
const submitTutorTurn = vi.fn();
const completeTutorVoice = vi.fn();

vi.mock("../../../api/client", () => ({
  api: {
    startLearnExperience,
    getTutorSession: vi.fn(),
    submitTutorTurn,
    completeTutorVoice,
    completeTutorSession: vi.fn(),
    tutorAsr: vi.fn(),
    getLearnSolutionBoard: vi.fn().mockResolvedValue({ task_id: "t", scenario_id: "s", board: null }),
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
  GeometryCanvasSurface: (props: { view: { entities: Record<string, { enabled: boolean }> } }) => (
    <div
      data-testid="geometry-figure-stub"
      data-entity-ids={Object.keys(props.view.entities).sort().join(",")}
      data-all-disabled={String(Object.values(props.view.entities).every((entity) => !entity.enabled))}
    />
  ),
}));

const { TutorLearnExperience } = await import("../TutorLearnExperience");
import type { TutorExperienceResponse, TutorTurnResponse } from "../../../../../shared/tutorExperience";
import type { TopicGeometryModel } from "../../../../../shared/topicPractice";
import type { TaskId } from "../../../../../shared/contracts";

const TASK = "parallelLineRatios" as TaskId;

const GEOMETRY: TopicGeometryModel = {
  viewBox: { width: 400, height: 300 },
  points: [
    { id: "A", x: 60, y: 220 },
    { id: "B", x: 300, y: 220 },
    { id: "C", x: 120, y: 60 },
  ],
  segments: [
    { id: "AB", from: "A", to: "B" },
    { id: "BC", from: "B", to: "C" },
  ],
};

function turn(): TutorTurnResponse {
  return {
    session_id: "TS-6101", revision: 2, client_turn_id: "system.open", idempotent_replay: false,
    mode: "teach",
    current_checkpoint: { checkpoint_id: "CP1", part_id: "1", route_id: "R1" },
    decision: null,
    voice: [],
    workspace: [],
    event_cursor: 3,
  };
}

function experience(geometry?: TopicGeometryModel): TutorExperienceResponse {
  return {
    kind: "tutor",
    task_id: TASK,
    scenario_id: "SC-1",
    binding: { artifact_id: "TB-1", default_plan: "TP-1", variants: [], alternates_available: false },
    question: {
      artifact_id: "QT-1",
      stem: "题干",
      subquestions: [],
      ...(geometry ? { geometry } : {}),
    },
    session_id: "TS-6101",
    opening: turn(),
  };
}

function mount(initial: TutorExperienceResponse): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  void act(() => root.render(
    <BrowserRouter>
      <TutorLearnExperience taskId={TASK} studentId="student-fig" initial={initial} onLegacy={() => undefined} />
    </BrowserRouter>,
  ));
  return { container, unmount: () => { void act(() => root.unmount()); container.remove(); } };
}

describe("TutorLearnExperience 开场题目画布（波次 C-2 裁定 1）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeTutorVoice.mockResolvedValue(null);
  });

  it("几何任务：无 workspace 分支渲染只读画布（实体全 disabled、无操作合同）", async () => {
    const { container, unmount } = mount(experience(GEOMETRY));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-state']")).toBeTruthy());
    const stub = container.querySelector("[data-testid='geometry-figure-stub']");
    expect(stub).toBeTruthy();
    expect(stub?.closest(".tutor-learn-figure")).toBeTruthy();
    expect(stub?.getAttribute("data-entity-ids")).toBe("A,AB,B,BC,C");
    expect(stub?.getAttribute("data-all-disabled")).toBe("true");
    // 讲解回合不是操作回合：无 ActionRuntimeFrame、无确认按钮、无 evidence 通道。
    expect(container.querySelector("[data-testid='action-runtime-workspace']")).toBeNull();
    expect(submitTutorTurn).not.toHaveBeenCalled();
    unmount();
  });

  it("非几何任务：无 geometry 字段 → 不渲染画布（维持现状）", async () => {
    const { container, unmount } = mount(experience());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='tutor-state']")).toBeTruthy());
    expect(container.querySelector("[data-testid='geometry-figure-stub']")).toBeNull();
    expect(container.querySelector(".tutor-learn-figure")).toBeNull();
    expect(container.querySelector(".tutor-learn-question")).toBeTruthy();
    unmount();
  });
});
