import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ClientDraftState, ExerciseRuntimeSpec, Side } from "../../../../shared/contracts";
import { FeedbackController } from "./runtime/FeedbackController";
import { GuidePanel } from "./runtime/GuidePanel";
import { WorkspaceScene } from "./runtime/WorkspaceScene";

type Props = {
  runtime: ExerciseRuntimeSpec;
  sessionPhase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished";
  draft: ClientDraftState;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
  inputRefs: MutableRefObject<Record<string, HTMLInputElement | null>>;
  hoveredSide: Side | null;
  onHoverSide: (side: Side | null) => void;
  onSubmit: (action: { stepId: string; value: string }) => void;
  onClear: (target?: string) => void;
  taskGroup?: string;
};

export function ExerciseRuntimeHost(props: Props) {
  return (
    <>
      <WorkspaceScene
        runtime={props.runtime}
        draft={props.draft}
        setDraft={props.setDraft}
        inputRefs={props.inputRefs}
        hoveredSide={props.hoveredSide}
        onHoverSide={props.onHoverSide}
        onSubmit={props.onSubmit}
        onClear={props.onClear}
      />
      <GuidePanel runtime={props.runtime} sessionPhase={props.sessionPhase} taskGroup={props.taskGroup} />
      <FeedbackController runtime={props.runtime} sessionPhase={props.sessionPhase} />
    </>
  );
}
