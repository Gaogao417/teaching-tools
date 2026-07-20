import type { TopicPracticeTaskId } from "../../../../../../shared/topicPractice";
import type { RuntimeEngineState } from "../../platform/engineTypes";

export type TopicPracticeEngineState = RuntimeEngineState & {
  taskId: TopicPracticeTaskId;
  scenarioId: string;
  stepIndex: number;
  completedStepIds: string[];
  hadWrongAttempt: boolean;
  isLearningProjection: boolean;
};
