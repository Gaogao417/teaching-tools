/**
 * F7 Step 7（复验 P2-6：PLAN Step 7 操作段键盘证据的具体测试落点）：
 * GeometryCanvasSurface 键盘可达——Tab 聚焦画布 → 方向键在 enabled 实体间
 * 移动 → Enter/Space 选中，与 pointer 命中**同一** onClickEntity 通道
 * （ActionRuntimeFrame 内即 OBJECT.SELECTED——不另建交互通道）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BoardCallbacks, BoardHandles } from "../react/jsxgraph-board";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../react/jsxgraph-board", () => ({
  mountGeometryBoard: vi.fn((_container: HTMLDivElement, _model: unknown, callbacks: BoardCallbacks): BoardHandles => ({
    board: {} as never,
    getPointer: () => null,
    render: vi.fn(),
    destroy: vi.fn(),
  })),
}));

const { GeometryCanvasSurface } = await import("../react/GeometryCanvas");
const { GeometryModel } = await import("../domain/model");
type GeometryModel = InstanceType<typeof GeometryModel>;

function model(): GeometryModel {
  return new GeometryModel({
    points: [
      { id: "A", x: 1, y: 4 },
      { id: "B", x: -2, y: 0 },
    ],
    lines: [{ id: "seg-AB", kind: "segment", from: "A", to: "B" }],
  });
}

function view(enabledIds: string[]) {
  return {
    prompt: "选择对象",
    entities: {
      A: { id: "A", kind: "point" as const, enabled: enabledIds.includes("A"), expected: false, visualState: "idle" as const },
      B: { id: "B", kind: "point" as const, enabled: enabledIds.includes("B"), expected: false, visualState: "idle" as const },
      "seg-AB": { id: "seg-AB", kind: "line" as const, enabled: enabledIds.includes("seg-AB"), expected: false, visualState: "idle" as const },
    },
    selected: [],
    cursor: "default" as const,
    canCancel: false,
    canGoBack: false,
  };
}

let container: HTMLDivElement | null = null;
let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

function keyDown(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("GeometryCanvasSurface 键盘可达（F7 Step 7）", () => {
  it("Enter/Space 与方向键遍历都经同一 onClickEntity 通道发实体引用", () => {
    const onClickEntity = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<GeometryCanvasSurface model={model()} view={view(["A", "B", "seg-AB"])} onClickEntity={onClickEntity} modelVersion={1} />));
    const surface = container.querySelector<HTMLDivElement>(".geometry-canvas")!;
    expect(surface.getAttribute("tabindex")).toBe("0");
    // 方向键在 enabled 实体间移动（-1 起步：首键 → 第一个实体 A）。
    keyDown(surface, "ArrowRight");
    expect(surface.getAttribute("data-keyboard-focus-id")).toBe("A");
    keyDown(surface, "ArrowRight");
    expect(surface.getAttribute("data-keyboard-focus-id")).toBe("B");
    keyDown(surface, "Enter");
    expect(onClickEntity).toHaveBeenCalledWith({ kind: "point", id: "B" });
    // Space 同通道（焦点仍为 B）。
    keyDown(surface, " ");
    expect(onClickEntity).toHaveBeenLastCalledWith({ kind: "point", id: "B" });
    // ArrowLeft 从 B 回到 A；再左回绕到 seg-AB → Enter 选中。
    keyDown(surface, "ArrowLeft");
    expect(surface.getAttribute("data-keyboard-focus-id")).toBe("A");
    keyDown(surface, "ArrowLeft");
    expect(surface.getAttribute("data-keyboard-focus-id")).toBe("seg-AB");
    keyDown(surface, "Enter");
    expect(onClickEntity).toHaveBeenLastCalledWith({ kind: "line", id: "seg-AB" });
    expect(onClickEntity).toHaveBeenCalledTimes(3);
  });

  it("无 enabled 实体（讲解/完成只读）：不进 Tab 序、按键零事件", () => {
    const onClickEntity = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<GeometryCanvasSurface model={model()} view={view([])} onClickEntity={onClickEntity} modelVersion={1} />));
    const surface = container.querySelector<HTMLDivElement>(".geometry-canvas")!;
    expect(surface.getAttribute("tabindex")).toBeNull();
    keyDown(surface, "Enter");
    expect(onClickEntity).not.toHaveBeenCalled();
  });
});
