import { Fragment } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ClientDraftState, FormulaSceneEntity, SceneAnchor } from "../../../../../shared/contracts";
import type { InputRefs } from "./sceneUtils";

export function FormulaEntity({
  entity,
  anchors,
  draft,
  setDraft,
  inputRefs,
}: {
  entity: FormulaSceneEntity;
  anchors: SceneAnchor[];
  draft: ClientDraftState;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
  inputRefs: InputRefs;
}) {
  if (!entity.slots?.length || entity.layout !== "fraction") return null;

  const slots = entity.slots
    .map((slotId) => anchors.find((anchor) => anchor.id === slotId))
    .filter((anchor): anchor is SceneAnchor => Boolean(anchor));

  if (slots.length < 2) return null;

  return (
    <div className="practice-formula-entity" style={{ left: `${entity.x || 0}px`, top: `${entity.y || 0}px` }}>
      <div className="practice-final-inline">
        <span>{entity.label}</span>
        <div className="practice-final-stack">
          {slots.map((slot, index) => (
            <Fragment key={slot.id}>
              <input
                ref={(node) => {
                  inputRefs.current[slot.id] = node;
                }}
                value={draft.inputs[slot.id] || ""}
                placeholder={slot.placeholder}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    inputs: { ...current.inputs, [slot.id]: event.target.value },
                  }))
                }
              />
              {index === 0 ? <div className="practice-final-bar" /> : null}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
