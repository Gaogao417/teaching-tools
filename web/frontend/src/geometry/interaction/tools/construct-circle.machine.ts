/**
 * construct-circle machine — the second migrated tool.
 *
 * Deliberately different in shape from construct-parallel: both steps consume
 * the same `POINT.CLICKED` event, but they fill different context fields and
 * carry different prompts/previews. The point of this tool is to prove the
 * Canvas's central event dispatch needs no tool-specific branching when a new
 * tool is added.
 *
 * Output is resolved from context (see construct-parallel note for why
 * state-level/event-based output is not reliable in XState v5).
 */
import { assign, setup } from "xstate";
import type { GeometryCommand } from "../../domain/commands";
import type { CanvasEvent } from "../events";
import type { CancelledOutput } from "./construct-parallel.machine";

export type ConstructCircleOutput = Extract<GeometryCommand, { type: "construct-circle" }> | CancelledOutput;

interface ConstructCircleContext {
  centerId?: string;
  throughPointId?: string;
  outcome?: "completed" | "cancelled";
}

export const constructCircleMachine = setup({
  types: {
    context: {} as ConstructCircleContext,
    events: {} as CanvasEvent,
    output: {} as ConstructCircleOutput,
  },
}).createMachine({
  id: "construct-circle",
  initial: "selectCenter",
  context: {},
  states: {
    selectCenter: {
      on: {
        "POINT.CLICKED": {
          target: "selectThroughPoint",
          actions: assign({ centerId: ({ event }) => event.pointId }),
        },
        CANCEL: { target: "cancelled", actions: assign({ outcome: () => "cancelled" }) },
      },
    },
    selectThroughPoint: {
      on: {
        "POINT.CLICKED": {
          target: "done",
          actions: assign({ throughPointId: ({ event }) => event.pointId, outcome: () => "completed" }),
        },
        BACK: {
          target: "selectCenter",
          actions: assign({ centerId: () => undefined }),
        },
        CANCEL: { target: "cancelled", actions: assign({ outcome: () => "cancelled" }) },
      },
    },
    done: { type: "final" },
    cancelled: { type: "final" },
  },
  output: ({ context }) => {
    if (context.outcome === "cancelled") return { type: "cancelled" };
    if (context.centerId === undefined) throw new Error("construct-circle: missing context field \"centerId\"");
    if (context.throughPointId === undefined) throw new Error("construct-circle: missing context field \"throughPointId\"");
    return {
      type: "construct-circle",
      centerId: context.centerId,
      throughPointId: context.throughPointId,
    };
  },
});
