/**
 * markSegmentValue — "click segment BC, then enter its value (e.g. 3)".
 *
 * Demonstrates the abstraction holds for a structurally DIFFERENT action:
 *   - two stages, but the second stage consumes `input-change` + `submit`
 *     events (not click events), and uses the generic InteractionView.inputs
 *     field rather than any action-specific canvas field.
 *
 * No React. No JSXGraph. Pure state machine.
 */
import { defineAction } from "../domain/action.ts";
import type { ActionDefinition, ActionTransition } from "../domain/action.ts";
import type { GeometryEvent } from "../domain/events.ts";
import { view } from "../domain/interaction.ts";
import type { InteractionView } from "../domain/interaction.ts";
import { withObject } from "../domain/geometry.ts";
import type { SegmentId, WorldState } from "../domain/geometry.ts";

export interface MarkSegmentValueParams {
  segment: SegmentId;
  expected: string;
}

export type MarkSegmentValueState =
  | { stage: "pick-segment" }
  | { stage: "enter-value"; inputValue: string };

export interface MarkSegmentValueResult {
  segment: SegmentId;
  value: string;
}

/** Deterministic id for the committed segment-value object. */
export function segmentValueId(segment: SegmentId): string {
  return `value:${segment}`;
}

const definition: ActionDefinition<
  MarkSegmentValueParams,
  MarkSegmentValueState,
  MarkSegmentValueResult
> = {
  actionKind: "mark-segment-value",

  init: () => ({ stage: "pick-segment" }),

  reduce: (
    state: MarkSegmentValueState,
    event: GeometryEvent,
    params: MarkSegmentValueParams,
    _world: WorldState,
  ): ActionTransition<MarkSegmentValueState, MarkSegmentValueResult> => {
    if (state.stage === "pick-segment") {
      if (event.kind === "segment-click" && event.id === params.segment) {
        return {
          kind: "continue",
          state: { stage: "enter-value", inputValue: "" },
        };
      }
      return {
        kind: "reject",
        state,
        message: `请选择正确的线段（线段 ${params.segment}）。`,
      };
    }

    // stage === "enter-value"
    if (event.kind === "input-change") {
      return {
        kind: "continue",
        state: { stage: "enter-value", inputValue: event.value },
      };
    }
    if (event.kind === "submit") {
      if (state.inputValue.trim() === params.expected) {
        return {
          kind: "complete",
          result: { segment: params.segment, value: state.inputValue.trim() },
        };
      }
      return {
        kind: "reject",
        state,
        message: `不正确，请重新输入线段 ${params.segment} 的值。`,
      };
    }
    return {
      kind: "reject",
      state,
      message: "请输入线段的值后提交。",
    };
  },

  view: (
    state: MarkSegmentValueState,
    params: MarkSegmentValueParams,
    _world: WorldState,
  ): InteractionView => {
    if (state.stage === "pick-segment") {
      return view({
        clickablePoints: [],
        clickableSegments: [params.segment],
        prompt: `请选择要标注的线段（线段 ${params.segment}）。`,
        inputs: [],
        canSubmit: false,
      });
    }
    return view({
      clickablePoints: [],
      clickableSegments: [],
      highlightedObjects: [params.segment],
      prompt: `请输入线段 ${params.segment} 的值，然后提交。`,
      inputs: [
        {
          objectId: segmentValueId(params.segment),
          expectedKind: "number",
          value: state.inputValue,
          active: true,
          label: `线段 ${params.segment} 的值`,
        },
      ],
      canSubmit: true,
    });
  },

  commit: (
    world: WorldState,
    result: MarkSegmentValueResult,
    _params: MarkSegmentValueParams,
  ): WorldState => {
    return withObject(world, {
      kind: "segment-value",
      id: segmentValueId(result.segment),
      segment: result.segment,
      value: result.value,
    });
  },
};

/** Factory: build a RuntimeAction for this markSegmentValue instance. */
export function markSegmentValue(params: MarkSegmentValueParams) {
  return defineAction(definition, params);
}
