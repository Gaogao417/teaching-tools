/**
 * specToWorld — projects a PocRuntimeSpec's scene into a frontend WorldState.
 *
 * This is the frontend's ONLY way to build a WorldState: it never constructs
 * one itself, never commits. The WorldState is a pure projection of whatever
 * the backend returned. This is what makes the backend the single source of
 * truth (ADR-001/ADR-002).
 *
 * No React. No JSXGraph.
 */
import type {
  IntersectionPointObject,
  MathObject,
  ParallelLineObject,
  PointObject,
  SegmentObject,
  SegmentValueObject,
  WorldState,
} from "../domain/geometry.ts";
import type { PocSceneEntity, PocSceneSpec, PocRuntimeSpec } from "../shared/runtimeContracts.ts";

export function projectSpecToWorld(spec: PocRuntimeSpec): WorldState {
  return { objects: sceneToObjects(spec.scene) };
}

export function sceneToObjects(scene: PocSceneSpec): Record<string, MathObject> {
  const objects: Record<string, MathObject> = {};
  for (const entity of scene.entities) {
    const obj = entityToObject(entity);
    if (obj) objects[obj.id] = obj;
  }
  return objects;
}

function entityToObject(entity: PocSceneEntity): MathObject | null {
  switch (entity.kind) {
    case "vertex": {
      const obj: PointObject = { kind: "point", id: entity.id, x: entity.x, y: entity.y };
      return obj;
    }
    case "edge": {
      const obj: SegmentObject = { kind: "segment", id: entity.id, endpoints: [entity.from, entity.to] };
      return obj;
    }
    case "parallel-line": {
      const obj: ParallelLineObject = {
        kind: "parallel-line",
        id: entity.id,
        through: entity.through,
        parallelTo: entity.parallelTo,
      };
      return obj;
    }
    case "intersection": {
      const obj: IntersectionPointObject = {
        kind: "intersection",
        id: entity.id,
        of: entity.of,
      };
      return obj;
    }
    case "segment-value": {
      const obj: SegmentValueObject = {
        kind: "segment-value",
        id: entity.id,
        segment: entity.segment,
        value: entity.value,
      };
      return obj;
    }
    default:
      // Unknown entity kinds are ignored (forward-compat).
      return null;
  }
}
