/**
 * Pure geometry hit-testing — no JSXGraph, no React.
 *
 * Extracted from the board adapter so the click-resolution logic (the layer the
 * old "full chain" test bypassed, and where the coordinate bug hid) can be unit-
 * tested directly. The adapter imports these and calls them with the click's
 * user coordinates.
 *
 * Tolerances scale with the board so a click feels consistent across the small
 * POC board (~10×10) and the much larger production boards
 * (`TopicGeometryModel` viewBox 159.46 × 121.07). See {@link hitTolerances}.
 */
import type { GeoLine, GeometryModel } from "./model";
import type { EntityAffordance } from "../interaction/interaction-view";
import type { EntityRef } from "../interaction/events";

/**
 * Minimum (floor) hit tolerances in user units — the POC-scale baseline. Production
 * boards are much larger, so {@link hitTolerances} grows these proportionally to the
 * board diagonal. Kept exported so tests can assert the floor behavior directly.
 */
export const POINT_HIT_RADIUS = 0.55; // user units, roughly the visible point size
export const LINE_HIT_RADIUS = 0.35; // user units, perpendicular distance to a segment

/**
 * Hit tolerances as a fraction of the board diagonal. A point's touch target is
 * ~4.5% of the diagonal (comfortable on a phone), a line's ~3%. These dominate the
 * floor constants on large boards; the floor dominates on tiny POC boards.
 */
const POINT_HIT_FRACTION = 0.045;
const LINE_HIT_FRACTION = 0.03;

export interface HitTolerances {
  /** Max distance (user units) a click can be from a point to count as a hit. */
  point: number;
  /** Max perpendicular distance (user units) from a segment to count as a hit. */
  line: number;
}

/**
 * Scale-aware hit tolerances for a model. The board diagonal is derived from the
 * bounding box (the same box JSXGraph mounts with), so the tolerances track the
 * on-screen scale regardless of board size — a touch that hits a point on the POC
 * board also hits a point on a 159×121 production board. Falls back to the floor
 * constants when the model has no geometry.
 */
export function hitTolerances(model: GeometryModel): HitTolerances {
  const [minX, maxY, maxX, minY] = model.boundingBox();
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  return {
    point: Math.max(POINT_HIT_RADIUS, POINT_HIT_FRACTION * diagonal),
    line: Math.max(LINE_HIT_RADIUS, LINE_HIT_FRACTION * diagonal),
  };
}

/**
 * Perpendicular distance from (px,py) to the segment (ax,ay)-(bx,by). Clamped to
 * the segment, not the infinite line.
 */
export function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Unambiguous geometric hit-test. Given a click in user coordinates and the
 * per-entity affordances for the current step, return the closest ENABLED
 * matching entity or null.
 *
 * Only entities whose affordance is `enabled` are candidates — that is the
 * Canvas's single filter. A wrong-but-relevant object stays enabled so its click
 * reaches the machine. Tolerances scale with the board (see {@link hitTolerances})
 * so the click feels consistent regardless of board zoom/size. When both a point
 * and a line are near, the point wins (a vertex is picked, not a segment through
 * it). Returns null (→ onMiss) when nothing enabled is within tolerance.
 */
export function hitTest(
  model: GeometryModel,
  entities: Record<string, EntityAffordance>,
  ux: number,
  uy: number,
): EntityRef | null {
  const { point: pointR, line: lineR } = hitTolerances(model);
  // Points take priority: a click on a vertex should pick the vertex, even if
  // several segments pass through it.
  let pointBest: { id: string; d: number } | null = null;
  for (const p of model.pointsList()) {
    if (!entities[p.id]?.enabled) continue;
    const d = Math.hypot(p.x - ux, p.y - uy);
    if (d <= pointR && (!pointBest || d < pointBest.d)) pointBest = { id: p.id, d };
  }
  if (pointBest) return { kind: "point", id: pointBest.id };

  let lineBest: { id: string; d: number; centerDistance: number } | null = null;
  for (const l of model.linesList()) {
    if (!entities[l.id]?.enabled) continue;
    const d = distanceToLine(model, l, ux, uy);
    if (d === null) continue;
    const centerDistance = distanceToLineCenter(model, l, ux, uy);
    const previous = lineBest ? model.getLine(lineBest.id) : undefined;
    const overlapping = previous ? shareVisualCarrier(model, l, previous, lineR) : false;
    const closer = !lineBest
      || (overlapping && Math.abs(d - lineBest.d) <= lineR * 0.2
        ? centerDistance < lineBest.centerDistance
        : d < lineBest.d - 1e-8);
    if (d <= lineR && closer) lineBest = { id: l.id, d, centerDistance };
  }
  if (lineBest) return { kind: "line", id: lineBest.id };

  return null;
}

/**
 * Collinear whole/part segments have the same perpendicular distance. In that
 * tie, the segment whose visual midpoint is nearest the click is the learner's
 * intended target (for example AP instead of the overlapping whole AD).
 */
function distanceToLineCenter(model: GeometryModel, line: GeoLine, ux: number, uy: number): number {
  if (line.kind === "segment") {
    const a = model.getPoint(line.from);
    const b = model.getPoint(line.to);
    if (a && b) return Math.hypot(ux - (a.x + b.x) / 2, uy - (a.y + b.y) / 2);
  }
  const through = line.kind === "parallel-line" ? model.getPoint(line.through) : undefined;
  return through ? Math.hypot(ux - through.x, uy - through.y) : Number.POSITIVE_INFINITY;
}

function shareVisualCarrier(model: GeometryModel, first: GeoLine, second: GeoLine, tolerance: number): boolean {
  if (first.kind !== "segment" || second.kind !== "segment") return false;
  const firstFrom = model.getPoint(first.from);
  const firstTo = model.getPoint(first.to);
  const secondFrom = model.getPoint(second.from);
  const secondTo = model.getPoint(second.to);
  if (!firstFrom || !firstTo || !secondFrom || !secondTo) return false;
  const firstDirection = {
    x: firstTo.x - firstFrom.x,
    y: firstTo.y - firstFrom.y,
  };
  const secondDirection = {
    x: secondTo.x - secondFrom.x,
    y: secondTo.y - secondFrom.y,
  };
  const firstLength = Math.hypot(firstDirection.x, firstDirection.y);
  const secondLength = Math.hypot(secondDirection.x, secondDirection.y);
  if (!firstLength || !secondLength) return false;
  const directionCross = Math.abs(firstDirection.x * secondDirection.y - firstDirection.y * secondDirection.x) / (firstLength * secondLength);
  const offset = {
    x: secondFrom.x - firstFrom.x,
    y: secondFrom.y - firstFrom.y,
  };
  const carrierDistance = Math.abs(firstDirection.x * offset.y - firstDirection.y * offset.x) / firstLength;
  return directionCross < 0.015 && carrierDistance <= tolerance * 0.2;
}

/**
 * Perpendicular distance from a click to a line, by line kind.
 * - `segment`: clamped perpendicular distance to the finite segment.
 * - `parallel-line`: perpendicular distance to the INFINITE line through
 *   `through` with the direction of `parallelTo` (a parallel line is not a
 *   finite object, so the whole line is hit-testable). Resolved via the model's
 *   recursive direction so a parallel-of-a-parallel is handled too.
 * Returns null when the line's geometry can't be resolved.
 */
function distanceToLine(
  model: GeometryModel,
  line: GeoLine,
  ux: number,
  uy: number,
): number | null {
  if (line.kind === "segment") {
    const a = model.getPoint(line.from);
    const b = model.getPoint(line.to);
    if (!a || !b) return null;
    return pointToSegmentDistance(ux, uy, a.x, a.y, b.x, b.y);
  }
  // parallel-line: distance to the infinite line through `through` ∥ `parallelTo`.
  const through = model.getPoint(line.through);
  if (!through) return null;
  const dir = model.lineDirection(line.id);
  if (dir.dx === 0 && dir.dy === 0) return null;
  // Perpendicular distance from (ux,uy) to the infinite line through `through`
  // with unit direction (dir.dx, dir.dy): |cross(dir, p - through)|.
  const px = ux - through.x;
  const py = uy - through.y;
  return Math.abs(dir.dx * py - dir.dy * px);
}
