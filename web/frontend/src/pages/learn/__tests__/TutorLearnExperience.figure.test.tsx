/**
 * VS1 remediation（2026-08-26 验收 Rejected 后）：讲解分支结构测试。
 *
 * 用户裁定的 Learn Question / Workspace composition 合同（组件级）：
 * - stem + 全部 subquestions 一体化在 region-question（FocusPrompt）内，
 *   每问 part_id 派生编号（（1）（2）…）、data-part-id、第 N 问 aria；
 * - subquestions 不进 canvas（.tutor-learn-question 类已删除）；
 * - 双 surface 经唯一 canonical StudentWorkspaceFrame（固定双栏容器）：
 *   画布=ReadOnlyGeometrySurface（统一 View 组合几何，实体全 disabled）、
 *   板书=StudentBoardSurface（empty/content 两态）；
 * - Frame 容器携带统一 View revision（data-view-revision）。
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
import { studentWorkspaceViewFixture } from "../../../action-runtime/tutor/tutorTestFixtures";

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

/** VS1：演示披露后服务端组合的画布（题图 + 一条构造线）。 */
const COMPOSED_GEOMETRY: TopicGeometryModel = {
  ...GEOMETRY,
  derivedLines: [{ id: "line:demo-0", kind: "parallel-line", through: "C", parallelTo: "AB", derived: true }],
};

function turn(viewOverrides: Parameters<typeof studentWorkspaceViewFixture>[0] = {}): TutorTurnResponse {
  return {
    session_id: "TS-6101", revision: 2, client_turn_id: "system.open", idempotent_replay: false,
    mode: "teach",
    current_checkpoint: { checkpoint_id: "CP1", part_id: "1", route_id: "R1", index: 1, total: 3 },
    decision: null,
    voice: [],
    workspace: [],
    workspace_view: studentWorkspaceViewFixture(viewOverrides),
    event_cursor: 3,
  };
}

const SUBQUESTIONS = [
  { part_id: "1", prompt: "求证：$CE \\perp AB$；" },
  { part_id: "2", prompt: "求证：$AF \\cdot DE = AG \\cdot BC$。" },
];

function experience(opening: TutorTurnResponse, withSubquestions = true): TutorExperienceResponse {
  return {
    kind: "tutor",
    task_id: TASK,
    scenario_id: "SC-1",
    binding: { artifact_id: "TB-1", default_plan: "TP-1", variants: [], alternates_available: false },
    question: {
      artifact_id: "QT-1",
      stem: "如图，在 $\\triangle ABC$ 中，$BD$ 是 $AC$ 边上的高。",
      ...(withSubquestions ? { subquestions: SUBQUESTIONS } : { subquestions: [] }),
    },
    session_id: "TS-6101",
    opening,
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

describe("TutorLearnExperience 讲解分支结构（VS1 remediation）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeTutorVoice.mockResolvedValue(null);
  });

  it("门禁 1/2/3：region-question 一体化——stem +（1）（2）编号 + 小问内容 + data-part-id + aria", async () => {
    const { container, unmount } = mount(experience(turn({ canvas: { geometry: GEOMETRY } })));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='region-status']")).toBeTruthy());

    const region = container.querySelector("[data-testid='region-question']");
    expect(region).toBeTruthy();
    const text = region?.textContent ?? "";
    // stem 在题目区域。
    expect(text).toContain("AC");
    // 两问都在题目区域（一体化，不在 canvas）。
    expect(text).toContain("CE");
    expect(text).toContain("DE");
    // 编号由 part_id 派生、每问唯一 identity 与 aria。
    const items = Array.from(region?.querySelectorAll(".learn-question-subquestions li") ?? []);
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute("data-part-id")).toBe("1");
    expect(items[1].getAttribute("data-part-id")).toBe("2");
    expect(items[0].getAttribute("aria-label")).toBe("第 1 问");
    expect(items[0].querySelector(".learn-question-part-number")?.textContent).toBe("（1）");
    expect(items[1].querySelector(".learn-question-part-number")?.textContent).toBe("（2）");
    // 顺序与 response 一致（DOM 顺序）。
    expect(items.map((item) => item.getAttribute("data-part-id"))).toEqual(["1", "2"]);

    // 门禁 4：subquestions 不再进入 canvas（旧结构与类已删除）。
    const canvas = container.querySelector(".ks-focus-canvas");
    expect(canvas?.querySelector(".tutor-learn-question")).toBeNull();
    expect(canvas?.querySelector(".tutor-learn-subquestion")).toBeNull();
    unmount();
  });

  it("门禁 5：canvas 内唯一 StudentWorkspaceFrame——画布=统一 View 组合几何（含演示构造线、全 disabled）", async () => {
    const { container, unmount } = mount(experience(turn({
      canvas: { geometry: COMPOSED_GEOMETRY },
    })));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='region-status']")).toBeTruthy());

    const canvas = container.querySelector(".ks-focus-canvas");
    expect(canvas?.querySelectorAll(".student-workspace-frame")).toHaveLength(1);
    const frame = canvas?.querySelector(".student-workspace-frame");
    // Frame 容器携带统一 revision；geometry/board 槽都在 Frame 内。
    expect(frame?.getAttribute("data-view-revision")).toBe("2");
    const stub = frame?.querySelector("[data-testid='geometry-figure-stub']");
    expect(stub).toBeTruthy();
    expect(stub?.closest(".student-workspace-frame")).toBeTruthy();
    expect(stub?.getAttribute("data-entity-ids")).toBe("A,AB,B,BC,C,line:demo-0");
    expect(stub?.getAttribute("data-all-disabled")).toBe("true");
    // 讲解回合不是操作回合：无操作 workspace 合同。
    expect(container.querySelector("[data-testid='action-runtime-workspace']")).toBeNull();
    expect(submitTutorTurn).not.toHaveBeenCalled();
    unmount();
  });

  it("板书 empty surface 常驻（region-solution-board 始终存在；revision 在 Frame）", async () => {
    const { container, unmount } = mount(experience(turn()));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='region-status']")).toBeTruthy());
    const frame = container.querySelector(".student-workspace-frame");
    expect(frame).toBeTruthy();
    const board = frame?.querySelector("[data-testid='region-solution-board']");
    expect(board).toBeTruthy();
    expect(board?.className).toContain("is-empty");
    expect(frame?.getAttribute("data-view-revision")).toBe("2");
    unmount();
  });

  it("有披露板书：可见行在 Frame 板书槽渲染（服务端已过滤 hidden 行）", async () => {
    const { container, unmount } = mount(experience(turn({
      canvas: { geometry: GEOMETRY },
      solutionBoard: {
        headingLatex: "解：",
        visibleExpressions: [
          { expressionId: "E1", sourceStepId: "g2-step-1", latex: "\\because AD \\cdot OC = AB \\cdot OD", isCurrent: false, isComplete: true },
          { expressionId: "E2", sourceStepId: "g2-step-1", latex: "\\therefore \\frac{AD}{OD} = \\frac{AB}{OC}", isCurrent: true, isComplete: true },
        ],
        currentExpressionId: "E2",
      },
    })));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='region-status']")).toBeTruthy());
    const frame = container.querySelector(".student-workspace-frame");
    const lines = frame?.querySelectorAll("[data-testid='region-solution-board'] .solution-board-line");
    expect(lines).toHaveLength(2);
    expect(frame?.querySelector("[data-testid='region-geometry']")).toBeTruthy();
    unmount();
  });

  it("无 subquestions 题目：不渲染小问列表（题干仍在 region-question）", async () => {
    const { container, unmount } = mount(experience(turn(), false));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='region-status']")).toBeTruthy());
    expect(container.querySelector(".learn-question-subquestions")).toBeNull();
    expect(container.querySelector("[data-testid='region-question']")?.textContent).toContain("AC");
    unmount();
  });

  it("无几何题目：Geometry 槽渲染明确占位（surface 不塌缩，不猜图）", async () => {
    const { container, unmount } = mount(experience(turn()));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='region-status']")).toBeTruthy());
    const frame = container.querySelector(".student-workspace-frame");
    expect(frame?.querySelector("[data-testid='geometry-figure-stub']")).toBeNull();
    expect(frame?.querySelector(".student-workspace-empty-note")).toBeTruthy();
    unmount();
  });
});
