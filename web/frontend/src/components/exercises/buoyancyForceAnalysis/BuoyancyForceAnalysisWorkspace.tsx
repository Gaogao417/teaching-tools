import type { ReactElement } from "react";
import type { BuoyancyWorkspaceModel } from "../../../../../shared/buoyancyForceAnalysis";
import type { ExerciseRuntimeSpec } from "../../../../../shared/contracts";
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

export function BuoyancyForceAnalysisWorkspaceRenderer({
  runtime,
  draft,
  setDraft,
}: WorkspaceRendererProps): ReactElement {
  const model = parseWorkspaceModel(runtime);
  if (!model) {
    return <div className="bfa-workspace">Loading...</div>;
  }

  const stepId = model.currentStepId;

  // Find the current unknown variable
  const currentUnknown = model.variables.find((v) => !v.isKnown && !isStepDone(runtime, stepId))
    ?? model.variables.find((v) => !v.isKnown);

  // Input change handler
  const handleInputChange = (key: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      inputs: { ...prev.inputs, [key]: value },
    }));
  };

  return (
    <div className="bfa-workspace">
      {/* Equation reference card */}
      <div className="bfa-equation-card">
        <div className="bfa-eq-line">
          <span className="bfa-eq-label">物块：</span>
          <span>F + F浮 = G物</span>
        </div>
        <div className="bfa-eq-line">
          <span className="bfa-eq-label">整体：</span>
          <span>F + F桌 = G水 + G物</span>
        </div>
      </div>

      {/* Main canvas: diagram + input */}
      <div className="bfa-canvas">
        <div className="bfa-diagram-area">
          <ForceDiagramSVG model={model} />
        </div>

        <div className="bfa-input-area">
          {/* Prompt */}
          <div className="bfa-prompt">{model.prompt}</div>

          {/* Step input */}
          {currentUnknown && (
            <div className="bfa-step-input">
              <label className="bfa-input-label">
                {currentUnknown.label} = ?
              </label>
              <div className="bfa-input-row">
                <input
                  className="bfa-input-field"
                  placeholder={`输入${currentUnknown.label}的值`}
                  value={draft.inputs[stepId] || ""}
                  onChange={(e) => handleInputChange(stepId, e.target.value)}
                />
                <span className="bfa-input-unit">{currentUnknown.unit}</span>
              </div>
            </div>
          )}

          {/* Wrong hint */}
          {model.wrongHint && (
            <div className="bfa-wrong-hint">{model.wrongHint}</div>
          )}

        </div>
      </div>
    </div>
  );
}

function isStepDone(runtime: ExerciseRuntimeSpec, stepId: string): boolean {
  return runtime.runtimeState.completedStepIds.includes(stepId);
}
