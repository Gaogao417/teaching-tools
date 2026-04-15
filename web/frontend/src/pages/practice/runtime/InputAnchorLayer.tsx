import type { Dispatch, SetStateAction } from "react";
import type { ClientDraftState, ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import type { Side } from "../../../../../shared/triangleTrig";
import type { InputRefs } from "./sceneUtils";
import { edgeSideFromRef } from "./sceneUtils";

export function InputAnchorLayer({
  runtime,
  draft,
  setDraft,
  inputRefs,
  inputTargets,
  onHoverSide,
}: {
  runtime: ExerciseRuntimeSpec;
  draft: ClientDraftState;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
  inputRefs: InputRefs;
  inputTargets: Set<string>;
  onHoverSide: (side: Side | null) => void;
}) {
  return (
    <>
      {runtime.instance.scene.anchors
        .filter((anchor) => anchor.anchorKind === "value-input" && inputTargets.has(anchor.id))
        .map((anchor) => {
          const side = edgeSideFromRef(anchor.entityRef);

          return (
            <input
              key={anchor.id}
              ref={(node) => {
                inputRefs.current[anchor.id] = node;
              }}
              className="practice-edge-input"
              style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
              value={draft.inputs[anchor.id] || ""}
              placeholder={anchor.placeholder}
              onFocus={() => onHoverSide(side)}
              onBlur={() => onHoverSide(null)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  inputs: { ...current.inputs, [anchor.id]: event.target.value },
                }))
              }
            />
          );
        })}
    </>
  );
}
