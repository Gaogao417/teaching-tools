import type { CandidateDecision, TrainingFeedback } from "../../../../shared/trainingRuntime";
import { latexToSpokenChinese } from "../../../../shared/speechText";

/**
 * ADR-006 §Voice and Coach Integration — the feedback the Frame renders after a
 * guard decision. Fields align with the existing `CoachSlice` intent so the
 * (later, separate) Integration step can splice this in without reshaping the
 * coach slice. This is a pure view value; it carries no domain/world state.
 */
export interface TrainingFeedbackView {
  /** `false` when there is no wrong feedback to show (every non-`wrong` decision). */
  active: boolean;
  /** Display LaTeX from `TrainingFeedback.messageLatex` (empty when inactive). */
  messageLatex: string;
  /** Wrong feedback ⇒ `"wrong"`; inactive views use the neutral `"prompt"`. */
  tone: "wrong" | "correct" | "prompt";
  /** Wrong entities to highlight, from `TrainingFeedback.wrongObjectIds`. */
  highlightObjectIds: string[];
  /** Optional focus target from `TrainingFeedback.focusTargetId`. */
  focusTargetId?: string;
  /**
   * Deterministic spoken variant for optional narration: the explicit
   * `TrainingFeedback.spokenText` when provided, otherwise
   * `latexToSpokenChinese(messageLatex)`. Never LLM/provider text.
   */
  spokenText?: string;
}

/** Optional projection inputs supplied by the integration layer. */
export interface ProjectOptions {
  /**
   * The Action's public instruction. Used only as a neutral fallback
   * `messageLatex` for inactive views; it is never treated as correctness copy.
   */
  actionInstruction?: string;
}

/**
 * Owns the projection from a guard-produced `CandidateDecision` to the instant
 * training feedback view. Pure by construction:
 * - It only READS a decision the guard already produced, so guard → attempt
 *   recording → state advancement always completes first (ADR-006 ordering).
 * - No I/O, no audio, no state mutation, no metrics writes, no network. Audio
 *   queuing / autoplay being blocked therefore cannot block training.
 * - Spoken text is deterministic (`spokenText` or `latexToSpokenChinese`); it
 *   never invokes an LLM or provider.
 *
 * It does NOT add or remove wrong attempts and does NOT decide completion
 * (ADR-006: that is the guard/recorder's job, never this controller's).
 */
export class TrainingFeedbackController {
  /**
   * Map a guard decision to a feedback view. For `wrong`, populate from
   * `decision.feedback` and derive a deterministic spoken variant. For every
   * other decision (`correct-partial`, `correct-completion`, `ignored-illegal`)
   * return an inactive neutral shape — never invent correctness copy that could
   * change outcomes.
   */
  project(decision: CandidateDecision, opts?: ProjectOptions): TrainingFeedbackView {
    if (decision.kind === "wrong") return this.projectWrong(decision.feedback);
    return {
      active: false,
      messageLatex: opts?.actionInstruction ?? "",
      tone: "prompt",
      highlightObjectIds: [],
    };
  }

  /**
   * Hand the deterministic spoken text to narration integration. Returns just a
   * string; this controller never imports or calls any audio/media/narration API.
   */
  requestSpoken(view: TrainingFeedbackView): string | undefined {
    return view.spokenText;
  }

  private projectWrong(feedback: TrainingFeedback): TrainingFeedbackView {
    return {
      active: true,
      messageLatex: feedback.messageLatex,
      tone: "wrong",
      // Copy the guard's array so the view is decoupled from the input decision.
      highlightObjectIds: feedback.wrongObjectIds.slice(),
      focusTargetId: feedback.focusTargetId,
      spokenText: feedback.spokenText ?? latexToSpokenChinese(feedback.messageLatex),
    };
  }
}
