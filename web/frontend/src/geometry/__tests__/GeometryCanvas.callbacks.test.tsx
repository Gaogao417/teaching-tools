/**
 * React-level regression for the stale-closure bug in GeometryCanvas.
 *
 * Background: the board's `onHit` is wired once at mount (useEffect []). Without
 * the `onClickEntityRef` indirection it captured the FIRST render's
 * `onClickEntity`, whose `view.accepts === []` (idle). After a tool starts,
 * `accepts` becomes e.g. ["point"] but the board still called the stale handler,
 * which dropped the event at use-geometry-interaction.ts (`if (!view.accepts...)
 * return`). So a click that *hit* never reached the machine.
 *
 * This test renders GeometryCanvas (with the JSXGraph board mocked out), starts
 * a tool so accepts becomes ["point"], and drives the captured `onHit` directly.
 * It must reach `runtime.send`. With the stale closure, it would be dropped.
 *
 * This is a React-lifecycle + callback-wiring test, NOT a browser test: it does
 * not exercise pixel→coords conversion or real JSXGraph (those need a browser).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { BoardCallbacks, BoardHandles } from "../react/jsxgraph-board";
import type { EntityRef } from "../interaction/events";

// Opt this file into React's act() environment so effects flush synchronously.
// (Without this React 19 logs "not configured to support act(...)".)
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Capture the callbacks the component registers, so we can drive onHit directly.
let capturedCallbacks: BoardCallbacks | null = null;
const mountedModels: unknown[] = [];
const destroy = vi.fn();
const render = vi.fn();

vi.mock("../react/jsxgraph-board", () => ({
  mountGeometryBoard: vi.fn((_container: HTMLDivElement, _model: unknown, callbacks: BoardCallbacks): BoardHandles => {
    mountedModels.push(_model);
    capturedCallbacks = callbacks;
    return {
      board: {} as never,
      getPointer: () => null,
      render,
      destroy,
    };
  }),
}));

const { GeometryCanvas, GeometryCanvasSurface } = await import("../react/GeometryCanvas");
const { GeometryModel } = await import("../domain/model");
const { createCommandExecutor } = await import("../domain/command-executor");
const { createInteractionRuntime } = await import("../interaction/runtime");
type GeometryModel = InstanceType<typeof GeometryModel>;

function seededTriangle(): GeometryModel {
  return new GeometryModel({
    points: [
      { id: "A", x: 1, y: 4 },
      { id: "B", x: -2, y: 0 },
      { id: "C", x: 5, y: 0 },
    ],
    lines: [
      { id: "AB", kind: "segment", from: "A", to: "B" },
      { id: "BC", kind: "segment", from: "B", to: "C" },
      { id: "AC", kind: "segment", from: "A", to: "C" },
    ],
  });
}

describe("GeometryCanvas — stale-closure regression", () => {
  beforeEach(() => {
    capturedCallbacks = null;
    mountedModels.length = 0;
    destroy.mockClear();
  });

  it("an onHit fired AFTER a tool starts reaches runtime.send (uses latest handler)", async () => {
    const model = seededTriangle();
    const runtime = createInteractionRuntime(createCommandExecutor(model), model);
    const sendSpy = vi.spyOn(runtime, "send");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    // Initial render: no tool active → no enabled entities.
    await act(async () => {
      root.render(<GeometryCanvas model={model} runtime={runtime} modelVersion={0} />);
    });

    expect(capturedCallbacks).not.toBeNull();
    expect(Object.values(capturedCallbacks!.getEntities()).filter((e) => e.enabled)).toHaveLength(0);

    // Start a tool OUTSIDE the initial render. selectPoint now enables points.
    act(() => {
      runtime.startTool("construct-parallel", { throughPointId: "A", referenceLineId: "BC", carrierPoints: ["B", "C"] as const });
    });

    // Flush React so the component re-renders and the ref is updated to the
    // new onClickEntity (the one whose entities enable points).
    await act(async () => {
      root.render(<GeometryCanvas model={model} runtime={runtime} modelVersion={0} />);
    });

    // The board's getEntities must reflect the CURRENT step, not the mount-time
    // empty table: point A is enabled+expected.
    expect(capturedCallbacks!.getEntities()["A"]).toMatchObject({ enabled: true, expected: true });

    // Drive the captured onHit exactly as the real board would on a click on A.
    await act(async () => {
      const hit: EntityRef = { kind: "point", id: "A" };
      capturedCallbacks!.onHit(hit);
    });

    // The semantic POINT.CLICKED event must reach the machine.
    expect(sendSpy).toHaveBeenCalledWith({ type: "POINT.CLICKED", pointId: "A" });

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("an onHit for a non-enabled entity is dropped (regression guard, not a bug)", async () => {
    // selectPoint only enables points; lines are not in the table. A line hit
    // must NOT reach the machine. This pins the per-entity enabled filter.
    const model = seededTriangle();
    const runtime = createInteractionRuntime(createCommandExecutor(model), model);
    const sendSpy = vi.spyOn(runtime, "send");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<GeometryCanvas model={model} runtime={runtime} modelVersion={0} />);
    });
    act(() => {
      runtime.startTool("construct-parallel", { throughPointId: "A", referenceLineId: "BC", carrierPoints: ["B", "C"] as const });
    });
    await act(async () => {
      root.render(<GeometryCanvas model={model} runtime={runtime} modelVersion={0} />);
    });

    await act(async () => {
      capturedCallbacks!.onHit({ kind: "line", id: "BC" });
    });
    expect(sendSpy).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("renders ActionPresentation preview on the production Canvas without pointer or network state", async () => {
    const model = seededTriangle();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<GeometryCanvasSurface
        model={model}
        modelVersion={0}
        onClickEntity={() => undefined}
        view={{
          prompt: "preview",
          entities: {},
          selected: [],
          cursor: "default",
          canCancel: true,
          canGoBack: false,
          preview: { type: "parallel-fixed", throughPointId: "A", referenceLineId: "BC" },
        }}
      />);
    });
    expect(container.querySelector('[data-preview-type="parallel"]')).not.toBeNull();
    await act(async () => root.unmount());
    document.body.removeChild(container);
  });

  it("remounts production Canvas with the new GeometryModel after a draft DomainCommand", async () => {
    const initial = seededTriangle();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const rendererView = { prompt: "world", entities: {}, selected: [], cursor: "default" as const, canCancel: true, canGoBack: false };
    await act(async () => root.render(<GeometryCanvasSurface model={initial} modelVersion={0} view={rendererView} onClickEntity={() => undefined} />));
    const next = seededTriangle();
    next.addPoint({ id: "X", x: 2, y: 2, derived: true });
    await act(async () => root.render(<GeometryCanvasSurface model={next} modelVersion={1} view={rendererView} onClickEntity={() => undefined} />));
    expect(mountedModels).toEqual([initial, next]);
    expect(destroy).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    document.body.removeChild(container);
  });
});
