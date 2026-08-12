import type { ActionContract, ExercisePlan } from "../../../../shared/actionRuntime";
import { latexToSpokenChinese } from "../../../../shared/speechText";

export interface TeacherCopy {
  /** Display LaTeX shown in the coach panel. */
  displayLatex: string;
  /** Plain spoken copy fed to TTS (no LaTeX typesetting). */
  spokenText: string;
}

/**
 * Choose the deterministic teacher text for an Action's entry.
 *
 * Authoring may split one source step into several sub-Actions and copy the same
 * `coach.entryLatex` onto each. To avoid the page showing one sentence while the
 * TTS reads another, the rule is:
 *   1. The FIRST Action of a `sourceStepId` uses the coach entry copy (falling
 *      back to the Action instruction).
 *   2. Later sub-Actions of the same source step use their own instruction, so
 *      the entry copy is spoken once per step, not once per sub-Action.
 *
 * The returned `spokenText` is the normalized form of the chosen display copy so
 * the coach panel and the TTS always say the same thing.
 */
export function teacherCopyForAction(plan: ExercisePlan, action: ActionContract): TeacherCopy {
  const isFirstOfStep = plan.actions.find((item) => item.sourceStepId === action.sourceStepId)?.actionId === action.actionId;
  const displayLatex = isFirstOfStep
    ? (action.coach?.entryLatex ?? action.instruction)
    : action.instruction;
  const authoredSpoken = isFirstOfStep ? action.coach?.entrySpoken?.trim() : undefined;
  return { displayLatex, spokenText: authoredSpoken || latexToSpokenChinese(displayLatex) };
}
