import { describe, expect, it } from "vitest";
import { GeometryModel } from "../domain/model";
import type { EntityAffordance } from "../interaction/interaction-view";
import type { EntityKind } from "../interaction/events";
import {
  hitTest,
  LINE_HIT_RADIUS,
  pointToSegmentDistance,
  POINT_HIT_RADIUS,
} from "../domain/hit-test";

/**
 * Unit tests for the pure hit-test module — the layer the old "full chain"
 * runtime test bypassed, and where the coordinate bug hid. These do NOT touch
 * JSXGraph, React, or the DOM: they feed user coordinates straight in, which is
 * what the adapter does after converting the browser event.
 *
 * A real browser regression (pixel → getUsrCoordsOfMouse → these functions) is
 * documented separately; these tests cover the math + enabled-filter only.
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

/**
 * Build an affordances table for the seeded model. `enabledKinds` enables every
 * entity of the listed kinds; pass an empty array for "nothing enabled", or use
 * `disabled` to turn specific ids off. This mirrors how projectors emit tables.
 */
function entities(model: GeometryModel, enabledKinds: EntityKind[], disabled: string[] = []): Record<string, EntityAffordance> {
  const out: Record<string, EntityAffordance> = {};
  for (const p of model.pointsList()) {
    out[p.id] = { id: p.id, kind: "point", enabled: enabledKinds.includes("point") && !disabled.includes(p.id), expected: false, visualState: "available" };
  }
  for (const l of model.linesList()) {
    out[l.id] = { id: l.id, kind: "line", enabled: enabledKinds.includes("line") && !disabled.includes(l.id), expected: false, visualState: "available" };
  }
  return out;
}

describe("pointToSegmentDistance", () => {
  it("is 0 on the segment", () => {
    expect(pointToSegmentDistance(0, 0, -2, 0, 5, 0)).toBe(0);
  });

  it("measures perpendicular distance off the segment", () => {
    // Segment from (0,0) to (4,0); point (2,3) → distance 3.
    expect(pointToSegmentDistance(2, 3, 0, 0, 4, 0)).toBeCloseTo(3, 10);
  });

  it("clamps to the nearest endpoint past the segment ends", () => {
    // Point (-3, 5) is past the (-2,0) end of BC.
    expect(pointToSegmentDistance(-3, 5, -2, 0, 5, 0)).toBeCloseTo(
      Math.hypot(-3 - -2, 5 - 0),
      10,
    );
  });

  it("handles a degenerate (zero-length) segment as distance to the point", () => {
    // (3,4) to (1,1) = sqrt(13).
    expect(pointToSegmentDistance(3, 4, 1, 1, 1, 1)).toBeCloseTo(Math.hypot(3 - 1, 4 - 1), 10);
  });
});

describe("hitTest — enabled filter", () => {
  const model = seededTriangle();

  it("returns null when nothing is enabled (idle step)", () => {
    expect(hitTest(model, entities(model, []), 1, 4)).toBeNull();
  });

  it("ignores disabled points — falls through to an enabled line through the point", () => {
    // Clicking exactly on A also sits on lines AB/AC; with points disabled, the
    // click resolves to a line passing through A, not to the point.
    const hit = hitTest(model, entities(model, ["line"]), 1, 4);
    expect(hit?.kind).toBe("line");
    expect(["AB", "AC"]).toContain(hit?.id);
  });

  it("returns null when only points are enabled but the click is on a line, off any point", () => {
    // (0,0) is on BC but not at B or C → with lines disabled, nothing hits.
    expect(hitTest(model, entities(model, ["point"]), 0, 0)).toBeNull();
  });

  it("a specific disabled point is not hit even within tolerance", () => {
    // Enable points but disable A explicitly → a click on A resolves to a line.
    const hit = hitTest(model, entities(model, ["point", "line"], ["A"]), 1, 4);
    expect(hit?.kind).toBe("line");
  });
});

describe("hitTest — points", () => {
  const model = seededTriangle();

  it("hits a point clicked within POINT_HIT_RADIUS", () => {
    expect(hitTest(model, entities(model, ["point"]), 1, 4)).toEqual({ kind: "point", id: "A" });
  });

  it("misses a point clicked just outside tolerance", () => {
    const justOutside = POINT_HIT_RADIUS + 0.01;
    expect(hitTest(model, entities(model, ["point"]), 1 + justOutside, 4)).toBeNull();
  });

  it("resolves a tie to the closest point", () => {
    const m = new GeometryModel({
      points: [
        { id: "P", x: 0, y: 0 },
        { id: "Q", x: 0.2, y: 0 },
      ],
    });
    expect(hitTest(m, entities(m, ["point"]), 0.18, 0)).toEqual({ kind: "point", id: "Q" });
  });
});

describe("hitTest — points win over lines when both are enabled", () => {
  const model = seededTriangle();

  it("returns the point when a click lands on a shared endpoint", () => {
    // B(-2,0) is an endpoint of both AB and BC. With both kinds enabled the
    // point should win.
    expect(hitTest(model, entities(model, ["point", "line"]), -2, 0)).toEqual({ kind: "point", id: "B" });
  });
});

describe("hitTest — lines", () => {
  const model = seededTriangle();

  it("hits a line clicked within LINE_HIT_RADIUS", () => {
    // BC runs along y=0 from x=-2..5. A click at (1, 0.1) is on it.
    expect(hitTest(model, entities(model, ["line"]), 1, 0.1)).toEqual({ kind: "line", id: "BC" });
  });

  it("misses a line clicked just outside tolerance", () => {
    const justOutside = LINE_HIT_RADIUS + 0.01;
    expect(hitTest(model, entities(model, ["line"]), 1, justOutside)).toBeNull();
  });

  it("misses a line click past its segment ends even if near the infinite line", () => {
    // BC is the segment B(-2,0)–C(5,0). Click far past C on y=0 → off the
    // segment, so perpendicular distance is to C, not 0.
    expect(hitTest(model, entities(model, ["line"]), 10, 0)).toBeNull();
  });

  it("resolves a tie to the closest line", () => {
    // Click midway on BC; AB and AC are farther away.
    expect(hitTest(model, entities(model, ["line"]), 1.5, 0.05)).toEqual({ kind: "line", id: "BC" });
  });
});
