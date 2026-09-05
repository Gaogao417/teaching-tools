/**
 * fe-prep（2026-08-28）：canonical view/v1 renderer 的正例渲染 + aria/
 * keyboard 断言。输入 = G1 冻结的 canonical fixtures（import.meta.glob 只读
 * 加载，与 harness 页同机制）+ 由正例派生的 schema-valid 变体（覆盖 7 个
 * participation kind、只读 review、inquiry return point 等 contract 分支）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoachPanelViewSurface } from "../CoachPanelViewSurface";
import { MainlineParticipationSurface } from "../MainlineParticipationSurface";
import { parseCoachPanelView, parseStudentWorkspaceView } from "../parseCanonicalView";
import { SolutionBoardViewSurface } from "../SolutionBoardViewSurface";
import { StudentWorkspaceViewSurface, type StudentWorkspaceViewSurfaceProps } from "../StudentWorkspaceViewSurface";
import { parseRenderGeometryV1 } from "../renderGeometry";
import type { CoachPanelViewV1, MainlineParticipationKind, StudentWorkspaceViewV1 } from "../canonicalViewTypes";
import type { TopicGeometryModel } from "../../../../../shared/topicPractice";

// F7 Step 7：production Canvas 经 jsxgraph-board 挂载（jsdom 不跑真实
// JSXGraph——与 GeometryCanvas.callbacks.test 同纪律：捕获回调/模型断言）。
const boardHarness = vi.hoisted(() => ({
  mountedModels: [] as unknown[],
  callbacks: undefined as unknown,
  render: vi.fn(),
  destroy: vi.fn(),
  reset() {
    this.mountedModels = [];
    this.callbacks = undefined;
    this.render.mockClear();
    this.destroy.mockClear();
  },
}));

vi.mock("../../../geometry/react/jsxgraph-board", () => ({
  mountGeometryBoard: vi.fn((_container: HTMLDivElement, model: unknown, callbacks: unknown) => {
    boardHarness.mountedModels.push(model);
    boardHarness.callbacks = callbacks;
    return {
      board: {} as never,
      getPointer: () => null,
      render: boardHarness.render,
      destroy: boardHarness.destroy,
    };
  }),
}));

/** commitSignal 注入面（PresentationRuntime commitPort 生产接线）。 */
function commitSignalHarness() {
  const unregister = vi.fn();
  const notifyRealCommitted = vi.fn();
  const registerRealCommitSource = vi.fn(() => unregister);
  return {
    signal: { registerRealCommitSource, notifyRealCommitted },
    registerRealCommitSource,
    notifyRealCommitted,
    unregister,
  };
}

/** 排空 rAF×2 / setTimeout(0) 结算链（jsdom rAF 可用与否两路径都覆盖）。 */
async function drainSettle(ms = 60): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** 与 view/v1 正例同 id 宇宙的 student-safe 组合几何（SVG 坐标系，Y 向下）。 */
function fixtureGeometry(): TopicGeometryModel {
  return {
    viewBox: { width: 100, height: 100 },
    points: [
      { id: "A", x: 20, y: 30, derived: false },
      { id: "D", x: 80, y: 30, derived: false },
      { id: "B", x: 10, y: 90, derived: false },
      { id: "C", x: 90, y: 90, derived: false },
    ],
    segments: [
      { id: "seg-AD", from: "A", to: "D", derived: false },
      { id: "seg-BC", from: "B", to: "C", derived: false },
    ],
  };
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixtureModules = {
  ...import.meta.glob("../../../../../shared/canonical/fixtures/student-workspace-view.positive.json", { eager: true, import: "default" }),
  ...import.meta.glob("../../../../../shared/canonical/fixtures/coach-panel-view.positive.json", { eager: true, import: "default" }),
} as Record<string, unknown>;

function fixture(name: string): unknown {
  const entry = Object.entries(fixtureModules).find(([key]) => key.endsWith(`/${name}.json`));
  if (!entry) throw new Error(`fixture not loaded: ${name}`);
  return structuredClone(entry[1]);
}

function mustParseWorkspace(input: unknown): StudentWorkspaceViewV1 {
  const result = parseStudentWorkspaceView(input);
  if (!result.ok) throw new Error(`workspace input must stay schema-valid: ${result.issues.join("; ")}`);
  return result.view;
}

function mustParseCoach(input: unknown): CoachPanelViewV1 {
  const result = parseCoachPanelView(input);
  if (!result.ok) throw new Error(`coach input must stay schema-valid: ${result.issues.join("; ")}`);
  return result.view;
}

function parsedWorkspaceVariant(overrides?: (view: StudentWorkspaceViewV1) => unknown): StudentWorkspaceViewV1 {
  const base = mustParseWorkspace(fixture("student-workspace-view.positive"));
  return overrides ? mustParseWorkspace(overrides(base)) : base;
}

function parsedCoachVariant(overrides?: (view: CoachPanelViewV1) => unknown): CoachPanelViewV1 {
  const base = mustParseCoach(fixture("coach-panel-view.positive"));
  return overrides ? mustParseCoach(overrides(base)) : base;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(node: React.ReactNode): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

afterEach(() => {
  const currentRoot = root;
  if (currentRoot) act(() => currentRoot.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("canonical StudentWorkspaceView renderer（view/v1 + F7 Step 7 production Canvas）", () => {
  it("renders the positive fixture: six-region semantics, one revision, explicit no-diagram placeholder (text list deleted)", () => {
    const view = parsedWorkspaceVariant();
    const host = render(<StudentWorkspaceViewSurface view={view} />);
    const frame = host.querySelector('[data-testid="canonical-student-workspace"]')!;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute("data-view-revision")).toBe("6");
    expect(frame.getAttribute("data-session-id")).toBe("TS-4242");
    // region-geometry 由 canonical StudentWorkspaceFrame 提供（唯一 composition owner）
    const geometry = host.querySelector('[data-testid="region-geometry"]')!;
    expect(geometry.getAttribute("aria-label")).toBe("几何画布");
    expect(host.querySelector('[data-testid="region-solution-board"]')).toBeTruthy();
    // PLAN Step 7：文字列表已删除——无 geometry 输入时渲染明确占位，不得出现元素清单。
    expect(host.querySelector(".geometry-canvas")).toBeNull();
    expect(host.querySelectorAll("[data-element-id]").length).toBe(0);
    expect(host.querySelector(".canonical-workspace-canvas")!.textContent).toContain("本题没有图示");
    // Board：同一 View 的 building 模式；条目内容与尝试摘要可见（共享 canonical 渲染面）
    const board = host.querySelector('[data-testid="region-solution-board"]')!;
    expect(board.getAttribute("data-board-mode")).toBe("building");
    expect(board.getAttribute("aria-label")).toBe("解题板书");
    expect(board.textContent).toContain("AD/AB = DE/BC");
    expect(board.textContent).toContain("学生已写出左边比例");
    expect(host.querySelector('[data-entry-id="BE-02"]')!.getAttribute("data-entry-state")).toBe("active");
  });

  it("renders the production GeometryCanvas from render.geometry（Y 翻折 + View highlight 映射 + 只读实体）", () => {
    const view = parsedWorkspaceVariant();
    const geometry = fixtureGeometry();
    const host = render(<StudentWorkspaceViewSurface view={view} geometry={geometry} />);
    expect(host.querySelector(".geometry-canvas")).toBeTruthy();
    expect(boardHarness.mountedModels.length).toBe(1);
    const model = boardHarness.mountedModels[0] as { getPoint(id: string): { x: number; y: number } | undefined; getLine(id: string): unknown };
    // buildGeometryModel 的 SVG→math Y 翻折（viewBox.height - svgY）
    expect(model.getPoint("A")).toMatchObject({ x: 20, y: 70 });
    expect(model.getPoint("B")).toMatchObject({ x: 10, y: 10 });
    expect(model.getLine("seg-AD")).toBeTruthy();
    // InteractionView 来自 canonical View：highlighted→selected（display-only）、
    // 其余 idle、实体 enabled=false（讲解/完成只读——学生操作走 ActionRuntimeFrame）。
    const entities = (boardHarness.callbacks as { getEntities(): Record<string, { visualState: string; enabled: boolean; kind: string }> }).getEntities();
    expect(entities["seg-AD"].visualState).toBe("selected");
    expect(entities["seg-BC"].visualState).toBe("idle");
    expect(entities["A"].visualState).toBe("idle");
    expect(Object.values(entities).every((entity) => entity.enabled === false)).toBe(true);
  });

  it("renders review/readonly without second board truth or operable canvas", () => {
    const view = parsedWorkspaceVariant((base) => ({
      ...base,
      canvas: { ...base.canvas, interaction_enabled: false },
      solution_board: { ...base.solution_board, mode: "review" },
    }));
    const host = render(<StudentWorkspaceViewSurface view={view} geometry={fixtureGeometry()} />);
    const board = host.querySelector('[data-testid="region-solution-board"]')!;
    expect(board.getAttribute("data-board-mode")).toBe("review");
    expect(board.getAttribute("aria-label")).toBe("解题板书（回顾）");
    expect(board.textContent).toContain("只读阅读模式");
    const canvas = host.querySelector(".canonical-workspace-canvas")!;
    expect(canvas.getAttribute("data-interaction-enabled")).toBe("false");
    expect(canvas.getAttribute("aria-readonly")).toBe("true");
    expect(canvas.textContent).toContain("只读画布");
  });

  it("renders an explicit empty board surface without changing the top-level owner", () => {
    const view = parsedWorkspaceVariant((base) => ({
      ...base,
      solution_board: { mode: "building", groups: [] },
    }));
    const host = render(<StudentWorkspaceViewSurface view={view} />);
    const board = host.querySelector('[data-testid="region-solution-board"]')!;
    expect(board.className).toContain("is-empty");
    expect(board.textContent).toContain("板书还没有开始");
    expect(host.querySelector('[data-testid="canonical-student-workspace"]')).toBeTruthy();
  });
});

describe("SolutionBoardViewSurface（共享 canonical Board 渲染面）", () => {
  it("is the same renderer consumed by the workspace surface（groups/entries/MathText 语义）", () => {
    const view = parsedWorkspaceVariant();
    const host = render(<SolutionBoardViewSurface board={view.solution_board} />);
    const board = host.querySelector('[data-testid="region-solution-board"]')!;
    expect(board.getAttribute("data-board-mode")).toBe("building");
    expect(host.querySelector('[data-entry-id="BE-01"]')!.getAttribute("data-entry-kind")).toBe("statement");
    expect(board.textContent).toContain("AD/AB = DE/BC");
  });
});

describe("parseRenderGeometryV1（render.geometry → production Canvas 输入，零 cast）", () => {
  it("null → undefined；合法 record → TopicGeometryModel；结构非法 → undefined", () => {
    expect(parseRenderGeometryV1(null)).toBeUndefined();
    const valid = parseRenderGeometryV1(fixtureGeometry() as unknown as Record<string, unknown>);
    expect(valid).toBeDefined();
    expect(valid!.points.map((point) => point.id)).toEqual(["A", "D", "B", "C"]);
    expect(valid!.segments.length).toBe(2);
    expect(parseRenderGeometryV1({ points: [], segments: [] })).toBeUndefined();
    expect(parseRenderGeometryV1({ viewBox: { width: 100, height: 100 }, points: [{ id: "A", x: 1, y: "bad" }], segments: [] })).toBeUndefined();
    expect(parseRenderGeometryV1({ viewBox: { width: 100, height: 100 }, points: [{ id: "A", x: 1, y: 2 }], segments: [{ id: "s", from: "A", to: "MISSING" }] })).toBeDefined();
  });
});

describe("Workspace 真实 commit 信号（F7 Step 7：production Canvas + Board reveal 双结算）", () => {
  beforeEach(() => {
    boardHarness.reset();
  });

  it("registers the real commit source on mount and unregisters on unmount", () => {
    const view = parsedWorkspaceVariant();
    const harness = commitSignalHarness();
    const host = render(<StudentWorkspaceViewSurface view={view} geometry={fixtureGeometry()} commitSignal={harness.signal} />);
    expect(harness.registerRealCommitSource).toHaveBeenCalledTimes(1);
    act(() => root!.unmount());
    expect(harness.unregister).toHaveBeenCalledTimes(1);
    void host;
  });

  it("notifies once per revision only after canvas post-paint ∧ board settle（重复渲染不重复通知）", async () => {
    const view = parsedWorkspaceVariant();
    const harness = commitSignalHarness();
    render(<StudentWorkspaceViewSurface view={view} geometry={fixtureGeometry()} commitSignal={harness.signal} />);
    await drainSettle();
    expect(harness.registerRealCommitSource).toHaveBeenCalledTimes(1);
    expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(1);
    expect(harness.notifyRealCommitted).toHaveBeenCalledWith({ sessionId: "TS-4242", revision: 6 });
    // 同 revision 重渲染（新对象同值）：不重复通知。
    const sameRevision = parsedWorkspaceVariant();
    act(() => root!.render(<StudentWorkspaceViewSurface view={sameRevision} geometry={fixtureGeometry()} commitSignal={harness.signal} />));
    await drainSettle();
    expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(1);
    // revision 7 + 新板书条目：board 走 paint 结算（jsdom 无 animate）→ 再通知一次。
    const nextView = parsedWorkspaceVariant((base) => ({
      ...base,
      revision: 7,
      solution_board: {
        mode: "building",
        groups: [...base.solution_board.groups, { group_id: "PG-02", title: "续", entries: [{ entry_id: "BE-03", kind: "conclusion", content: "BE=\\dfrac{16}{5}", state: "visible" }] }],
      },
    }));
    act(() => root!.render(<StudentWorkspaceViewSurface view={nextView} geometry={fixtureGeometry()} commitSignal={harness.signal} />));
    await drainSettle();
    expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(2);
    expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith({ sessionId: "TS-4242", revision: 7 });
    // 跨会话同号 revision 不被去重键误抑制（结算键绑 session+revision）。
    const otherSession = parsedWorkspaceVariant((base) => ({ ...base, session_id: "TS-4243" }));
    act(() => root!.render(<StudentWorkspaceViewSurface view={otherSession} geometry={fixtureGeometry()} commitSignal={harness.signal} />));
    await drainSettle();
    expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith({ sessionId: "TS-4243", revision: 6 });
    expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(3);
  });

  it("waits for the new-entry reveal animation before settling（animate 只作用于新增条目）", async () => {
    const animateSpy = vi.fn((_keyframes: Keyframe[], _options: unknown) => ({ finished: Promise.resolve() }));
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animateSpy;
    try {
      const view = parsedWorkspaceVariant();
      const harness = commitSignalHarness();
      render(<StudentWorkspaceViewSurface view={view} geometry={fixtureGeometry()} commitSignal={harness.signal} />);
      await drainSettle();
      expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(1);
      expect(animateSpy).not.toHaveBeenCalled();
      const nextView = parsedWorkspaceVariant((base) => ({
        ...base,
        revision: 7,
        solution_board: {
          mode: "building",
          groups: [...base.solution_board.groups, { group_id: "PG-02", title: "续", entries: [{ entry_id: "BE-03", kind: "conclusion", content: "BE=\\dfrac{16}{5}", state: "visible" }] }],
        },
      }));
      act(() => root!.render(<StudentWorkspaceViewSurface view={nextView} geometry={fixtureGeometry()} commitSignal={harness.signal} />));
      await drainSettle();
      // 只有新增条目 BE-03 播放 reveal；既有 BE-01/BE-02 不重复。
      expect(animateSpy).toHaveBeenCalledTimes(1);
      expect(animateSpy.mock.calls[0] && (animateSpy.mock.calls[0][0] as unknown)).toBeDefined();
      expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith({ sessionId: "TS-4242", revision: 7 });
    } finally {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    }
  });
});

describe("canonical MainlineParticipation renderer（7 受控 kind）", () => {
  const participationFor = (kind: MainlineParticipationKind): StudentWorkspaceViewV1["participation"] => {
    const needsGate = kind === "answer_input" || kind === "workspace_input" || kind === "confirm_input" || kind === "continue_input";
    return {
      kind,
      ...(needsGate ? { gate_id: "GT-01" } : {}),
      ...(kind === "workspace_input" ? { action_id: "WSA-20260827-0001" } : {}),
      ...(kind === "temporarily_paused_for_inquiry" ? { return_checkpoint_id: "BT-03" } : {}),
    };
  };

  it.each<MainlineParticipationKind>([
    "listen_only",
    "answer_input",
    "workspace_input",
    "confirm_input",
    "continue_input",
    "temporarily_paused_for_inquiry",
    "read_only_completed",
  ])("renders exactly one typed mainline affordance for kind=%s", (kind) => {
    const host = render(<MainlineParticipationSurface participation={participationFor(kind)} />);
    const region = host.querySelector('[data-testid="region-participation"]')!;
    expect(region.getAttribute("data-participation-kind")).toBe(kind);
    expect(region.getAttribute("aria-label")).toBe("主线参与");
    const inputs = region.querySelectorAll("input");
    const buttons = region.querySelectorAll("button");
    if (kind === "answer_input") {
      expect(inputs.length).toBe(1);
      expect(inputs[0].getAttribute("aria-label")).toBe("回答输入");
      expect(buttons.length).toBe(1);
    } else if (kind === "confirm_input" || kind === "continue_input") {
      expect(inputs.length).toBe(0);
      expect(buttons.length).toBe(1);
    } else if (kind === "workspace_input") {
      expect(inputs.length).toBe(0);
      expect(buttons.length).toBe(0);
      expect(region.textContent).toContain("WSA-20260827-0001");
    } else if (kind === "temporarily_paused_for_inquiry") {
      expect(inputs.length).toBe(0);
      expect(buttons.length).toBe(0);
      expect(region.textContent).toContain("返回主线检查点 BT-03");
    } else {
      // listen_only / read_only_completed：无任何输入控件
      expect(inputs.length).toBe(0);
      expect(buttons.length).toBe(0);
    }
  });

  it("submits the typed answer through the form submit path (keyboard Enter equivalent)", () => {
    const submitted = vi.fn();
    const host = render(<MainlineParticipationSurface participation={participationFor("answer_input")} onSubmitAnswer={submitted} />);
    const input = host.querySelector("input")!;
    const submit = host.querySelector<HTMLButtonElement>('[data-testid="canonical-submit-answer"]')!;
    expect(submit.disabled).toBe(true);
    setInputValue(input, "先证相似，再用比例");
    expect(submit.disabled).toBe(false);
    const form = host.querySelector("form")!;
    act(() => form.requestSubmit());
    expect(submitted).toHaveBeenCalledWith("先证相似，再用比例");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("keeps gate identity visible for gate-scoped kinds (sr-only)", () => {
    const host = render(<MainlineParticipationSurface participation={participationFor("confirm_input")} />);
    const region = host.querySelector('[data-testid="region-participation"]')!;
    expect(region.getAttribute("data-gate-id")).toBe("GT-01");
    expect(region.querySelector(".sr-only")!.textContent).toContain("GT-01");
  });
});

/** React 受控输入：原生 setter + input 事件（jsdom 无 UserEvent）。 */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("canonical CoachPanelView renderer（ADR-010 结构）", () => {
  it("renders typed mainline status (never generic) with focus cue, live tutor turn and transcript", () => {
    const view = parsedCoachVariant();
    const host = render(<CoachPanelViewSurface view={view} />);
    const panel = host.querySelector('[data-testid="canonical-coach-panel"]')!;
    expect(panel.getAttribute("aria-label")).toBe("陪练老师");
    expect(panel.getAttribute("data-view-revision")).toBe("6");
    expect(panel.getAttribute("data-mainline-kind")).toBe("awaiting_workspace");
    const status = host.querySelector('[data-testid="region-status"]')!;
    expect(status.getAttribute("aria-label")).toBe("学习状态");
    expect(status.textContent).toContain("等待你在画布上操作");
    expect(status.textContent).toContain("GT-02");
    expect(status.textContent).toContain("第 1 小问 · 正在标出已知线段");
    const focusCue = host.querySelector('[data-testid="coach-focus-cue"]')!;
    expect(focusCue.getAttribute("aria-label")).toBe("当前教学关注点");
    expect(focusCue.textContent).toContain("在画布上标出你已知长度的线段");
    const turn = host.querySelector('[data-testid="coach-current-turn"]')!;
    expect(turn.getAttribute("role")).toBe("status");
    expect(turn.getAttribute("aria-live")).toBe("polite");
    expect(turn.textContent).toContain("把已知长度的线段在图上标出来。");
    const transcript = host.querySelector('[data-testid="coach-transcript"]')!;
    expect(transcript.getAttribute("aria-label")).toBe("答疑对话");
    expect(transcript.querySelectorAll(".topic-coach-turn").length).toBe(2);
    expect(transcript.querySelector('[data-turn-id="DT-20260827-0002"]')!.className).toContain("is-student");
    expect(host.querySelector<HTMLButtonElement>('[data-testid="coach-replay"]')!.disabled).toBe(false);
    const assistance = host.querySelector('[data-testid="coach-assistance"]')!;
    expect(assistance.getAttribute("role")).toBe("group");
    expect(assistance.querySelectorAll("button").length).toBe(3);
  });

  it("disables replay when replay_available=false and hides assistance when unavailable", () => {
    const view = parsedCoachVariant((base) => ({
      ...base,
      replay_available: false,
      assistance_available: false,
    }));
    const host = render(<CoachPanelViewSurface view={view} />);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="coach-replay"]')!.disabled).toBe(true);
    expect(host.querySelector('[data-testid="coach-assistance"]')).toBeNull();
  });

  it("shows the explicit inquiry return point while inquiry is active", () => {
    const view = parsedCoachVariant((base) => ({
      ...base,
      inquiry: { kind: "clarifying", inquiry_id: "IQ-20260828-0001", return_checkpoint_id: "BT-05" },
    }));
    const host = render(<CoachPanelViewSurface view={view} />);
    const inquiry = host.querySelector('[data-testid="coach-inquiry"]')!;
    expect(inquiry.getAttribute("data-return-checkpoint-id")).toBe("BT-05");
    expect(inquiry.textContent).toContain("返回主线检查点");
    expect(inquiry.textContent).toContain("BT-05");
  });

  it("renders completed mainline as read-only: status without assistance entries", () => {
    const view = parsedCoachVariant((base) => ({
      ...base,
      mainline: { kind: "completed" },
    }));
    const host = render(<CoachPanelViewSurface view={view} />);
    expect(host.querySelector('[data-testid="coach-mainline-status"]')!.textContent).toContain("本小节完成");
    expect(host.querySelector('[data-testid="coach-assistance"]')).toBeNull();
  });

  it("exposes recovery mainline with its checkpoint id", () => {
    const view = parsedCoachVariant((base) => ({
      ...base,
      mainline: { kind: "recovering", checkpoint_id: "BT-02" },
    }));
    const host = render(<CoachPanelViewSurface view={view} />);
    expect(host.querySelector('[data-testid="coach-mainline-status"]')!.textContent).toContain("正在恢复会话");
    expect(host.querySelector('[data-testid="coach-mainline-status"]')!.textContent).toContain("BT-02");
  });
});
