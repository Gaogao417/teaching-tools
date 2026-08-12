import type { LearningMode } from "../ports/TextCoachEngine";

/**
 * Shared coaching capability allowance. Both the streaming turn path
 * (`CoachTurnApplication`) and the full-duplex live path (`LiveCoachApplication`)
 * resolve their mode gate through this single policy, closing the ADR-005 audit
 * finding that turn and live did not share one mode policy.
 *
 * Assessment always fails closed for generative voice. The streaming turn keeps
 * its explicit opt-in escape hatch (`COACH_STREAM_ASSESSMENT_ENABLED`) for parity
 * with the prior behavior; live voice has no such hatch.
 */

export type CapabilityAllowance =
  | { ok: true }
  | { ok: false; code: string; retryable: boolean };

export interface CoachModePolicy {
  /** Generative streaming turn. Denied in Assessment unless an explicit env
   *  opts in (kept for parity with the prior turn behavior). */
  allowTurn(mode: LearningMode): CapabilityAllowance;
  /** Full-duplex live voice. Always denied in Assessment. */
  allowLive(mode: LearningMode): CapabilityAllowance;
  /** Per-segment speech gate. A generative spoken segment may only be
   *  synthesized outside Assessment. */
  canSpeakSegment(mode: LearningMode): boolean;
}

class CoachModePolicyImpl implements CoachModePolicy {
  allowTurn(mode: LearningMode): CapabilityAllowance {
    if (mode === "assessment" && process.env.COACH_STREAM_ASSESSMENT_ENABLED !== "true") {
      return { ok: false, code: "NOT_ALLOWED", retryable: false };
    }
    return { ok: true };
  }

  allowLive(mode: LearningMode): CapabilityAllowance {
    if (mode === "assessment") {
      return { ok: false, code: "NOT_ALLOWED", retryable: false };
    }
    return { ok: true };
  }

  canSpeakSegment(mode: LearningMode): boolean {
    return mode !== "assessment";
  }
}

/** Shared default instance used by the composition root. Tests may construct
 *  their own or call the pure helpers below. */
export const coachModePolicy: CoachModePolicy = new CoachModePolicyImpl();

/** Pure helper reused by {@link SegmentPolicy} so the per-segment gate and the
 *  turn/live capability gate share one source of truth for Assessment. */
export function segmentSpeakable(mode: LearningMode): boolean {
  return mode !== "assessment";
}
