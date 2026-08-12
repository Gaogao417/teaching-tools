import type { SpokenSegment } from "../../../../../shared/coachMedia";
import type { LearningMode } from "../ports/TextCoachEngine";
import type { Result } from "../ports/TextCoachEngine";

export class SegmentPolicyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Per-segment mode/safety gate. A segment may only be spoken once it passes
 * this policy. Assessment fails closed — generative streaming voice must stay
 * off in assessment until an independent per-segment leak review lands.
 */
export class SegmentPolicy {
  validate(mode: LearningMode, segment: SpokenSegment): Result<SpokenSegment, SegmentPolicyError> {
    if (!segment.spokenText.trim()) {
      return { ok: false, error: new SegmentPolicyError("empty-segment", "Segment has no spoken text") };
    }
    if (mode === "assessment") {
      return { ok: false, error: new SegmentPolicyError("assessment-disabled", "Generative spoken segments are disabled in assessment") };
    }
    return { ok: true, value: segment };
  }
}
