/**
 * VS1 remediation-2：canonical Coach 气泡/对话流测试。
 *
 * 气泡（topic-coach-bubble / data-testid=coach-prompt）= 当前拍老师话术
 * 主呈现面（呈现指针 currentText，回看时临时显示被回看条）；学生条目
 * 不进气泡；对话历史进 canonical thread（aria-label=答疑对话，无折叠
 * toggle——ADR-010 §2 Transcript 为次级呈现，样式随 canonical 组件）。
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
    getState() { return { status: "idle" }; }
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
  useCoachRecorder: () => ({ recording: false, toggle: vi.fn(), cancel: vi.fn() }),
}));
vi.mock("../../../geometry/react/GeometryCanvas", () => ({
  GeometryCanvasSurface: () => <div data-testid="geometry-figure-stub" />,
}));

const { TutorLearnExperience } = await import("../TutorLearnExperience");
import type { TutorExperienceResponse, TutorTurnResponse } from "../../../../../shared/tutorExperience";
import { studentWorkspaceViewFixture } from "../../../action-runtime/tutor/tutorTestFixtures";
import type { TaskId } from "../../../../../shared/contracts";

const TASK = "parallelLineRatios" as TaskId;

function turn(overrides: Partial<TutorTurnResponse> = {}): TutorTurnResponse {
  return {
    session_id: "TS-6410", revision: 2, client_turn_id: "ct-1", idempotent_replay: false,
    mode: "teach",
    current_checkpoint: { checkpoint_id: "CP1", part_id: "1", route_id: "R1", index: 1, total: 3 },
    decision: null,
    voice: [],
    workspace: [],
    workspace_view: studentWorkspaceViewFixture(),
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
  await vi.waitFor(() => expect(container.querySelector("input[aria-label='回答输入']")).toBeTruthy());
  const input = container.querySelector<HTMLInputElement>("input[aria-label='回答输入']");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input!, text);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector("[data-testid='tutor-submit-answer']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("TutorLearnExperience canonical Coach 气泡与对话流（VS1 remediation-2）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeTutorVoice.mockResolvedValue(null);
    completeTutorSession.mockResolvedValue({ session_id: "TS-6410", completed: true });
    submitTutorTurn.mockResolvedValue(turn());
  });

  it("气泡=当前拍老师话术（coach-prompt；开场讲解进入 canonical bubble）", async () => {
    const { container, unmount } = mount(experience("我们先看这两个三角形的公共角。"));
    await vi.waitFor(() => {
      const bubble = container.querySelector("[data-testid='coach-prompt']");
      expect(bubble).toBeTruthy();
      expect(bubble!.textContent).toContain("我们先看这两个三角形的公共角。");
    });
    // canonical bubble 结构（topic-coach-bubble，含 aria 语义）。
    expect(container.querySelector("[data-testid='coach-prompt']")!.className).toContain("topic-coach-bubble");
    expect(container.querySelector("[data-testid='coach-prompt']")!.getAttribute("aria-label")).toBe("当前 Action 讲解");
    unmount();
  });

  it("气泡随回合更新（后一条老师话术覆盖前一条）", async () => {
    const { container, unmount } = mount(experience("第一条老师话术。"));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='coach-prompt']")!.textContent).toContain("第一条老师话术。"));

    submitTutorTurn.mockResolvedValue(turn({
      voice: [{ action_id: "VA-2", text: "第二条老师话术覆盖。", interruptible: true }],
    }));
    await submitAnswer(container, "我来说这一步");
    await vi.waitFor(() => expect(container.querySelector("[data-testid='coach-prompt']")!.textContent).toContain("第二条老师话术覆盖。"));
    unmount();
  });

  it("学生条目不进气泡（学生发言后气泡仍是最近老师话术，学生文本只进 thread）", async () => {
    const { container, unmount } = mount(experience("开场讲解话术。"));
    await vi.waitFor(() => expect(container.querySelector("[data-testid='coach-prompt']")!.textContent).toContain("开场讲解话术。"));

    // 学生发言且回合无老师话术：气泡保持上一条老师话术，不显示学生文本。
    submitTutorTurn.mockResolvedValue(turn());
    await submitAnswer(container, "学生自己的一段推理内容不应出现在气泡里");
    const thread = container.querySelector("[aria-label='答疑对话']");
    await vi.waitFor(() => expect(thread!.textContent).toContain("学生自己的一段推理内容"));
    expect(container.querySelector("[data-testid='coach-prompt']")!.textContent).not.toContain("学生自己的一段推理内容");
    expect(container.querySelector("[data-testid='coach-prompt']")!.textContent).toContain("开场讲解话术。");
    unmount();
  });

  it("对话历史=canonical thread（常驻、师生条目都在；无折叠 toggle/无模式切换/无快捷 chips）", async () => {
    const { container, unmount } = mount(experience("开场讲解话术。"));
    await vi.waitFor(() => expect(container.querySelector("[aria-label='答疑对话']")).toBeTruthy());
    await vi.waitFor(() => expect(container.querySelector("[aria-label='答疑对话']")!.textContent).toContain("开场讲解话术。"));

    // 学生发言 → 师生两类条目都在 thread（canonical topic-coach-turn 结构）。
    submitTutorTurn.mockResolvedValue(turn({
      voice: [{ action_id: "VA-2", text: "老师回应。", interruptible: true }],
    }));
    await submitAnswer(container, "我的回答");
    await vi.waitFor(() => expect(container.querySelectorAll("[aria-label='答疑对话'] .topic-coach-turn").length).toBeGreaterThanOrEqual(3));
    // 旧交互面零残留（remediation-2 裁定：折叠历史 toggle/模式切换/快捷 chips 全删）。
    expect(container.querySelector("[data-testid='tutor-transcript-toggle']")).toBeNull();
    expect(container.querySelector("[data-testid='tutor-transcript']")).toBeNull();
    expect(container.querySelector(".tutor-learn-composer-mode")).toBeNull();
    expect(container.querySelector(".tutor-learn-quick-asks")).toBeNull();
    unmount();
  });
});
