import type { ChangeEvent, ReactElement } from "react";
import type { AngleEquationWorkspaceModel } from "../../../../../shared/angleEquation";
import type { ExerciseRuntimeSpec, SceneAnchor } from "../../../../../shared/contracts";
import type { WorkspaceRendererProps } from "../../../pages/practice/runtime/workspaceRenderers";
import { EquationCard } from "./EquationCard";
import { RangeBandSVG } from "./RangeBandSVG";
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

// ─── Read anchors from scene spec ────────────────────────────────────

function inputAnchors(runtime: ExerciseRuntimeSpec): SceneAnchor[] {
  return runtime.instance.scene.anchors.filter(
    (a) => a.anchorKind === "value-input",
  );
}

function labelAnchors(runtime: ExerciseRuntimeSpec): SceneAnchor[] {
  return runtime.instance.scene.anchors.filter(
    (a) => a.anchorKind === "label",
  );
}

// ─── Format display ──────────────────────────────────────────────────

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

// ─── Step-specific input rendering ───────────────────────────────────

function TransformRangeInputs({
  anchors,
  inputs,
  onInputChange,
}: {
  anchors: SceneAnchor[];
  inputs: Record<string, string>;
  onInputChange: (key: string, value: string) => void;
}) {
  return (
    <div className="ae-input-area">
      <div className="ae-input-title">输入变换后的范围端点</div>
      <div className="ae-range-input-row">
        <span className="ae-range-separator">[</span>
        {anchors.map((anchor) => (
          <input
            key={anchor.id}
            className="ae-input-field"
            placeholder={anchor.placeholder}
            value={inputs[anchor.id] || ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onInputChange(anchor.id, e.target.value)
            }
          />
        ))}
        <span className="ae-range-separator">]</span>
      </div>
    </div>
  );
}

function FilterAnglesInput({
  labels,
  selected,
  onToggleAngle,
}: {
  labels: SceneAnchor[];
  selected: string[];
  onToggleAngle: (angle: string) => void;
}) {
  const selectedSet = new Set(selected);

  return (
    <div className="ae-input-area">
      <div className="ae-input-title">从候选角中选出范围内的角</div>
      <div className="ae-chip-list">
        {labels.map((anchor) => (
          <span
            key={anchor.id}
            className={`ae-angle-chip ${selectedSet.has(anchor.label || "") ? "is-selected" : ""}`}
            onClick={() => onToggleAngle(anchor.label || "")}
          >
            {anchor.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function SolveTargetInputs({
  anchors,
  inputs,
  onInputChange,
}: {
  anchors: SceneAnchor[];
  inputs: Record<string, string>;
  onInputChange: (key: string, value: string) => void;
}) {
  return (
    <div className="ae-input-area">
      <div className="ae-input-title">对每个合法角输入解</div>
      <div className="ae-solution-inputs">
        {anchors.map((anchor) => (
          <div key={anchor.id} className="ae-solution-row">
            <span className="ae-solution-label">{anchor.label} →</span>
            <input
              className="ae-input-field"
              placeholder={anchor.placeholder}
              value={inputs[anchor.id] || ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                onInputChange(anchor.id, e.target.value)
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main renderer ───────────────────────────────────────────────────

export function AngleEquationWorkspaceRenderer({
  runtime,
  draft,
  setDraft,
}: WorkspaceRendererProps): ReactElement {
  const model = parseWorkspaceModel(runtime);
  if (!model) {
    return <div className="ae-workspace">Loading...</div>;
  }

  const stepId = model.currentStepId;
  const equationDisplay = formatEquationDisplay(model);
  const rangeDisplay = formatRangeDisplay(model);

  // Read input anchors from scene spec
  const inputs = inputAnchors(runtime);
  const labels = labelAnchors(runtime);

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

  // Determine unit circle selected state
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
          selectedAngles={unitCircleSelected}
          selectable={stepId === "find-angles"}
          onToggleAngle={(angleId) => handleToggleAngle("find-angles", angleId)}
        />

        {/* Step-specific inputs rendered from scene anchors */}
        {stepId === "find-angles" && (
          <div className="ae-input-area">
            <div className="ae-input-title">已选角</div>
            <div className="ae-chip-list">
              {(draft.selections["find-angles"] || []).map((angle) => (
                <span key={angle} className="ae-angle-chip is-selected">
                  {angle}
                </span>
              ))}
              {(draft.selections["find-angles"] || []).length === 0 && (
                <span className="ae-empty-hint">在单位圆上点击选择满足条件的角</span>
              )}
            </div>
          </div>
        )}

        {stepId === "transform-range" && (
          <TransformRangeInputs
            anchors={inputs}
            inputs={draft.inputs}
            onInputChange={handleInputChange}
          />
        )}

        {stepId === "filter-angles" && (
          <FilterAnglesInput
            labels={labels}
            selected={draft.selections["filter-angles"] || []}
            onToggleAngle={(angle) => handleToggleAngle("filter-angles", angle)}
          />
        )}

        {stepId === "solve-target" && (
          <SolveTargetInputs
            anchors={inputs}
            inputs={draft.inputs}
            onInputChange={handleInputChange}
          />
        )}
      </div>

    </div>
  );
}
