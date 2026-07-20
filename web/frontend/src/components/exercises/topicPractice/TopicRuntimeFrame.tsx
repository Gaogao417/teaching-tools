import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ClientDraftState, ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import { MathText } from "../../math/MathText";
import { ExerciseRuntimeHost, GuideHUD } from "../../../pages/practice/ExerciseRuntimeHost";
import { RuntimeActionDock } from "../../../pages/practice/runtime/RuntimeActionDock";
import { currentStep } from "../../../pages/practice/runtime/sceneUtils";

type TopicRuntimeFrameProps = {
  runtime: ExerciseRuntimeSpec;
  phase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished";
  draft: ClientDraftState;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
  inputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  showGuide: boolean;
  disabled?: boolean;
  onClear: (target?: string) => void;
  onSubmit: (stepId: string, value: string) => void;
};

export function TopicRuntimeFrame({
  runtime,
  phase,
  draft,
  setDraft,
  inputRefs,
  showGuide,
  disabled,
  onClear,
  onSubmit,
}: TopicRuntimeFrameProps) {
  const step = currentStep(runtime);
  const activeIndex = runtime.instance.flow.steps.findIndex((item) => item.id === runtime.runtimeState.currentStepId);
  return (
    <>
      <section className={`ks-runtime-stage topic-runtime-frame ${showGuide ? "is-guided" : "is-unguided"}`}>
        <div className="ks-prompt-line">
          <span>题目</span>
          <div><h1><MathText value={runtime.instance.prompt} /></h1><p><MathText value={step.goal} /></p></div>
          <small>步骤 {activeIndex + 1}</small>
        </div>
        <div className="ks-runtime-stage-canvas">
          <ExerciseRuntimeHost
            runtime={runtime}
            sessionPhase={phase}
            draft={draft}
            setDraft={setDraft}
            inputRefs={inputRefs}
            onSubmit={({ stepId, value }) => onSubmit(stepId, value)}
            onClear={onClear}
          />
        </div>
        {showGuide ? <GuideHUD runtime={runtime} sessionPhase={phase} defaultExpanded staticMode /> : null}
      </section>
      <RuntimeActionDock runtime={runtime} draft={draft} disabled={disabled} compact onClear={onClear} onSubmit={onSubmit} />
    </>
  );
}
