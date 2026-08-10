import type { TopicGeometryModel } from "../../../../shared/topicPractice";
import { GeometryModel } from "../domain/model";

/** Stable geometry-to-domain adapter shared by legacy and Action Runtime v2. */
export function buildGeometryModel(geometry: TopicGeometryModel): GeometryModel {
  // Topic-bank coordinates come from SVG assets (Y grows downward), whereas
  // JSXGraph and the geometry domain use mathematical coordinates (Y grows
  // upward). Convert exactly once at this adapter boundary.
  const toMathY = (svgY: number) => geometry.viewBox.height - svgY;
  return new GeometryModel({
    points: geometry.points.map((point) => ({ id: point.id, x: point.x, y: toMathY(point.y), derived: point.derived })),
    lines: [...geometry.segments.map((segment) => ({
      id: segment.id,
      kind: "segment" as const,
      from: segment.from,
      to: segment.to,
      derived: segment.derived,
      extensionPoint: segment.extensionPoint,
    })), ...(geometry.derivedLines || []).map((line) => ({ ...line }))],
    teachingMarks: geometry.teachingMarks,
  });
}
