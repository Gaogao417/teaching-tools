import type { ExercisePlan } from "../../../shared/actionRuntime";
import type { ActionMachineRegistry } from "./registry";
import { projectExerciseSteps } from "./projection/projectExerciseSteps";
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
  registry: Pick<ActionMachineRegistry, "projectStepRecord">,
): WorkspaceView {
  const action = page.plan.actions.find((item) => item.actionId === page.currentActionId);
  if (!action) throw new Error(`Current action ${page.currentActionId} is missing from plan`);
  const actionIndex = page.plan.actions.findIndex((item) => item.actionId === action.actionId);
  const directive = page.coachDirective;
  const wrongMessage = page.wrongMessage || child.wrongMessage;
  const entities = entitiesFor(page.plan, child, page.world.draft.geometry, directive?.highlightObjectIds || []);
  return {
    actionId: action.actionId,
    actionKind: action.kind,
    title: action.title,
    instruction: action.instruction,
    progress: { current: actionIndex + 1, total: page.plan.actions.length },
    canvas: {
      geometry: page.world.draft.geometry,
      diagramAsset: page.world.draft.diagramAsset,
      entities,
      selectedObjectIds: child.selectedObjectIds,
      cursor: Object.values(entities).some((entity) => entity.enabled) ? "pointer" : "default",
      preview: child.preview,
    },
    answer: {
      slots: child.projectedAnswerSlots,
      activeSlotId: child.activeSlotId,
      steps: projectExerciseSteps(page, child, registry),
    },
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
      canBack: child.selectedObjectIds.length > 0 || Object.keys(child.answers).length > 0,
      canClear: child.selectedObjectIds.length > 0 || Object.keys(child.answers).length > 0,
      canCancel: page.status !== "submitting",
      canHelp: page.status !== "submitting",
      canSubmit: child.ready && !child.done && page.status !== "submitting",
      isSubmitting: page.status === "submitting",
      submitReason: child.ready ? undefined : "请先完成当前动作需要的选择或输入。",
    },
  };
}
