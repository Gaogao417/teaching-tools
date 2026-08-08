/**
 * GeometryEvent — domain-level interaction events.
 *
 * The renderer converts raw JSXGraph events into these. A JXG event object
 * must NEVER escape the renderer boundary.
 */
import type { MathObjectId, PointId, SegmentId } from "./geometry.ts";

export type GeometryEvent =
  | { kind: "point-click"; id: PointId }
  | { kind: "segment-click"; id: SegmentId }
  | { kind: "input-change"; objectId: MathObjectId; value: string }
  | { kind: "submit" };
