import { describe, expect, it } from "vitest";
import type { TopicGeometryModel, TopicGeometryInteraction } from "../../../../shared/topicPractice";
import {
  buildGeometryModel,
  buildParallelSpec,
  parseParallelAnswer,
  serializeParallelEvidence,
} from "./constructParallelAdapter";

/**
 * Adapter tests. The golden values (`point:C|parallel:AD|carrier:B,E`) come
 * straight from `auxiliaryTwoRatios` Q001's accepted answer key in
 * `web/backend/src/content/topicScenarioBundle.json`, so the serialized form is
 * proven byte-identical to what the backend already grades. The partial
 * sequences mirror the incremental strings the legacy `handlePoint` /
 * `handleSegment` / `undoLast` handlers produced as the learner advanced.
 */

const CONSTRUCTION: NonNullable<TopicGeometryInteraction["construction"]> = {
  throughPoint: "C",
  parallelSegment: "AD",
  carrierPoints: ["B", "E"],
  resultPoint: "F",
};

const GEOMETRY: TopicGeometryModel = {
  viewBox: { width: 159.46, height: 121.07 },
  points: [
    { id: "A", x: 18, y: 100 },
    { id: "B", x: 9, y: 18 },
    { id: "C", x: 145, y: 18 },
    { id: "D", x: 82, y: 72 },
    { id: "E", x: 55, y: 45 },
    { id: "P", x: 82, y: 100 },
  ],
  segments: [
    { id: "AB", from: "A", to: "B" },
    { id: "BC", from: "B", to: "C" },
    { id: "AC", from: "A", to: "C" },
    { id: "AD", from: "A", to: "D" },
    { id: "BE", from: "B", to: "E" },
  ],
};

describe("buildParallelSpec", () => {
  it("maps the learner-visible construction into the machine task spec", () => {
    expect(buildParallelSpec(CONSTRUCTION)).toEqual({
      throughPointId: "C",
      referenceLineId: "AD",
      carrierPoints: ["B", "E"],
    });
  });

  it("returns null when construction is absent (no tool should start)", () => {
    expect(buildParallelSpec(undefined)).toBeNull();
  });

  it("returns a fresh 2-tuple (not the input array reference)", () => {
    const spec = buildParallelSpec(CONSTRUCTION);
    expect(spec!.carrierPoints).not.toBe(CONSTRUCTION.carrierPoints);
    expect(spec!.carrierPoints).toHaveLength(2);
  });
});

describe("buildGeometryModel", () => {
  it("round-trips points and segment-kind lines into the domain model", () => {
    const model = buildGeometryModel(GEOMETRY);
    expect(model.pointsList().map((p) => p.id).sort()).toEqual(["A", "B", "C", "D", "E", "P"]);
    const lines = model.linesList();
    expect(lines.map((l) => l.id).sort()).toEqual(["AB", "AC", "AD", "BC", "BE"]);
    expect(lines.every((l) => l.kind === "segment")).toBe(true);
  });

  it("converts SVG Y-down coordinates to JSXGraph's Y-up coordinates", () => {
    const model = buildGeometryModel(GEOMETRY);
    expect(model.getPoint("A")?.x).toBe(18);
    expect(model.getPoint("A")?.y).toBeCloseTo(21.07);
    expect(model.getPoint("B")?.x).toBe(9);
    expect(model.getPoint("B")?.y).toBeCloseTo(103.07);
  });

  it("preserves segment endpoints so the projector can resolve directions", () => {
    const model = buildGeometryModel(GEOMETRY);
    const ad = model.getLine("AD");
    expect(ad).toMatchObject({ kind: "segment", from: "A", to: "D" });
  });

  it("preserves a constructed carrier's visible extension point", () => {
    const model = buildGeometryModel({
      ...GEOMETRY,
      points: [...GEOMETRY.points, { id: "F", x: 131, y: 46, derived: true }],
      segments: [...GEOMETRY.segments, {
        id: "carrier",
        from: "B",
        to: "E",
        derived: true,
        extensionPoint: "F",
      }],
    });
    expect(model.getLine("carrier")).toMatchObject({
      kind: "segment",
      from: "B",
      to: "E",
      extensionPoint: "F",
    });
  });
});

describe("serializeParallelEvidence", () => {
  it("produces the exact accepted-answer string for Q001", () => {
    expect(
      serializeParallelEvidence({
        selectedPointId: "C",
        selectedLineId: "AD",
        carrierPointIds: ["B", "E"],
      }),
    ).toBe("point:C|parallel:AD|carrier:B,E");
  });

  it("matches the byte form the legacy handlers produced (no spaces, fixed field order)", () => {
    // Cross-checked against the second accepted answer in the bundle.
    expect(
      serializeParallelEvidence({
        selectedPointId: "E",
        selectedLineId: "BC",
        carrierPointIds: ["A", "D"],
      }),
    ).toBe("point:E|parallel:BC|carrier:A,D");
  });
});

describe("parseParallelAnswer", () => {
  it("parses a complete answer", () => {
    expect(parseParallelAnswer("point:C|parallel:AD|carrier:B,E")).toEqual({
      throughPointId: "C",
      referenceLineId: "AD",
      carrierPointIds: ["B", "E"],
    });
  });

  it("parses the partial stage-1 draft the UI writes after the first click", () => {
    expect(parseParallelAnswer("point:C")).toEqual({
      throughPointId: "C",
      referenceLineId: undefined,
      carrierPointIds: [],
    });
  });

  it("parses the partial stage-2 draft (point + parallel)", () => {
    expect(parseParallelAnswer("point:C|parallel:AD")).toEqual({
      throughPointId: "C",
      referenceLineId: "AD",
      carrierPointIds: [],
    });
  });

  it("parses the partial stage-3 draft (point + parallel + one carrier)", () => {
    expect(parseParallelAnswer("point:C|parallel:AD|carrier:B")).toEqual({
      throughPointId: "C",
      referenceLineId: "AD",
      carrierPointIds: ["B"],
    });
  });

  it("round-trips serialize -> parse -> same shape", () => {
    const evidence = {
      selectedPointId: "C",
      selectedLineId: "AD",
      carrierPointIds: ["B", "E"] as const,
    };
    expect(parseParallelAnswer(serializeParallelEvidence(evidence))).toEqual({
      throughPointId: "C",
      referenceLineId: "AD",
      carrierPointIds: ["B", "E"],
    });
  });

  it("treats an empty string as empty state", () => {
    expect(parseParallelAnswer("")).toEqual({
      throughPointId: undefined,
      referenceLineId: undefined,
      carrierPointIds: [],
    });
  });
});
