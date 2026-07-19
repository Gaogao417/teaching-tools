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
  onClear,
  onSubmit,
}: {
  runtime: ExerciseRuntimeSpec;
  draft: ClientDraftState;
  disabled?: boolean;
  onClear: (target?: string) => void;
  onSubmit: (stepId: string, value: string) => void;
}) {
  const step = currentStep(runtime);
  const clearAction = step.allowedActions.find((action) => action.type === "clear");
  const submitAction = step.allowedActions.find((action) => action.type === "submit");
  const slots = answerSlots(runtime, draft);

  return (
    <section className="ks-action-dock" aria-label="答案操作区">
      <div className="ks-action-dock-answer">
        <span className="ks-action-dock-label">当前答案</span>
        <div className="ks-answer-slots">
          {slots.length ? slots.map((slot) => (
            <div key={slot.id} className={`ks-answer-slot ${slot.value ? "is-filled" : ""}`}>
              <span>{slot.label}</span>
              <strong>{slot.value || slot.placeholder}</strong>
            </div>
          )) : <span className="ks-answer-empty">完成画布中的当前动作后提交</span>}
        </div>
      </div>

      <div className="ks-action-dock-buttons">
        <button
          className="btn btn-ghost"
          type="button"
          disabled={disabled || !clearAction}
          onClick={() => onClear(clearAction?.target || step.id)}
        >
          清空
        </button>
        <button
          className="btn btn-primary ks-action-submit"
          type="button"
          disabled={disabled || !submitAction || !canSubmit(runtime, draft)}
          onClick={() => submitAction?.type === "submit" && onSubmit(
            submitAction.stepId,
            JSON.stringify({ selections: draft.selections, inputs: draft.inputs }),
          )}
        >
          提交答案
          <span className="material-symbols-outlined">arrow_forward</span>
        </button>
      </div>
    </section>
  );
}
