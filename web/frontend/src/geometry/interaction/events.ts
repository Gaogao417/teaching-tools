/**
 * CanvasEvent — semantic events the UI sends to a tool machine.
 *
 * Never feed raw DOM PointerEvents into a machine. The Canvas adapter first
 * converts a hit into a stable domain interaction event, keeping the machine
 * decoupled from the renderer and the browser API.
 */
import type { AngleId, LineId, PointId } from "../domain/commands";

export type EntityKind = "point" | "line" | "angle";

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export type CanvasEvent =
  | { type: "POINT.CLICKED"; pointId: PointId }
  | { type: "LINE.CLICKED"; lineId: LineId }
  | { type: "ANGLE.CLICKED"; angleId: AngleId }
  | { type: "CONFIRM" }
  | { type: "BACK" }
  | { type: "CANCEL" };

/**
 * Pure mapping from a clicked {@link EntityRef} to the matching semantic
 * CanvasEvent. The Canvas calls this after it has already confirmed the hit's
 * kind is in the current InteractionView's `accepts` list.
 */
export function toCanvasEvent(hit: EntityRef): CanvasEvent {
  switch (hit.kind) {
    case "point":
      return { type: "POINT.CLICKED", pointId: hit.id };
    case "line":
      return { type: "LINE.CLICKED", lineId: hit.id };
    case "angle":
      return { type: "ANGLE.CLICKED", angleId: hit.id };
    default: {
      const _exhaustive: never = hit.kind;
      void _exhaustive;
      throw new Error(`toCanvasEvent: unknown entity kind ${JSON.stringify(hit)}`);
    }
  }
}
