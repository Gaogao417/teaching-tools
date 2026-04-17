import type { ReactElement } from "react";
import type { AngleEquationWorkspaceModel } from "../../../../../shared/angleEquation";
import type { ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import type { WorkspaceRendererProps } from "../../../pages/practice/runtime/workspaceRenderers";
import { EquationCard } from "./EquationCard";
import { RangeBandSVG } from "./RangeBandSVG";
import { StepInputArea } from "./StepInputArea";
import { UnitCircleSVG } from "./UnitCircleSVG";
import "./angleEquation.css";

// ─── Parse workspace model from scene entities ───────────────────────

function parseWorkspaceModel(
  runtime: ExerciseRuntimeSpec,
): AngleEquationWorkspaceModel | null {
  const modelEntity = runtime.instance.scene.entities.find(
    (e) => e.kind === "text" && e.id === "angle-equation-model",
  );
  if (!modelEntity || modelEntity.kind !== "text") return null;
  try {
    return JSON.parse(modelEntity.text) as AngleEquationWorkspaceModel;
  } catch {
    return null;
  }
}

// ─── Format equation display ─────────────────────────────────────────

function formatEquationDisplay(model: AngleEquationWorkspaceModel): string {
  const { trigFn, omega, phi, value } = model.equation;
  let inner = "";

  if (model.unknownType === "x") {
    const omegaStr = omega === 1 ? "" : omega === -1 ? "-" : `${omega}`;
    const phiStr =
      phi === "0"
        ? ""
        : phi.startsWith("-")
          ? ` ${phi}`
          : ` + ${phi}`;
    inner = `${omegaStr}x${phiStr}`;
  } else if (model.unknownType === "phi") {
    inner = "x + phi";
  } else {
    inner = "omega * x";
  }

  return `${trigFn}(${inner}) = ${value}`;
}

function formatRangeDisplay(model: AngleEquationWorkspaceModel): string {
  const label =
    model.unknownType === "x"
      ? "x"
      : model.unknownType === "phi"
        ? "phi"
        : "omega";
  return `${label} in [${model.unknownRange[0]}, ${model.unknownRange[1]}]`;
}

// ─── Main renderer ───────────────────────────────────────────────────

export function AngleEquationWorkspaceRenderer({
  runtime,
  draft,
  setDraft,
  onSubmit,
  onClear,
}: WorkspaceRendererProps): ReactElement {
  const model = parseWorkspaceModel(runtime);
  if (!model) {
    return <div className="ae-workspace">Loading...</div>;
  }

  const stepId = model.currentStepId;
  const equationDisplay = formatEquationDisplay(model);
  const rangeDisplay = formatRangeDisplay(model);

  // Selection toggle handler
  const handleToggleAngle = (key: string, angle: string) => {
    const current = draft.selections[key] || [];
    const next = current.includes(angle)
      ? current.filter((a) => a !== angle)
      : [...current, angle];
    setDraft((prev) => ({
      ...prev,
      selections: { ...prev.selections, [key]: next },
    }));
  };

  // Input change handler
  const handleInputChange = (key: string, value: string) => {
    setDraft((prev) => ({
      ...prev,
      inputs: { ...prev.inputs, [key]: value },
    }));
  };

  // Submit handler
  const handleSubmit = () => {
    onSubmit({
      stepId,
      value: JSON.stringify({
        selections: draft.selections,
        inputs: draft.inputs,
      }),
    });
  };

  // Clear handler
  const handleClear = () => {
    onClear(stepId);
  };

  // Determine which angles are selected on the unit circle
  const unitCircleSelected =
    stepId === "find-angles"
      ? draft.selections["find-angles"] || []
      : model.candidateAngles || [];

  return (
    <div className="ae-workspace">
      <EquationCard equation={equationDisplay} rangeText={rangeDisplay} />

      <RangeBandSVG
        unknownLabel={
          model.unknownType === "x"
            ? "x"
            : model.unknownType === "phi"
              ? "phi"
              : "omega"
        }
        rangeLow={model.unknownRange[0]}
        rangeHigh={model.unknownRange[1]}
        transformedRange={model.transformedRange}
      />

      <div className="ae-canvas">
        <UnitCircleSVG
          trigFn={model.equation.trigFn}
          selectedAngles={unitCircleSelected}
          selectable={stepId === "find-angles"}
          onToggleAngle={(angleId) => handleToggleAngle("find-angles", angleId)}
        />

        <StepInputArea
          stepId={stepId}
          selections={draft.selections}
          inputs={draft.inputs}
          onToggleSelection={handleToggleAngle}
          onInputChange={handleInputChange}
          candidateAngles={model.candidateAngles}
          filteredAngles={model.filteredAngles}
        />
      </div>

      <div className="practice-workspace-actions">
        <button className="tiny-btn" type="button" onClick={handleClear}>
          清空当前步骤
        </button>
        <button className="btn btn-primary" type="button" onClick={handleSubmit}>
          提交当前步骤
        </button>
      </div>
    </div>
  );
}
