import type { ChangeEvent } from "react";
import type { ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import { currentStep } from "./sceneUtils";
import type { WorkspaceRendererProps } from "./workspaceRenderers";

function currentInputValue(runtime: ExerciseRuntimeSpec, draftInputs: Record<string, string>) {
  const step = currentStep(runtime);
  const inputAction = step.allowedActions.find((action) => action.type === "input");
  return inputAction?.type === "input" ? draftInputs[inputAction.target] || "" : "";
}

export function DemoCounterWorkspaceRenderer({
  runtime,
  draft,
  setDraft,
  inputRefs,
}: WorkspaceRendererProps) {
  const step = currentStep(runtime);
  const inputAction = step.allowedActions.find((action) => action.type === "input");
  const anchor =
    inputAction?.type === "input"
      ? runtime.instance.scene.anchors.find((item) => item.id === inputAction.target)
      : undefined;
  const value = currentInputValue(runtime, draft.inputs);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (inputAction?.type !== "input") return;
    setDraft((current) => ({
      ...current,
      inputs: { ...current.inputs, [inputAction.target]: event.target.value },
    }));
  };

  return (
    <div className="practice-canvas-zone">
      <div className="practice-triangle-stage demo-runtime-stage">
        <div className="practice-demo-card">
          <div className="practice-demo-badge">Demo Engine</div>
          <p className="practice-demo-copy">{runtime.instance.prompt}</p>
          <label className="practice-demo-input">
            <span>{anchor?.label || "演示口令"}</span>
            <input
              ref={(node) => {
                if (anchor?.id) inputRefs.current[anchor.id] = node;
              }}
              placeholder={anchor?.placeholder}
              value={value}
              onChange={handleChange}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
