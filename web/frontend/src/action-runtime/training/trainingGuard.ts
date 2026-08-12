import type { ActionContract } from "../../../../shared/actionRuntime";
import type { CandidateDecision, SemanticCandidate, TrainingFeedback } from "../../../../shared/trainingRuntime";
import type { ActionRuntimeEvent } from "../events";
import type { ActionSnapshotView } from "../types";
import { semanticCandidate } from "./candidateSemantics";

/**
 * ADR-006 §Local attempt and completion — the single authority that maps a
 * student ActionRuntimeEvent (run through the child action machine) onto the v2
 * `CandidateDecision` vocabulary for `local-training` actions.
 *
 * The child action machine remains the evaluator of mathematical correctness
 * (its guards accept/reject and set wrongObjectId/wrongMessage/done). This guard
 * OWNS the classification vocabulary — most importantly the `ignored-illegal`
 * outcome, which is a no-op: it is never recorded, never counts as wrong, and
 * never enters hit-rate.
 *
 * `ignored-illegal` covers:
 *   - events that are not legal candidates (pure BACK/CLEAR/CANCEL, idle clicks
 *     that the machine did not accept and did not reject as a wrong candidate);
 *   - OBJECT.SELECTED on a target that is not part of this action's accepting
 *     set in the current state (outside `enabledByKind`), e.g. clicking a line
 *     while the action is selecting points, or an id not in the action universe.
 *
 * A `wrong` candidate is a plausible candidate the learner was allowed to try
 * (it was in the accepting set) but the machine rejected. That distinction is
 * what the 3-layer affordance (hitTestable/candidate/advanceEnabled) preserves.
 *
 * Assessment never reaches this guard: the page runtime only classifies events
 * for actions whose `validationPolicy === "local-training"`.
 */

export interface ClassificationResult {
  decision: CandidateDecision;
  /** The legal candidate this event produced (present for non-ignored outcomes). */
  candidate?: SemanticCandidate;
}

const DEFAULT_WRONG_MESSAGE = "这个对象不是当前动作需要的对象。";

function feedbackFrom(after: ActionSnapshotView, objectId?: string): TrainingFeedback {
  return {
    messageLatex: after.wrongMessage || DEFAULT_WRONG_MESSAGE,
    wrongObjectIds: objectId ? [objectId] : [],
  };
}

export class TrainingGuard {
  /**
   * Classify the candidate described by `(event, before, after)` after the child
   * machine has already processed `event`. Pure with respect to its inputs.
   */
  classify(
    contract: ActionContract,
    event: ActionRuntimeEvent,
    before: ActionSnapshotView,
    after: ActionSnapshotView,
  ): ClassificationResult {
    const candidate = semanticCandidate(event, before, after);
    if (!candidate) return { decision: { kind: "ignored-illegal" } };

    // Object selection: a click outside the action's current accepting set is an
    // idle/illegal click — ignored, not a wrong attempt.
    if (candidate.kind === "object") {
      const bucket = `${candidate.objectKind}s` as "points" | "lines" | "angles";
      const wasAccepting = before.enabledByKind[bucket].includes(candidate.objectId);
      if (!wasAccepting) return { decision: { kind: "ignored-illegal" } };

      // Machine rejected this specific object → wrong candidate with feedback.
      if (after.wrongObjectId === candidate.objectId) {
        return { decision: { kind: "wrong", feedback: feedbackFrom(after, candidate.objectId) }, candidate };
      }
      if (after.done && after.evidence) {
        return { decision: { kind: "correct-completion", evidence: after.evidence, commands: after.commands }, candidate };
      }
      return { decision: { kind: "correct-partial" }, candidate };
    }

    // Answer / evidence candidates arrive via SUBMIT. A SUBMIT that did nothing
    // (form not structurally ready) is an idle/illegal candidate — ignored.
    if (event.type === "SUBMIT") {
      if (after.done && after.evidence) {
        return { decision: { kind: "correct-completion", evidence: after.evidence, commands: after.commands }, candidate };
      }
      if (after.wrongMessage && after.wrongMessage !== before.wrongMessage) {
        return { decision: { kind: "wrong", feedback: feedbackFrom(after) }, candidate };
      }
      return { decision: { kind: "ignored-illegal" } };
    }

    // Non-object, non-submit candidate with no completion: partial progress.
    if (after.done && after.evidence) {
      return { decision: { kind: "correct-completion", evidence: after.evidence, commands: after.commands }, candidate };
    }
    return { decision: { kind: "correct-partial" }, candidate };
  }
}
