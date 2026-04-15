import type {
  ClientDraftState,
  ExerciseRuntimeSpec,
  FlowStep,
  SceneEntity,
} from "../../../../../shared/contracts";
import type { Role, Side } from "../../../../../shared/triangleTrig";

export const ROLE_LABELS: Record<Role, string> = {
  opposite: "对边",
  adjacent: "邻边",
  hypotenuse: "斜边",
};

export function edgeSideFromRef(ref?: string): Side | null {
  if (!ref) return null;
  if (ref.startsWith("edge-")) return ref.slice(5) as Side;
  if (ref.startsWith("side-")) return ref.slice(5) as Side;
  if (ref === "AB" || ref === "BC" || ref === "AC") return ref;
  return null;
}

export function currentStep(runtime: ExerciseRuntimeSpec): FlowStep {
  return (
    runtime.instance.flow.steps.find((step) => step.id === runtime.runtimeState.currentStepId) ||
    runtime.instance.flow.steps[0]
  );
}

export function findEntity<TKind extends SceneEntity["kind"]>(
  entities: SceneEntity[],
  kind: TKind,
): Extract<SceneEntity, { kind: TKind }> | undefined {
  return entities.find((entity): entity is Extract<SceneEntity, { kind: TKind }> => entity.kind === kind);
}

export function findEntities<TKind extends SceneEntity["kind"]>(
  entities: SceneEntity[],
  kind: TKind,
): Array<Extract<SceneEntity, { kind: TKind }>> {
  return entities.filter((entity): entity is Extract<SceneEntity, { kind: TKind }> => entity.kind === kind);
}

export function roleLabelForEdge(edgeId: string, entities: SceneEntity[]) {
  const edge = entities.find(
    (entity): entity is Extract<SceneEntity, { kind: "edge" }> => entity.id === edgeId && entity.kind === "edge",
  );

  if (!edge?.role) {
    return edge?.label || edgeId.replace("edge-", "");
  }

  return `${ROLE_LABELS[edge.role as Role]} (${edge.label || edge.id.replace("edge-", "")})`;
}

export function orderedSelectionPreview(runtime: ExerciseRuntimeSpec, draft: ClientDraftState) {
  const step = currentStep(runtime);
  const selectAction = step.allowedActions.find((action) => action.type === "select");
  if (!selectAction || selectAction.selectionKind !== "ordered") return null;

  const selected = draft.selections[selectAction.target] || [];
  return {
    numerator: selected[0] ? roleLabelForEdge(`edge-${selected[0]}`, runtime.instance.scene.entities) : null,
    denominator: selected[1] ? roleLabelForEdge(`edge-${selected[1]}`, runtime.instance.scene.entities) : null,
  };
}
