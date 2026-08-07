import type { ClientDraftState, ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import { currentStep } from "./sceneUtils";

function canSubmit(runtime: ExerciseRuntimeSpec, draft: ClientDraftState) {
  const step = currentStep(runtime);
  const topicWorkspace = runtime.instance.scene.topicWorkspace;
  const topicContract = topicWorkspace?.contracts[runtime.runtimeState.currentStepId];
  if (topicContract) {
    const inputAction = step.allowedActions.find((action) => action.type === "input");
    const value = inputAction?.type === "input" ? draft.inputs[inputAction.target]?.trim() || "" : "";
    if (topicContract.primitive === "mark-segments") {
      const labels = value.split(";").filter(Boolean).map((part) => part.split("="));
      const required = topicContract.interaction?.expectedLabels?.length
        || (topicContract.acceptedAnswers[0] || "").split(";").filter(Boolean).length;
      return labels.length >= required && labels.every(([segmentId, label]) => Boolean(segmentId && label?.trim()));
    }
    if (topicContract.primitive === "mark-ratio") {
      const selected = value.split(",").filter(Boolean);
      return selected.length >= (topicContract.interaction?.expectedOrder?.length || 4);
    }
    if (topicContract.primitive === "ratio-scratch") {
      const [objects = "", ratio = ""] = value.split("|");
      return objects.split(",").filter(Boolean).length === 2
        && ratio.split(",").filter((item) => item.trim()).length === 2;
    }
    if (topicContract.primitive === "convert-collinear") {
      const selected = value.split(",").filter(Boolean);
      return selected.length === (topicContract.interaction?.expectedOrder?.length || 3);
    }
    if (topicContract.primitive === "construct-parallel") {
      const parts = Object.fromEntries(value.split("|").filter(Boolean).map((part) => part.split(":")));
      return Boolean(parts.point && parts.parallel && parts.carrier?.split(",").filter(Boolean).length === 2);
    }
    if (topicContract.primitive === "equation") {
      const [equation = "", result = ""] = value.split("|");
      const factors = equation.split("=")[1]?.split("*").filter(Boolean) || [];
      return factors.length === 3 && Boolean(result.trim());
    }
    return Boolean(value);
  }
  const actionable = step.allowedActions.filter((action) => action.type === "select" || action.type === "input");
  if (!actionable.length) return true;

  return actionable.every((action) => {
    if (action.type === "input") return Boolean(draft.inputs[action.target]?.trim());
    const selected = draft.selections[action.target] || [];
    const required = action.selectionKind === "ordered" ? action.presentation?.slots?.length || 1 : 1;
    return selected.length >= required;
  });
}

type RuntimeActionControlsProps = {
  runtime: ExerciseRuntimeSpec;
  draft: ClientDraftState;
  disabled?: boolean;
  showSubmit?: boolean;
  onClear: (target?: string) => void;
  onSubmit: (stepId: string, value: string) => void;
};

export function RuntimeActionControls({
  runtime,
  draft,
  disabled,
  showSubmit = true,
  onClear,
  onSubmit,
}: RuntimeActionControlsProps) {
  const step = currentStep(runtime);
  const clearAction = step.allowedActions.find((action) => action.type === "clear");
  const submitAction = step.allowedActions.find((action) => action.type === "submit");
  const readyToSubmit = canSubmit(runtime, draft);

  return (
    <>
      <button
        className="btn btn-ghost"
        type="button"
        disabled={disabled || !clearAction}
        onClick={() => onClear(clearAction?.target || step.id)}
      >
        清空本步
      </button>
      {showSubmit && submitAction ? (
        <button
          className="btn btn-primary"
          type="button"
          disabled={disabled || !readyToSubmit}
          onClick={() => submitAction.type === "submit" && onSubmit(
            submitAction.stepId,
            JSON.stringify({ selections: draft.selections, inputs: draft.inputs }),
          )}
        >
          提交答案
          <span className="material-symbols-outlined">arrow_forward</span>
        </button>
      ) : null}
      {!readyToSubmit && showSubmit ? (
        <small className="ks-submit-requirement">先完成图中的当前动作</small>
      ) : null}
    </>
  );
}
