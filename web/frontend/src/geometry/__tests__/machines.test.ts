import { createActor } from "xstate";
import { describe, expect, it } from "vitest";
import { constructCircleMachine } from "../interaction/tools/construct-circle.machine";
import { constructParallelMachine } from "../interaction/tools/construct-parallel.machine";

/**
 * Class 1 test (per design report §07): machine unit test.
 * createActor(machine) -> send events -> assert matches/context/output.
 */

describe("construct-parallel machine", () => {
  // construct-parallel is task-driven: every run needs expected point + line +
  // the two carrier points (full PRD-03 §5.3 four-stage flow).
  const SPEC = { throughPointId: "A", referenceLineId: "BC", carrierPoints: ["B", "C"] as const };
  function start() {
    const actor = createActor(constructParallelMachine, { input: SPEC });
    actor.start();
    return actor;
  }

  it("starts in selectPoint with the spec in context", () => {
    const actor = start();
    const snap = actor.getSnapshot();
    expect(snap.matches("selectPoint")).toBe(true);
    expect(snap.status).toBe("active");
    expect(snap.context.spec).toEqual(SPEC);
  });

  it("full four-stage flow: point -> line -> carrier0 -> carrier1 -> done", () => {
    const actor = start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    expect(actor.getSnapshot().matches("selectLine")).toBe(true);

    actor.send({ type: "LINE.CLICKED", lineId: "BC" });
    expect(actor.getSnapshot().matches("selectCarrier0")).toBe(true);

    actor.send({ type: "POINT.CLICKED", pointId: "B" });
    expect(actor.getSnapshot().matches("selectCarrier1")).toBe(true);
    expect(actor.getSnapshot().context.carrierIds).toEqual(["B"]);

    actor.send({ type: "POINT.CLICKED", pointId: "C" });
    const snap = actor.getSnapshot();
    expect(snap.matches("done")).toBe(true);
    expect(snap.status).toBe("done");
    expect(snap.context.carrierIds).toEqual(["B", "C"]);
    expect(snap.output).toEqual({ type: "construct-parallel", throughPointId: "A", referenceLineId: "BC" });
  });

  it("a WRONG point in selectPoint stays and records wrongId", () => {
    const actor = start();
    actor.send({ type: "POINT.CLICKED", pointId: "C" }); // C is not the expected A
    const snap = actor.getSnapshot();
    expect(snap.matches("selectPoint")).toBe(true);
    expect(snap.context.pointId).toBeUndefined();
    expect(snap.context.wrongId).toBe("C");
  });

  it("a wrong point then the correct point clears wrongId and advances", () => {
    const actor = start();
    actor.send({ type: "POINT.CLICKED", pointId: "C" });
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    const snap = actor.getSnapshot();
    expect(snap.matches("selectLine")).toBe(true);
    expect(snap.context.wrongId).toBeUndefined();
  });

  it("a WRONG line in selectLine stays and records wrongId", () => {
    const actor = start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    actor.send({ type: "LINE.CLICKED", lineId: "AB" }); // AB is not the expected BC
    const snap = actor.getSnapshot();
    expect(snap.matches("selectLine")).toBe(true);
    expect(snap.context.lineId).toBeUndefined();
    expect(snap.context.wrongId).toBe("AB");
  });

  it("a WRONG first carrier in selectCarrier0 stays and records wrongId", () => {
    const actor = start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    actor.send({ type: "LINE.CLICKED", lineId: "BC" });
    actor.send({ type: "POINT.CLICKED", pointId: "A" }); // A is not carrier0 (B)
    const snap = actor.getSnapshot();
    expect(snap.matches("selectCarrier0")).toBe(true);
    expect(snap.context.carrierIds).toEqual([]);
    expect(snap.context.wrongId).toBe("A");
  });

  it("a WRONG second carrier in selectCarrier1 stays; the chosen carrier0 is kept", () => {
    const actor = start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    actor.send({ type: "LINE.CLICKED", lineId: "BC" });
    actor.send({ type: "POINT.CLICKED", pointId: "B" }); // carrier0 ok
    actor.send({ type: "POINT.CLICKED", pointId: "A" }); // A is not carrier1 (C)
    const snap = actor.getSnapshot();
    expect(snap.matches("selectCarrier1")).toBe(true);
    expect(snap.context.carrierIds).toEqual(["B"]); // prior carrier preserved
    expect(snap.context.wrongId).toBe("A");
  });

  it("BACK chains: carrier1 -> carrier0 -> line -> point", () => {
    const actor = start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    actor.send({ type: "LINE.CLICKED", lineId: "BC" });
    actor.send({ type: "POINT.CLICKED", pointId: "B" });
    actor.send({ type: "BACK" }); // carrier1 -> carrier0, pops carrier
    expect(actor.getSnapshot().matches("selectCarrier0")).toBe(true);
    expect(actor.getSnapshot().context.carrierIds).toEqual([]);
    actor.send({ type: "BACK" }); // carrier0 -> selectLine
    expect(actor.getSnapshot().matches("selectLine")).toBe(true);
    expect(actor.getSnapshot().context.lineId).toBeUndefined();
    actor.send({ type: "BACK" }); // selectLine -> selectPoint
    expect(actor.getSnapshot().matches("selectPoint")).toBe(true);
    expect(actor.getSnapshot().context.pointId).toBeUndefined();
  });

  it("CANCEL from selectCarrier1 ends in cancelled", () => {
    const actor = start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    actor.send({ type: "LINE.CLICKED", lineId: "BC" });
    actor.send({ type: "POINT.CLICKED", pointId: "B" });
    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().output).toEqual({ type: "cancelled" });
  });

  it("ignores LINE.CLICKED while in selectPoint (no transition)", () => {
    const actor = start();
    actor.send({ type: "LINE.CLICKED", lineId: "BC" });
    expect(actor.getSnapshot().matches("selectPoint")).toBe(true);
    expect(actor.getSnapshot().context.pointId).toBeUndefined();
  });
});

describe("construct-circle machine", () => {
  function start() {
    const actor = createActor(constructCircleMachine);
    actor.start();
    return actor;
  }

  it("selectCenter -> selectThroughPoint -> done emits construct-circle output", () => {
    const actor = start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    expect(actor.getSnapshot().matches("selectThroughPoint")).toBe(true);

    actor.send({ type: "POINT.CLICKED", pointId: "B" });
    const snap = actor.getSnapshot();
    expect(snap.matches("done")).toBe(true);
    expect(snap.output).toEqual({ type: "construct-circle", centerId: "A", throughPointId: "B" });
  });

  it("BACK from selectThroughPoint clears the center and returns", () => {
    const actor = start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    actor.send({ type: "BACK" });
    const snap = actor.getSnapshot();
    expect(snap.matches("selectCenter")).toBe(true);
    expect(snap.context.centerId).toBeUndefined();
  });

  it("CANCEL ends in cancelled", () => {
    const actor = start();
    actor.send({ type: "POINT.CLICKED", pointId: "A" });
    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().output).toEqual({ type: "cancelled" });
  });

  it("ignores LINE.CLICKED entirely (both steps want points)", () => {
    const actor = start();
    actor.send({ type: "LINE.CLICKED", lineId: "BC" });
    expect(actor.getSnapshot().matches("selectCenter")).toBe(true);
  });
});
