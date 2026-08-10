import type { ActionContract } from "../../../../shared/actionRuntime";
import type { ActionMachineRegistry } from "../registry";
import type { ActionSnapshotView, ExerciseStepStatus, ExerciseStepView, PageRuntimeSnapshot, StepRecordTokenView } from "../types";

function groupBySourceStep(actions: ActionContract[]): ActionContract[][] {
  const groups = new Map<string, ActionContract[]>();
  for (const action of actions) {
    const group = groups.get(action.sourceStepId) || [];
    group.push(action);
    groups.set(action.sourceStepId, group);
  }
  return [...groups.values()];
}

/** Pure aggregation of registry-owned Action projections into learner-facing source steps. */
export function projectExerciseSteps(
  page: PageRuntimeSnapshot,
  child: ActionSnapshotView,
  registry: Pick<ActionMachineRegistry, "projectStepRecord">,
): ExerciseStepView[] {
  return groupBySourceStep(page.plan.actions).map((actions) => {
    const actionIds = actions.map((action) => action.actionId);
    const values: Record<string, string> = {};
    const summaries: string[] = [];
    let template: StepRecordTokenView[] | undefined;

    for (const action of actions) {
      const projection = registry.projectStepRecord(action, {
        evidence: page.evidence.find((item) => item.actionId === action.actionId),
        current: action.actionId === page.currentActionId ? child : undefined,
      });
      if (!template && projection.template) template = projection.template;
      Object.assign(values, projection.values);
      if (projection.summary) summaries.push(projection.summary);
    }

    const allComplete = actionIds.every((actionId) => page.completedActionIds.includes(actionId));
    const isActive = actionIds.includes(page.currentActionId);
    const status: ExerciseStepStatus = allComplete ? "complete" : isActive ? "active" : "pending";
    const record = template?.map((token): StepRecordTokenView => token.kind === "slot"
      ? { ...token, value: values[token.slotId] || undefined }
      : token);

    return {
      sourceStepId: actions[0].sourceStepId,
      title: actions[0].title,
      instruction: actions[0].instruction,
      actionIds,
      status,
      record,
      summary: summaries.length ? summaries.join("；") : undefined,
    };
  });
}
