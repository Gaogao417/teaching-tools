import type { ClientDraftState, ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import { currentStep } from "./sceneUtils";

type AnswerSlot = {
  id: string;
  label: string;
  placeholder: string;
  value: string;
};

function answerSlots(runtime: ExerciseRuntimeSpec, draft: ClientDraftState): AnswerSlot[] {
  const step = currentStep(runtime);
  const slots: AnswerSlot[] = [];

  for (const action of step.allowedActions) {
    if (action.type === "select") {
      const selected = draft.selections[action.target] || [];
      const presentationSlots = action.presentation?.slots;
      if (presentationSlots?.length) {
        presentationSlots.forEach((slot, index) => {
          slots.push({ ...slot, value: selected[index] || "" });
        });
      } else {
        slots.push({
          id: action.target,
          label: action.presentation?.label || "已选择",
          placeholder: "尚未选择",
          value: selected.join(" → "),
        });
      }
    }

    if (action.type === "input") {
      const slot = action.presentation?.slots?.find((item) => item.id === action.target)
        || action.presentation?.slots?.[0];
      slots.push({
        id: action.target,
        label: slot?.label || action.presentation?.label || "当前输入",
        placeholder: slot?.placeholder || "尚未输入",
        value: draft.inputs[action.target] || "",
      });
    }
  }

  return slots;
}

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

export function RuntimeActionDock({
  runtime,
  draft,
  disabled,
  compact = false,
  onClear,
  onSubmit,
}: {
  runtime: ExerciseRuntimeSpec;
  draft: ClientDraftState;
  disabled?: boolean;
  compact?: boolean;
  onClear: (target?: string) => void;
  onSubmit: (stepId: string, value: string) => void;
}) {
  const step = currentStep(runtime);
  const clearAction = step.allowedActions.find((action) => action.type === "clear");
  const submitAction = step.allowedActions.find((action) => action.type === "submit");
  const slots = answerSlots(runtime, draft);
  const readyToSubmit = canSubmit(runtime, draft);

  return (
    <section className={`ks-action-dock ${compact ? "is-compact" : ""}`} aria-label="答案操作区">
      {!compact ? <div className="ks-action-dock-answer">
        <span className="ks-action-dock-label">当前答案</span>
        <div className="ks-answer-slots">
          {slots.length ? slots.map((slot) => (
            <div key={slot.id} className={`ks-answer-slot ${slot.value ? "is-filled" : ""}`}>
              <span>{slot.label}</span>
              <strong>{slot.value || slot.placeholder}</strong>
            </div>
          )) : <span className="ks-answer-empty">完成画布中的当前动作后提交</span>}
        </div>
      </div> : null}

      <div className="ks-action-dock-buttons">
        {!compact ? <button
          className="btn btn-ghost"
          type="button"
          disabled={disabled || !clearAction}
          onClick={() => onClear(clearAction?.target || step.id)}
        >
          清空本步
        </button> : null}
        <button
          className="btn btn-primary ks-action-submit"
          type="button"
          disabled={disabled || !submitAction || !readyToSubmit}
          onClick={() => submitAction?.type === "submit" && onSubmit(
            submitAction.stepId,
            JSON.stringify({ selections: draft.selections, inputs: draft.inputs }),
          )}
        >
          提交答案
          <span className="material-symbols-outlined">arrow_forward</span>
        </button>
        {!readyToSubmit ? <small className="ks-submit-requirement">先完成图中的当前动作</small> : null}
      </div>
    </section>
  );
}
