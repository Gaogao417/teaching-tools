/**
 * Projector for construct-circle. Pure: (snapshot, model) -> InteractionView.
 *
 * construct-circle has no task spec yet (it accepts any point), so no entity is
 * marked `expected`; every point stays enabled/clickable. The shape mirrors
 * construct-parallel so the Canvas needs no tool-specific branching.
 */
import type { SnapshotFrom } from "xstate";
import type { GeometryModel } from "../../domain/model";
import { constructCircleMachine } from "./construct-circle.machine";
import { idleView, type EntityAffordance, type InteractionView } from "../interaction-view";

type CircleSnapshot = SnapshotFrom<typeof constructCircleMachine>;

export function projectConstructCircle(snapshot: CircleSnapshot, model: GeometryModel): InteractionView {
  if (snapshot.matches("selectCenter")) {
    return {
      prompt: "选择圆心",
      entities: pointAffordances(model, { selectedId: undefined }),
      selected: [],
      cursor: "pointer",
      canCancel: true,
      canGoBack: false,
    };
  }

  if (snapshot.matches("selectThroughPoint")) {
    const centerId = snapshot.context.centerId;
    return {
      prompt: "选择圆经过的点",
      entities: pointAffordances(model, { selectedId: centerId }),
      selected: centerId ? [{ kind: "point", id: centerId }] : [],
      cursor: "pointer",
      preview: { type: "circle-through-hover", centerId },
      canCancel: true,
      canGoBack: true,
    };
  }

  return idleView;
}

function pointAffordances(model: GeometryModel, opts: { selectedId?: string }): Record<string, EntityAffordance> {
  const out: Record<string, EntityAffordance> = {};
  for (const p of model.pointsList()) {
    const isSelected = p.id === opts.selectedId;
    out[p.id] = {
      id: p.id,
      kind: "point",
      enabled: !isSelected,
      expected: false, // no spec yet → no teaching-truth target
      visualState: isSelected ? "selected" : "available",
    };
  }
  return out;
}
