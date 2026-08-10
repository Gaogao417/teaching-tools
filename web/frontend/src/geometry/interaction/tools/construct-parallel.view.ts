/**
 * Projector for construct-parallel. Pure: (snapshot, model) -> InteractionView.
 * The Canvas consumes only the view, never the raw machine state value.
 *
 * The model is needed to enumerate which points/lines exist, so each can be
 * given an affordance. Answer-truth lives only in `context.spec` (read here to
 * mark `expected`); the Canvas never sees `expected` to filter clicks.
 *
 * Stages mirror PRD-03 §5.3:
 *   selectPoint → selectLine → selectCarrier0 → selectCarrier1 → done
 */
import type { SnapshotFrom } from "xstate";
import type { GeometryModel } from "../../domain/model";
import { constructParallelMachine } from "./construct-parallel.machine";
import { idleView, type EntityAffordance, type InteractionView } from "../interaction-view";

type ParallelSnapshot = SnapshotFrom<typeof constructParallelMachine>;

export function projectConstructParallel(snapshot: ParallelSnapshot, model: GeometryModel): InteractionView {
  const spec = snapshot.context.spec;
  const wrongId = snapshot.context.wrongId;

  if (snapshot.matches("selectPoint")) {
    return {
      prompt: "选择平行线经过的点",
      entities: pointAffordances(model, { expectedIds: [spec.throughPointId], lockedIds: [], wrongId }),
      selected: [],
      cursor: "pointer",
      canCancel: true,
      canGoBack: false,
    };
  }

  if (snapshot.matches("selectLine")) {
    const pointId = snapshot.context.pointId;
    return {
      prompt: "选择参考直线",
      entities: {
        ...pointAffordances(model, { expectedIds: [spec.throughPointId], lockedIds: pointId ? [pointId] : [], wrongId: undefined }),
        ...lineAffordances(model, { expectedId: spec.referenceLineId, wrongId }),
      },
      selected: pointId ? [{ kind: "point", id: pointId }] : [],
      cursor: "pointer",
      preview: { type: "parallel-through-hover", referenceLineId: undefined },
      canCancel: true,
      canGoBack: true,
    };
  }

  if (snapshot.matches("selectCarrier0")) {
    const { pointId, lineId } = snapshot.context;
    return {
      prompt: "点第一个外点",
      entities: {
        ...pointAffordances(model, {
          expectedIds: [spec.carrierPoints[0]],
          lockedIds: lockedSoFar(pointId, lineId, []),
          wrongId,
        }),
        ...lineAffordances(model, { expectedId: spec.referenceLineId, wrongId: undefined, lockedIds: lineId ? [lineId] : [] }),
      },
      selected: selectedSoFar(pointId, lineId, []),
      cursor: "pointer",
      canCancel: true,
      canGoBack: true,
    };
  }

  if (snapshot.matches("selectCarrier1")) {
    const { pointId, lineId, carrierIds } = snapshot.context;
    // Carrier preview (plan 第五阶段): the through point, reference line, and
    // first carrier point are all chosen; the learner is now picking the second
    // carrier. Show the carrier line from the fixed first carrier toward the
    // hovered world point, the parallel line, and their intersection. The
    // renderer computes the geometry from the pointer + model; the machine never
    // sees the hovered coordinates. Only emitted when all three fixed ids exist.
    const preview =
      pointId && lineId && carrierIds[0]
        ? {
            type: "carrier-preview" as const,
            throughPointId: pointId,
            referenceLineId: lineId,
            carrier0Id: carrierIds[0],
          }
        : undefined;
    return {
      prompt: "点第二个外点",
      entities: {
        ...pointAffordances(model, {
          expectedIds: [spec.carrierPoints[1]],
          lockedIds: lockedSoFar(pointId, lineId, carrierIds),
          wrongId,
        }),
        ...lineAffordances(model, { expectedId: spec.referenceLineId, wrongId: undefined, lockedIds: lineId ? [lineId] : [] }),
      },
      selected: selectedSoFar(pointId, lineId, carrierIds),
      cursor: "pointer",
      preview,
      canCancel: true,
      canGoBack: true,
    };
  }

  return idleView;
}

/** Ids that have already been chosen and must be locked (unclickable) now. */
function lockedSoFar(pointId?: string, lineId?: string, carrierIds: readonly string[] = []): string[] {
  return [pointId, lineId, ...carrierIds].filter((x): x is string => Boolean(x));
}

/** Selected entity refs for display, in stage order. */
function selectedSoFar(pointId?: string, lineId?: string, carrierIds: readonly string[] = []): { kind: "point" | "line"; id: string }[] {
  const out: { kind: "point" | "line"; id: string }[] = [];
  if (pointId) out.push({ kind: "point", id: pointId });
  if (lineId) out.push({ kind: "line", id: lineId });
  for (const c of carrierIds) out.push({ kind: "point", id: c });
  return out;
}

interface PointAffordanceOpts {
  /** Ids that are the teaching-truth target at this stage (expected=true). */
  expectedIds: readonly string[];
  /** Ids already chosen and locked (enabled=false). */
  lockedIds: readonly string[];
  wrongId?: string;
}

/**
 * Build affordances for every point. Non-locked points are enabled (a wrong
 * point must remain clickable so the machine can diagnose it); only expected
 * points are `expected`. Visual state reflects wrong/locked/available.
 */
function pointAffordances(model: GeometryModel, opts: PointAffordanceOpts): Record<string, EntityAffordance> {
  const out: Record<string, EntityAffordance> = {};
  for (const p of model.pointsList()) {
    const isLocked = opts.lockedIds.includes(p.id);
    const isWrong = p.id === opts.wrongId;
    const isSelected = isLocked; // locked == chosen earlier in this run
    out[p.id] = {
      id: p.id,
      kind: "point",
      enabled: !isLocked,
      expected: opts.expectedIds.includes(p.id),
      visualState: isWrong ? "wrong" : isSelected ? "selected" : "available",
      ...(isWrong ? { feedback: `点 ${p.id} 不是本步要点的点。` } : {}),
    };
  }
  return out;
}

interface LineAffordanceOpts {
  expectedId: string;
  wrongId?: string;
  lockedIds?: readonly string[];
}

/**
 * Build affordances for every line. Non-locked lines are enabled; only the
 * expected line is `expected`.
 */
function lineAffordances(model: GeometryModel, opts: LineAffordanceOpts): Record<string, EntityAffordance> {
  const out: Record<string, EntityAffordance> = {};
  const locked = opts.lockedIds ?? [];
  for (const l of model.linesList()) {
    const isLocked = locked.includes(l.id);
    const isWrong = l.id === opts.wrongId;
    out[l.id] = {
      id: l.id,
      kind: "line",
      enabled: !isLocked,
      expected: l.id === opts.expectedId,
      visualState: isWrong ? "wrong" : isLocked ? "selected" : "available",
      ...(isWrong ? { feedback: `线 ${l.id} 不是参照直线。` } : {}),
    };
  }
  return out;
}
