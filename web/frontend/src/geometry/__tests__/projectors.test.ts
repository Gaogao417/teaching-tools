import { createActor } from "xstate";
import { describe, expect, it } from "vitest";
import { idleView } from "../interaction/interaction-view";
import { projectConstructCircle } from "../interaction/tools/construct-circle.view";
import { projectConstructParallel } from "../interaction/tools/construct-parallel.view";
import { constructCircleMachine } from "../interaction/tools/construct-circle.machine";
import { constructParallelMachine } from "../interaction/tools/construct-parallel.machine";
import { GeometryModel } from "../domain/model";

/**
 * Class 2 test (per design report §07): view projector.
 * Feed a real machine snapshot + model, assert prompt / entities / selected / preview.
 */

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

describe("projectConstructParallel", () => {
  const model = seededTriangle();
  const SPEC = { throughPointId: "A", referenceLineId: "BC", carrierPoints: ["B", "C"] as const };

  it("selectPoint prompts for a point; A is enabled+expected, B/C enabled+not-expected, lines disabled", () => {
    const actor = createActor(constructParallelMachine, { input: SPEC });
    actor.start();
    const view = projectConstructParallel(actor.getSnapshot(), model);
    expect(view.prompt).toContain("点");
    expect(view.entities["A"]).toMatchObject({ enabled: true, expected: true, visualState: "available" });
    expect(view.entities["B"]).toMatchObject({ enabled: true, expected: false, visualState: "available" });
    expect(view.entities["C"]).toMatchObject({ enabled: true, expected: false });
    // Lines are not part of this step at all → absent (not clickable).
    expect(view.entities["AB"]).toBeUndefined();
    expect(view.selected).toEqual([]);
    expect(view.canCancel).toBe(true);
    expect(view.canGoBack).toBe(false);
  });

  it("selectLine prompts for a line; only lines are enabled, BC is expected, A is locked (selected)", () => {
    const actor = createActor(constructParallelMachine, { input: SPEC });
    actor.start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    const view = projectConstructParallel(actor.getSnapshot(), model);
    expect(view.entities["BC"]).toMatchObject({ enabled: true, expected: true });
    expect(view.entities["AB"]).toMatchObject({ enabled: true, expected: false });
    expect(view.entities["A"]).toMatchObject({ enabled: false, visualState: "selected" });
    expect(view.selected).toEqual([{ kind: "point", id: "A" }]);
    expect(view.preview).toBeDefined();
    expect(view.preview?.type).toBe("parallel-through-hover");
    expect(view.canGoBack).toBe(true);
  });

  it("selectCarrier0 prompts for the first carrier; B is expected, A and BC are locked", () => {
    const actor = createActor(constructParallelMachine, { input: SPEC });
    actor.start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    actor.send({ type: "LINE.CLICKED", lineId: "BC" });
    const view = projectConstructParallel(actor.getSnapshot(), model);
    expect(view.prompt).toContain("第一个外点");
    expect(view.entities["B"]).toMatchObject({ enabled: true, expected: true });
    expect(view.entities["A"]).toMatchObject({ enabled: false, visualState: "selected" });
    expect(view.entities["BC"]).toMatchObject({ enabled: false, visualState: "selected" });
    expect(view.selected).toEqual([{ kind: "point", id: "A" }, { kind: "line", id: "BC" }]);
  });

  it("selectCarrier1 prompts for the second carrier; C is expected, B is locked", () => {
    const actor = createActor(constructParallelMachine, { input: SPEC });
    actor.start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    actor.send({ type: "LINE.CLICKED", lineId: "BC" });
    actor.send({ type: "POINT.CLICKED", pointId: "B" });
    const view = projectConstructParallel(actor.getSnapshot(), model);
    expect(view.prompt).toContain("第二个外点");
    expect(view.entities["C"]).toMatchObject({ enabled: true, expected: true });
    expect(view.entities["B"]).toMatchObject({ enabled: false, visualState: "selected" });
  });

  it("after a wrong point click, that point is marked wrong with feedback", () => {
    const actor = createActor(constructParallelMachine, { input: SPEC });
    actor.start();
    actor.send({ type: "POINT.CLICKED", pointId: "B" }); // wrong
    const view = projectConstructParallel(actor.getSnapshot(), model);
    expect(view.entities["B"].visualState).toBe("wrong");
    expect(view.entities["B"].feedback).toContain("B");
    // A remains available+expected.
    expect(view.entities["A"]).toMatchObject({ expected: true, visualState: "available" });
  });

  it("falls back to idleView after the full four-stage completion", () => {
    const actor = createActor(constructParallelMachine, { input: SPEC });
    actor.start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    actor.send({ type: "LINE.CLICKED", lineId: "BC" });
    actor.send({ type: "POINT.CLICKED", pointId: "B" });
    actor.send({ type: "POINT.CLICKED", pointId: "C" });
    const view = projectConstructParallel(actor.getSnapshot(), model);
    expect(view).toEqual(idleView);
  });
});

describe("projectConstructCircle", () => {
  const model = seededTriangle();

  it("selectCenter prompts for a point; all points enabled, none expected", () => {
    const actor = createActor(constructCircleMachine);
    actor.start();
    const view = projectConstructCircle(actor.getSnapshot(), model);
    expect(view.prompt).toContain("圆心");
    expect(view.entities["A"]).toMatchObject({ enabled: true, expected: false, visualState: "available" });
    expect(view.entities["B"]).toMatchObject({ enabled: true });
    expect(view.selected).toEqual([]);
  });

  it("selectThroughPoint keeps points enabled (except the selected center) and previews a circle", () => {
    const actor = createActor(constructCircleMachine);
    actor.start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    const view = projectConstructCircle(actor.getSnapshot(), model);
    expect(view.entities["A"]).toMatchObject({ enabled: false, visualState: "selected" });
    expect(view.entities["B"]).toMatchObject({ enabled: true });
    expect(view.selected).toEqual([{ kind: "point", id: "A" }]);
    expect(view.preview?.type).toBe("circle-through-hover");
    expect(view.canGoBack).toBe(true);
  });
});
