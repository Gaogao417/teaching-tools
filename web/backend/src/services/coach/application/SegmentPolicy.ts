import type { SpokenSegment } from "../../../../../shared/coachMedia";
import type { LearningMode, Result } from "../ports/TextCoachEngine";
import { segmentSpeakable } from "./coachModePolicy";

export class SegmentPolicyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Per-segment mode/safety gate. A segment may only be spoken once it passes
 * this policy. The Assessment decision is delegated to the shared
 * {@link segmentSpeakable} predicate so the per-segment gate and the turn/live
 * capability gate share one source of truth (ADR-005 §Architectural Invariants
 * #6, #9).
 */
export class SegmentPolicy {
  validate(mode: LearningMode, segment: SpokenSegment): Result<SpokenSegment, SegmentPolicyError> {
    if (!segment.spokenText.trim()) {
      return { ok: false, error: new SegmentPolicyError("empty-segment", "Segment has no spoken text") };
    }
    if (!segmentSpeakable(mode)) {
      return { ok: false, error: new SegmentPolicyError("assessment-disabled", "Generative spoken segments are disabled in assessment") };
    }
    return { ok: true, value: segment };
  }
}
