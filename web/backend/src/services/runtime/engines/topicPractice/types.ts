import type { TopicPracticeTaskId, TopicScenarioRecord } from "../../../../../../shared/topicPractice";
import type { SimilarityCapabilityId } from "../../../../../../shared/similarityLearningMap";
import type { RuntimeEngineState } from "../../platform/engineTypes";

export type TopicPracticeEngineState = RuntimeEngineState & {
  taskId: TopicPracticeTaskId;
  scenarioId: string;
  scenarioVersion: string;
  /** Backend-only immutable bank snapshot; never included in ExerciseRuntimeSpec. */
  pinnedScenario?: TopicScenarioRecord;
  stepIndex: number;
  completedStepIds: string[];
  hadWrongAttempt: boolean;
  isLearningProjection: boolean;
  remediationCapabilityId?: SimilarityCapabilityId;
  allowedCapabilityIds?: SimilarityCapabilityId[];
  wrongObjectIds: string[];
  interactionVersion: number;
};
