import type { ExerciseRuntimeSpec, SessionPhase } from "../../../../../shared/contracts";

type FeedbackControllerProps = {
  runtime: ExerciseRuntimeSpec;
  sessionPhase: SessionPhase;
};

function phaseLabel(sessionPhase: SessionPhase) {
  if (sessionPhase === "wrong_feedback") return "当前步骤错误，请按引导重新检查左侧操作。";
  if (sessionPhase === "correct_pause") return "当前步骤正确，系统即将进入下一题。";
  if (sessionPhase === "group_finished") return "本组训练已完成。";
  return "当前步骤可继续作答。";
}

export function FeedbackController({ runtime, sessionPhase }: FeedbackControllerProps) {
  const currentGuideStep = runtime.instance.guide.stepItems.find(
    (step) => step.stepId === runtime.runtimeState.currentStepId,
  );

  return (
    <div className="sr-only" aria-live="polite">
      {currentGuideStep ? `${currentGuideStep.title}。` : ""}
      {phaseLabel(sessionPhase)}
    </div>
  );
}
