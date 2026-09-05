/**
 * F7 Step 7：ActionRuntimeFrame 的 canonical 板书槽与 tutor 模式零媒体创建。
 *
 * - boardSurface（tutor 模式 canonical V6 槽）优先于 boardView/内部投影——
 *   共享 SolutionBoardViewSurface 渲染快照 student_workspace_view.solution_board，
 *   data-board=canonical；
 * - legacyMediaDisabled（canonical tutor 模式）：Frame 零媒体对象创建——
 *   不 new MediaSessionController/NarrationController（媒体实例唯一属主 =
 *   外层 PresentationRuntime）；legacy 模式仍创建（行为零改动）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionPlanResponse } from "../../../../shared/actionRuntime";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../api/client", () => ({
  api: {
    checkpointAction: vi.fn(),
    evaluateAction: vi.fn(),
    askActionCoach: vi.fn(),
    conductActionCoach: vi.fn(),
    synthesizeActionSpeech: vi.fn().mockResolvedValue({ audioUrl: "https://example/t.mp3" }),
    streamActionSpeech: vi.fn().mockResolvedValue({ audioUrl: "https://example/t.mp3" }),
    reportVoiceTelemetry: vi.fn().mockResolvedValue({ accepted: true }),
  },
}));
vi.mock("../../geometry/react/GeometryCanvas", () => ({
  GeometryCanvasSurface: () => <div data-testid="geometry-canvas-stub" />,
}));

const mediaInstances = vi.hoisted(() => ({ count: 0 }));
const narrationInstances = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../presentation/audio/MediaSessionController", () => ({
  MediaSessionController: class {
    constructor() { mediaInstances.count += 1; }
    subscribe() { return () => undefined; }
    subscribePlaybackEvents() { return () => undefined; }
    getState() { return { status: "idle" }; }
    currentGeneration() { return 0; }
    stop() {}
    dispose() {}
    replay() { return Promise.resolve(0); }
    playUrl() { return 0; }
    release() {}
    acquire() { return () => undefined; }
    acquireCapture() { return { release: () => undefined }; }
  },
}));
vi.mock("../../presentation/narration/NarrationController", () => ({
  NarrationController: class {
    constructor() { narrationInstances.count += 1; }
    enter = vi.fn(async () => undefined);
    replay = vi.fn(async () => 0);
    stop = vi.fn();
    has = vi.fn(() => true);
  },
  clearNarrationCacheForTests: () => undefined,
}));

const { ActionRuntimeFrame } = await import("../../presentation/runtime/ActionRuntimeFrame");
const { SolutionBoardViewSurface } = await import("../../presentation/canonicalView/SolutionBoardViewSurface");

/** 单 action（enter-text）的 tutor workspace 计划（同 tutorTransport 夹具形态）。 */
function tutorWorkspaceResponse(): ActionPlanResponse {
  return {
    sessionId: "TS-7001",
    plan: {
      planVersion: 5,
      exerciseId: "tutor:TP-TST-921:tp:TP-TST-921:1:enter-text",
      revision: 1,
      mode: "assessment",
      metadata: { taskId: "task-tutor-921", title: "智能一对一", promptLatex: "如图，AB \\parallel CD。", skillTags: [] },
      world: { revision: 1 },
      coach: { profileId: "tutor-workspace-v1", displayName: "一对一老师", avatarId: "school", tone: "supportive" },
      actions: [{
        actionId: "tp:TP-TST-921:1:enter-text",
        sourceStepId: "S3",
        kind: "enter-text",
        version: 1,
        title: "本题结论",
        instruction: "根据前面的推理，写出本题的最终结论。",
        input: { placeholder: "写出本题结论" },
        capabilities: ["agent:set-answer", "agent:back", "agent:clear"],
        answerSlots: [{ id: "value", label: "本题结论", kind: "text", required: true, placeholder: "写出本题结论" }],
        validationPolicy: "server-authoritative",
        submitOnComplete: true,
      }],
      currentActionId: "tp:TP-TST-921:1:enter-text",
      completedActionIds: [],
      runtimeCapabilities: {
        practiceValidation: "server-authoritative",
        trainingSync: "local-only",
        narrationTransport: "url",
        coachTurnTransport: "request-response",
        liveCoach: false,
      },
    },
  };
}

/** canonical 板书面（= 快照 student_workspace_view.solution_board 形态）。 */
const canonicalBoard = {
  mode: "building" as const,
  groups: [{
    group_id: "PG-01",
    title: "板书",
    entries: [
      { entry_id: "BE-301", kind: "derivation" as const, content: "\\triangle AOB \\sim \\triangle DOC", state: "visible" as const },
    ],
  }],
};

function mount(props: Parameters<typeof ActionRuntimeFrame>[0]): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  void act(() => root.render(<ActionRuntimeFrame {...props} />));
  return { container, unmount: () => { void act(() => root.unmount()); container.remove(); } };
}

describe("ActionRuntimeFrame boardSurface 槽（F7 Step 7）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mediaInstances.count = 0;
    narrationInstances.count = 0;
  });

  it("boardSurface 优先：canonical 板书渲染共享 SolutionBoardViewSurface（data-board=canonical）", () => {
    const { container, unmount } = mount({
      response: tutorWorkspaceResponse(),
      transport: { submitEvidence: vi.fn() },
      railContent: <aside data-testid="tutor-rail">tutor rail</aside>,
      boardSurface: <SolutionBoardViewSurface board={canonicalBoard} />,
      legacyMediaDisabled: true,
    });
    const frame = container.querySelector('[data-testid="action-runtime-workspace"]')!;
    expect(frame.getAttribute("data-board")).toBe("canonical");
    const board = container.querySelector('[data-testid="region-solution-board"]')!;
    expect(board.getAttribute("data-board-mode")).toBe("building");
    expect(board.querySelector('[data-entry-id="BE-301"]')!.getAttribute("data-entry-kind")).toBe("derivation");
    unmount();
  });

  it("canonical tutor 模式零媒体创建：不 new MediaSessionController/NarrationController", () => {
    const { unmount } = mount({
      response: tutorWorkspaceResponse(),
      transport: { submitEvidence: vi.fn() },
      railContent: <aside data-testid="tutor-rail">tutor rail</aside>,
      boardSurface: <SolutionBoardViewSurface board={canonicalBoard} />,
      legacyMediaDisabled: true,
    });
    expect(mediaInstances.count).toBe(0);
    expect(narrationInstances.count).toBe(0);
    unmount();
  });

  it("legacy 模式（legacyMediaDisabled 缺省）仍创建媒体实例——行为零改动", () => {
    const { unmount } = mount({
      response: tutorWorkspaceResponse(),
      transport: { submitEvidence: vi.fn() },
      railContent: <aside data-testid="tutor-rail">tutor rail</aside>,
    });
    expect(mediaInstances.count).toBeGreaterThan(0);
    unmount();
  });
});
