/**
 * JSXGraph board adapter — the only module that knows about JSXGraph.
 *
 * Responsibilities:
 *  - mount a board from a {@link GeometryModel} (bounding box derived, never
 *    hardcoded);
 *  - render the model's points/lines/circles as board elements;
 *  - turn element clicks into {@link EntityRef} hits for the Canvas;
 *  - expose the current pointer world position so previews stay in the render
 *    layer (pointermove never enters the machine).
 *
 * It depends on JSXGraph + domain types only — no React, no XState. React owns
 * its lifecycle via the {@link mountGeometryBoard} factory.
 */
import JXG from "jsxgraph";
import type { GeometryModel } from "../domain/model";
import { hitTest } from "../domain/hit-test";
import type { EntityRef } from "../interaction/events";
import type { EntityAffordance, TransientCanvasEmphasis } from "../interaction/interaction-view";

/** CSS class applied for one render to elements whose emphasis key is new. */
const EMPHASIS_PULSE_CLASS = "geometry-emphasis-pulse";

export interface BoardHandles {
  /** The underlying JSXGraph board. */
  board: JXG.Board;
  /** Last known pointer position in user coordinates, or null. */
  getPointer(): { x: number; y: number } | null;
  /** Re-render all model entities onto the board (clears first). */
  render(): void;
  /** Tear the board down. */
  destroy(): void;
}

export interface BoardCallbacks {
  /** v3 on-demand UI keeps facts in the model, not permanently on the board. */
  hideTeachingMarks?: boolean;
  /**
   * Per-entity affordances for the current step. The hit-test considers ONLY
   * entities whose `enabled` is true; a wrong-but-relevant object stays enabled
   * so its click reaches the machine and produces teaching feedback. When both
   * a point and a line are geometrically near the click, the point wins (so a
   * vertex is picked, not a segment passing through it).
   */
  getEntities(): Record<string, EntityAffordance>;
  /** Fired when the learner clicks an enabled entity. */
  onHit(hit: EntityRef): void;
  /**
   * Fired when the learner clicks empty space (no entity within tolerance).
   * Lets the Canvas surface an "invalid target" message.
   */
  onMiss(): void;
  /** Fired on every pointer move with the world coordinates. */
  onPointerMove(position: { x: number; y: number }): void;
  /**
   * Optional one-shot canvas emphasis. When omitted (e.g. the POC workspace),
   * the board renders no transient highlight.
   */
  getEmphasis?(): TransientCanvasEmphasis | undefined;
}

const POINT_ATTRS_ACTIVE: Partial<JXG.PointAttributes> = {
  size: 5,
  strokeColor: "#1f64ff",
  fillColor: "#ffffff",
  fixed: true,
  showInfobox: false,
  label: { anchorX: "middle", offset: [0, 12], fontSize: 14, color: "#1f64ff" },
  withLabel: true,
} as Partial<JXG.PointAttributes>;

const POINT_ATTRS_DERIVED: Partial<JXG.PointAttributes> = {
  size: 4,
  strokeColor: "#18b7b7",
  fillColor: "#18b7b7",
  fixed: true,
  showInfobox: false,
  label: { anchorX: "middle", offset: [0, 12], fontSize: 14, color: "#18b7b7" },
  withLabel: true,
} as Partial<JXG.PointAttributes>;

const LINE_ATTRS: Partial<JXG.LineAttributes> = {
  strokeColor: "#1f64ff",
  strokeWidth: 2,
  fixed: true,
  straightFirst: false,
  straightLast: false,
  highlight: false,
} as Partial<JXG.LineAttributes>;

const LINE_ATTRS_DERIVED: Partial<JXG.LineAttributes> = {
  strokeColor: "#18b7b7",
  strokeWidth: 2,
  dash: 2,
  fixed: true,
  straightFirst: false,
  straightLast: false,
  highlight: false,
} as Partial<JXG.LineAttributes>;

const CIRCLE_ATTRS: Partial<JXG.CircleAttributes> = {
  strokeColor: "#f05a47",
  strokeWidth: 2,
  fixed: true,
  highlight: false,
} as Partial<JXG.CircleAttributes>;

/**
 * Pure resolution of the transient canvas highlight for one render.
 *
 * - `fresh` is true only when the emphasis key differs from the last one the
 *   board played, so a re-render with the same key produces no pulse targets
 *   and the animation never restarts.
 * - An emphasis-kind teaching mark has no independent renderer node, so a mark
 *   id that resolves to such a mark contributes the mark's own entity ids to
 *   `pulseEntities` instead of appearing in `pulseMarks`.
 */
export function resolveCanvasEmphasis(input: {
  emphasis?: TransientCanvasEmphasis;
  teachingMarks: readonly { id: string; kind: string; entityIds?: readonly string[]; segmentIds?: readonly string[] }[];
  lastKey?: string;
}): { fresh: boolean; pulseEntities: Set<string>; pulseMarks: Set<string> } {
  const { emphasis, teachingMarks, lastKey } = input;
  const fresh = Boolean(emphasis && emphasis.key !== lastKey);
  const pulseEntities = new Set<string>();
  const pulseMarks = new Set<string>();
  if (fresh && emphasis) {
    for (const id of emphasis.entityIds) pulseEntities.add(id);
    for (const markId of emphasis.markIds) {
      const mark = teachingMarks.find((candidate) => candidate.id === markId);
      if (mark?.kind === "emphasis") mark.entityIds?.forEach((id) => pulseEntities.add(id));
      else {
        pulseMarks.add(markId);
        if (mark?.kind === "correspondence") mark.segmentIds?.forEach(id => pulseEntities.add(id));
      }
    }
  }
  return { fresh, pulseEntities, pulseMarks };
}

/**
 * Rendered-element anchor (波次 F)：给实体元素的 DOM 节点打
 * `data-geometry-id`——e2e/调试直接按 id 定位真实渲染位置，不再重算
 * world→pixel 坐标约定（坐标约定换算曾导致 e2e 误判命中缺陷）。
 */
function tagGeometryId(element: { rendNode?: HTMLElement }, id: string): void {
  element.rendNode?.setAttribute("data-geometry-id", id);
}

/** Contain all model points with pixel margins at one uniform world→pixel scale.
 * JSXGraph bbox order: left, top, right, bottom. Expand, never stretch/crop.
 */
export function fitBBoxToViewport(
  pointsBBox: readonly [number, number, number, number],
  width: number, height: number, pixelMargin = 24,
): [number, number, number, number] {
  if (![...pointsBBox, width, height, pixelMargin].every(Number.isFinite) || width <= 0 || height <= 0 || pixelMargin < 0)
    throw new Error("Geometry viewport requires finite bounds and positive dimensions");
  const [left, top, right, bottom] = pointsBBox;
  if (right < left || top < bottom) throw new Error("Invalid geometry bounds");
  const margin = Math.min(pixelMargin, Math.min(width, height) / 4);
  // A single point / collinear diagram still needs a nonzero world interval.
  const scale = Math.min((width - 2 * margin) / Math.max(right - left, 1),
    (height - 2 * margin) / Math.max(top - bottom, 1));
  const centerX = (left + right) / 2, centerY = (top + bottom) / 2;
  return [centerX - width / scale / 2, centerY + height / scale / 2,
    centerX + width / scale / 2, centerY - height / scale / 2];
}

/**
 * Mount a JSXGraph board inside `container`, backed by `model`. Returns handles
 * the React layer uses to render, read the pointer, and tear down.
 */
export function mountGeometryBoard(
  container: HTMLDivElement,
  model: GeometryModel,
  callbacks: BoardCallbacks,
): BoardHandles {
  const initialWidth = container.clientWidth;
  const initialHeight = container.clientHeight;
  // Hidden hosts have no meaningful projection yet; the observer refits once
  // visible. A visible host must use the expanded viewport from its first draw.
  const bbox = fitBBoxToViewport(model.boundingBox(0), initialWidth > 0 ? initialWidth : 1,
    initialHeight > 0 ? initialHeight : 1);
  const board = JXG.JSXGraph.initBoard(container, {
    boundingbox: bbox,
    showCopyright: false,
    showNavigation: false,
    keepaspectratio: false,
    // Own sizing below: JSXGraph's default resize preserves its current box,
    // which can be invalid or excessively expanded after a zero-size mount.
    resize: { enabled: false, throttle: 0 },
    axis: false,
  }) as unknown as JXG.Board;

  let destroyed = false;
  let lastWidth = 0;
  let lastHeight = 0;
  const fitToContainer = (): void => {
    if (destroyed) return;
    // Layout pixels, not getBoundingClientRect(): a CSS transform must not be
    // counted twice. The board has no padding; client size excludes its border.
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) {
      lastWidth = 0; lastHeight = 0;
      return; // Hidden/unlaid-out host: wait for a positive measurement.
    }
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width; lastHeight = height;
    // Preserve responsive CSS. Refit the model, never the previous viewport:
    // repeated narrow/wide resizing must not accumulate bounding-box expansion.
    board.resizeContainer(width, height, true, true);
    // The explicit bbox aspect makes unitX == unitY. Passing true would let
    // JSXGraph guess the dominant interval again and crop narrow/tall boards.
    board.setBoundingBox(fitBBoxToViewport(model.boundingBox(0), width, height), false);
    board.fullUpdate();
  };
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(fitToContainer) : undefined;
  resizeObserver?.observe(container);
  if (!resizeObserver) window.addEventListener("resize", fitToContainer);
  fitToContainer();

  let pointer: { x: number; y: number } | null = null;

  // Last emphasis key the board has already played. A full redraw runs on every
  // view change, so without this guard a highlight would replay on unrelated
  // re-renders. We pulse only when the key is new.
  let lastEmphasisKey: string | undefined;

  // Track the pointer in user coordinates for previews (render-layer only).
  // getUsrCoordsOfMouse expects the raw browser event: internally it calls
  // Env.getPosition(evt), which reads evt.clientX/clientY. Passing an array
  // (as a previous version did) makes getPosition return [0,0], pinning every
  // click to a fixed top-left offset and breaking hit-test.
  board.on("move", (evt: unknown) => {
    const coords = board.getUsrCoordsOfMouse(evt);
    pointer = { x: coords[0], y: coords[1] };
    callbacks.onPointerMove(pointer);
  });

  // Own click handler attached directly to the container. We deliberately do
  // NOT route through JSXGraph's board.on("down") / getAllUnderMouse: that path
  // returns every element whose (sometimes infinite, for lines) region contains
  // the pointer, so at a shared endpoint a point and several lines all "hit" and
  // the picked one is ambiguous. A native DOM listener gives us the real browser
  // coordinates regardless of how JSXGraph is wired, and distance-based testing
  // is unambiguous and respects which kinds the current step accepts.
  function onPointerDown(evt: PointerEvent) {
    // Per-entity affordances drive clickability now (not a kind-level accept
    // list): only `enabled` entities are hit-test candidates, so a wrong object
    // that the step wants to diagnose stays clickable until the machine marks
    // it otherwise.
    const entities = callbacks.getEntities();
    const enabledCount = Object.values(entities).some((e) => e.enabled);
    if (!enabledCount) return;
    // Pass the raw event — see the move handler note on getUsrCoordsOfMouse.
    const [ux, uy] = board.getUsrCoordsOfMouse(evt);
    const hit = hitTest(model, entities, ux, uy);
    if (hit) callbacks.onHit(hit);
    else callbacks.onMiss();
  }
  container.addEventListener("pointerdown", onPointerDown);

  function renderModel() {
    board.suspendUpdate();
    clearUserElements(board);

    // Per-entity affordances drive styling (available/selected/wrong/correct).
    // Read fresh each render so the board reflects the current step's view.
    const entities = callbacks.getEntities();
    const teachingMarks = callbacks.hideTeachingMarks ? [] : model.teachingMarksList();
    const emphasizedIds = new Set(teachingMarks.filter((mark) => mark.kind === "emphasis").flatMap((mark) => mark.entityIds));
    // Correspondence expresses a pairing, not equal length. Use shared color,
    // never equality ticks; existing selection/error affordances retain priority.
    const correspondenceColors = new Map<string, string>();
    const pairPalette = ["#a16207", "#7c3aed", "#0369a1", "#be185d"];
    teachingMarks.filter(mark => mark.kind === "correspondence")
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((mark, index) => {
        for (const id of mark.segmentIds) {
          if (!correspondenceColors.has(id)) correspondenceColors.set(id, pairPalette[index % pairPalette.length]);
        }
      });

    // Resolve the transient highlight for this render (pure — extracted so the
    // one-key-per-play rule and the emphasis-mark fallback are unit-testable
    // without JSXGraph).
    const emphasis = callbacks.getEmphasis?.();
    const { fresh: freshEmphasis, pulseEntities, pulseMarks } = resolveCanvasEmphasis({
      emphasis,
      teachingMarks,
      lastKey: lastEmphasisKey,
    });
    lastEmphasisKey = emphasis?.key;

    // Create point elements first so lines/circles can reference them by JSXGraph
    // element (the valid parent form), not by raw {x,y} objects. Points render on
    // a higher layer so the small draggable markers sit visually above the lines.
    const pointEls = new Map<string, JXG.Point>();
    for (const point of model.pointsList()) {
      const el = board.create(
        "point",
        [point.x, point.y],
        {
          ...(point.derived ? POINT_ATTRS_DERIVED : POINT_ATTRS_ACTIVE),
          ...entityStyle(entities[point.id]),
          ...(freshEmphasis && pulseEntities.has(point.id) ? { cssClass: EMPHASIS_PULSE_CLASS } : {}),
          layer: 9,
          // Canonical construction IDs retain their namespace in the model and DOM;
          // the diagram uses the mathematical point name.
          name: point.id.replace(/^pt-([A-Z](?:[0-9]+|['′])?)$/, "$1"),
        },
      ) as JXG.Point;
      tagGeometryId(el, point.id);
      pointEls.set(point.id, el);
    }

    for (const line of model.linesList()) {
      if (line.kind === "segment") {
        const renderFromId = line.derived && line.extensionPoint ? line.to : line.from;
        const renderToId = line.derived && line.extensionPoint ? line.extensionPoint : line.to;
        const from = pointEls.get(renderFromId);
        const to = pointEls.get(renderToId);
        if (!from || !to) continue;
        const segment = board.create("line", [from, to], {
          ...(line.derived ? LINE_ATTRS_DERIVED : LINE_ATTRS),
          ...(emphasizedIds.has(line.id) ? { strokeColor: "#0f766e", strokeWidth: 4 } : {}),
          ...(correspondenceColors.has(line.id) ? { strokeColor: correspondenceColors.get(line.id), strokeWidth: 4 } : {}),
          ...entityStyle(entities[line.id]),
          ...(freshEmphasis && pulseEntities.has(line.id) ? { cssClass: EMPHASIS_PULSE_CLASS } : {}),
          layer: 7,
          name: line.id,
        }) as JXG.Line;
        tagGeometryId(segment, line.id);
      } else {
        // parallel-line: a relation (through + parallelTo). The renderer derives
        // display extent — a helper point offset from `through` along the
        // reference direction — purely for on-screen drawing. This geometry is
        // NOT stored in the model; the relation is the single source of truth.
        const through = pointEls.get(line.through);
        if (!through) continue;
        const end = line.endPoint ? pointEls.get(line.endPoint) : undefined;
        const dir = model.lineDirection(line.id);
        if (!end && dir.dx === 0 && dir.dy === 0) continue;
        const helper = end || board.create("point", [
          model.getPoint(line.through)!.x + dir.dx,
          model.getPoint(line.through)!.y + dir.dy,
        ], { visible: false, fixed: true, withLabel: false, name: "" }) as JXG.Point;
        const parallelLine = board.create("line", [through, helper], {
          ...LINE_ATTRS_DERIVED,
          ...(emphasizedIds.has(line.id) ? { strokeColor: "#0f766e", strokeWidth: 4 } : {}),
          ...(correspondenceColors.has(line.id) ? { strokeColor: correspondenceColors.get(line.id), strokeWidth: 4 } : {}),
          ...entityStyle(entities[line.id]),
          ...(freshEmphasis && pulseEntities.has(line.id) ? { cssClass: EMPHASIS_PULSE_CLASS } : {}),
          layer: 7,
          name: line.id,
          // Before the intersection exists, show the complete mathematical
          // helper line. Afterwards, C--F is a bounded construction segment.
          straightFirst: !end,
          straightLast: !end,
        }) as JXG.Line;
        tagGeometryId(parallelLine, line.id);
      }
    }

    for (const circle of model.circlesList()) {
      const center = pointEls.get(circle.centerId);
      const through = pointEls.get(circle.throughPointId);
      if (!center || !through) continue;
      const circleEl = board.create("circle", [center, through], { ...CIRCLE_ATTRS, layer: 7, name: circle.id }) as JXG.Circle;
      tagGeometryId(circleEl, circle.id);
    }

    const [minX, maxY, maxX, minY] = model.boundingBox();
    const markScale = Math.max(maxX - minX, maxY - minY);
    for (const mark of teachingMarks) {
      if (mark.kind === "segment-label") {
        const endpoints = displayLineEndpoints(model, mark.segmentId);
        if (!endpoints) continue;
        const dx = endpoints.to.x - endpoints.from.x;
        const dy = endpoints.to.y - endpoints.from.y;
        const length = Math.hypot(dx, dy) || 1;
        const offset = markScale * 0.022;
        const x = (endpoints.from.x + endpoints.to.x) / 2 - (dy / length) * offset;
        const y = (endpoints.from.y + endpoints.to.y) / 2 + (dx / length) * offset;
        const value = displayTeachingLatex(mark.valueLatex);
        const displayValue = mark.labelKind === "share" ? `${value} 份` : value;
        const markPulsed = freshEmphasis && pulseMarks.has(mark.id);
        board.create("text", [x, y, displayValue], {
          fixed: true,
          anchorX: "middle",
          anchorY: "middle",
          fontSize: 16,
          color: mark.labelKind === "share" ? "#a16207" : "#0f766e",
          cssClass: `geometry-teaching-label is-${mark.labelKind}${markPulsed ? ` ${EMPHASIS_PULSE_CLASS}` : ""}`,
          highlight: false,
          layer: 10,
        }) as JXG.Text;
        continue;
      }

    }

    board.unsuspendUpdate();
  }

  return {
    board,
    getPointer: () => pointer,
    render: renderModel,
    destroy: () => {
      destroyed = true;
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", fitToContainer);
      container.removeEventListener("pointerdown", onPointerDown);
      try {
        JXG.JSXGraph.freeBoard(board as unknown as Parameters<typeof JXG.JSXGraph.freeBoard>[0]);
      } catch {
        // Board may already be gone during React StrictMode double-invoke.
      }
    },
  };
}

function displayLineEndpoints(model: GeometryModel, lineId: string): { from: { x: number; y: number }; to: { x: number; y: number } } | undefined {
  const line = model.getLine(lineId);
  if (!line) return undefined;
  if (line.kind === "segment") {
    const from = model.getPoint(line.from);
    const to = model.getPoint(line.to);
    return from && to ? { from, to } : undefined;
  }
  const from = model.getPoint(line.through);
  const to = line.endPoint ? model.getPoint(line.endPoint) : undefined;
  return from && to ? { from, to } : undefined;
}

function displayTeachingLatex(value: string): string {
  return value
    .replace(/^\$|\$$/g, "")
    .replace(/\\d?frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2")
    .replace(/\\sqrt\{([^{}]+)\}/g, "√$1")
    .replace(/\\angle\s*/g, "∠")
    .replace(/\\(?:left|right)/g, "")
    .replace(/[{}]/g, "");
}

/**
 * Remove every element the adapter created, leaving the board clean for the
 * next render. We remove everything that is not an inherent board fixture.
 */
function clearUserElements(board: JXG.Board) {
  const objects = (board as unknown as { objects: Record<string, unknown> }).objects ?? {};
  for (const id of Object.keys(objects)) {
    try {
      board.removeObject(id as unknown as JXG.GeometryElement);
    } catch {
      // Ignore fixtures that can't be removed.
    }
  }
}

/**
 * Map an entity's affordance `visualState` to JSXGraph stroke/fill color attrs.
 * The affordance is the only place teaching-truth (`expected`/`wrong`) lives;
 * the renderer turns it into color so the learner sees what the machine decided.
 * Returns an empty object for entities with no affordance (idle / not in step).
 */
function entityStyle(
  affordance: EntityAffordance | undefined,
): Partial<JXG.PointAttributes> & Partial<JXG.LineAttributes> {
  if (!affordance) return {};
  switch (affordance.visualState) {
    case "wrong":
      return { strokeColor: "#e0364b", fillColor: "#fdecee" };
    case "selected":
      return { strokeColor: "#1f64ff", fillColor: "#1f64ff" };
    case "correct":
      return { strokeColor: "#18b7b7", fillColor: "#18b7b7" };
    default:
      return {};
  }
}
