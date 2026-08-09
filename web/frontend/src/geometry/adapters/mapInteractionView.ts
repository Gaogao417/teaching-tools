/**
 * Map an {@link InteractionView} (produced by a construct-parallel projector)
 * into the props the production SVG-over-image `GeometryCanvas` already
 * understands: `availablePointIds`, `availableSegmentIds`, `selectedPoints`,
 * `selectedSegments`, `wrongObjectIds`, `constructionPreview`, and the step
 * `prompt`.
 *
 * This is the seam that lets the XState machine + projector drive the existing
 * Canvas WITHOUT rewriting the Canvas or adopting JSXGraph. The Canvas keeps
 * reading the same prop shapes it always has; the source of truth behind them
 * switches from hand-written stage switches to the machine snapshot.
 *
 * Pure: no React, no XState. Unit-tested in isolation.
 */
import type { InteractionView } from "../interaction/interaction-view";
import type { EntityKind } from "../interaction/events";

/**
 * The production Canvas `constructionPreview` prop carries the
 * `construction.resultPoint` (the intersection of the parallel line with the
 * carrier line) purely for rendering — it is NOT part of the submit string.
 * The projector does not know about it (it lives in `TopicGeometryInteraction`
 * but not in `ParallelActionSpec`), so the caller threads it through here.
 */
export interface ConstructionPreviewExtras {
  /** The intersection point the preview circle is drawn on, if any. */
  resultPoint?: string;
}

/** The subset of production `GeometryCanvas` props this mapper produces. */
export interface MappedConstructParallelView {
  /** ids of points the Canvas should let the learner click right now. */
  availablePointIds: string[];
  /** ids of segments the Canvas should let the learner click right now. */
  availableSegmentIds: string[];
  /** points already chosen in this tool run (rendered with a label). */
  selectedPoints: string[];
  /** segments already chosen in this tool run (rendered highlighted). */
  selectedSegments: string[];
  /** entity ids currently flagged wrong by the machine (rendered red). */
  wrongObjectIds: string[];
  /** preview spec the Canvas already renders (parallel + carrier + result). */
  constructionPreview: {
    throughPoint?: string;
    parallelSegment?: string;
    carrierPoints: string[];
    resultPoint?: string;
  };
  /** the learner-facing instruction for the current step. */
  prompt: string;
}

function idsOfKind(view: InteractionView, kind: EntityKind, predicate: (id: string) => boolean): string[] {
  const out: string[] = [];
  for (const id in view.entities) {
    const e = view.entities[id];
    if (e.kind === kind && predicate(id)) out.push(id);
  }
  return out;
}

/**
 * Map an InteractionView to the production Canvas prop shape.
 *
 * @param view the projected view (from the construct-parallel projector)
 * @param extras carries `resultPoint` for the preview circle (rendering only)
 */
export function mapConstructParallelView(
  view: InteractionView,
  extras: ConstructionPreviewExtras = {},
): MappedConstructParallelView {
  // `selected` arrives in stage order: through-point, then the reference line,
  // then the carrier points. Split it by kind so the Canvas can render points
  // vs segments with their existing per-kind styling.
  const selectedPoints: string[] = [];
  const selectedSegments: string[] = [];
  for (const ref of view.selected) {
    if (ref.kind === "point") selectedPoints.push(ref.id);
    else if (ref.kind === "line") selectedSegments.push(ref.id);
  }

  // The Canvas treats `available*Ids` as a clickability whitelist. The
  // projector keeps wrong-but-relevant entities `enabled` so the machine can
  // diagnose a click; collecting enabled ids here preserves that: the learner
  // CAN click a wrong point, the machine records it as wrong, and the next
  // projection turns it red. This matches the POC's "errors turn red then
  // recover" acceptance criterion.
  const availablePointIds = idsOfKind(view, "point", () => true).filter(
    (id) => view.entities[id].enabled,
  );
  const availableSegmentIds = idsOfKind(view, "line", () => true).filter(
    (id) => view.entities[id].enabled,
  );

  const wrongObjectIds = [
    ...idsOfKind(view, "point", (id) => view.entities[id].visualState === "wrong"),
    ...idsOfKind(view, "line", (id) => view.entities[id].visualState === "wrong"),
  ];

  // Reconstruct the preview from `selected`. The first selected point is the
  // through-point; the first selected line is the parallel reference; any
  // remaining selected points are the carriers.
  const throughPoint = selectedPoints[0];
  const parallelSegment = selectedSegments[0];
  const carrierPoints = selectedPoints.slice(1);

  return {
    availablePointIds,
    availableSegmentIds,
    selectedPoints,
    selectedSegments,
    wrongObjectIds,
    constructionPreview: {
      throughPoint,
      parallelSegment,
      carrierPoints,
      ...(extras.resultPoint ? { resultPoint: extras.resultPoint } : {}),
    },
    prompt: view.prompt,
  };
}
