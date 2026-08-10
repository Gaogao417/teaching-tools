import type { ExercisePlan } from "../../../shared/actionRuntime";
import { applyDomainCommands } from "../../../shared/actionWorld";
import { applyBoardCommands, renderBoardExpression } from "../../../shared/solutionBoard";
import type { ActionSnapshotView, PageRuntimeSnapshot, RuntimeEntityView, WorkspaceView } from "./types";

function entitiesFor(plan: ExercisePlan, child: ActionSnapshotView, geometry = plan.world.geometry, highlights: string[] = []): Record<string, RuntimeEntityView> {
  const ids = new Map<string, "point" | "line" | "angle">();
  for (const point of geometry?.points || []) ids.set(point.id, "point");
  for (const line of geometry?.segments || []) ids.set(line.id, "line");
  for (const line of geometry?.derivedLines || []) ids.set(line.id, "line");
  const wrong = child.wrongObjectId;
  return Object.fromEntries([...ids].map(([id, kind]) => {
    const enabled = child.enabledByKind[`${kind}s` as "points" | "lines" | "angles"].includes(id);
    const selected = child.selectedObjectIds.includes(id);
    return [id, {
      id,
      kind,
      enabled,
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
  const currentExpression = page.plan.solutionBoardScript?.expressions.find((expression) => expression.ownerActionIds.includes(action.actionId));
  let board = page.world.draft.solutionBoard;
  if (board && currentExpression) {
    try {
      board = applyBoardCommands(board, [
        { type: "reveal-expression", expressionId: currentExpression.expressionId },
        ...child.boardPreview,
      ]);
    } catch {
      // A malformed preview must not replace the last valid committed document.
    }
  }
  const latestBoardFill = [...child.boardPreview].reverse().find((command) => command.type === "fill-slot");
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
      announcement: latestBoardFill?.type === "fill-slot" ? `板书已填写 ${latestBoardFill.latex}` : undefined,
    } : undefined,
    coach: {
      profileName: page.plan.coach.displayName,
      avatarId: page.plan.coach.avatarId,
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
