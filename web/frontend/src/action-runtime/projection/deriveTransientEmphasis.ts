import type { ActionSolutionBoardContext } from "../../../../shared/solutionBoard";
import type { DomainCommand } from "../../../../shared/actionWorld";
import type { EmphasisTarget } from "../types";

/**
 * Derive the set of elements to briefly highlight from the domain changes an
 * Action just produced. This is the ONLY place that maps a {@link DomainCommand}
 * type to an {@link EmphasisTarget}; PageRuntime, the WorkspaceView projector
 * and the renderers consume the result without inspecting command kinds, so a
 * new Action that emits an already-supported command gets highlighting for free.
 *
 * The function is pure and returns an empty array when nothing changed — the
 * caller then produces no emphasis at all.
 */
export function deriveTransientEmphasis(input: {
  /** Local DomainCommands emitted by the Action completion (already diagram-resolved). */
  commands?: readonly DomainCommand[];
  /**
   * A server-projected SolutionBoard context whose stage just became "accepted".
   * When present, the expression(s) for the accepted source step are highlighted.
   */
  acceptedBoard?: { context: ActionSolutionBoardContext; sourceStepId: string };
}): EmphasisTarget[] {
  const targets: EmphasisTarget[] = [];
  for (const command of input.commands || []) {
    switch (command.type) {
      case "construct-parallel":
      case "construct-carrier":
        targets.push({ surface: "canvas", kind: "entity", id: command.outputLineId });
        break;
      case "intersect-lines":
        targets.push({ surface: "canvas", kind: "entity", id: command.outputPointId });
        break;
      case "set-segment-label":
      case "set-correspondence-mark":
      case "set-emphasis":
        // The derivation names the teaching-mark artifact. If the active renderer
        // has no independent node for an emphasis mark, the renderer falls back to
        // the mark's own entity ids — that fallback lives in the renderer, not here.
        targets.push({ surface: "canvas", kind: "teaching-mark", id: command.markId });
        break;
      default: {
        const exhaustive: never = command;
        return exhaustive;
      }
    }
  }

  if (input.acceptedBoard) {
    const { context, sourceStepId } = input.acceptedBoard;
    for (const expression of context.board.expressions) {
      if (expression.phase === "hidden") continue;
      if (expression.sourceStepId !== sourceStepId) continue;
      targets.push({ surface: "solution-board", kind: "expression", id: expression.expressionId });
    }
  }

  // De-duplicate while preserving order (a command batch and an accepted board
  // could theoretically reference the same id across surfaces).
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.surface}:${target.kind}:${target.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
