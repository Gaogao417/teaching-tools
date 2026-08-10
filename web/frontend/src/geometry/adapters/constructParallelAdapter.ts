/**
 * Production adapter — bridges the topic-practice `TopicGeometryInteraction`
 * shape to the XState construct-parallel machine boundary, and back to the
 * `topic-answer` string the backend already grades.
 *
 * This module is pure (no React, no XState imports) on purpose: it is the
 * single place that knows both shapes, so it can be unit-tested in isolation
 * and reused by whatever host (today the React workspace renderer, tomorrow an
 * agent path) needs to drive the machine.
 *
 * Three responsibilities:
 *  1. {@link buildParallelSpec} — map the learner-visible `construction` into
 *     the machine's `ParallelActionSpec` (the machine input).
 *  2. {@link buildGeometryModel} — map the production `TopicGeometryModel` into
 *     the domain `GeometryModel`, so the projector can enumerate affordances.
 *  3. {@link serializeParallelEvidence} / {@link parseParallelAnswer} — the
 *     `point:T|parallel:S|carrier:C0,C1` string the backend grades, in both
 *     directions. The serialized form is byte-identical to what the old
 *     hand-written `handlePoint`/`handleSegment`/`undoLast` produced, so the
 *     backend's `isTopicAnswerAccepted` + `wrongObjectsForSubmission` keep
 *     working unchanged.
 */
import type { ParallelActionSpec } from "../interaction/tools/construct-parallel.machine";
import type { ToolEvidence } from "../interaction/tool-registry";
import type { TopicGeometryInteraction } from "../../../../shared/topicPractice";
export { buildGeometryModel } from "./topicGeometryModel";

/** The production `construction` sub-shape (narrowed for clarity). */
type TopicConstruction = NonNullable<TopicGeometryInteraction["construction"]>;

/**
 * Map the learner-visible construction into the machine's task spec. Returns
 * `null` when the construction is absent (caller should then NOT start a tool).
 *
 * `construction` lives in the learner-visible projection — only
 * `acceptedAnswers`/`expectedLatex` are backend-only — so feeding it into the
 * machine's guards does not leak grading truth.
 */
export function buildParallelSpec(construction: TopicConstruction | undefined): ParallelActionSpec | null {
  if (!construction) return null;
  return {
    throughPointId: construction.throughPoint,
    referenceLineId: construction.parallelSegment,
    carrierPoints: [construction.carrierPoints[0], construction.carrierPoints[1]],
  };
}

/**
 * Build a domain `GeometryModel` from the production `TopicGeometryModel`. Only
 * `segment`-kind lines are produced (the production model has no parallel-line
 * relation until the learner constructs one), and points carry their raw
 * coordinates. The projector enumerates these to build per-entity affordances.
 */
/**
 * The shape returned by {@link parseParallelAnswer}. All fields optional: the
 * draft string grows one field at a time as the learner advances.
 */
export interface ParsedParallelAnswer {
  throughPointId?: string;
  referenceLineId?: string;
  carrierPointIds: string[];
}

/**
 * Serialize completed evidence into the `topic-answer` string the backend
 * grades. Form (byte-identical to the legacy handlers):
 *
 *   point:T|parallel:S|carrier:C0,C1
 *
 * Used by the production `runtime.onDone` handler once the machine completes.
 */
export function serializeParallelEvidence(
  evidence: ToolEvidence["construct-parallel"],
): string {
  return `point:${evidence.selectedPointId}|parallel:${evidence.selectedLineId}|carrier:${evidence.carrierPointIds.join(",")}`;
}

/**
 * Parse a `topic-answer` draft string back into its parts. Inverse-tolerant:
 * accepts the partial intermediate strings the UI produces (`point:C`,
 * `point:C|parallel:AD`, `point:C|parallel:AD|carrier:B`). Used to hydrate the
 * machine from an existing draft when the learner returns to a half-finished
 * step.
 *
 * Splits on the FIRST `:` per segment (matching the legacy handlers' use of
 * `indexOf(":")` rather than `String#split(":")`, which would mis-split if a
 * value ever contained `:`).
 */
export function parseParallelAnswer(value: string): ParsedParallelAnswer {
  const parts = Object.fromEntries(
    value
      .split("|")
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf(":");
        return index < 0 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
      }),
  );
  return {
    throughPointId: parts.point || undefined,
    referenceLineId: parts.parallel || undefined,
    carrierPointIds: (parts.carrier || "").split(",").filter(Boolean),
  };
}
