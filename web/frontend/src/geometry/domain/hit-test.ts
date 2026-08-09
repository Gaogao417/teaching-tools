/**
 * Pure geometry hit-testing — no JSXGraph, no React.
 *
 * Extracted from the board adapter so the click-resolution logic (the layer the
 * old "full chain" test bypassed, and where the coordinate bug hid) can be unit-
 * tested directly. The adapter imports these and calls them with the click's
 * user coordinates.
 */
import type { GeoLine, GeometryModel } from "./model";
import type { EntityAffordance } from "../interaction/interaction-view";
import type { EntityRef } from "../interaction/events";

/** User-space click tolerance: how close a click must be to count as a hit. */
export const POINT_HIT_RADIUS = 0.55; // user units, roughly the visible point size
export const LINE_HIT_RADIUS = 0.35; // user units, perpendicular distance to a segment

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
 * reaches the machine. Tolerances are in user units (not pixels), so the click
 * feels consistent regardless of board zoom/size. When both a point and a line
 * are near, the point wins (a vertex is picked, not a segment through it).
 * Returns null (→ onMiss) when nothing enabled is within tolerance.
 */
export function hitTest(
  model: GeometryModel,
  entities: Record<string, EntityAffordance>,
  ux: number,
  uy: number,
): EntityRef | null {
  // Points take priority: a click on a vertex should pick the vertex, even if
  // several segments pass through it.
  let pointBest: { id: string; d: number } | null = null;
  for (const p of model.pointsList()) {
    if (!entities[p.id]?.enabled) continue;
    const d = Math.hypot(p.x - ux, p.y - uy);
    if (d <= POINT_HIT_RADIUS && (!pointBest || d < pointBest.d)) pointBest = { id: p.id, d };
  }
  if (pointBest) return { kind: "point", id: pointBest.id };

  let lineBest: { id: string; d: number } | null = null;
  for (const l of model.linesList()) {
    if (!entities[l.id]?.enabled) continue;
    const d = distanceToLine(model, l, ux, uy);
    if (d === null) continue;
    if (d <= LINE_HIT_RADIUS && (!lineBest || d < lineBest.d)) lineBest = { id: l.id, d };
  }
  if (lineBest) return { kind: "line", id: lineBest.id };

  return null;
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
