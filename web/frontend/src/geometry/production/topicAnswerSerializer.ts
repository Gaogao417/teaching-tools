/**
 * Production answer serializer — rebuilds the legacy `topic-answer` partial
 * string from the construct-parallel machine's current {@link InteractionView}.
 *
 * This keeps the draft (which hydration, the in-progress preview, and the
 * backend's eventual submission all read) in lockstep with the machine as the
 * learner advances, undoes (BACK), or gets a wrong-click cleared. The serialized
 * partial form is byte-identical to what the legacy `handlePoint` /
 * `handleSegment` / `undoLast` handlers produced at each stage
 * (`point:T`, `point:T|parallel:S`, `point:T|parallel:S|carrier:C0,C1`), so the
 * backend grading path is unaffected.
 *
 * Pure: no React, no XState. Unit-tested in isolation.
 */
import type { InteractionView } from "../interaction/interaction-view";

/**
 * Rebuild the legacy partial `topic-answer` string from the machine's current
 * view. The projector places `selected` in stage order: the through-point first,
 * then the reference line, then the carrier points. We rebuild the same
 * `point:T|parallel:S|carrier:C0,C1` form the legacy handlers produced at each
 * stage and return `null` when the machine has nothing chosen yet, so the draft
 * isn't touched on a fresh start.
 */
export function parallelAnswerFromView(view: InteractionView): string | null {
  const points: string[] = [];
  const lines: string[] = [];
  for (const ref of view.selected) {
    if (ref.kind === "point") points.push(ref.id);
    else if (ref.kind === "line") lines.push(ref.id);
  }
  if (points.length === 0 && lines.length === 0) return null;
  const parts: string[] = [];
  if (points[0]) parts.push(`point:${points[0]}`);
  if (lines[0]) parts.push(`parallel:${lines[0]}`);
  const carriers = points.slice(1);
  if (carriers.length > 0) parts.push(`carrier:${carriers.join(",")}`);
  return parts.join("|");
}
