import type {
  ContentDefinition,
  ExerciseInstance,
  ExerciseRuntimeSpec,
  LearningProjectionSpec,
  ProblemReviewProjection,
  ProblemStatus,
  ResultAttemptReview,
  RuntimeActionEvent,
  RuntimeEvaluation,
  RuntimeFeedbackPacket,
  SessionPhase,
  TaskDefinition,
  TaskId,
} from "../../../../../shared/contracts";
import type { ScenarioRecord } from "../../../../../shared/scenarios";

export type RuntimeEngineState = {
  instanceId: string;
  taskId: TaskId;
  contentId: string;
  index: number;
  status: ProblemStatus;
  attempts: number;
  firstTryCorrect: boolean | null;
};

export type EngineActionResult<TState extends RuntimeEngineState = RuntimeEngineState> = {
  accepted: boolean;
  evaluation: RuntimeEvaluation;
  phase: SessionPhase;
  engineState: TState;
  runtime: ExerciseRuntimeSpec;
  feedback: RuntimeFeedbackPacket;
};

export type EnginePlugin<
  TContent extends ContentDefinition = ContentDefinition,
  TState extends RuntimeEngineState = RuntimeEngineState,
> = {
  createState: (task: TaskDefinition, content: TContent, index: number, scenario: ScenarioRecord) => TState;
  restoreState: (raw: unknown, pinnedScenario?: ScenarioRecord) => TState;
  buildRuntime: (task: TaskDefinition, content: TContent, state: TState, phase: SessionPhase) => ExerciseRuntimeSpec;
  buildLearningProjection: (
    task: TaskDefinition,
    content: TContent,
    state: TState,
  ) => LearningProjectionSpec;
  buildProblemReviewProjection: (
    task: TaskDefinition,
    content: TContent,
    state: TState,
    instance: ExerciseInstance,
    attempts: ResultAttemptReview[],
  ) => ProblemReviewProjection;
  reduceAction: (
    task: TaskDefinition,
    content: TContent,
    state: TState,
    action: RuntimeActionEvent,
  ) => EngineActionResult<TState>;
};

export type RegisteredEnginePlugin = EnginePlugin<ContentDefinition, RuntimeEngineState>;

export function defineEnginePlugin<
  TContent extends ContentDefinition,
  TState extends RuntimeEngineState,
>(plugin: EnginePlugin<TContent, TState>): RegisteredEnginePlugin {
  return plugin as unknown as RegisteredEnginePlugin;
}

export function learningProjectionFromRuntime(
  task: TaskDefinition,
  runtime: ExerciseRuntimeSpec,
): LearningProjectionSpec {
  const guideByStepId = new Map(runtime.instance.guide.stepItems.map((step) => [step.stepId, step]));
  const runtimeSteps = runtime.instance.flow.steps;
  const projectionSteps = task.steps.length > runtimeSteps.length
    ? task.steps.map((narration, index) => {
        const runtimeStep = runtimeSteps[Math.min(index, runtimeSteps.length - 1)];
        const targetAction = runtimeStep?.allowedActions.find((action) => "target" in action);
        const shortTitle = narration
          .replace(/^(先|再|若|把|根据|利用|在)/, "")
          .split(/[，。]/)[0]
          .slice(0, 18);
        return {
          stepId: `learn-${index + 1}-${runtimeStep?.id || "step"}`,
          title: shortTitle || `教学步骤 ${index + 1}`,
          narration,
          focusTargetRef: index === task.steps.length - 1
            ? targetAction && "target" in targetAction ? targetAction.target : runtimeStep?.id
            : index === 0 ? "prompt" : "scene",
          actionLabel: index === task.steps.length - 1 ? runtimeStep?.goal : undefined,
          nextLabel: index < task.steps.length - 1 ? `下一步：${index + 2}` : "完成示范，开始训练",
        };
      })
    : runtimeSteps.map((step, index, steps) => {
        const firstAction = step.allowedActions.find((action) => action.type !== "clear" && action.type !== "submit");
        const focusTargetRef = firstAction && "target" in firstAction ? firstAction.target : step.id;
        return {
          stepId: step.id,
          title: step.title,
          narration: task.steps[index] || guideByStepId.get(step.id)?.summary || step.goal,
          focusTargetRef,
          actionLabel: step.goal,
          nextLabel: index < steps.length - 1 ? `下一步：${steps[index + 1].title}` : "完成示范，开始训练",
        };
      });
  return {
    taskId: task.id,
    objective: task.summary,
    sampleRuntime: runtime,
    steps: projectionSteps,
  };
}

export function parseSubmittedAnswer(raw?: string) {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { selections?: Record<string, string[]>; inputs?: Record<string, string> };
    return {
      selections: parsed.selections,
      inputs: parsed.inputs,
    };
  } catch {
    return { display: raw };
  }
}

export function defaultProblemReviewProjection(
  instance: ExerciseInstance,
  attempts: ResultAttemptReview[],
  expectedAnswer?: ProblemReviewProjection["expectedAnswer"],
): ProblemReviewProjection {
  const submissions = attempts.filter((attempt) => attempt.actionType === "submit");
  const firstWrong = submissions.find((attempt) => attempt.evaluation === "wrong");
  const representative = firstWrong || submissions[submissions.length - 1];
  return {
    diagnosisCode: firstWrong ? `step-${firstWrong.stepId || "unknown"}` : undefined,
    diagnosisTitle: firstWrong
      ? `${firstWrong.stepTitle || "当前步骤"}需要再巩固`
      : "本题首次完成",
    coachingCopy: firstWrong
      ? "回到发生偏差的动作，先确认对象与顺序，再重新计算。"
      : "继续保持当前判断顺序。",
    actualAnswer: parseSubmittedAnswer(representative?.submittedValue),
    expectedAnswer,
    focusStepId: firstWrong?.stepId || instance.flow.steps[0]?.id,
    scene: instance.scene,
  };
}
