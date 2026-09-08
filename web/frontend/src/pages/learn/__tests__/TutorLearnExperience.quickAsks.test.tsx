/**
 * VS1 remediation-2：快捷 chips/「回答/提问」模式切换已按用户裁定移除
 * （未经批准的交互 override——ADR-010 §2 禁止清单）。本文件改为：
 * - 负面断言：teach 态 DOM 无快捷 chips、无模式切换、无通用 composer；
 * - Assistance 语义迁移：Panel canonical composer 提问带（问）前缀进
 *   thread，老师回答走同一回合通道。
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
    session_id: "TS-6301", revision: 2, client_turn_id: "ct-1", idempotent_replay: false,
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

describe("TutorLearnExperience 快捷交互退场 + Assistance 迁移（VS1 remediation-2）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeTutorVoice.mockResolvedValue(null);
    completeTutorSession.mockResolvedValue({ session_id: "TS-6301", completed: true });
    submitTutorTurn.mockResolvedValue(turn());
  });

  it("负面断言：无快捷 chips、无「回答/提问」模式切换、无自建 rail（ADR-010 §6 VS1 行）", async () => {
    const { container, unmount } = mount(experience());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='region-status']")).toBeTruthy());
    expect(container.querySelector(".tutor-learn-quick-asks")).toBeNull();
    expect(container.querySelector("[data-testid='tutor-quick-ask-lost']")).toBeNull();
    expect(container.querySelector("[data-testid='tutor-quick-ask-rephrase']")).toBeNull();
    expect(container.querySelector("[data-testid='tutor-quick-ask-hint']")).toBeNull();
    expect(container.querySelector(".tutor-learn-composer-mode")).toBeNull();
    expect(container.querySelector(".tutor-learn-rail")).toBeNull();
    expect(container.querySelector("[aria-label='发言区']")).toBeNull();
    // canonical Coach 面在场（topic-coach-panel + 拍点/标题头）。
    expect(container.querySelector(".topic-coach-panel")).toBeTruthy();
    expect(container.querySelector("[data-testid='coach-progress']")!.textContent).toContain("教学拍点 1/3");
    expect(container.querySelector("[data-testid='coach-title']")!.textContent).toContain("第1小问");
    unmount();
  });

  it("Panel canonical composer 提问：学生条目带（问）前缀进 thread，老师回答同通道", async () => {
    const { container, unmount } = mount(experience());
    await vi.waitFor(() => expect(container.querySelector("[data-testid='region-status']")).toBeTruthy());
    submitTutorTurn.mockResolvedValue(turn({
      voice: [{ action_id: "v-1", text: "我们换一个角度看这两个三角形。", interruptible: true }],
    }));

    await vi.waitFor(() => expect(container.querySelector(".topic-coach-question input")).toBeTruthy());
    const composer = container.querySelector<HTMLInputElement>(".topic-coach-question input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(composer!, "能换一种说法再解释一下这一步吗？");
      composer!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("button[aria-label='发送问题']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(submitTutorTurn).toHaveBeenCalledTimes(1);
    expect(submitTutorTurn.mock.calls[0][3]).toEqual({
      input_kind: "question_asked",
      text: "能换一种说法再解释一下这一步吗？",
    });
    await vi.waitFor(() => {
      expect(container.querySelector("[aria-label='答疑对话']")!.textContent).toContain("（问）能换一种说法再解释一下这一步吗？");
    });
    await vi.waitFor(() => {
      expect(container.querySelector("[aria-label='答疑对话']")!.textContent).toContain("我们换一个角度看这两个三角形。");
    });
    unmount();
  });
});
