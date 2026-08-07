import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ClientDraftState, ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import { MathText } from "../../math/MathText";
import { FocusWorkspace } from "../../layout/FocusWorkspace";
import { ExerciseRuntimeHost } from "../../../pages/practice/ExerciseRuntimeHost";
import { RuntimeActionControls } from "../../../pages/practice/runtime/RuntimeActionControls";
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
  disabled,
  onClear,
  onSubmit,
}: TopicRuntimeFrameProps) {
  const step = currentStep(runtime);
  const activeIndex = runtime.instance.flow.steps.findIndex((item) => item.id === runtime.runtimeState.currentStepId);
  const topicWorkspace = runtime.instance.scene.topicWorkspace;
  const activeContract = topicWorkspace?.contracts[runtime.runtimeState.currentStepId];
  const wrongObjectIds = runtime.runtimeState.wrongObjectIds || [];
  const coach = activeContract?.coach;
  const startsWithExplanation = Boolean(topicWorkspace?.guidedMode && coach?.explanationLatex);

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      topicCoach: {
        soundEnabled: current.topicCoach?.soundEnabled !== false,
        messageLatex: startsWithExplanation ? coach?.explanationLatex : coach?.entryLatex,
        tone: startsWithExplanation ? "explain" : "prompt",
        displayMode: startsWithExplanation ? "explanation" : "task",
        invalidObjectCount: 0,
        feedbackNonce: (current.topicCoach?.feedbackNonce || 0) + 1,
      },
    }));
  }, [runtime.runtimeState.currentStepId]);

  useEffect(() => {
    if (phase !== "answering" || draft.topicCoach?.displayMode === "explanation" || !coach?.idleHintsLatex?.length) return undefined;
    const timers = coach.idleHintsLatex.map((messageLatex, index) => window.setTimeout(() => {
      setDraft((current) => ({
        ...current,
        topicCoach: { ...current.topicCoach, messageLatex, tone: "prompt" },
      }));
    }, 8000 + index * 7000));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [runtime.runtimeState.currentStepId, draft.topicCoach?.feedbackNonce, draft.topicCoach?.displayMode, phase]);

  const isExplanation = phase === "answering" && draft.topicCoach?.displayMode === "explanation";
  const coachMessage = phase === "wrong_feedback"
    ? activeContract?.errorDiagnosis || "当前答案与这一步的数学关系不一致。"
    : draft.topicCoach?.messageLatex
      || (isExplanation ? coach?.explanationLatex : coach?.entryLatex)
      || runtime.instance.guide.hint;
  const followup = phase === "wrong_feedback"
    ? activeContract?.hintLatex || (wrongObjectIds.length ? `只检查 ${wrongObjectIds.join("、")}。` : undefined)
    : draft.topicCoach?.tone === "correct" && !draft.topicCoach.activeSlotId
      ? undefined
      : (draft.topicCoach?.activeSlotId && coach?.slotHints?.[draft.topicCoach.activeSlotId]?.hintLatex)
        || (!isExplanation ? coach?.nextActionLatex : undefined);
  const autoSubmit = Boolean(topicWorkspace?.guidedMode && activeContract?.presentation?.autoSubmitOnComplete);

  const actionLabel = activeContract?.title || "当前任务";

  return (
    <FocusWorkspace
      ariaLabel="专题学习工作台"
      prompt={
        <>
          <span>题目</span>
          <div><h1><MathText value={runtime.instance.prompt} /></h1></div>
        </>
      }
      rail={
        <aside
          className={`topic-coach-panel tone-${phase === "wrong_feedback" ? "wrong" : draft.topicCoach?.tone || "prompt"}`}
          aria-label="陪练老师"
          aria-live={phase === "wrong_feedback" ? "assertive" : "polite"}
        >
          <div className="topic-coach-header">
            <span className="topic-coach-avatar material-symbols-outlined">school</span>
            <div>
              <small>{isExplanation ? "老师讲解" : `任务 ${activeIndex + 1}/${runtime.instance.flow.steps.length}`}</small>
              {!isExplanation ? <strong>{activeContract?.title || "当前任务"}</strong> : null}
            </div>
            <button
              type="button"
              className="topic-coach-sound"
              aria-label={draft.topicCoach?.soundEnabled === false ? "开启错误提示音" : "关闭错误提示音"}
              onClick={() => setDraft((current) => ({
                ...current,
                topicCoach: { ...current.topicCoach, soundEnabled: current.topicCoach?.soundEnabled === false },
              }))}
            >
              <span className="material-symbols-outlined">
                {draft.topicCoach?.soundEnabled === false ? "volume_off" : "volume_up"}
              </span>
            </button>
          </div>
          <div
            className="topic-coach-bubble"
            role={phase === "wrong_feedback" ? "alert" : undefined}
            data-testid="topic-coach-bubble"
          >
            <MathText value={coachMessage || "完成画布中的当前动作。"} block />
            {followup && coachMessage !== followup ? (
              <div className="topic-coach-followup">
                <MathText value={followup} block />
              </div>
            ) : null}
          </div>
        </aside>
      }
      actionBarLeft={
        <span className="ks-focus-rail-action">{actionLabel}</span>
      }
      actionEnd={
        !autoSubmit ? (
          <RuntimeActionControls
            runtime={runtime}
            draft={draft}
            disabled={disabled}
            showSubmit={!autoSubmit}
            onClear={onClear}
            onSubmit={onSubmit}
          />
        ) : undefined
      }
    >
      <ExerciseRuntimeHost
        runtime={runtime}
        sessionPhase={phase}
        draft={draft}
        setDraft={setDraft}
        inputRefs={inputRefs}
        onSubmit={({ stepId, value }) => onSubmit(stepId, value)}
        onClear={onClear}
      />
    </FocusWorkspace>
  );
}
