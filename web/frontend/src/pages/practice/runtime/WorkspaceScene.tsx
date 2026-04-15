import { useState } from "react";
import type { ClientDraftState, ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import type { Side } from "../../../../../shared/triangleTrig";
import { currentStep } from "./sceneUtils";
import type { WorkspaceRendererProps } from "./workspaceRenderers";
import { SceneRenderer } from "./SceneRenderer";
import { InputAnchorLayer } from "./InputAnchorLayer";
import { OverlayLayer } from "./OverlayLayer";

type WorkspaceSceneProps = WorkspaceRendererProps & {
  hoveredSide: Side | null;
  onHoverSide: (side: Side | null) => void;
};

function WorkspaceScene({
  runtime,
  draft,
  setDraft,
  inputRefs,
  hoveredSide,
  onHoverSide,
  onSubmit,
  onClear,
}: WorkspaceSceneProps) {
  const step = currentStep(runtime);
  const selectAction = step.allowedActions.find((action) => action.type === "select");
  const clearAction = step.allowedActions.find((action) => action.type === "clear");
  const submitAction = step.allowedActions.find((action) => action.type === "submit");
  const inputTargets = new Set(
    step.allowedActions.filter((action) => action.type === "input").map((action) => action.target),
  );
  const selected = selectAction?.type === "select" ? draft.selections[selectAction.target] || [] : [];
  const canSubmitOrderedSelection =
    selectAction?.type === "select" && selectAction.selectionKind === "ordered" ? selected.length >= 2 : true;

  return (
    <div className="practice-canvas-zone">
      <div className="practice-triangle-stage">
        <SceneRenderer
          runtime={runtime}
          hoveredSide={hoveredSide}
          onHoverSide={onHoverSide}
          selectionTarget={selectAction?.type === "select" ? selectAction.target : undefined}
          setDraft={setDraft}
        />

        <InputAnchorLayer
          runtime={runtime}
          draft={draft}
          setDraft={setDraft}
          inputRefs={inputRefs}
          inputTargets={inputTargets}
          onHoverSide={onHoverSide}
        />

        <OverlayLayer
          runtime={runtime}
          draft={draft}
          setDraft={setDraft}
          inputRefs={inputRefs}
          canSubmitOrderedSelection={canSubmitOrderedSelection}
          submitStepId={submitAction?.type === "submit" ? submitAction.stepId : undefined}
          onSubmit={onSubmit}
          onClear={onClear}
          clearTarget={clearAction?.target || step.id}
        />
      </div>
    </div>
  );
}

export function TriangleTrigWorkspaceRenderer(props: WorkspaceRendererProps) {
  const [hoveredSide, setHoveredSide] = useState<Side | null>(null);

  return (
    <WorkspaceScene
      {...props}
      hoveredSide={hoveredSide}
      onHoverSide={setHoveredSide}
    />
  );
}
