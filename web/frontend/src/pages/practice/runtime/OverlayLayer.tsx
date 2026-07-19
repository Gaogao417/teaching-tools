import type { ClientDraftState, ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import type { InputRefs } from "./sceneUtils";
import { findEntities } from "./sceneUtils";
import { FormulaEntity } from "./FormulaEntity";

export function OverlayLayer({
  runtime,
  draft,
  setDraft,
  inputRefs,
}: {
  runtime: ExerciseRuntimeSpec;
  draft: ClientDraftState;
  setDraft: import("react").Dispatch<import("react").SetStateAction<ClientDraftState>>;
  inputRefs: InputRefs;
}) {
  const texts = findEntities(runtime.instance.scene.entities, "text");
  const formulas = findEntities(runtime.instance.scene.entities, "formula");
  const inlineTexts = texts.filter((entity) => entity.variant === "inline-formula");

  return (
    <>
      {formulas.map((entity) => (
        <FormulaEntity
          key={entity.id}
          entity={entity}
          anchors={runtime.instance.scene.anchors}
          draft={draft}
          setDraft={setDraft}
          inputRefs={inputRefs}
        />
      ))}

      {inlineTexts.length ? (
        <div className="practice-workspace-footer ks-workspace-footer">
          {inlineTexts.map((entity) => (
            <div key={entity.id} className="practice-inline-formula">
              {entity.text}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
