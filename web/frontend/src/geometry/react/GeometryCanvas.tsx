/**
 * GeometryCanvas — the tool-agnostic geometry surface.
 *
 * INVARIANT (POC acceptance criteria): this component MUST NOT contain any
 * `tool === "construct-parallel"`-style branching. It consumes only the
 * {@link InteractionView} (prompt / accepts / selected / preview) and the
 * {@link GeometryModel}. Adding a new tool changes the registry, never this
 * file. A grep for tool ids here should return nothing.
 */
import { useEffect, useRef, useState } from "react";
import type { GeometryModel } from "../domain/model";
import type { EntityRef } from "../interaction/events";
import type { InteractionView } from "../interaction/interaction-view";
import type { InteractionRuntime } from "../interaction/runtime";
import { mountGeometryBoard, type BoardHandles } from "./jsxgraph-board";
import { useGeometryInteraction } from "./use-geometry-interaction";

export interface GeometryCanvasProps {
  model: GeometryModel;
  runtime: InteractionRuntime;
  /** Bumped by the parent whenever the model was mutated, to force a re-render. */
  modelVersion: number;
}

export function GeometryCanvas({ model, runtime, modelVersion }: GeometryCanvasProps) {
  const { view, onClickEntity } = useGeometryInteraction(runtime, model);
  return <GeometryCanvasSurface model={model} view={view} onClickEntity={onClickEntity} modelVersion={modelVersion} />;
}

export interface GeometryCanvasSurfaceProps {
  model: GeometryModel;
  view: InteractionView;
  onClickEntity: (hit: EntityRef) => void;
  modelVersion: number;
}

/** Renderer-only entry used by the page Action Runtime. */
export function GeometryCanvasSurface({ model, view, onClickEntity, modelVersion }: GeometryCanvasSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handlesRef = useRef<BoardHandles | null>(null);
  // Pointer world position lives in the render layer — never enters the machine.
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [invalidHint, setInvalidHint] = useState<string | null>(null);

  // Keep the latest per-entity affordances available to the board's hit-test,
  // which is set up once at mount but must read the CURRENT step's entities on
  // every click. The board filters only on `entities[id].enabled`.
  const entitiesRef = useRef(view.entities);
  entitiesRef.current = view.entities;
  // Likewise keep the latest click handler: the board's onHit is wired once at
  // mount, but onClickEntity closes over `view.entities` and would otherwise
  // stay pinned to the first render (idle, no enabled entities) and silently
  // drop every click after a tool starts. Reading through the ref always invokes
  // the current one.
  const onClickEntityRef = useRef(onClickEntity);
  onClickEntityRef.current = onClickEntity;

  // Mount for the current immutable model; Action Runtime replaces the model
  // after a DomainCommand, so remounting here guarantees production Canvas
  // consumes the new draft objects rather than a stale constructor closure.
  useEffect(() => {
    if (!containerRef.current) return;
    const handles = mountGeometryBoard(containerRef.current, model, {
      getEntities: () => entitiesRef.current,
      onHit: (hit) => {
        setInvalidHint(null);
        onClickEntityRef.current(hit);
      },
      onMiss: () => {
        const enabledKinds = new Set(
          Object.values(entitiesRef.current)
            .filter((e) => e.enabled)
            .map((e) => e.kind),
        );
        setInvalidHint(
          enabledKinds.size === 0
            ? "现在没有可选对象。"
            : `请点选${[...enabledKinds].map((k) => (k === "point" ? "点" : k === "line" ? "线段" : "角")).join("或")}。`,
        );
      },
      onPointerMove: (pos) => setPointer(pos),
    });
    handlesRef.current = handles;
    return () => {
      handles.destroy();
      handlesRef.current = null;
    };
  }, [model]);

  // Clear the invalid hint as soon as the step changes (the machine advanced).
  useEffect(() => {
    setInvalidHint(null);
  }, [view.prompt]);

  // Re-render the board when the model changed OR when the view changed (so
  // per-entity affordance styling — wrong/selected/correct colors — updates as
  // the machine advances, including wrong→correct transitions within a step).
  // renderModel is an idempotent full redraw, safe to call on every view change.
  useEffect(() => {
    handlesRef.current?.render();
  }, [modelVersion, view]);

  // Size contract (plan feedback): the host (.artifact-diagram-stage) provides
  // available space; GeometryCanvas derives its own width + aspect-ratio from the
  // model's bounding box, and the board fills it 100%. This is the "外层分配空间、
  // 内层完整填满" contract — the previous fixed `height: 420px` left GeometryCanvas
  // with no size to hand down, so the board's `width: 100%` had no reference.
  const [minX, maxY, maxX, minY] = model.boundingBox();
  const aspectRatio = `${maxX - minX} / ${maxY - minY}`;

  return (
    <div className="geometry-canvas" style={{ aspectRatio }}>
      <div className="geometry-canvas__board" ref={containerRef} />
      <PreviewLine
        view={view}
        pointer={pointer}
        model={model}
      />
      {invalidHint && (
        <div className="geometry-canvas__invalid" role="alert">
          {invalidHint}
        </div>
      )}
    </div>
  );
}

/**
 * Preview is computed purely from the view spec + current pointer + model. It is
 * the report's "高频 pointer move 留在渲染层" rule: the machine never sees these
 * coordinates. Rendered as a faint SVG overlay so JSXGraph need not own it.
 *
 * The overlay's viewBox is the model's bounding box (the same box the JSXGraph
 * board mounts with), so it lines up with the board at ANY scale — the POC's
 * ~10×10 board and a 159×121 production board alike. Model coordinates are
 * math space (Y up); each `y` is flipped to SVG space (Y down) via the box's
 * vertical extent, instead of the previous hardcoded negative-height viewBox.
 */
function PreviewLine({
  view,
  pointer,
  model,
}: {
  view: InteractionView;
  pointer: { x: number; y: number } | null;
  model: GeometryModel;
}) {
  if (!view.preview) return null;
  const spec = view.preview;

  // JSXGraph convention: [minX, maxY, maxX, minY]. Build a standard SVG
  // viewBox="minX minY width height" and flip model-Y → svg-Y.
  const [minX, maxY, maxX, minY] = model.boundingBox();
  const width = maxX - minX;
  const height = maxY - minY;
  const yExtent = minY + maxY; // svgY = yExtent - modelY
  const svgY = (my: number) => yExtent - my;

  if (spec.type === "parallel-fixed") {
    const through = model.getPoint(spec.throughPointId);
    const direction = model.lineDirection(spec.referenceLineId);
    if (!through || (direction.dx === 0 && direction.dy === 0)) return null;
    const clipped = clipLineToBox(through.x, through.y, direction.dx, direction.dy, minX, minY, maxX, maxY);
    if (!clipped) return null;
    return (
      <svg className="geometry-canvas__preview" data-preview-type="parallel" viewBox={`${minX} ${minY} ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <line className="is-parallel" x1={clipped[0].x} y1={svgY(clipped[0].y)} x2={clipped[1].x} y2={svgY(clipped[1].y)} />
      </svg>
    );
  }

  if (spec.type === "intersection-fixed") {
    const parallel = model.getLine(spec.parallelLineId);
    const parallelPoint = parallel?.kind === "parallel-line" ? model.getPoint(parallel.through) : undefined;
    const direction = model.lineDirection(spec.parallelLineId);
    const first = spec.carrierPointIds[0] ? model.getPoint(spec.carrierPointIds[0]) : undefined;
    const second = spec.carrierPointIds[1] ? model.getPoint(spec.carrierPointIds[1]) : pointer;
    if (!parallelPoint || !first || !second || (direction.dx === 0 && direction.dy === 0)) return null;
    const intersection = lineLineIntersection(first.x, first.y, second.x, second.y, parallelPoint.x, parallelPoint.y, direction.dx, direction.dy);
    return (
      <svg className="geometry-canvas__preview" data-preview-type="intersection" viewBox={`${minX} ${minY} ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <line className="is-carrier" x1={first.x} y1={svgY(first.y)} x2={second.x} y2={svgY(second.y)} />
        {intersection && <circle className="is-intersection" cx={intersection.x} cy={svgY(intersection.y)} r={Math.max(width, height) * 0.018} />}
      </svg>
    );
  }

  if (!pointer) return null;

  if (spec.type === "parallel-through-hover") {
    // Direction taken from the first selected line, if any; horizontal fallback.
    const ref = view.selected.find((s: { kind: string; id: string }) => s.kind === "line");
    const dir = ref
      ? (() => {
          const d = model.lineDirection(ref.id);
          return d.dx === 0 && d.dy === 0 ? { dx: 1, dy: 0 } : d;
        })()
      : { dx: 1, dy: 0 };
    // Clip the infinite parallel line to the viewport so the preview never
    // relies on an arbitrary fixed reach (plan 第五阶段). The line passes through
    // the pointer in direction `dir`; intersect it with the box edges.
    const clipped = clipLineToBox(pointer.x, pointer.y, dir.dx, dir.dy, minX, minY, maxX, maxY);
    if (!clipped) return null;
    return (
      <svg className="geometry-canvas__preview" viewBox={`${minX} ${minY} ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <line x1={clipped[0].x} y1={svgY(clipped[0].y)} x2={clipped[1].x} y2={svgY(clipped[1].y)} />
      </svg>
    );
  }

  if (spec.type === "circle-through-hover") {
    const center = spec.centerId ? model.getPoint(spec.centerId) : undefined;
    if (!center) return null;
    const r = Math.hypot(pointer.x - center.x, pointer.y - center.y);
    return (
      <svg className="geometry-canvas__preview" viewBox={`${minX} ${minY} ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <circle cx={center.x} cy={svgY(center.y)} r={r} />
      </svg>
    );
  }

  if (spec.type === "carrier-preview") {
    const through = model.getPoint(spec.throughPointId);
    const carrier0 = model.getPoint(spec.carrier0Id);
    const refDir = model.lineDirection(spec.referenceLineId);
    if (!through || !carrier0 || (refDir.dx === 0 && refDir.dy === 0)) return null;
    // Parallel line: through `throughPointId`, direction = reference line's. Clip
    // to the viewport so it spans the visible board (plan 第五阶段).
    const parallelClipped = clipLineToBox(through.x, through.y, refDir.dx, refDir.dy, minX, minY, maxX, maxY);
    // Carrier line: from the fixed first carrier to the hovered world point.
    const carrierEnd = { x: pointer.x, y: pointer.y };
    // Intersection of the carrier line with the parallel line.
    const isx = lineLineIntersection(
      carrier0.x, carrier0.y, carrierEnd.x, carrierEnd.y,
      through.x, through.y, refDir.dx, refDir.dy,
    );
    return (
      <svg className="geometry-canvas__preview" viewBox={`${minX} ${minY} ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {parallelClipped && (
          <line
            className="is-parallel"
            x1={parallelClipped[0].x}
            y1={svgY(parallelClipped[0].y)}
            x2={parallelClipped[1].x}
            y2={svgY(parallelClipped[1].y)}
          />
        )}
        <line
          className="is-carrier"
          x1={carrier0.x}
          y1={svgY(carrier0.y)}
          x2={carrierEnd.x}
          y2={svgY(carrierEnd.y)}
        />
        {isx && <circle className="is-intersection" cx={isx.x} cy={svgY(isx.y)} r={Math.max(width, height) * 0.018} />}
      </svg>
    );
  }

  return null;
}

/**
 * Clip the infinite line through (px,py) with direction (dx,dy) to the axis-aligned
 * box [minX,minY]–[maxX,maxY]. Returns the two entry/exit points, or null if the
 * line misses the box entirely (shouldn't happen for a line through a point inside
 * the board, but guards degenerate input). Pure.
 */
function clipLineToBox(
  px: number,
  py: number,
  dx: number,
  dy: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): [{ x: number; y: number }, { x: number; y: number }] | null {
  if (dx === 0 && dy === 0) return null;
  // Liang–Barsky on the parametric line p + t*d. Find t-range inside the box.
  let t0 = -Infinity;
  let t1 = Infinity;
  const p = [-dx, dx, -dy, dy];
  const q = [px - minX, maxX - px, py - minY, maxY - py];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null; // parallel and outside this edge
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  if (t0 > t1) return null;
  return [
    { x: px + t0 * dx, y: py + t0 * dy },
    { x: px + t1 * dx, y: py + t1 * dy },
  ];
}

/**
 * Intersection of the line through (ax,ay)→(bx,by) with the infinite line through
 * (cx,cy) in direction (cdx,cdy). Returns null for parallel/degenerate input. Pure.
 */
function lineLineIntersection(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  cdx: number,
  cdy: number,
): { x: number; y: number } | null {
  // Segment direction.
  const dx = bx - ax;
  const dy = by - ay;
  const denom = dx * cdy - dy * cdx;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  // Solve ax + s*dx = cx + t*cdx ; ay + s*dy = cy + t*cdy for s (the segment param).
  const s = ((cx - ax) * cdy - (cy - ay) * cdx) / denom;
  return { x: ax + s * dx, y: ay + s * dy };
}
