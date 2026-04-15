import type { ClientDraftState, ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import type { InputRefs } from "./sceneUtils";
import { findEntities, orderedSelectionPreview } from "./sceneUtils";
import { FormulaEntity } from "./FormulaEntity";

export function OverlayLayer({
  runtime,
  draft,
  setDraft,
  inputRefs,
  canSubmitOrderedSelection,
  submitStepId,
  onSubmit,
  onClear,
  clearTarget,
}: {
  runtime: ExerciseRuntimeSpec;
  draft: ClientDraftState;
  setDraft: import("react").Dispatch<import("react").SetStateAction<ClientDraftState>>;
  inputRefs: InputRefs;
  canSubmitOrderedSelection: boolean;
  submitStepId?: string;
  onSubmit: (action: { stepId: string; value: string }) => void;
  onClear: (target?: string) => void;
  clearTarget?: string;
}) {
  const texts = findEntities(runtime.instance.scene.entities, "text");
  const formulas = findEntities(runtime.instance.scene.entities, "formula");
  const inlineTexts = texts.filter((entity) => entity.variant === "inline-formula");
  const angleBadge = texts.find((entity) => entity.variant === "angle-badge");
  const selectionPreview = orderedSelectionPreview(runtime, draft);

  return (
    <>
      {angleBadge ? <div className="practice-angle-badge">{angleBadge.text}</div> : null}

      {formulas.map((entity) => (
        <FormulaEntity
          key={entity.id}
          entity={entity}
          anchors={runtime.instance.scene.anchors}
          draft={draft}
          setDraft={setDraft}
          inputRefs={inputRefs}
        />
      ))}

      <div className="practice-workspace-footer">
        {selectionPreview ? (
          <div className="practice-fraction-preview">
            <div className={`practice-fraction-slot ${selectionPreview.numerator ? "filled" : "active"}`}>
              {selectionPreview.numerator || "第一项"}
            </div>
            <div className="practice-fraction-bar" />
            <div className={`practice-fraction-slot ${selectionPreview.denominator ? "filled" : ""}`}>
              {selectionPreview.denominator || "第二项"}
            </div>
          </div>
        ) : null}

        {inlineTexts.map((entity) => (
          <div key={entity.id} className="practice-inline-formula">
            {entity.text}
          </div>
        ))}

        <div className="practice-workspace-actions">
          <button className="tiny-btn" type="button" onClick={() => onClear(clearTarget)}>
            清空左侧步骤
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!submitStepId || !canSubmitOrderedSelection}
            onClick={() =>
              submitStepId &&
              onSubmit({
                stepId: submitStepId,
                value: JSON.stringify({
                  selections: draft.selections,
                  inputs: draft.inputs,
                }),
              })
            }
          >
            提交左侧步骤
          </button>
        </div>
      </div>
    </>
  );
}
