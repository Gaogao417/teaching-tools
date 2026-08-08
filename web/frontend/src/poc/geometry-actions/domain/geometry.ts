/**
 * WorldState — the mathematical world.
 *
 * Invariants for this POC:
 *   1. NEVER store React or JSXGraph objects here. Only pure data.
 *   2. Free (given) objects may carry concrete coordinates, because they define
 *      the initial figure. Derived objects should express *mathematical
 *      dependency* on other MathObjects, NOT precomputed coordinates.
 *
 * The JSXGraph renderer is responsible for resolving these dependencies into
 * concrete board elements. The domain layer must remain renderer-agnostic.
 */

export type PointId = string;
export type SegmentId = string;
export type LineId = string;
export type MathObjectId = string;

/** A free/given point. Carries coordinates because it seeds the figure. */
export interface PointObject {
  kind: "point";
  id: PointId;
  x: number;
  y: number;
}

/** A given segment connecting two points by id. */
export interface SegmentObject {
  kind: "segment";
  id: SegmentId;
  endpoints: [PointId, PointId];
}

/** A derived line through `through` parallel to the carrier segment `parallelTo`. */
export interface ParallelLineObject {
  kind: "parallel-line";
  id: LineId;
  through: PointId;
  parallelTo: SegmentId;
}

/** A derived point at the intersection of two 1-D objects. No coordinates. */
export interface IntersectionPointObject {
  kind: "intersection";
  id: PointId;
  of: [LineId, SegmentId];
}

/** A value attached to a segment (e.g. its measured length). Added by markSegmentValue. */
export interface SegmentValueObject {
  kind: "segment-value";
  id: string;
  segment: SegmentId;
  value: string;
}

export type MathObject =
  | PointObject
  | SegmentObject
  | ParallelLineObject
  | IntersectionPointObject
  | SegmentValueObject;

export interface WorldState {
  objects: Record<MathObjectId, MathObject>;
}

/** Look up an object, narrowed to a specific kind. */
export function getObject<T extends MathObject["kind"]>(
  world: WorldState,
  id: MathObjectId,
  kind: T,
): Extract<MathObject, { kind: T }> | undefined {
  const obj = world.objects[id];
  if (obj && obj.kind === kind) return obj as Extract<MathObject, { kind: T }>;
  return undefined;
}

/** Pure helper: returns a new WorldState with an object added/overwritten. */
export function withObject(world: WorldState, obj: MathObject): WorldState {
  return { objects: { ...world.objects, [obj.id]: obj } };
}
