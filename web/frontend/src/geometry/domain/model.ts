/**
 * GeometryModel — the single source of truth for geometry.
 *
 * The model owns points, lines, and circles. It knows nothing about tools,
 * interaction steps, React, JSXGraph, or XState. It exposes immutable queries
 * plus narrow mutators that {@link CommandExecutor} is the only caller of.
 *
 * Coordinates are in math space (y points up) so they map directly onto a
 * JSXGraph `boundingbox`. Storing raw coordinates here — rather than derived
 * UX state — is what keeps the model reusable across renderers and agents.
 */
import type { LineId, PointId } from "./commands";

export interface GeoPoint {
  id: PointId;
  x: number;
  y: number;
  /**
   * `true` for points that existed when the scenario was loaded, `false` for
   * points the learner constructed. The POC uses this only for styling; it
   * carries no answer truth.
   */
  derived?: boolean;
}

/**
 * A line is modeled as a *mathematical relation*, never as stored display
 * geometry. This mirrors {@link GeoCircle} (center + through point, no stored
 * radius/range): the renderer derives on-screen extent from the relation.
 *
 * - `segment`: the finite line through two points.
 * - `parallel-line`: the (infinite, for hit-test) line through `through` parallel
 *   to `parallelTo`. The reference line is resolved recursively, so a parallel
 *   of a parallel still has a well-defined direction.
 *
 * Storing the relation — not a synthesized endpoint + segment alongside it —
 * keeps a single source of truth: there is no second `segment` whose
 * coordinates could drift out of sync with the parallel declaration.
 */
export type GeoLine =
  | (GeoLineBase & {
      kind: "segment";
      /** Id of one point the segment passes through. */
      from: PointId;
      /** Id of the other point the segment passes through. */
      to: PointId;
      /** Optional constructed continuation rendered from `to` to this point. */
      extensionPoint?: PointId;
    })
  | (GeoLineBase & {
      kind: "parallel-line";
      /** Id of the point the line passes through. */
      through: PointId;
      /** Id of the line this line is parallel to. */
      parallelTo: LineId;
      /** Optional visible endpoint after the helper line has intersected. */
      endPoint?: PointId;
    });

interface GeoLineBase {
  id: LineId;
  /**
   * `true` for lines that existed when the scenario was loaded, `false` for
   * lines the learner constructed. Styling-only metadata; carries no answer truth.
   */
  derived?: boolean;
}

export interface GeoCircle {
  id: string;
  centerId: PointId;
  throughPointId: PointId;
  derived?: true;
}

export class GeometryModel {
  private readonly points = new Map<PointId, GeoPoint>();
  private readonly lines = new Map<LineId, GeoLine>();
  private readonly circles = new Map<string, GeoCircle>();

  constructor(seed: { points?: GeoPoint[]; lines?: GeoLine[]; circles?: GeoCircle[] } = {}) {
    for (const p of seed.points ?? []) this.points.set(p.id, { ...p });
    for (const l of seed.lines ?? []) this.lines.set(l.id, { ...l });
    for (const c of seed.circles ?? []) this.circles.set(c.id, { ...c });
  }

  // ---- points ---------------------------------------------------------------
  getPoint(id: PointId): GeoPoint | undefined {
    const p = this.points.get(id);
    return p ? { ...p } : undefined;
  }

  hasPoint(id: PointId): boolean {
    return this.points.has(id);
  }

  /** All points, insertion order. */
  pointsList(): readonly GeoPoint[] {
    return [...this.points.values()].map((p) => ({ ...p }));
  }

  addPoint(point: GeoPoint): GeoPoint {
    if (this.points.has(point.id)) {
      throw new Error(`GeometryModel: duplicate point id "${point.id}"`);
    }
    this.points.set(point.id, { ...point });
    return { ...point };
  }

  // ---- lines ----------------------------------------------------------------
  getLine(id: LineId): GeoLine | undefined {
    const l = this.lines.get(id);
    return l ? { ...l } : undefined;
  }

  hasLine(id: LineId): boolean {
    return this.lines.has(id);
  }

  linesList(): readonly GeoLine[] {
    return [...this.lines.values()].map((l) => ({ ...l }));
  }

  /**
   * Register a line that passes through two existing points. The caller is
   * responsible for ensuring both points exist (the executor validates this).
   */
  addLine(line: GeoLine): GeoLine {
    if (this.lines.has(line.id)) {
      throw new Error(`GeometryModel: duplicate line id "${line.id}"`);
    }
    this.lines.set(line.id, { ...line });
    return { ...line };
  }

  // ---- circles --------------------------------------------------------------
  getCircle(id: string): GeoCircle | undefined {
    const c = this.circles.get(id);
    return c ? { ...c } : undefined;
  }

  circlesList(): readonly GeoCircle[] {
    return [...this.circles.values()].map((c) => ({ ...c }));
  }

  addCircle(circle: GeoCircle): GeoCircle {
    if (this.circles.has(circle.id)) {
      throw new Error(`GeometryModel: duplicate circle id "${circle.id}"`);
    }
    this.circles.set(circle.id, { ...circle });
    return { ...circle };
  }

  // ---- view box -------------------------------------------------------------
  /**
   * Compute a `[x1, y1, x2, y2]` bounding box (JSXGraph convention: left, top,
   * right, bottom in user coordinates) that fits every point with padding.
   * Falls back to a small default viewport when there are no points.
   */
  boundingBox(padding = 4): [number, number, number, number] {
    const pts = this.pointsList();
    if (pts.length === 0) return [-6, 6, 8, -4];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) - padding;
    const maxX = Math.max(...xs) + padding;
    const minY = Math.min(...ys) - padding;
    const maxY = Math.max(...ys) + padding;
    return [minX, maxY, maxX, minY];
  }

  /**
   * Direction vector (normalized) of any line, regardless of whether it is a
   * `segment` or a `parallel-line`. A parallel-line resolves its reference line
   * recursively, with a cycle guard so a malformed `parallelTo` chain cannot
   * loop forever. Returns `{0,0}` for a degenerate or dangling line.
   */
  lineDirection(lineId: LineId): { dx: number; dy: number } {
    const seen = new Set<LineId>();
    let current: GeoLine | undefined = this.lines.get(lineId);
    while (current && current.kind === "parallel-line") {
      if (seen.has(current.id)) return { dx: 0, dy: 0 }; // cycle → degenerate
      seen.add(current.id);
      current = this.lines.get(current.parallelTo);
    }
    if (!current || current.kind !== "segment") return { dx: 0, dy: 0 };
    const a = this.points.get(current.from);
    const b = this.points.get(current.to);
    if (!a || !b) return { dx: 0, dy: 0 };
    return lineDirection(a, b);
  }
}

/**
 * Direction vector of a line defined by two points, normalized to length 1.
 * Used by the parallel-line construction. Pure function, no model dependency.
 */
export function lineDirection(from: { x: number; y: number }, to: { x: number; y: number }): { dx: number; dy: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { dx: 0, dy: 0 };
  return { dx: dx / len, dy: dy / len };
}
