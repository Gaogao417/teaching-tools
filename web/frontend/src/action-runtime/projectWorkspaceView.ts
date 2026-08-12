import type { ExercisePlan } from "../../../shared/actionRuntime";
import { applyDomainCommands } from "../../../shared/actionWorld";
import { renderBoardExpression } from "../../../shared/solutionBoard";
import type { ActionSnapshotView, PageRuntimeSnapshot, RuntimeEntityView, WorkspaceView } from "./types";

function entitiesFor(plan: ExercisePlan, child: ActionSnapshotView, geometry = plan.world.geometry, highlights: string[] = []): Record<string, RuntimeEntityView> {
  const ids = new Map<string, "point" | "line" | "angle">();
  for (const point of geometry?.points || []) ids.set(point.id, "point");
  for (const line of geometry?.segments || []) ids.set(line.id, "line");
  for (const line of geometry?.derivedLines || []) ids.set(line.id, "line");
  const wrong = child.wrongObjectId;
  // ADR-006 3-layer affordance. `advanceObjectIds` (machine-authored local truth)
  // is the correct-path set; when the machine omits it we fall back to the whole
  // accepting set so server-authoritative actions keep their current behavior.
  const advance = new Set(child.advanceObjectIds
    ?? [...child.enabledByKind.points, ...child.enabledByKind.lines, ...child.enabledByKind.angles]);
  return Object.fromEntries([...ids].map(([id, kind]) => {
    const enabled = child.enabledByKind[`${kind}s` as "points" | "lines" | "angles"].includes(id);
    const selected = child.selectedObjectIds.includes(id);
    return [id, {
      id,
      kind,
      // `enabled` stays the renderer/hit-test authority and is unchanged: a
      // reasonable-but-wrong candidate remains interactable and still reaches
      // the local training guard.
      enabled,
      // Broadest: anything the action will accept input on in this state.
      hitTestable: enabled,
      // A plausible candidate the guard will evaluate (includes wrong ones).
      candidate: enabled,
      // On a correct advancing path right now (local truth).
      advanceEnabled: enabled && advance.has(id),
      visualState: wrong === id ? "wrong" : selected ? "selected" : highlights.includes(id) ? "correct" : enabled ? "available" : "idle",
      feedback: wrong === id ? child.wrongMessage : undefined,
    } satisfies RuntimeEntityView];
  }));
}

/** Pure page composition; every action-specific projection came from its machine definition. */
export function projectWorkspaceView(
  page: PageRuntimeSnapshot,
  child: ActionSnapshotView,
): WorkspaceView {
  const action = page.plan.actions.find((item) => item.actionId === page.currentActionId);
  if (!action) throw new Error(`Current action ${page.currentActionId} is missing from plan`);
  const actionIndex = page.plan.actions.findIndex((item) => item.actionId === action.actionId);
  const directive = page.coachDirective;
  const wrongMessage = page.wrongMessage || child.wrongMessage;
  let previewWorld = page.world.draft;
  if (child.diagramPreviewCommands.length) {
    try {
      previewWorld = applyDomainCommands(page.world.draft, child.diagramPreviewCommands);
    } catch {
      // Keep the last valid diagram while the learner is still editing a mark.
    }
  }
  const entities = entitiesFor(page.plan, child, previewWorld.geometry, directive?.highlightObjectIds || []);
  const boardContext = page.plan.mode === "assessment"
    ? undefined
    : page.plan.solutionBoardContexts?.find((candidate) => candidate.actionId === action.actionId);
  const board = boardContext?.board;
  const currentExpression = [...(board?.expressions || [])].reverse()
    .find((expression) => expression.sourceStepId === action.sourceStepId)
    || (board?.expressions.length ? board.expressions[board.expressions.length - 1] : undefined);
  return {
    actionId: action.actionId,
    actionKind: action.kind,
    title: action.title,
    instruction: action.instruction,
    progress: { current: actionIndex + 1, total: page.plan.actions.length },
    canvas: {
      geometry: previewWorld.geometry,
      diagramAsset: page.world.draft.diagramAsset,
      entities,
      selectedObjectIds: child.selectedObjectIds,
      cursor: Object.values(entities).some((entity) => entity.enabled) ? "pointer" : "default",
      preview: child.preview,
    },
    answer: {
      slots: child.projectedAnswerSlots,
      activeSlotId: child.activeSlotId,
    },
    solutionBoard: board ? {
      headingLatex: board.headingLatex,
      visibleExpressions: board.expressions.filter((expression) => expression.phase !== "hidden").map((expression) => ({
        expressionId: expression.expressionId,
        sourceStepId: expression.sourceStepId,
        latex: renderBoardExpression(expression),
        isCurrent: expression.expressionId === currentExpression?.expressionId,
        isComplete: expression.phase === "complete",
      })),
      currentExpressionId: currentExpression?.expressionId,
      announcement: boardContext?.stage === "accepted" ? "规范解答已更新" : undefined,
    } : undefined,
    coach: {
      profileName: page.plan.coach.displayName,
      avatarId: page.plan.coach.avatarId,
      actionPromptLatex: action.coach?.entryLatex || action.instruction,
      messageLatex: directive?.messageLatex || wrongMessage || action.coach?.entryLatex || action.instruction,
      tone: directive?.tone || (wrongMessage ? "wrong" : "prompt"),
      highlightObjectIds: directive?.highlightObjectIds || page.wrongObjectIds,
      focusTargetId: directive?.focusTargetId,
      suggestedActionId: directive?.suggestedActionId,
      agentCommand: directive?.agentCommand,
    },
    controls: {
      canBack: child.selectedObjectIds.length > 0 || Object.keys(child.answers).length > 0
        || page.world.commandBatches.some((batch) => !batch.committed),
      canClear: child.selectedObjectIds.length > 0 || Object.keys(child.answers).length > 0,
      canCancel: page.status !== "submitting",
      canHelp: page.status !== "submitting",
      canSubmit: child.ready && !child.done && page.status !== "submitting",
      isSubmitting: page.status === "submitting",
      submitReason: child.ready ? undefined : "请先完成当前动作需要的选择或输入。",
    },
  };
}
