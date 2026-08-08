/**
 * InteractionView — the renderer-facing projection of an Action.
 *
 * IMPORTANT: this type is GENERIC. It must NOT contain fields that only make
 * sense for one specific action (no `constructParallelMode`, no
 * `markSegmentValueFoo`). The GeometryCanvas reads this and nothing else; it
 * must not know which Action produced it.
 */
import type { MathObjectId, PointId, SegmentId } from "./geometry.ts";

export type FeedbackKind = "error" | "success" | "info";

export interface Feedback {
  kind: FeedbackKind;
  message: string;
}

export interface InputSpec {
  objectId: MathObjectId;
  expectedKind: "number" | "text";
  /** Current value to echo back into the input field. */
  value?: string;
  /** When true the input accepts typing; when false it is read-only/hidden. */
  active?: boolean;
  /** Human label rendered next to the field. */
  label?: string;
}

export interface InteractionView {
  /** Points the learner is currently allowed to click. */
  clickablePoints: PointId[];
  /** Segments the learner is currently allowed to click. */
  clickableSegments: SegmentId[];

  /** Objects to render with emphasis (e.g. the just-picked point). */
  highlightedObjects?: MathObjectId[];

  /** Instruction shown to the learner. */
  prompt?: string;

  /** Most recent feedback from a reject/complete. */
  feedback?: Feedback;

  /** Generic input fields (used by actions like markSegmentValue). */
  inputs?: InputSpec[];

  /** Whether a submit affordance should be offered right now. */
  canSubmit?: boolean;
}

/** Convenience for building a view with sensible defaults. */
export function view(partial: Partial<InteractionView>): InteractionView {
  return {
    clickablePoints: [],
    clickableSegments: [],
    ...partial,
  };
}
