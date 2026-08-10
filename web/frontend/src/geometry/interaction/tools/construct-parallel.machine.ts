/**
 * construct-parallel reference machine (design report §05; PRD-03 §5.3 full flow).
 *
 * Task-driven, not free-drawing: a run REQUIRES a {@link ParallelActionSpec}
 * naming the expected through-point, reference line, and the two carrier points
 * the full auxiliary-line construction connects. The machine drives the four
 * stages of PRD-03 §5.3:
 *
 *   selectPoint → selectLine → selectCarrier0 → selectCarrier1 → done
 *   (点过线点)    (点参照边)    (点第一个外点)   (点第二个外点)
 *
 * At each stage the machine accepts ANY enabled click (the Canvas filters only
 * on `enabled`, so wrong-but-relevant objects still reach it); it advances on
 * the EXPECTED target (guard) and otherwise records the wrong target in context
 * and stays put — letting the projector surface a wrong affordance + feedback
 * without losing prior correct state (PRD-03 §4/§6).
 *
 * Wrong feedback note: a failed guard does NOT silently drop the event. XState
 * evaluates an array of transitions and falls through to the next when a guard
 * fails; the second transition has no guard and only records the wrong id.
 *
 * The machine owns only step flow + collected ids. It does NOT serialize the
 * `topic-answer` string itself — that is the caller's concern (the runtime
 * emits a GeometryCommand on completion; production wiring serializes from
 * context). Keeping serialization out keeps the machine reusable.
 *
 * Output resolution note: in XState v5 the machine-level `output` callback
 * receives the `xstate.done.*` internal event rather than the event that
 * triggered the transition, and final-state-level `output` does not populate
 * `snapshot.output`. So the reliable way to distinguish "completed" from
 * "cancelled" is to track the outcome in context and read it in the machine
 * output.
 */
import { assign, setup } from "xstate";
import type { GeometryCommand } from "../../domain/commands";
import type { PointId, LineId } from "../../domain/commands";
import type { CanvasEvent } from "../events";

export interface CancelledOutput {
  type: "cancelled";
}

export type ConstructParallelOutput = Extract<GeometryCommand, { type: "construct-parallel" }> | CancelledOutput;

/**
 * The task contract a construct-parallel run is started with. Mandatory: there
 * is no free-drawing mode on this machine — production PRD-03 explicitly forbids
 * a free canvas. `carrierPoints` carries the two outer points the full PRD-03
 * §5.3 construction connects; they are NOT part of the emitted GeometryCommand
 * (which only carries through + reference), but they drive the carrier stages
 * and feed the production `topic-answer` serialization.
 *
 * In production this is filled from `interaction.construction` — which lives in
 * the learner-visible projection (only `acceptedAnswers`/`expectedLatex` are
 * backend-only), so `expected` here never leaks grading truth.
 */
export interface ParallelActionSpec {
  throughPointId: PointId;
  referenceLineId: LineId;
  carrierPoints: readonly [PointId, PointId];
}

interface ConstructParallelContext {
  spec: ParallelActionSpec;
  pointId?: PointId;
  lineId?: LineId;
  carrierIds: PointId[];
  /** Id of the most recent wrong target, for projector feedback. Cleared on a correct advance. */
  wrongId?: string;
  outcome?: "completed" | "cancelled";
}

function expectedCarrierAt(spec: ParallelActionSpec, index: number): PointId | undefined {
  return spec.carrierPoints[index];
}

export const constructParallelMachine = setup({
  types: {
    context: {} as ConstructParallelContext,
    events: {} as CanvasEvent,
    input: {} as ParallelActionSpec,
    output: {} as ConstructParallelOutput,
  },
  guards: {
    isExpectedPoint: ({ context, event }) =>
      event.type === "POINT.CLICKED" && event.pointId === context.spec.throughPointId,
    isExpectedLine: ({ context, event }) =>
      event.type === "LINE.CLICKED" && event.lineId === context.spec.referenceLineId,
    isExpectedCarrier0: ({ context, event }) =>
      event.type === "POINT.CLICKED" && event.pointId === expectedCarrierAt(context.spec, 0),
    isExpectedCarrier1: ({ context, event }) =>
      event.type === "POINT.CLICKED" && event.pointId === expectedCarrierAt(context.spec, 1),
  },
  actions: {
    selectPoint: assign({ pointId: ({ event }) => (event as { pointId: PointId }).pointId, wrongId: undefined }),
    selectLine: assign({
      lineId: ({ event }) => (event as { lineId: LineId }).lineId,
      wrongId: undefined,
    }),
    pushCarrier0: assign({
      carrierIds: ({ context, event }) => [...context.carrierIds, (event as { pointId: PointId }).pointId],
      wrongId: undefined,
    }),
    pushCarrier1: assign({
      carrierIds: ({ context, event }) => [...context.carrierIds, (event as { pointId: PointId }).pointId],
      wrongId: undefined,
    }),
    recordWrongPoint: assign({ wrongId: ({ event }) => (event as { pointId: string }).pointId }),
    recordWrongLine: assign({ wrongId: ({ event }) => (event as { lineId: string }).lineId }),
    clearPoint: assign({ pointId: undefined, wrongId: undefined }),
    clearLine: assign({ lineId: undefined, wrongId: undefined }),
    clearLastCarrier: assign(({ context }) => ({ carrierIds: context.carrierIds.slice(0, -1), wrongId: undefined })),
  },
}).createMachine({
  id: "construct-parallel",
  initial: "selectPoint",
  context: ({ input }) => ({ spec: input, carrierIds: [] }),
  states: {
    selectPoint: {
      on: {
        "POINT.CLICKED": [
          { guard: "isExpectedPoint", target: "selectLine", actions: "selectPoint" },
          { actions: "recordWrongPoint" },
        ],
        CANCEL: { target: "cancelled", actions: assign({ outcome: () => "cancelled" }) },
      },
    },
    selectLine: {
      on: {
        "LINE.CLICKED": [
          { guard: "isExpectedLine", target: "selectCarrier0", actions: "selectLine" },
          { actions: "recordWrongLine" },
        ],
        BACK: { target: "selectPoint", actions: "clearPoint" },
        CANCEL: { target: "cancelled", actions: assign({ outcome: () => "cancelled" }) },
      },
    },
    selectCarrier0: {
      on: {
        "POINT.CLICKED": [
          { guard: "isExpectedCarrier0", target: "selectCarrier1", actions: "pushCarrier0" },
          { actions: "recordWrongPoint" },
        ],
        BACK: { target: "selectLine", actions: "clearLine" },
        CANCEL: { target: "cancelled", actions: assign({ outcome: () => "cancelled" }) },
      },
    },
    selectCarrier1: {
      on: {
        "POINT.CLICKED": [
          { guard: "isExpectedCarrier1", target: "done", actions: "pushCarrier1" },
          { actions: "recordWrongPoint" },
        ],
        BACK: { target: "selectCarrier0", actions: "clearLastCarrier" },
        CANCEL: { target: "cancelled", actions: assign({ outcome: () => "cancelled" }) },
      },
    },
    done: { type: "final" },
    cancelled: { type: "final" },
  },
  output: ({ context }) => {
    if (context.outcome === "cancelled") return { type: "cancelled" };
    if (context.pointId === undefined) throw new Error("construct-parallel: missing context field \"pointId\"");
    if (context.lineId === undefined) throw new Error("construct-parallel: missing context field \"lineId\"");
    return {
      type: "construct-parallel",
      throughPointId: context.pointId,
      referenceLineId: context.lineId,
    };
  },
});
