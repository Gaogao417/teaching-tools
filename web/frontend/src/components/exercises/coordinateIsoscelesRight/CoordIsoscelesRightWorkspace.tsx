import type { CoordIsoscelesWorkspaceModel } from "../../../../../shared/coordinateIsoscelesRight";
import type { ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import { currentStep } from "../../../pages/practice/runtime/sceneUtils";
import type { WorkspaceRendererProps } from "../../../pages/practice/runtime/workspaceRenderers";
import { CoordPlaneSVG } from "./CoordPlaneSVG";
import { StepInputArea } from "./StepInputArea";

// ─── Parse workspace model from scene entities ─────────────────────────

function parseModel(runtime: ExerciseRuntimeSpec): CoordIsoscelesWorkspaceModel | null {
  const entity = runtime.instance.scene.entities.find(
    (e) => e.id === "coord-isosceles-right-model" && e.kind === "text",
  );
  if (!entity || entity.kind !== "text") return null;
  try {
    return JSON.parse(entity.text) as CoordIsoscelesWorkspaceModel;
  } catch {
    return null;
  }
}

// ─── Main workspace renderer ───────────────────────────────────────────

export function CoordIsoscelesRightWorkspaceRenderer({
  runtime,
  draft,
  setDraft,
  inputRefs,
  onSubmit,
  onClear,
}: WorkspaceRendererProps) {
  const step = currentStep(runtime);
  const model = parseModel(runtime);

  if (!model) {
    return (
      <div className="practice-canvas-zone">
        <p>工作区模型加载失败</p>
      </div>
    );
  }

  const submitAction = step.allowedActions.find((a) => a.type === "submit");
  const clearAction = step.allowedActions.find((a) => a.type === "clear");

  const completedSteps = runtime.runtimeState.completedStepIds;
  const showAuxiliaryLines = completedSteps.includes("construct-lines");
  const highlightCongruent = completedSteps.includes("identify-congruent");

  // Toggle selection (single-select: replace)
  const handleToggleSelection = (key: string, value: string) => {
    setDraft((prev) => {
      const current = prev.selections[key] || [];
      const isSelected = current.includes(value);
      return {
        ...prev,
        selections: {
          ...prev.selections,
          [key]: isSelected ? [] : [value],
        },
      };
    });
  };

  // Input change
  const handleInputChange = (key: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      inputs: { ...prev.inputs, [key]: value },
    }));
  };

  // Submit handler
  const handleSubmit = () => {
    if (submitAction?.type !== "submit") return;
    onSubmit({
      stepId: submitAction.stepId,
      value: JSON.stringify({
        selections: draft.selections,
        inputs: draft.inputs,
      }),
    });
  };

  return (
    <div className="practice-canvas-zone">
      <div className="ir-workspace">
        {/* Main canvas: coordinate plane + step input */}
        <div className="ir-canvas">
          <div className="ir-plane-container">
            <CoordPlaneSVG
              gridBounds={model.gridBounds}
              B={model.B}
              C={model.C}
              solvedA={model.solvedCoord ?? null}
              showAuxiliaryLines={showAuxiliaryLines}
              highlightCongruent={highlightCongruent}
            />
          </div>
          <div className="ir-step-area">
            <StepInputArea
              stepId={model.currentStepId}
              selections={draft.selections}
              inputs={draft.inputs}
              onToggleSelection={handleToggleSelection}
              onInputChange={handleInputChange}
              constructionOptions={model.constructionOptions}
              congruenceOptions={model.congruenceOptions}
              inputRefs={inputRefs}
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="practice-workspace-actions">
          <button
            className="tiny-btn"
            type="button"
            onClick={() => onClear(clearAction?.target || step.id)}
          >
            清空左侧步骤
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={submitAction?.type !== "submit"}
            onClick={handleSubmit}
          >
            提交左侧步骤
          </button>
        </div>
      </div>
    </div>
  );
}
