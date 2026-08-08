/**
 * makeParallel — "construct the line through A parallel to BC (intersecting DE at F)".
 *
 * No React. No JSXGraph. Pure state machine.
 */
import { defineAction } from "../domain/action.ts";
import type { ActionDefinition, ActionTransition } from "../domain/action.ts";
import type { GeometryEvent } from "../domain/events.ts";
import { view } from "../domain/interaction.ts";
import type { InteractionView } from "../domain/interaction.ts";
import { withObject } from "../domain/geometry.ts";
import type {
  PointId,
  SegmentId,
  LineId,
  WorldState,
} from "../domain/geometry.ts";

export interface MakeParallelParams {
  through: PointId;
  parallelTo: SegmentId;
  /** Optional carrier segment that the new line should intersect. */
  intersectionWith?: SegmentId;
  /** Id to give the resulting intersection point. */
  intersectionPoint?: PointId;
}

export type MakeParallelState =
  | { stage: "pick-through-point" }
  | { stage: "pick-parallel-segment"; through: PointId };

export interface MakeParallelResult {
  through: PointId;
  parallelTo: SegmentId;
  /** Id of the committed parallel-line object. */
  lineId: LineId;
}

/** Deterministic id for the committed parallel line. */
export function parallelLineId(through: PointId, parallelTo: SegmentId): LineId {
  return `parallel:${through}:${parallelTo}`;
}

const definition: ActionDefinition<
  MakeParallelParams,
  MakeParallelState,
  MakeParallelResult
> = {
  actionKind: "make-parallel",

  init: () => ({ stage: "pick-through-point" }),

  reduce: (
    state: MakeParallelState,
    event: GeometryEvent,
    params: MakeParallelParams,
    _world: WorldState,
  ): ActionTransition<MakeParallelState, MakeParallelResult> => {
    if (state.stage === "pick-through-point") {
      if (event.kind === "point-click" && event.id === params.through) {
        return {
          kind: "continue",
          state: { stage: "pick-parallel-segment", through: event.id },
        };
      }
      return {
        kind: "reject",
        state,
        message: `请选择点 ${params.through} 作为平行线经过的点。`,
      };
    }

    // stage === "pick-parallel-segment"
    if (event.kind === "segment-click" && event.id === params.parallelTo) {
      return {
        kind: "complete",
        result: {
          through: state.through,
          parallelTo: params.parallelTo,
          lineId: parallelLineId(state.through, params.parallelTo),
        },
      };
    }
    return {
      kind: "reject",
      state,
      message: `请选择线段 ${params.parallelTo} 作为平行的对象。`,
    };
  },

  view: (
    state: MakeParallelState,
    params: MakeParallelParams,
    _world: WorldState,
  ): InteractionView => {
    if (state.stage === "pick-through-point") {
      return view({
        clickablePoints: [params.through],
        clickableSegments: [],
        prompt: `请选择平行线经过的点（点 ${params.through}）。`,
        inputs: [],
      });
    }
    return view({
      clickablePoints: [],
      clickableSegments: [params.parallelTo],
      highlightedObjects: [state.through],
      prompt: `请选择要平行的线段（线段 ${params.parallelTo}）。`,
      inputs: [],
    });
  },

  commit: (
    world: WorldState,
    result: MakeParallelResult,
    params: MakeParallelParams,
  ): WorldState => {
    let next = withObject(world, {
      kind: "parallel-line",
      id: result.lineId,
      through: result.through,
      parallelTo: result.parallelTo,
    });

    // Optionally record the intersection point as a dependency (no coordinates).
    if (params.intersectionWith && params.intersectionPoint) {
      next = withObject(next, {
        kind: "intersection",
        id: params.intersectionPoint,
        of: [result.lineId, params.intersectionWith],
      });
    }
    return next;
  },
};

/** Factory: build a RuntimeAction for this makeParallel instance. */
export function makeParallel(params: MakeParallelParams) {
  return defineAction(definition, params);
}
