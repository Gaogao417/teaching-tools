import { useState } from "react";
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
  const inputTargets = new Set(step.allowedActions.filter((action) => action.type === "input").map((action) => action.target));
  const selected = selectAction?.type === "select" ? draft.selections[selectAction.target] || [] : [];
  const canSubmitOrderedSelection =
    selectAction?.type === "select" && selectAction.selectionKind === "ordered" ? selected.length >= 2 : true;

  return (
    <div className="ks-workspace-stack">
      <div className="practice-canvas-zone ks-canvas-card">
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
          />
        </div>
      </div>
    </div>
  );
}

export function TriangleTrigWorkspaceRenderer(props: WorkspaceRendererProps) {
  const [hoveredSide, setHoveredSide] = useState<Side | null>(null);

  return <WorkspaceScene {...props} hoveredSide={hoveredSide} onHoverSide={setHoveredSide} />;
}
