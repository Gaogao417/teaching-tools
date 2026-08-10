import { describe, expect, it } from "vitest";
import { createCommandExecutor } from "../domain/command-executor";
import type { GeometryCommand } from "../domain/commands";
import { GeometryModel } from "../domain/model";
import { createInteractionRuntime } from "../interaction/runtime";

/**
 * Class 4 test (per design report §07): runtime integration — but RUNTIME ONLY.
 *
 * SCOPE NOTE: this test drives the runtime directly via `runtime.send(...)`,
 * i.e. it starts AFTER the semantic event has been produced. It does NOT
 * exercise the real UI chain (React closure → DOM PointerEvent →
 * getUsrCoordsOfMouse → hitTest → onHit). That chain is covered by:
 *   - hit-test.test.ts          (the pure hit-test math)
 *   - GeometryCanvas.callbacks.test.tsx (the React stale-closure wiring)
 * A real browser regression (pixel → coords) is manual / Playwright, not here.
 *
 * What this file DOES prove:
 *  - the machine produces a command; it never mutates the model directly;
 *  - the same command path is what an Agent would use (no UI simulation);
 *  - adding construct-circle needs no new event-dispatch path.
 */

const PARALLEL_SPEC = { throughPointId: "A", referenceLineId: "BC", carrierPoints: ["B", "C"] as const };

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

describe("InteractionRuntime — construct-parallel (runtime-only: send → done → command → model)", () => {
  it("selectPoint -> selectLine -> done -> command -> model gains a parallel-line", () => {
    const model = seededTriangle();
    const executor = createCommandExecutor(model);
    const runtime = createInteractionRuntime(executor, model);

    let lastCompleted: { command: GeometryCommand; evidence?: unknown } | undefined;
    runtime.onDone((c) => (lastCompleted = { command: c.command, evidence: c.evidence }));

    runtime.startTool("construct-parallel", PARALLEL_SPEC);
    expect(runtime.activeToolId()).toBe("construct-parallel");
    // selectPoint: point A is enabled+expected.
    expect(runtime.getView().entities["A"]).toMatchObject({ enabled: true, expected: true });

    runtime.send({ type: "POINT.CLICKED", pointId: "A" });
    // selectLine: line BC is enabled+expected.
    expect(runtime.getView().entities["BC"]).toMatchObject({ enabled: true, expected: true });

    runtime.send({ type: "LINE.CLICKED", lineId: "BC" });
    // selectCarrier0 / selectCarrier1: the two carrier points.
    runtime.send({ type: "POINT.CLICKED", pointId: "B" });
    runtime.send({ type: "POINT.CLICKED", pointId: "C" });

    // The runtime tears down the tool once complete.
    expect(runtime.activeToolId()).toBeUndefined();
    expect(lastCompleted).toBeDefined();
    expect(lastCompleted!.command).toEqual({
      type: "construct-parallel",
      throughPointId: "A",
      referenceLineId: "BC",
    });

    // Evidence carries the learner's clicks (the carriers the math command
    // omits) so production can serialize the `topic-answer` string.
    expect(lastCompleted!.evidence).toEqual({
      selectedPointId: "A",
      selectedLineId: "BC",
      carrierPointIds: ["B", "C"],
    });

    // The model, NOT the machine, gained the derived geometry: a single
    // parallel-line relation (no extra point/segment).
    const derived = model.linesList().filter((l) => l.derived);
    expect(derived).toHaveLength(1);
    expect(derived[0].kind).toBe("parallel-line");
  });

  it("a wrong point does not advance and surfaces a wrong affordance", () => {
    const model = seededTriangle();
    const runtime = createInteractionRuntime(createCommandExecutor(model), model);
    runtime.startTool("construct-parallel", PARALLEL_SPEC);

    runtime.send({ type: "POINT.CLICKED", pointId: "B" }); // wrong
    const view = runtime.getView();
    expect(view.entities["B"].visualState).toBe("wrong");
    expect(view.entities["B"].feedback).toBeDefined();
    // Still in selectPoint: A remains available.
    expect(view.entities["A"]).toMatchObject({ enabled: true, expected: true, visualState: "available" });
  });

  it("BACK lets the learner re-choose the point without completing", () => {
    const model = seededTriangle();
    const runtime = createInteractionRuntime(createCommandExecutor(model), model);
    let completed = false;
    runtime.onDone(() => (completed = true));

    runtime.startTool("construct-parallel", PARALLEL_SPEC);
    runtime.send({ type: "POINT.CLICKED", pointId: "A" });
    runtime.send({ type: "BACK" });
    expect(runtime.getView().entities["A"]).toMatchObject({ enabled: true, visualState: "available" });
    expect(runtime.activeToolId()).toBe("construct-parallel");
    expect(completed).toBe(false);
  });

  it("CANCEL clears the tool without producing a command or mutating the model", () => {
    const model = seededTriangle();
    const runtime = createInteractionRuntime(createCommandExecutor(model), model);
    let completed = false;
    runtime.onDone(() => (completed = true));

    runtime.startTool("construct-parallel", PARALLEL_SPEC);
    runtime.send({ type: "POINT.CLICKED", pointId: "A" });
    runtime.send({ type: "CANCEL" });

    expect(runtime.activeToolId()).toBeUndefined();
    expect(completed).toBe(false);
    expect(model.linesList().filter((l) => l.derived)).toHaveLength(0);
  });
});

describe("InteractionRuntime — construct-circle uses identical dispatch", () => {
  it("reaches done through the same send() path and mutates the model", () => {
    const model = seededTriangle();
    const runtime = createInteractionRuntime(createCommandExecutor(model), model);
    let lastCommand: GeometryCommand | undefined;
    let lastEvidence: unknown;
    runtime.onDone((c) => { lastCommand = c.command; lastEvidence = c.evidence; });

    runtime.startTool("construct-circle", undefined);
    // Both steps are POINT.CLICKED — same Canvas dispatch, no tool branch.
    runtime.send({ type: "POINT.CLICKED", pointId: "A" });
    runtime.send({ type: "POINT.CLICKED", pointId: "B" });

    expect(lastCommand).toEqual({ type: "construct-circle", centerId: "A", throughPointId: "B" });
    expect(model.circlesList().filter((c) => c.derived)).toHaveLength(1);
    // construct-circle has no production evidence need yet: extractEvidence is
    // undefined, so ToolCompleted.evidence stays undefined.
    expect(lastEvidence).toBeUndefined();
  });
});

describe("InteractionRuntime — invariants", () => {
  it("getView returns idleView when no tool is active", () => {
    const runtime = createInteractionRuntime(createCommandExecutor(seededTriangle()), seededTriangle());
    const view = runtime.getView();
    expect(view.entities).toEqual({});
    expect(view.canCancel).toBe(false);
  });

  it("send before startTool is a safe no-op", () => {
    const runtime = createInteractionRuntime(createCommandExecutor(seededTriangle()), seededTriangle());
    expect(() => runtime.send({ type: "POINT.CLICKED", pointId: "A" })).not.toThrow();
  });
});
