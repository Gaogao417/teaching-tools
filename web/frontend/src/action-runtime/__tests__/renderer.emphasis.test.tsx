import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCanvasEmphasis } from "../../geometry/react/jsxgraph-board";
import type { SolutionBoardView } from "../types";
import { SolutionBoardPanel } from "../react/ActionRuntimeFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("resolveCanvasEmphasis (canvas renderer)", () => {
  it("marks fresh entities and teaching marks on a new key", () => {
    const result = resolveCanvasEmphasis({
      emphasis: { key: "k1", entityIds: ["P", "X"], markIds: ["L1"] },
      teachingMarks: [],
      lastKey: undefined,
    });
    expect(result.fresh).toBe(true);
    expect([...result.pulseEntities]).toEqual(["P", "X"]);
    expect([...result.pulseMarks]).toEqual(["L1"]);
  });

  it("resolves an emphasis-kind mark id to its own entity ids (no independent node)", () => {
    const result = resolveCanvasEmphasis({
      emphasis: { key: "k1", entityIds: [], markIds: ["E1"] },
      teachingMarks: [{ id: "E1", kind: "emphasis", entityIds: ["AB", "CD"] }],
      lastKey: undefined,
    });
    expect(result.fresh).toBe(true);
    expect([...result.pulseEntities]).toEqual(["AB", "CD"]);
    expect([...result.pulseMarks]).toEqual([]);
  });

  it("does not pulse on a re-render with the same key", () => {
    const result = resolveCanvasEmphasis({
      emphasis: { key: "k1", entityIds: ["P"], markIds: [] },
      teachingMarks: [],
      lastKey: "k1",
    });
    expect(result.fresh).toBe(false);
    expect(result.pulseEntities.size).toBe(0);
  });
});

function board(): SolutionBoardView {
  return {
    headingLatex: "\\text{解：}",
    visibleExpressions: [
      { expressionId: "e1", sourceStepId: "s1", latex: "a", isCurrent: false, isComplete: true },
      { expressionId: "e2", sourceStepId: "s2", latex: "b", isCurrent: true, isComplete: false },
      { expressionId: "e3", sourceStepId: "s3", latex: "c", isCurrent: false, isComplete: true },
    ],
  };
}

describe("SolutionBoardPanel emphasis", () => {
  let animateSpy: ReturnType<typeof vi.fn>;
  let originalAnimate: unknown;

  beforeEach(() => {
    animateSpy = vi.fn(() => ({ cancel: () => undefined })) as ReturnType<typeof vi.fn>;
    originalAnimate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animateSpy as unknown as HTMLElement["animate"];
  });
  afterEach(() => {
    HTMLElement.prototype.animate = originalAnimate as HTMLElement["animate"];
  });

  function render(panel: React.ReactElement): { container: HTMLDivElement; root: ReturnType<typeof createRoot> } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(panel));
    return { container, root };
  }

  it("only highlights the targeted expression", () => {
    const { container, root } = render(<SolutionBoardPanel board={board()} emphasis={{ key: "k1", expressionIds: ["e2"] }} />);
    const lines = container.querySelectorAll<HTMLElement>(".solution-board-line");
    expect(lines[1].classList.contains("is-emphasis")).toBe(true);
    expect(lines[1].dataset.emphasisKey).toBe("k1");
    expect(lines[0].classList.contains("is-emphasis")).toBe(false);
    expect(lines[2].classList.contains("is-emphasis")).toBe(false);
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("plays once per new key and does not restart on a same-key re-render", () => {
    const { container, root } = render(<SolutionBoardPanel board={board()} emphasis={{ key: "k1", expressionIds: ["e2"] }} />);
    expect(animateSpy).toHaveBeenCalledTimes(1);
    // Re-render with the SAME key: the effect must not fire again.
    act(() => root.render(<SolutionBoardPanel board={board()} emphasis={{ key: "k1", expressionIds: ["e2"] }} />));
    expect(animateSpy).toHaveBeenCalledTimes(1);
    // A new key replays the animation.
    act(() => root.render(<SolutionBoardPanel board={board()} emphasis={{ key: "k2", expressionIds: ["e2"] }} />));
    expect(animateSpy).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("uses the gentler reduced-motion timing when the user prefers reduced motion", () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true, addEventListener() { /* noop */ }, removeEventListener() { /* noop */ } });
    const original = window.matchMedia;
    window.matchMedia = matchMediaMock as unknown as typeof window.matchMedia;
    try {
      const { root } = render(<SolutionBoardPanel board={board()} emphasis={{ key: "k1", expressionIds: ["e2"] }} />);
      expect(animateSpy).toHaveBeenCalledTimes(1);
      const options = animateSpy.mock.calls[0][1] as { duration: number };
      expect(options.duration).toBe(650); // reduced-motion duration
      act(() => root.unmount());
    } finally {
      window.matchMedia = original;
    }
  });
});
