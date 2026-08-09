import { describe, expect, it } from "vitest";
import { createCommandExecutor } from "../domain/command-executor";
import type { GeometryCommand } from "../domain/commands";
import { GeometryModel } from "../domain/model";

/**
 * Class 3 test (per design report §07): command executor. Does not go through
 * the UI — feeds GeometryCommand straight to the executor and asserts geometry
 * results and errors. This is also the path an Agent would take.
 */

function seededTriangle(): GeometryModel {
  // A right-ish triangle: A at the top, B/C on the base. BC is a horizontal
  // reference line convenient for parallel-line construction.
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

describe("CommandExecutor — construct-parallel", () => {
  it("persists a parallel-line relation through the point (no synthesized endpoint)", () => {
    const model = seededTriangle();
    const exec = createCommandExecutor(model);
    const command: GeometryCommand = {
      type: "construct-parallel",
      throughPointId: "A",
      referenceLineId: "BC",
    };

    const result = exec.execute(command);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A single derived line — NO derived point, NO extra segment. The relation
    // is the sole source of truth; the renderer derives extent from it.
    expect(result.createdIds).toHaveLength(1);
    expect(model.pointsList().filter((p) => p.derived)).toHaveLength(0);

    const newLine = model.linesList().find((l) => l.derived);
    expect(newLine).toEqual({
      id: "parallel-A-BC",
      kind: "parallel-line",
      through: "A",
      parallelTo: "BC",
      derived: true,
    });
  });

  it("the relation resolves to a direction parallel to the reference line", () => {
    const model = seededTriangle();
    const exec = createCommandExecutor(model);
    exec.execute({ type: "construct-parallel", throughPointId: "A", referenceLineId: "BC" });

    const newLine = model.linesList().find((l) => l.derived)!;
    expect(newLine.kind).toBe("parallel-line");

    // The constructed line's direction equals the reference line's direction.
    const dirParallel = model.lineDirection(newLine.id);
    const dirBC = model.lineDirection("BC");
    // BC is horizontal; the parallel must be horizontal too (cross product 0).
    expect(dirParallel.dx * dirBC.dy - dirParallel.dy * dirBC.dx).toBeCloseTo(0, 10);
  });

  it("can chain: a parallel of a parallel keeps the reference direction", () => {
    const model = seededTriangle();
    const exec = createCommandExecutor(model);
    exec.execute({ type: "construct-parallel", throughPointId: "A", referenceLineId: "BC" });
    // Now construct a parallel to the just-created line, through C.
    const r2 = exec.execute({
      type: "construct-parallel",
      throughPointId: "C",
      referenceLineId: "parallel-A-BC",
    });
    expect(r2.ok).toBe(true);
    const chained = model.linesList().find((l) => l.id === "parallel-C-parallel-A-BC")!;
    expect(chained.kind).toBe("parallel-line");
    // Direction still resolves (recursively) to BC's horizontal direction.
    const dir = model.lineDirection(chained.id);
    expect(Math.abs(dir.dy)).toBeCloseTo(0, 10);
  });

  it("rejects when the referenced point does not exist", () => {
    const model = seededTriangle();
    const exec = createCommandExecutor(model);
    const result = exec.execute({
      type: "construct-parallel",
      throughPointId: "Z",
      referenceLineId: "BC",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-reference");
    // No geometry mutated.
    expect(model.pointsList().filter((p) => p.derived)).toHaveLength(0);
  });

  it("rejects when the referenced line does not exist", () => {
    const model = seededTriangle();
    const exec = createCommandExecutor(model);
    const result = exec.execute({
      type: "construct-parallel",
      throughPointId: "A",
      referenceLineId: "ZZ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-reference");
  });
});

describe("CommandExecutor — construct-circle", () => {
  it("constructs a circle through the given point", () => {
    const model = seededTriangle();
    const exec = createCommandExecutor(model);
    const result = exec.execute({ type: "construct-circle", centerId: "A", throughPointId: "B" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const circle = model.circlesList().find((c) => c.derived);
    expect(circle).toBeTruthy();
    expect(circle?.centerId).toBe("A");
    expect(circle?.throughPointId).toBe("B");
  });

  it("rejects a zero-radius circle (center == through)", () => {
    const model = seededTriangle();
    const exec = createCommandExecutor(model);
    const result = exec.execute({ type: "construct-circle", centerId: "A", throughPointId: "A" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("degenerate");
  });

  it("rejects when endpoints are missing", () => {
    const model = seededTriangle();
    const exec = createCommandExecutor(model);
    const result = exec.execute({ type: "construct-circle", centerId: "Q", throughPointId: "B" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-reference");
  });
});
