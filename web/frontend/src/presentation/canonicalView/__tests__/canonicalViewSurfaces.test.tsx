/**
 * fe-prep（2026-08-28）：canonical view/v1 renderer 的正例渲染 + aria/
 * keyboard 断言。输入 = G1 冻结的 canonical fixtures（import.meta.glob 只读
 * 加载，与 harness 页同机制）+ 由正例派生的 schema-valid 变体（覆盖 7 个
 * participation kind、只读 review、inquiry return point 等 contract 分支）。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CoachPanelViewSurface } from "../CoachPanelViewSurface";
import { MainlineParticipationSurface } from "../MainlineParticipationSurface";
import { parseCoachPanelView, parseStudentWorkspaceView } from "../parseCanonicalView";
import { StudentWorkspaceViewSurface } from "../StudentWorkspaceViewSurface";
import type { CoachPanelViewV1, MainlineParticipationKind, StudentWorkspaceViewV1 } from "../canonicalViewTypes";

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

describe("canonical StudentWorkspaceView renderer（view/v1）", () => {
  it("renders the positive fixture with six-region semantics and one workspace revision", () => {
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
    // 画布元素：student-safe 语义摘要，逐元素锚定
    expect(host.querySelector(".canonical-canvas-surface")!.getAttribute("data-element-count")).toBe("3");
    expect(host.querySelectorAll("[data-element-id]").length).toBe(3);
    expect(host.querySelector('[data-element-id="seg-AD"]')!.getAttribute("data-highlighted")).toBe("true");
    expect(host.querySelector('[data-element-id="label-DE"]')!.getAttribute("data-student-authored")).toBe("true");
    // Board：同一 View 的 building 模式；条目内容与尝试摘要可见
    const board = host.querySelector('[data-testid="region-solution-board"]')!;
    expect(board.getAttribute("data-board-mode")).toBe("building");
    expect(board.getAttribute("aria-label")).toBe("解题板书");
    expect(board.textContent).toContain("AD/AB = DE/BC");
    expect(board.textContent).toContain("学生已写出左边比例");
    expect(host.querySelector('[data-entry-id="BE-02"]')!.getAttribute("data-entry-state")).toBe("active");
  });

  it("renders review/readonly without second board truth or operable canvas", () => {
    const view = parsedWorkspaceVariant((base) => ({
      ...base,
      canvas: { ...base.canvas, interaction_enabled: false },
      solution_board: { ...base.solution_board, mode: "review" },
    }));
    const host = render(<StudentWorkspaceViewSurface view={view} />);
    const board = host.querySelector('[data-testid="region-solution-board"]')!;
    expect(board.getAttribute("data-board-mode")).toBe("review");
    expect(board.getAttribute("aria-label")).toBe("解题板书（回顾）");
    expect(board.textContent).toContain("只读阅读模式");
    const canvas = host.querySelector(".canonical-canvas-surface")!;
    expect(canvas.getAttribute("data-interaction-enabled")).toBe("false");
    expect(canvas.getAttribute("aria-readonly")).toBe("true");
    expect(canvas.textContent).toContain("只读回顾");
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
