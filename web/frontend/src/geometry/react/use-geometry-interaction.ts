/**
 * useGeometryInteraction — React binding for {@link InteractionRuntime}.
 *
 * The report's binding principle: subscribe to the runtime, and let components
 * select only the view fields they need. This hook re-renders on every runtime
 * change (the POC is small), and exposes a single `onClickEntity` that performs
 * the "is this kind accepted?" filter plus the semantic-event translation — so
 * the Canvas never branches on tool id.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { GeometryModel } from "../domain/model";
import type { EntityRef } from "../interaction/events";
import { toCanvasEvent } from "../interaction/events";
import { idleView, type InteractionView } from "../interaction/interaction-view";
import type { InteractionRuntime } from "../interaction/runtime";
import type { ToolId, ToolInput } from "../interaction/tool-registry";

export interface GeometryInteraction {
  view: InteractionView;
  activeTool: ToolId | undefined;
  startTool: <Id extends ToolId>(toolId: Id, input: ToolInput[Id]) => void;
  cancel: () => void;
  /** Translate a clicked entity into the right CanvasEvent, if its affordance is enabled now. */
  onClickEntity: (hit: EntityRef) => void;
}

export function useGeometryInteraction(runtime: InteractionRuntime, _model: GeometryModel): GeometryInteraction {
  // useSyncExternalStore keeps the view in lockstep with the runtime's notify().
  const view = useSyncExternalStore(
    (cb) => runtime.subscribe(cb),
    () => runtime.getView(),
    () => idleView,
  );
  const activeTool = useSyncExternalStore(
    (cb) => runtime.subscribe(cb),
    () => runtime.activeToolId(),
    () => undefined,
  );

  // No per-field selector effect needed for the POC; the runtime is the source.
  useEffect(() => {
    void _model;
  }, [_model]);

  const onClickEntity = useCallback(
    (hit: EntityRef) => {
      // Filter on the per-entity `enabled` affordance (not a kind-level list):
      // a wrong-but-relevant object stays enabled so the machine can diagnose it.
      if (!view.entities[hit.id]?.enabled) return;
      runtime.send(toCanvasEvent(hit));
    },
    [runtime, view.entities],
  );

  return useMemo(
    () => ({
      view,
      activeTool,
      startTool: <Id extends ToolId>(toolId: Id, input: import("../interaction/tool-registry").ToolInput[Id]) =>
        runtime.startTool(toolId, input),
      cancel: () => runtime.cancel(),
      onClickEntity,
    }),
    [view, activeTool, runtime, onClickEntity],
  );
}
