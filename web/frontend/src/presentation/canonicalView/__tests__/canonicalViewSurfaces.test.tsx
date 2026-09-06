/**
 * fe-prep（2026-08-28）：canonical view/v1 renderer 的正例渲染 + aria/
 * keyboard 断言。输入 = G1 冻结的 canonical fixtures（import.meta.glob 只读
 * 加载，与 harness 页同机制）+ 由正例派生的 schema-valid 变体（覆盖 7 个
 * participation kind、只读 review、inquiry return point 等 contract 分支）。
 */
import { StrictMode, act } from "react";
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
  const notifyRealSourceActive = vi.fn();
  const registerRealCommitSource = vi.fn(() => unregister);
  return {
    signal: { registerRealCommitSource, notifyRealCommitted, notifyRealSourceActive },
    registerRealCommitSource,
    notifyRealCommitted,
    notifyRealSourceActive,
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

describe("parseRenderGeometryV1 返工负例（P1-4：统一组装/已知字段非法/引用完整/重复 id）", () => {
  const base = () => ({
    viewBox: { width: 100, height: 100 },
    points: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 10, y: 10 }],
    segments: [{ id: "seg-AB", from: "A", to: "B" }],
  });

  it("derivedLines 与 teachingMarks 同时存在：两段都解析并保留（不互相遮蔽）", () => {
    const parsed = parseRenderGeometryV1({
      ...base(),
      derivedLines: [{ id: "dl-1", kind: "parallel-line", through: "A", parallelTo: "seg-AB", derived: true }],
      teachingMarks: [{ id: "m-1", kind: "segment-label", segmentId: "seg-AB", valueLatex: "5", labelKind: "length" }],
    } as unknown as Record<string, unknown>);
    expect(parsed?.derivedLines?.length).toBe(1);
    expect(parsed?.teachingMarks?.length).toBe(1);
  });

  it("derivedLines: [] 不遮蔽 teachingMarks（空段照常组装）", () => {
    const parsed = parseRenderGeometryV1({
      ...base(),
      derivedLines: [],
      teachingMarks: [{ id: "m-1", kind: "emphasis", entityIds: ["A", "seg-AB"] }],
    } as unknown as Record<string, unknown>);
    expect(parsed).toBeDefined();
    expect(parsed?.teachingMarks?.length).toBe(1);
  });

  it("已知字段非法即拒绝：kind 伪造/labelKind 越界/tickCount 非数/derived 非布尔", () => {
    expect(parseRenderGeometryV1({ ...base(), derivedLines: [{ id: "dl", through: "A", parallelTo: "seg-AB" }] } as unknown as Record<string, unknown>)).toBeUndefined();
    expect(parseRenderGeometryV1({ ...base(), teachingMarks: [{ id: "m", kind: "segment-label", segmentId: "seg-AB", valueLatex: "5", labelKind: "wrong" }] } as unknown as Record<string, unknown>)).toBeUndefined();
    expect(parseRenderGeometryV1({ ...base(), teachingMarks: [{ id: "m", kind: "correspondence", segmentIds: ["seg-AB", "seg-AB"], tickCount: "2" }] } as unknown as Record<string, unknown>)).toBeUndefined();
    expect(parseRenderGeometryV1({ ...base(), points: [{ id: "A", x: 0, y: 0, derived: "yes" }] } as unknown as Record<string, unknown>)).toBeUndefined();
    // 完成度审计 P2：derivedLines[].derived 为 false / 缺失 → 拒绝（不静默改写为 true）。
    expect(parseRenderGeometryV1({ ...base(), derivedLines: [{ id: "dl", kind: "parallel-line", through: "A", parallelTo: "seg-AB", derived: false }] } as unknown as Record<string, unknown>)).toBeUndefined();
    expect(parseRenderGeometryV1({ ...base(), derivedLines: [{ id: "dl", kind: "parallel-line", through: "A", parallelTo: "seg-AB" }] } as unknown as Record<string, unknown>)).toBeUndefined();
  });

  it("重复实体 id / 悬空引用（through/segmentId/entityIds）拒绝", () => {
    expect(parseRenderGeometryV1({ ...base(), segments: [{ id: "seg-AB", from: "A", to: "B" }, { id: "seg-AB", from: "A", to: "B" }] } as unknown as Record<string, unknown>)).toBeUndefined();
    expect(parseRenderGeometryV1({ ...base(), derivedLines: [{ id: "dl", kind: "parallel-line", through: "MISSING", parallelTo: "seg-AB", derived: true }] } as unknown as Record<string, unknown>)).toBeUndefined();
    expect(parseRenderGeometryV1({ ...base(), teachingMarks: [{ id: "m", kind: "segment-label", segmentId: "seg-MISSING", valueLatex: "5", labelKind: "length" }] } as unknown as Record<string, unknown>)).toBeUndefined();
    expect(parseRenderGeometryV1({ ...base(), teachingMarks: [{ id: "m", kind: "emphasis", entityIds: ["MISSING"] }] } as unknown as Record<string, unknown>)).toBeUndefined();
  });
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

describe("Workspace 真实 commit 信号——非对称结算/动画失败/StrictMode/快速连改（复验 P1-1/3、P2-5/6）", () => {
  /** 可控 WAAPI 动画：手动 resolve/reject/cancel。 */
  function controllableAnimate() {
    const handles: { finished: Promise<unknown>; cancel: ReturnType<typeof vi.fn>; resolve: () => void; reject: (reason?: unknown) => void }[] = [];
    const animate = vi.fn((_keyframes: Keyframe[], _options: unknown) => {
      let resolve!: () => void;
      let reject!: (reason?: unknown) => void;
      const finished = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
      const cancel = vi.fn(() => { reject(new DOMException("aborted", "AbortError")); });
      handles.push({ finished, cancel, resolve, reject });
      return { finished, cancel };
    });
    return { animate, handles };
  }

  beforeEach(() => {
    boardHarness.reset();
  });

  it("AND 门：canvas 渲染信号已到而 board 动画未完——不通知；动画完成才通知（非对称不误报）", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      const { animate, handles } = controllableAnimate();
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
      const view = parsedWorkspaceVariant();
      const harness = commitSignalHarness();
      render(<StudentWorkspaceViewSurface view={view} geometry={fixtureGeometry()} commitSignal={harness.signal} />);
      // 初始挂载：既有条目不动画（restore 语义）；canvas 信号 1 帧、board 双帧。
      act(() => { vi.advanceTimersByTime(34); });
      expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(1);
      expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "TS-4242", revision: 6 }));
      // revision 7 + 新条目：动画挂起；canvas 信号照常到达 → 不得通知。
      const nextView = parsedWorkspaceVariant((base) => ({
        ...base,
        revision: 7,
        solution_board: { mode: "building", groups: [...base.solution_board.groups, { group_id: "PG-02", title: "续", entries: [{ entry_id: "BE-03", kind: "conclusion", content: "c", state: "visible" }] }] },
      }));
      act(() => root!.render(<StudentWorkspaceViewSurface view={nextView} geometry={fixtureGeometry()} commitSignal={harness.signal} />));
      act(() => { vi.advanceTimersByTime(200); });
      expect(animate).toHaveBeenCalledTimes(1);
      expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(1); // board 未稳定 → 仍只有 revision 6
      // 动画成功完成 → 以最新 revision 结算。
      await act(async () => { handles[0].resolve(); });
      act(() => { vi.advanceTimersByTime(34); });
      expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(2);
      expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "TS-4242", revision: 7 }));
    } finally {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
      vi.useRealTimers();
    }
  });

  it("board 双帧 paint 结算前不通知（canvas 单帧先到也不放行）", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      const view = parsedWorkspaceVariant();
      const harness = commitSignalHarness();
      render(<StudentWorkspaceViewSurface view={view} geometry={fixtureGeometry()} commitSignal={harness.signal} />);
      act(() => { vi.advanceTimersByTime(17); }); // 恰一帧：canvas 到、board 内帧未触发
      expect(harness.notifyRealCommitted).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(17); });
      expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("动画取消/失败不结算（不误报 presented）；卸载取消句柄且迟到结果被忽略", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      const { animate, handles } = controllableAnimate();
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
      const view = parsedWorkspaceVariant();
      const harness = commitSignalHarness();
      render(<StudentWorkspaceViewSurface view={view} geometry={fixtureGeometry()} commitSignal={harness.signal} />);
      act(() => { vi.advanceTimersByTime(34); });
      expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(1);
      const nextView = parsedWorkspaceVariant((base) => ({
        ...base,
        revision: 7,
        solution_board: { mode: "building", groups: [...base.solution_board.groups, { group_id: "PG-02", title: "续", entries: [{ entry_id: "BE-03", kind: "conclusion", content: "c", state: "visible" }] }] },
      }));
      act(() => root!.render(<StudentWorkspaceViewSurface view={nextView} geometry={fixtureGeometry()} commitSignal={harness.signal} />));
      act(() => { vi.advanceTimersByTime(100); });
      // 动画被取消（finished reject）→ revision 7 永不结算（失败执行不误报）。
      await act(async () => { handles[0].reject(); });
      act(() => { vi.advanceTimersByTime(500); });
      expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(1);
      expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "TS-4242", revision: 6 }));
      // 二次复验 P1 语义修正：失败绑定呈现执行（revision 7），不锁定挂载
      // 实例——后续 revision 8（新执行）经 paint 正常结算。
      const thirdView = parsedWorkspaceVariant((base) => ({ ...base, revision: 8 }));
      act(() => root!.render(<StudentWorkspaceViewSurface view={thirdView} geometry={fixtureGeometry()} commitSignal={harness.signal} />));
      act(() => { vi.advanceTimersByTime(200); });
      expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(2);
      expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "TS-4242", revision: 8 }));
      // 失败的 revision 7 从未单独结算。
      expect(harness.notifyRealCommitted.mock.calls.some((call) => call[0]?.revision === 7)).toBe(false);
      act(() => root!.unmount());
      expect(harness.unregister).toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
      vi.useRealTimers();
    }
  });

  it("执行直接替换：同 revision 旧动画取消，迟到完成不结算新执行", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    const { animate, handles } = controllableAnimate();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    try {
      const view = parsedWorkspaceVariant();
      const harness = commitSignalHarness();
      render(<StudentWorkspaceViewSurface view={view} geometry={fixtureGeometry()} commitSignal={harness.signal} />);
      act(() => { vi.advanceTimersByTime(34); });
      const updated = parsedWorkspaceVariant(base => ({ ...base, revision: 7,
        solution_board: { mode: "building", groups: [...base.solution_board.groups,
          { group_id: "PG-09", entries: [{ entry_id: "BE-09", kind: "statement", content: "x", state: "visible" }] }] },
      }));
      const show = (key: string) => act(() => root!.render(<StudentWorkspaceViewSurface
        view={updated} geometry={fixtureGeometry()} commitSignal={harness.signal}
        boardPresentation={{ key, targets: ["BE-09"] }} />));
      show("K1");
      act(() => { vi.advanceTimersByTime(34); });
      show("K2");
      expect(handles[0].cancel).toHaveBeenCalledTimes(1);
      expect(animate).toHaveBeenCalledTimes(2);
      await act(async () => { handles[0].resolve(); });
      act(() => { vi.advanceTimersByTime(34); });
      expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(1);
      await act(async () => { handles[1].resolve(); });
      act(() => { vi.advanceTimersByTime(34); });
      expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith({ sessionId: view.session_id, revision: 7, executionKey: "K2" });
      // A third execution at the already-committed revision must emit its own result.
      show("K3");
      act(() => { vi.advanceTimersByTime(34); });
      expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(2);
      await act(async () => { handles[2].resolve(); });
      act(() => { vi.advanceTimersByTime(34); });
      expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith({ sessionId: view.session_id, revision: 7, executionKey: "K3" });
    } finally {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
      vi.useRealTimers();
    }
  });

  it("StrictMode 重挂载：注册/注销配对，结算仍每键一次", async () => {
    const view = parsedWorkspaceVariant();
    const harness = commitSignalHarness();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const strictRoot = createRoot(container);
    act(() => strictRoot.render(<StrictMode><StudentWorkspaceViewSurface view={view} geometry={fixtureGeometry()} commitSignal={harness.signal} /></StrictMode>));
    expect(harness.registerRealCommitSource.mock.calls.length).toBeGreaterThanOrEqual(1);
    // 完成度审计 P3：标题承诺的「结算每键一次」需真实断言（session+revision
    // 双结算键在 StrictMode 双 effect 下只通知一次）。
    await drainSettle();
    expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(1);
    expect(harness.notifyRealCommitted).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "TS-4242", revision: 6 }));
    act(() => strictRoot.unmount());
    expect(harness.unregister.mock.calls.length).toBe(harness.registerRealCommitSource.mock.calls.length);
    container.remove();
  });

  it("快速连续更新：动画在跑时 revision 被替换——完成后只以最新 revision 结算，不回补中间 revision", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      const { animate, handles } = controllableAnimate();
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
      const view = parsedWorkspaceVariant();
      const harness = commitSignalHarness();
      render(<StudentWorkspaceViewSurface view={view} geometry={fixtureGeometry()} commitSignal={harness.signal} />);
      act(() => { vi.advanceTimersByTime(34); });
      expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "TS-4242", revision: 6 }));
      const view7 = parsedWorkspaceVariant((base) => ({
        ...base,
        revision: 7,
        solution_board: { mode: "building", groups: [...base.solution_board.groups, { group_id: "PG-02", title: "续", entries: [{ entry_id: "BE-03", kind: "conclusion", content: "c", state: "visible" }] }] },
      }));
      act(() => root!.render(<StudentWorkspaceViewSurface view={view7} geometry={fixtureGeometry()} commitSignal={harness.signal} />));
      act(() => { vi.advanceTimersByTime(50); });
      expect(animate).toHaveBeenCalledTimes(1); // BE-03 动画在跑
      const view8 = parsedWorkspaceVariant((base) => ({
        ...base,
        revision: 8,
        solution_board: { mode: "building", groups: [...base.solution_board.groups, { group_id: "PG-02", title: "续", entries: [{ entry_id: "BE-03", kind: "conclusion", content: "c", state: "visible" }] }] },
      }));
      act(() => root!.render(<StudentWorkspaceViewSurface view={view8} geometry={fixtureGeometry()} commitSignal={harness.signal} />));
      act(() => { vi.advanceTimersByTime(50); });
      // revision 8 无新增条目，但 BE-03 动画仍在跑 → 不结算 8。
      expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(1);
      await act(async () => { handles[0].resolve(); });
      act(() => { vi.advanceTimersByTime(34); });
      // 完成后以最新 revision 8 结算一次（revision 7 被替换，不回补）。
      expect(harness.notifyRealCommitted).toHaveBeenCalledTimes(2);
      expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "TS-4242", revision: 8 }));
    } finally {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
      vi.useRealTimers();
    }
  });

  it("三次复验 P1（真实恢复场景）：presentation_only 重呈现同 revision/同条目/新 sequence——失败执行不补报、新执行重播并结算", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      const { animate, handles } = controllableAnimate();
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
      const view = parsedWorkspaceVariant();
      const harness = commitSignalHarness();
      render(<StudentWorkspaceViewSurface view={view} geometry={fixtureGeometry()} commitSignal={harness.signal} />);
      act(() => { vi.advanceTimersByTime(34); });
      expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "TS-4242", revision: 6 }));
      // 执行 K1（rev 7 新条目 BE-03）动画失败。
      const view7 = parsedWorkspaceVariant((base) => ({
        ...base,
        revision: 7,
        solution_board: { mode: "building", groups: [...base.solution_board.groups, { group_id: "PG-02", title: "续", entries: [{ entry_id: "BE-03", kind: "conclusion", content: "c", state: "visible" }] }] },
      }));
      act(() => root!.render(
        <StudentWorkspaceViewSurface view={view7} geometry={fixtureGeometry()} commitSignal={harness.signal}
          boardPresentation={{ key: "TS-4242:PS-0003:2:WSA-bt03-reveal", targets: ["BE-03"] }} />,
      ));
      act(() => { vi.advanceTimersByTime(50); });
      await act(async () => { handles[0].reject(); });
      act(() => { vi.advanceTimersByTime(100); });
      expect(harness.notifyRealCommitted.mock.calls.some((call) => call[0]?.revision === 7)).toBe(false); // K1 不补报
      // retry_recovery 新 sequence：同 rev 7、同条目、执行身份 K2——BE-03
      // 重新播 reveal（presentation_only 恢复不推进 workspace revision）。
      act(() => root!.render(
        <StudentWorkspaceViewSurface view={view7} geometry={fixtureGeometry()} commitSignal={harness.signal}
          boardPresentation={{ key: "TS-4242:PS-0009:0:WSA-bt03-reveal-R", targets: ["BE-03"] }} />,
      ));
      act(() => { vi.advanceTimersByTime(50); });
      expect(animate).toHaveBeenCalledTimes(2); // BE-03 重播
      await act(async () => { handles[1].resolve(); });
      act(() => { vi.advanceTimersByTime(34); });
      expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "TS-4242", revision: 7 }));
    } finally {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
      vi.useRealTimers();
    }
  });

  it("三次复验 P1（组件级复现）：失败后同会话同 revision 重呈现可结算（onSettled(rev) 到达）", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      const { animate, handles } = controllableAnimate();
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
      const onSettled = vi.fn();
      const groupsOf = (ids: string[]) => [{ group_id: "PG-01", title: "板书", entries: ids.map((id) => ({ entry_id: id, kind: "statement" as const, content: "a", state: "visible" as const })) }];
      // 初始板书（无执行上下文；BE-01 按首份投影 restore 语义不播动画）。
      render(<SolutionBoardViewSurface board={{ mode: "building", groups: groupsOf(["BE-01"]) }} revision={7} sessionId="TS-A" onSettled={onSettled} />);
      act(() => { vi.advanceTimersByTime(34); });
      expect(onSettled).toHaveBeenCalledWith(7);
      // 执行 K1 交付新条目 BE-301 → 动画失败 → 该执行零结算。
      const boardK1 = { mode: "building" as const, groups: groupsOf(["BE-01", "BE-301"]) };
      act(() => root!.render(<SolutionBoardViewSurface board={boardK1} revision={7} sessionId="TS-A" execution={{ key: "TS-A:PS-0003:2:WSA-r", targets: ["BE-301"] }} onSettled={onSettled} />));
      act(() => { vi.advanceTimersByTime(50); });
      await act(async () => { handles[0].reject(); });
      act(() => { vi.advanceTimersByTime(100); });
      expect(onSettled).toHaveBeenCalledTimes(1); // 仍只有初始结算——K1 不补报
      // 新 sequence、同 revision、同条目：重播并结算（presentation_only 恢复）。
      act(() => root!.render(<SolutionBoardViewSurface board={boardK1} revision={7} sessionId="TS-A" execution={{ key: "TS-A:PS-0009:0:WSA-r-R", targets: ["BE-301"] }} onSettled={onSettled} />));
      act(() => { vi.advanceTimersByTime(50); });
      expect(animate).toHaveBeenCalledTimes(2);
      await act(async () => { handles[1].resolve(); });
      act(() => { vi.advanceTimersByTime(34); });
      expect(onSettled).toHaveBeenLastCalledWith(7, "TS-A:PS-0009:0:WSA-r-R");
      expect(onSettled).toHaveBeenCalledTimes(2);
    } finally {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
      vi.useRealTimers();
    }
  });

  it("二次复验 P1（组件级复现）：动画失败后新会话首份板书可结算——失败不跨会话继承", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      const { animate, handles } = controllableAnimate();
      (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
      const onSettled = vi.fn();
      const boardA = (extra: string[]) => ({
        mode: "building" as const,
        groups: [{ group_id: "PG-01", title: "板书", entries: [
          { entry_id: "BE-01", kind: "statement" as const, content: "a", state: "visible" as const },
          ...extra.map((id) => ({ entry_id: id, kind: "conclusion" as const, content: "c", state: "visible" as const })),
        ] }],
      });
      render(<SolutionBoardViewSurface board={boardA([])} revision={1} sessionId="TS-A" onSettled={onSettled} />);
      act(() => { vi.advanceTimersByTime(34); });
      expect(onSettled).toHaveBeenCalledWith(1); // 会话 A 首份板书（restore）结算
      // rev 2 新条目动画失败。
      act(() => root!.render(<SolutionBoardViewSurface board={boardA(["BE-03"])} revision={2} sessionId="TS-A" onSettled={onSettled} />));
      act(() => { vi.advanceTimersByTime(50); });
      await act(async () => { handles[0].reject(); });
      act(() => { vi.advanceTimersByTime(100); });
      expect(onSettled.mock.calls.some((call) => call[0] === 2)).toBe(false);
      // 新会话 TS-B 首份板书（同一挂载实例）：生命周期重置，正常结算。
      const boardB = { mode: "building" as const, groups: [{ group_id: "PG-01", title: "板书", entries: [{ entry_id: "BE-99", kind: "statement" as const, content: "b", state: "visible" as const }] }] };
      act(() => root!.render(<SolutionBoardViewSurface board={boardB} revision={1} sessionId="TS-B" onSettled={onSettled} />));
      act(() => { vi.advanceTimersByTime(34); });
      expect(onSettled).toHaveBeenLastCalledWith(1);
      expect(onSettled.mock.calls.filter((call) => call[0] === 1).length).toBe(2); // A 与 B 各一次
      expect(animate).toHaveBeenCalledTimes(1); // 新会话首份 = restore，不播动画
    } finally {
      delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
      vi.useRealTimers();
    }
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
    // 引用完整性：段端点悬空 → 拒绝（返工 P1-4：已知字段非法不静默修正）。
    expect(parseRenderGeometryV1({ viewBox: { width: 100, height: 100 }, points: [{ id: "A", x: 1, y: 2 }], segments: [{ id: "s", from: "A", to: "MISSING" }] })).toBeUndefined();
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
    expect(harness.notifyRealCommitted).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "TS-4242", revision: 6 }));
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
    expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "TS-4242", revision: 7 }));
    // 跨会话同号 revision 不被去重键误抑制（结算键绑 session+revision）。
    const otherSession = parsedWorkspaceVariant((base) => ({ ...base, session_id: "TS-4243" }));
    act(() => root!.render(<StudentWorkspaceViewSurface view={otherSession} geometry={fixtureGeometry()} commitSignal={harness.signal} />));
    await drainSettle();
    expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "TS-4243", revision: 6 }));
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
      expect(harness.notifyRealCommitted).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: "TS-4242", revision: 7 }));
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
