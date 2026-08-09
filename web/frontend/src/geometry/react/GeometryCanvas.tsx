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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handlesRef = useRef<BoardHandles | null>(null);
  // Pointer world position lives in the render layer — never enters the machine.
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [invalidHint, setInvalidHint] = useState<string | null>(null);
  const { view, onClickEntity } = useGeometryInteraction(runtime, model);

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

  // Mount the board once; tear down on unmount.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="geometry-canvas">
      <div className="geometry-canvas__prompt" role="status" aria-live="polite">
        {view.prompt}
      </div>
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
      <div className="geometry-canvas__meta">
        {view.canGoBack && (
          <button type="button" className="btn btn-ghost" onClick={() => runtime.send({ type: "BACK" })}>
            上一步
          </button>
        )}
        {view.canCancel && (
          <button type="button" className="btn btn-secondary" onClick={() => runtime.cancel()}>
            取消
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Preview is computed purely from the view spec + current pointer + model. It is
 * the report's "高频 pointer move 留在渲染层" rule: the machine never sees these
 * coordinates. Rendered as a faint SVG overlay so JSXGraph need not own it.
 */
function PreviewLine({
  view,
  pointer,
  model,
}: {
  view: ReturnType<typeof useGeometryInteraction>["view"];
  pointer: { x: number; y: number } | null;
  model: GeometryModel;
}) {
  if (!view.preview || !pointer) return null;
  const spec = view.preview;

  if (spec.type === "parallel-through-hover") {
    // Direction taken from the first selected line, if any; horizontal fallback.
    const ref = view.selected.find((s: { kind: string; id: string }) => s.kind === "line");
    const dir = ref
      ? (() => {
          const d = model.lineDirection(ref.id);
          return d.dx === 0 && d.dy === 0 ? { dx: 1, dy: 0 } : d;
        })()
      : { dx: 1, dy: 0 };
    const reach = 6;
    return (
      <svg className="geometry-canvas__preview" viewBox="-10 10 20 -20" preserveAspectRatio="none">
        <line
          x1={pointer.x - dir.dx * reach}
          y1={-(pointer.y - dir.dy * reach)}
          x2={pointer.x + dir.dx * reach}
          y2={-(pointer.y + dir.dy * reach)}
        />
      </svg>
    );
  }

  if (spec.type === "circle-through-hover") {
    const center = spec.centerId ? model.getPoint(spec.centerId) : undefined;
    if (!center) return null;
    const r = Math.hypot(pointer.x - center.x, pointer.y - center.y);
    return (
      <svg className="geometry-canvas__preview" viewBox="-10 10 20 -20" preserveAspectRatio="none">
        <circle cx={center.x} cy={-center.y} r={r} />
      </svg>
    );
  }

  return null;
}

