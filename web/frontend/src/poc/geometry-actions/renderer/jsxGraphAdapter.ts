/**
 * jsxGraphAdapter — projects WorldState + InteractionView onto a JXG board.
 *
 * This module is the ONLY place where JSXGraph objects are created. Its job:
 *   1. Maintain Map<MathObjectId, JXG.GeometryElement>.
 *   2. Create new elements for new MathObjects (by kind), resolving derived
 *      objects' dependencies against the existing element map.
 *   3. Remove elements whose MathObject disappeared from the world.
 *   4. Apply InteractionView-driven styling (clickable, highlighted).
 *   5. Translate raw JSXGraph "down" events into domain GeometryEvents. The
 *      raw JXG Event object is NEVER passed out — only the {kind, id} union.
 *
 * It is an imperative projector. It never mutates the WorldState.
 *
 * Note on types: jsxgraph's bundled typings (src/index.d.ts) provide typed
 * overloads for `create("point"|"line"|"text", ...)`. There are NO typed
 * overloads for "segment" / "parallel" / "intersection" — those calls are made
 * via a small `createEl(...)` helper whose elementType is intentionally typed
 * as a plain string. This matches the official JSXGraph runtime API; we are
 * not inventing types here.
 */
import JXG from "jsxgraph";
import type { Board, GeometryElement, Point } from "jsxgraph";
import type { GeometryEvent } from "../domain/events.ts";
import type {
  IntersectionPointObject,
  MathObject,
  MathObjectId,
  ParallelLineObject,
  PointId,
  SegmentObject,
  SegmentValueObject,
  WorldState,
} from "../domain/geometry.ts";
import type { InteractionView } from "../domain/interaction.ts";

/** A registration capturing a board element bound to a world id. */
interface RegisteredElement {
  element: GeometryElement;
  /** Detach the click handler (if any) before removal. */
  detach?: () => void;
  /** Whether the "down" handler has already been bound (avoid dupes). */
  bound?: boolean;
}

/** Build a fresh, empty board inside `container`. */
export function createBoard(container: HTMLElement): Board {
  return JXG.JSXGraph.initBoard(container, {
    boundingbox: [-6, 6, 8, -4],
    axis: false,
    showCopyright: false,
    showNavigation: false,
    pan: { enabled: false },
    zoom: { wheel: false, needShift: true },
  } as Partial<JXG.BoardAttributes>);
}

export function destroyBoard(board: Board): void {
  try {
    JXG.JSXGraph.freeBoard(board);
  } catch {
    // ignore double-free during React StrictMode double mount/unmount
  }
}

/**
 * Stateful projector. One instance owns the element map for one board.
 */
export class JsxGraphAdapter {
  private readonly board: Board;
  private readonly onEvent: (event: GeometryEvent) => void;
  private readonly elements = new Map<MathObjectId, RegisteredElement>();

  constructor(board: Board, onEvent: (event: GeometryEvent) => void) {
    this.board = board;
    this.onEvent = onEvent;
  }

  /**
   * Reconcile the board against `world` + `interaction`. Idempotent.
   */
  render(world: WorldState, interaction: InteractionView | null): void {
    this.board.suspendUpdate();
    try {
      this.syncWorld(world);
      this.applyInteraction(world, interaction);
    } finally {
      this.board.unsuspendUpdate();
    }
  }

  /** Remove every element (e.g. on teardown). */
  dispose(): void {
    for (const { element, detach } of this.elements.values()) {
      detach?.();
      try {
        this.board.removeObject(element);
      } catch {
        /* noop */
      }
    }
    this.elements.clear();
  }

  // --- world reconciliation -------------------------------------------------

  private syncWorld(world: WorldState): void {
    const liveIds = new Set<MathObjectId>();

    // Create/update every object in dependency-friendly order: free points &
    // segments first, then derived objects, then value labels.
    const ordered = orderForCreation(world.objects);
    for (const obj of ordered) {
      liveIds.add(obj.id);
      this.ensureObject(obj, world);
    }

    // Remove anything no longer in the world.
    for (const [id, reg] of [...this.elements.entries()]) {
      if (!liveIds.has(id)) {
        reg.detach?.();
        try {
          this.board.removeObject(reg.element);
        } catch {
          /* noop */
        }
        this.elements.delete(id);
      }
    }
  }

  private ensureObject(obj: MathObject, world: WorldState): void {
    // The POC world is append-only during a session, so a present element is
    // up to date. (A production system would hash-and-compare here.)
    if (this.elements.has(obj.id)) return;

    switch (obj.kind) {
      case "point":
        this.createPoint(obj.id, obj.x, obj.y);
        break;
      case "segment":
        this.createSegment(obj);
        break;
      case "parallel-line":
        this.createParallelLine(obj);
        break;
      case "intersection":
        this.createIntersection(obj);
        break;
      case "segment-value":
        this.createSegmentValueLabel(obj, world);
        break;
      default:
        // Exhaustiveness guard.
        break;
    }
  }

  private createPoint(id: PointId, x: number, y: number): void {
    const el = this.board.create(
      "point",
      [x, y],
      { name: id, size: 3, fixed: true, showInfobox: false } as Partial<JXG.PointAttributes>,
    );
    this.elements.set(id, { element: el });
  }

  private createSegment(obj: SegmentObject): void {
    const a = this.elements.get(obj.endpoints[0])?.element;
    const b = this.elements.get(obj.endpoints[1])?.element;
    if (!a || !b) return;
    const el = this.createEl("segment", [a, b], {
      strokeWidth: 2,
      fixed: true,
    });
    this.elements.set(obj.id, { element: el });
  }

  private createParallelLine(obj: ParallelLineObject): void {
    const throughEl = this.elements.get(obj.through)?.element;
    const carrier = this.elements.get(obj.parallelTo)?.element;
    if (!throughEl || !carrier) return;
    // JSXGraph parallel parent order is [line, point] (confirmed from docs).
    const el = this.createEl("parallel", [carrier, throughEl], {
      dash: 2,
      strokeWidth: 2,
      strokeColor: "#3b82f6",
      fixed: true,
      highlight: false,
    });
    this.elements.set(obj.id, { element: el });
  }

  private createIntersection(obj: IntersectionPointObject): void {
    const [lineId, segId] = obj.of;
    const lineEl = this.elements.get(lineId)?.element;
    const segEl = this.elements.get(segId)?.element;
    if (!lineEl || !segEl) return;
    // parents: [el1, el2, i] where i picks which intersection point.
    const el = this.createEl("intersection", [lineEl, segEl, 0], {
      name: obj.id,
      size: 3,
      strokeColor: "#ef4444",
      fillColor: "#ef4444",
      fixed: true,
      showInfobox: false,
    });
    this.elements.set(obj.id, { element: el });
  }

  private createSegmentValueLabel(obj: SegmentValueObject, world: WorldState): void {
    const seg = world.objects[obj.segment];
    if (!seg || seg.kind !== "segment") return;
    const aEl = this.elements.get(seg.endpoints[0])?.element as Point | undefined;
    const bEl = this.elements.get(seg.endpoints[1])?.element as Point | undefined;
    if (!aEl || !bEl) return;
    const midX = (aEl.X() + bEl.X()) / 2;
    const midY = (aEl.Y() + bEl.Y()) / 2 + 0.45;
    const label = this.board.create(
      "text",
      [midX, midY, `${obj.segment} = ${obj.value}`],
      {
        fontSize: 14,
        anchorX: "middle",
        color: "#0f766e",
        fixed: true,
      } as Partial<JXG.TextAttributes>,
    );
    // value objects are metadata, not interactive board geometry; track them
    // as elements so the removal pass manages them consistently.
    this.elements.set(obj.id, { element: label });
  }

  // --- interaction styling --------------------------------------------------

  private applyInteraction(world: WorldState, interaction: InteractionView | null): void {
    const clickablePoints = new Set<PointId>(interaction?.clickablePoints ?? []);
    const clickableSegments = new Set<PointId>(interaction?.clickableSegments ?? []);
    const highlighted = new Set<MathObjectId>(interaction?.highlightedObjects ?? []);

    for (const obj of Object.values(world.objects)) {
      const reg = this.elements.get(obj.id);
      if (!reg) continue;
      const isHighlighted = highlighted.has(obj.id);

      if (obj.kind === "point") {
        const clickable = clickablePoints.has(obj.id);
        // size/fillColor/strokeColor are valid JSXGraph runtime attributes but
        // the typings scope `size` under PointAttributes; cast at this single
        // renderer-only call site.
        const attrs: Record<string, unknown> = {
          size: clickable || isHighlighted ? 5 : 3,
          fillColor: isHighlighted ? "#f59e0b" : clickable ? "#22c55e" : "#1f2937",
          strokeColor: isHighlighted ? "#f59e0b" : "#1f2937",
        };
        (reg.element.setAttribute as (a: Record<string, unknown>) => void)(attrs);
        this.attachClickHandler(reg, obj.id, "point-click");
      } else if (obj.kind === "segment") {
        const clickable = clickableSegments.has(obj.id);
        const attrs: Record<string, unknown> = {
          strokeWidth: clickable || isHighlighted ? 4 : 2,
          strokeColor: isHighlighted ? "#f59e0b" : clickable ? "#22c55e" : "#1f2937",
        };
        (reg.element.setAttribute as (a: Record<string, unknown>) => void)(attrs);
        this.attachClickHandler(reg, obj.id, "segment-click");
      }
    }
  }

  private attachClickHandler(
    reg: RegisteredElement,
    id: MathObjectId,
    eventKind: "point-click" | "segment-click",
  ): void {
    if (reg.bound) return;
    reg.bound = true;
    reg.element.on("down", () => {
      // The raw JXG event is deliberately dropped here.
      this.onEvent({ kind: eventKind, id });
    });
  }

  /**
   * Helper for element types the jsxgraph typings don't overload on
   * (segment / parallel / intersection). The elementType string and parent
   * shapes follow the official JSXGraph runtime API.
   */
  private createEl(
    elementType: string,
    parents: unknown[],
    attributes?: Record<string, unknown>,
  ): GeometryElement {
    // The runtime overload is `create(elementType: string, parents, attrs)`;
    // the typings don't expose it, so we cast through unknown at this single
    // boundary inside the renderer.
    const boardAny = this.board as unknown as {
      create(t: string, p: unknown[], a?: Record<string, unknown>): GeometryElement;
    };
    return boardAny.create(elementType, parents, attributes);
  }
}

/**
 * Order objects so dependents come after their dependencies:
 * points -> segments -> derived lines/intersections -> (values created inline).
 */
function orderForCreation(objects: Record<MathObjectId, MathObject>): MathObject[] {
  const result: MathObject[] = [];
  const seen = new Set<MathObjectId>();
  const pushKind = (kind: MathObject["kind"]): void => {
    for (const obj of Object.values(objects)) {
      if (obj.kind === kind && !seen.has(obj.id)) {
        result.push(obj);
        seen.add(obj.id);
      }
    }
  };
  pushKind("point");
  pushKind("segment");
  pushKind("parallel-line");
  pushKind("intersection");
  pushKind("segment-value");
  return result;
}
