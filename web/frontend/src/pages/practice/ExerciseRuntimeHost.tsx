import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ClientDraftState, ExerciseRuntimeSpec } from "../../../../shared/contracts";
import { FeedbackController } from "./runtime/FeedbackController";
import { GuidePanel } from "./runtime/GuidePanel";
import { WORKSPACE_RENDERERS } from "./runtime/workspaceRenderers";

type Props = {
  runtime: ExerciseRuntimeSpec;
  sessionPhase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished";
  draft: ClientDraftState;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
  inputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  onSubmit: (action: { stepId: string; value: string }) => void;
  onClear: (target?: string) => void;
  taskGroup?: string;
};

export function ExerciseRuntimeHost(props: Props) {
  const Renderer = WORKSPACE_RENDERERS[props.runtime.instance.engineKind];

  return (
    <>
      {Renderer ? (
        <Renderer
          runtime={props.runtime}
          draft={props.draft}
          setDraft={props.setDraft}
          inputRefs={props.inputRefs}
          onSubmit={props.onSubmit}
          onClear={props.onClear}
        />
      ) : (
        <section className="panel workspace-panel">
          <div className="detail-head">
            <h2>未注册的练习引擎</h2>
            <p className="text-muted">{props.runtime.instance.engineKind} 暂时没有对应的工作区渲染器。</p>
          </div>
        </section>
      )}
      <GuidePanel runtime={props.runtime} sessionPhase={props.sessionPhase} taskGroup={props.taskGroup} />
      <FeedbackController runtime={props.runtime} sessionPhase={props.sessionPhase} />
    </>
  );
}
