import type { ChangeEvent, ReactElement } from "react";
import type { BuoyancyWorkspaceModel } from "../../../../../shared/buoyancyForceAnalysis";
import type { ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import { currentStep } from "../../../pages/practice/runtime/sceneUtils";
import type { WorkspaceRendererProps } from "../../../pages/practice/runtime/workspaceRenderers";
import { ForceDiagramSVG } from "./ForceDiagramSVG";
import "./buoyancyForceAnalysis.css";

// ─── Parse workspace model from scene entities ───────────────────────

function parseWorkspaceModel(
  runtime: ExerciseRuntimeSpec,
): BuoyancyWorkspaceModel | null {
  const modelEntity = runtime.instance.scene.entities.find(
    (e) => e.kind === "text" && e.id === "buoyancy-model",
  );
  if (!modelEntity || modelEntity.kind !== "text") return null;
  try {
    return JSON.parse(modelEntity.text) as BuoyancyWorkspaceModel;
  } catch {
    return null;
  }
}

// ─── Main renderer ───────────────────────────────────────────────────

export function BuoyancyWorkspaceRenderer({
  runtime,
  draft,
  setDraft,
  onSubmit,
  onClear,
}: WorkspaceRendererProps): ReactElement {
  const model = parseWorkspaceModel(runtime);
  if (!model) {
    return <div className="bfa-workspace">Loading...</div>;
  }

  const step = currentStep(runtime);
  const stepId = model.currentStepId;
  const unknownVar = step.allowedActions.find((a) => a.type === "input");
  const inputTarget = unknownVar?.type === "input" ? unknownVar.target : stepId;

  // Find the current unknown variable
  const currentUnknownIndex = stepId === "solve-unknown-1" ? 0 : 1;
  const unknownKey = currentUnknownIndex === 0
    ? model.variables.find((v) => !v.isKnown && !runtime.runtimeState.completedStepIds.includes(v.key))
    : model.variables.find((v) => !v.isKnown);

  // Actually, we need to find the unknowns from the model
  const unknowns = model.variables.filter((v) => !v.isKnown);
  const currentUnknown = unknowns[currentUnknownIndex] || unknowns[0];

  const value = draft.inputs[inputTarget] || "";

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setDraft((prev) => ({
      ...prev,
      inputs: { ...prev.inputs, [inputTarget]: e.target.value },
    }));
  };

  const handleSubmit = () => {
    onSubmit({
      stepId,
      value: JSON.stringify({ inputs: { [inputTarget]: value } }),
    });
  };

  const handleClear = () => {
    onClear(inputTarget);
  };

  return (
    <div className="bfa-workspace">
      {/* Equation reference card */}
      <div className="bfa-equation-card">
        <div className="bfa-eq-line">
          <span className="bfa-eq-label">物块：</span>
          <span>{model.equations.object}</span>
        </div>
        <div className="bfa-eq-line">
          <span className="bfa-eq-label">整体：</span>
          <span>{model.equations.system}</span>
        </div>
      </div>

      {/* Main canvas: diagram + input area */}
      <div className="bfa-canvas">
        <div className="bfa-diagram-area">
          <ForceDiagramSVG model={model} />
        </div>

        <div className="bfa-input-area">
          <p className="bfa-prompt">{model.prompt}</p>

          <div className="bfa-step-input">
            <label className="bfa-input-label">
              求 {currentUnknown?.label || "?"}：
            </label>
            <div className="bfa-input-row">
              <input
                className="bfa-input-field"
                placeholder="输入数值"
                value={value}
                onChange={handleInputChange}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
              />
              <span className="bfa-input-unit">{currentUnknown?.unit || "N"}</span>
            </div>
          </div>

          {model.wrongHint && (
            <div className="bfa-wrong-hint">{model.wrongHint}</div>
          )}

          <div className="practice-workspace-actions">
            <button className="tiny-btn" type="button" onClick={handleClear}>
              清空当前步骤
            </button>
            <button className="btn btn-primary" type="button" onClick={handleSubmit}>
              提交当前步骤
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
