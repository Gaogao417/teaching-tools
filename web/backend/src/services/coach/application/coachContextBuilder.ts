import { renderBoardExpression } from "../../../../../shared/solutionBoard";
import type { ExercisePlan } from "../../../../../shared/actionRuntime";
import type { CoachContext } from "../ports/RealtimeVoiceProvider";

/**
 * The single, shared builder of the public coaching context. Both the streaming
 * turn path and the full-duplex live path resolve their context through this
 * function, so turn and live present the identical, Assessment-safe context
 * shape to their respective ports (ADR-005 §Architectural Invariants #6).
 *
 * Assessment mode is fail-closed at the data layer: `visibleSolution` is always
 * empty and no reviewed teaching targets are exposed, so no private answer truth
 * can reach a prompt, trace or stream event regardless of the caller.
 */

export interface BuildCoachContextOptions {
  actionId: string;
  /** Public, Assessment-safe student trace. Omit for live sessions that do not
   *  forward a trace to the provider. */
  trace?: unknown;
}

export function buildCoachContext(plan: ExercisePlan, options: BuildCoachContextOptions): CoachContext {
  const action = plan.actions.find((candidate) => candidate.actionId === options.actionId)
    || plan.actions.find((candidate) => candidate.actionId === plan.currentActionId)!;
  const board = plan.solutionBoardContexts?.find((context) => context.actionId === action.actionId)?.board;
  const visibleSolution = plan.mode === "assessment"
    ? []
    : (board?.expressions || []).filter((expression) => expression.phase !== "hidden").map((expression) => renderBoardExpression(expression));
  const context: CoachContext = {
    mode: plan.mode,
    problemLatex: plan.metadata.promptLatex,
    action: { actionId: action.actionId, title: action.title, instruction: action.instruction },
    visibleSolution,
    trace: options.trace ?? null,
  };
  if (plan.mode === "learn") {
    context.reviewedTeachingTargets = action.input;
  }
  return context;
}
