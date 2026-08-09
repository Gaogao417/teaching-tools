import { describe, expect, it } from "vitest";
import type { EntityAffordance, InteractionView } from "../interaction/interaction-view";
import { mapConstructParallelView } from "./mapInteractionView";

/**
 * Mapper tests. We hand-build InteractionView fixtures that mirror the shapes
 * the construct-parallel projector emits at each stage (see
 * `interaction/tools/construct-parallel.view.ts`), then assert the mapper
 * produces exactly the prop shape the production `GeometryCanvas` expects.
 *
 * Golden expectations are cross-checked against the hand-derived values the
 * old `TopicPracticeWorkspace` computed inline (e.g. at selectLine only the
 * through-point is selected and the reference segment is the lone enabled
 * segment).
 */

function affordance(id: string, kind: "point" | "line", over: Partial<EntityAffordance> = {}): EntityAffordance {
  return {
    id,
    kind,
    enabled: true,
    expected: false,
    visualState: "available",
    ...over,
  };
}

describe("mapConstructParallelView — selectPoint stage", () => {
  const view: InteractionView = {
    prompt: "选择平行线经过的点",
    entities: {
      C: affordance("C", "point", { expected: true }),
    },
    selected: [],
    cursor: "pointer",
    canCancel: true,
    canGoBack: false,
  };

  it("exposes the single enabled point as availablePointIds", () => {
    const mapped = mapConstructParallelView(view);
    expect(mapped.availablePointIds).toEqual(["C"]);
  });

  it("has no enabled segments at selectPoint", () => {
    const mapped = mapConstructParallelView(view);
    expect(mapped.availableSegmentIds).toEqual([]);
  });

  it("reports nothing selected and no wrong objects", () => {
    const mapped = mapConstructParallelView(view);
    expect(mapped.selectedPoints).toEqual([]);
    expect(mapped.selectedSegments).toEqual([]);
    expect(mapped.wrongObjectIds).toEqual([]);
  });

  it("threads the projector prompt through", () => {
    expect(mapConstructParallelView(view).prompt).toBe("选择平行线经过的点");
  });
});

describe("mapConstructParallelView — selectLine stage", () => {
  const view: InteractionView = {
    prompt: "选择参考直线",
    entities: {
      // The through-point is now locked (selected earlier).
      C: affordance("C", "point", { enabled: false, expected: true, visualState: "selected" }),
      AD: affordance("AD", "line", { expected: true }),
    },
    selected: [{ kind: "point", id: "C" }],
    cursor: "pointer",
    preview: { type: "parallel-through-hover" },
    canCancel: true,
    canGoBack: true,
  };

  it("locks the through-point (not in availablePointIds) and exposes the reference segment", () => {
    const mapped = mapConstructParallelView(view);
    expect(mapped.availablePointIds).toEqual([]);
    expect(mapped.availableSegmentIds).toEqual(["AD"]);
  });

  it("reports the through-point as selected (parallel preview waits for the line click)", () => {
    const mapped = mapConstructParallelView(view);
    expect(mapped.selectedPoints).toEqual(["C"]);
    expect(mapped.selectedSegments).toEqual([]);
    expect(mapped.constructionPreview.throughPoint).toBe("C");
    // At selectLine the reference segment is not yet in `selected` — the
    // projector only adds it once the learner clicks it (advancing to
    // selectCarrier0). So the parallel preview segment stays empty here,
    // matching the legacy behavior where the preview drew only after the
    // `parallel` slot was filled.
    expect(mapped.constructionPreview.parallelSegment).toBeUndefined();
    expect(mapped.constructionPreview.carrierPoints).toEqual([]);
  });
});

describe("mapConstructParallelView — selectCarrier0 stage (with a wrong point flagged)", () => {
  const view: InteractionView = {
    prompt: "点第一个外点",
    entities: {
      C: affordance("C", "point", { enabled: false, visualState: "selected" }),
      AD: affordance("AD", "line", { enabled: false, visualState: "selected" }),
      B: affordance("B", "point", { expected: true }),
      // The learner clicked D (wrong); projector keeps it enabled but marks it
      // wrong so the machine can diagnose a follow-up click.
      D: affordance("D", "point", { visualState: "wrong", feedback: "点 D 不是本步要点的点。" }),
    },
    selected: [
      { kind: "point", id: "C" },
      { kind: "line", id: "AD" },
    ],
    cursor: "pointer",
    canCancel: true,
    canGoBack: true,
  };

  it("keeps both the expected and the wrong-but-clickable point available", () => {
    const mapped = mapConstructParallelView(view);
    expect(mapped.availablePointIds).toEqual(["B", "D"]);
  });

  it("surfaces the wrong point id for red rendering", () => {
    const mapped = mapConstructParallelView(view);
    expect(mapped.wrongObjectIds).toEqual(["D"]);
  });

  it("reports through-point + reference as selected, no carriers yet", () => {
    const mapped = mapConstructParallelView(view);
    expect(mapped.selectedPoints).toEqual(["C"]);
    expect(mapped.selectedSegments).toEqual(["AD"]);
    expect(mapped.constructionPreview.carrierPoints).toEqual([]);
  });
});

describe("mapConstructParallelView — selectCarrier1 stage (one carrier chosen)", () => {
  const view: InteractionView = {
    prompt: "点第二个外点",
    entities: {
      C: affordance("C", "point", { enabled: false, visualState: "selected" }),
      AD: affordance("AD", "line", { enabled: false, visualState: "selected" }),
      B: affordance("B", "point", { enabled: false, visualState: "selected" }),
      E: affordance("E", "point", { expected: true }),
    },
    selected: [
      { kind: "point", id: "C" },
      { kind: "line", id: "AD" },
      { kind: "point", id: "B" },
    ],
    cursor: "pointer",
    canCancel: true,
    canGoBack: true,
  };

  it("only the second carrier remains available; the first is locked", () => {
    const mapped = mapConstructParallelView(view);
    expect(mapped.availablePointIds).toEqual(["E"]);
  });

  it("drives the carrier preview line from selected points after the through-point", () => {
    const mapped = mapConstructParallelView(view);
    expect(mapped.selectedPoints).toEqual(["C", "B"]);
    expect(mapped.constructionPreview.throughPoint).toBe("C");
    expect(mapped.constructionPreview.carrierPoints).toEqual(["B"]);
  });
});

describe("mapConstructParallelView — extras and edge cases", () => {
  it("threads resultPoint into the construction preview when provided", () => {
    const view: InteractionView = {
      prompt: "x",
      entities: {},
      selected: [],
      cursor: "default",
      canCancel: false,
      canGoBack: false,
    };
    const mapped = mapConstructParallelView(view, { resultPoint: "F" });
    expect(mapped.constructionPreview.resultPoint).toBe("F");
  });

  it("omits resultPoint when not provided (no undefined key)", () => {
    const view: InteractionView = {
      prompt: "x",
      entities: {},
      selected: [],
      cursor: "default",
      canCancel: false,
      canGoBack: false,
    };
    const mapped = mapConstructParallelView(view);
    expect(mapped.constructionPreview).not.toHaveProperty("resultPoint");
  });
});
