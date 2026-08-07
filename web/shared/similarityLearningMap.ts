import type { TaskId } from "./contracts";
import type { TopicActionPrimitive, TopicPracticeTaskId } from "./topicPractice";

export const SIMILARITY_MAP_ID = "similarity-v1" as const;
export const CAPABILITY_RULE_VERSION = "similarity-capabilities/v2" as const;

export const SIMILARITY_CAPABILITY_IDS = [
  "similarity.mark-known-segments",
  "similarity.map-corresponding-sides",
  "similarity.transfer-ratio-shares",
  "similarity.construct-parallel-helper",
  "similarity.convert-collinear-segments",
  "similarity.read-crossed-vertex-order",
  "similarity.build-side-equation",
] as const;

export type SimilarityCapabilityId = typeof SIMILARITY_CAPABILITY_IDS[number];
export type CapabilityState = "unobserved" | "developing" | "mastered";
export type TopicProgressState = "not_started" | "in_progress" | "completed";
export type LearningMapNodeState = "unopened" | "open" | "passed";
export type SessionKind = "practice" | "challenge" | "remediation";

export const CAPABILITY_MASTERY_RULE = {
  version: CAPABILITY_RULE_VERSION,
  minimumIndependentCorrectEvidence: 1,
  allowedSessionKinds: ["practice", "challenge"] as SessionKind[],
} as const;

export const CAPABILITY_LABELS: Record<SimilarityCapabilityId, string> = {
  "similarity.mark-known-segments": "把已知量标回题图",
  "similarity.map-corresponding-sides": "配对相似三角形的对应边",
  "similarity.transfer-ratio-shares": "迁移两组比例中的共同份数",
  "similarity.construct-parallel-helper": "作平行辅助线",
  "similarity.convert-collinear-segments": "互化共线线段",
  "similarity.read-crossed-vertex-order": "读取交叉构型点序",
  "similarity.build-side-equation": "按份数列边长式",
};

export type SimilarityTopicNodeDefinition = {
  id: string;
  kind: "topic";
  taskId: TopicPracticeTaskId;
  title: string;
  actionLabel: string;
  primaryCapabilityId: SimilarityCapabilityId;
  requiredCapabilityIds: SimilarityCapabilityId[];
};

export const SIMILARITY_TOPIC_NODES: SimilarityTopicNodeDefinition[] = [
  {
    id: "parallel-line-ratios",
    kind: "topic",
    taskId: "parallelLineRatios",
    title: "平行线比例",
    actionLabel: "建立比例原型",
    primaryCapabilityId: "similarity.transfer-ratio-shares",
    requiredCapabilityIds: [],
  },
  {
    id: "auxiliary-two-ratios",
    kind: "topic",
    taskId: "auxiliaryTwoRatios",
    title: "比例辅助线",
    actionLabel: "组合两组比例",
    primaryCapabilityId: "similarity.construct-parallel-helper",
    requiredCapabilityIds: [
      "similarity.map-corresponding-sides",
      "similarity.transfer-ratio-shares",
      "similarity.build-side-equation",
    ],
  },
  {
    id: "reverse-a-similarity",
    kind: "topic",
    taskId: "reverseASimilarity",
    title: "反 A 形",
    actionLabel: "迁移对应边模型",
    primaryCapabilityId: "similarity.map-corresponding-sides",
    requiredCapabilityIds: [
      "similarity.map-corresponding-sides",
      "similarity.build-side-equation",
    ],
  },
  {
    id: "nested-similarity",
    kind: "topic",
    taskId: "nestedSimilarity",
    title: "子母型",
    actionLabel: "处理共线边",
    primaryCapabilityId: "similarity.convert-collinear-segments",
    requiredCapabilityIds: [
      "similarity.map-corresponding-sides",
      "similarity.build-side-equation",
    ],
  },
  {
    id: "butterfly-similarity",
    kind: "topic",
    taskId: "butterflySimilarity",
    title: "蝶形",
    actionLabel: "辨认交叉点序",
    primaryCapabilityId: "similarity.read-crossed-vertex-order",
    requiredCapabilityIds: [
      "similarity.map-corresponding-sides",
      "similarity.build-side-equation",
    ],
  },
];

export type ChallengeDefinition = {
  id: string;
  kind: "challenge";
  title: string;
  actionLabel: string;
  sourceTaskId: TopicPracticeTaskId;
  requiredCapabilityIds: SimilarityCapabilityId[];
  evidenceRules: Array<{
    capabilityId: SimilarityCapabilityId;
    requiredStepPrimitives: TopicActionPrimitive[];
  }>;
  passEffects: SimilarityCapabilityId[];
};

export const SIMILARITY_CHALLENGES: ChallengeDefinition[] = [
  {
    id: "challenge-auxiliary-comprehensive",
    kind: "challenge",
    title: "辅助线综合挑战",
    actionLabel: "连用两组比例",
    sourceTaskId: "auxiliaryTwoRatios",
    requiredCapabilityIds: [
      "similarity.construct-parallel-helper",
      "similarity.transfer-ratio-shares",
      "similarity.map-corresponding-sides",
      "similarity.build-side-equation",
    ],
    evidenceRules: [
      { capabilityId: "similarity.construct-parallel-helper", requiredStepPrimitives: ["construct-parallel"] },
      { capabilityId: "similarity.transfer-ratio-shares", requiredStepPrimitives: ["mark-segments"] },
      { capabilityId: "similarity.map-corresponding-sides", requiredStepPrimitives: ["mark-segments"] },
      { capabilityId: "similarity.build-side-equation", requiredStepPrimitives: ["input"] },
    ],
    passEffects: [
      "similarity.construct-parallel-helper",
      "similarity.transfer-ratio-shares",
      "similarity.map-corresponding-sides",
      "similarity.build-side-equation",
    ],
  },
  {
    id: "challenge-crossed-configuration",
    kind: "challenge",
    title: "构型迁移挑战",
    actionLabel: "辨认蝶形并列式",
    sourceTaskId: "butterflySimilarity",
    requiredCapabilityIds: [
      "similarity.read-crossed-vertex-order",
      "similarity.map-corresponding-sides",
      "similarity.build-side-equation",
    ],
    evidenceRules: [
      { capabilityId: "similarity.read-crossed-vertex-order", requiredStepPrimitives: ["mark-ratio"] },
      { capabilityId: "similarity.map-corresponding-sides", requiredStepPrimitives: ["mark-ratio"] },
      { capabilityId: "similarity.build-side-equation", requiredStepPrimitives: ["equation"] },
    ],
    passEffects: [
      "similarity.read-crossed-vertex-order",
      "similarity.map-corresponding-sides",
      "similarity.build-side-equation",
    ],
  },
];

export const SIMILARITY_MAP_EDGES = [
  { from: "parallel-line-ratios", to: "auxiliary-two-ratios", kind: "required" as const },
  { from: "parallel-line-ratios", to: "reverse-a-similarity", kind: "required" as const },
  { from: "reverse-a-similarity", to: "nested-similarity", kind: "required" as const },
  { from: "reverse-a-similarity", to: "butterfly-similarity", kind: "required" as const },
  { from: "auxiliary-two-ratios", to: "challenge-auxiliary-comprehensive", kind: "challenge-requires" as const },
  { from: "nested-similarity", to: "challenge-crossed-configuration", kind: "challenge-requires" as const },
  { from: "butterfly-similarity", to: "challenge-crossed-configuration", kind: "challenge-requires" as const },
];

export interface StudentCapabilityState {
  capabilityId: SimilarityCapabilityId;
  state: CapabilityState;
  evidenceCount: number;
  ruleVersion: string;
  updatedAt?: string;
}

export interface StudentTopicProgress {
  studentName: string;
  nodeId: string;
  state: TopicProgressState;
  lastTaskId?: TaskId;
  lastStepId?: string;
  updatedAt?: string;
}

export interface LearningMapQuestionPreview {
  questionId: string;
  stemLatex: string;
  diagramAssetUrl?: string;
  diagramAlt?: string;
}

export interface LearningMapNode {
  id: string;
  kind: "topic" | "challenge";
  taskId?: TaskId;
  title: string;
  actionLabel: string;
  capabilityId?: SimilarityCapabilityId;
  capabilityLabel?: string;
  state: LearningMapNodeState;
  recommended: boolean;
  progress?: { completed: number; total: number };
  missingPrerequisiteIds: SimilarityCapabilityId[];
  previewQuestion?: LearningMapQuestionPreview;
  activeSessionId?: string;
}

export interface LearningMapResponse {
  mapId: typeof SIMILARITY_MAP_ID;
  nodes: LearningMapNode[];
  edges: typeof SIMILARITY_MAP_EDGES;
  capabilities: StudentCapabilityState[];
  focusedNodeId?: string;
  recommendedNodeId?: string;
}

export interface RemediationDiagnosis {
  diagnosisCode: string;
  capabilityId: SimilarityCapabilityId;
  title: string;
  coachingCopy: string;
  focusStepId: string;
  sourceChallengeSessionId: string;
  recommendedRemediationId: string;
}

export interface RemediationResumeContext {
  remediationSessionId: string;
  sourceChallengeSessionId: string;
  sourceInstanceId: string;
  sourceStepId: string;
  preservedCompletedStepIds: string[];
  returnMode: "resume-step" | "restart-instance";
}

export function challengeById(challengeId: string): ChallengeDefinition | undefined {
  return SIMILARITY_CHALLENGES.find((challenge) => challenge.id === challengeId);
}

export function topicNodeByTaskId(taskId: TaskId): SimilarityTopicNodeDefinition | undefined {
  return SIMILARITY_TOPIC_NODES.find((node) => node.taskId === taskId);
}

export function capabilityIdsForTopicStep(
  taskId: TaskId,
  primitive: TopicActionPrimitive,
  stepIndex: number,
): SimilarityCapabilityId[] {
  if (!SIMILARITY_TOPIC_NODES.some((node) => node.taskId === taskId)) return [];
  if (primitive === "convert-collinear") return ["similarity.convert-collinear-segments"];
  if (primitive === "equation") return ["similarity.build-side-equation"];
  if (primitive === "construct-parallel") return ["similarity.construct-parallel-helper"];
  if (taskId === "parallelLineRatios" && stepIndex === 0) return ["similarity.mark-known-segments"];
  if (taskId === "parallelLineRatios" && stepIndex === 1) {
    return ["similarity.map-corresponding-sides", "similarity.transfer-ratio-shares"];
  }
  if (taskId === "auxiliaryTwoRatios" && stepIndex === 1) return ["similarity.map-corresponding-sides"];
  if (taskId === "auxiliaryTwoRatios" && stepIndex === 2) return ["similarity.transfer-ratio-shares"];
  if (taskId === "auxiliaryTwoRatios" && primitive === "input") return ["similarity.build-side-equation"];
  if (taskId === "butterflySimilarity" && primitive === "mark-ratio") {
    return ["similarity.read-crossed-vertex-order", "similarity.map-corresponding-sides"];
  }
  if (primitive === "mark-ratio") return ["similarity.map-corresponding-sides"];
  if (primitive === "mark-segments") return ["similarity.mark-known-segments"];
  return [];
}

export const REMEDIATION_TASK_BY_CAPABILITY: Record<SimilarityCapabilityId, TopicPracticeTaskId> = {
  "similarity.mark-known-segments": "parallelLineRatios",
  "similarity.map-corresponding-sides": "reverseASimilarity",
  "similarity.transfer-ratio-shares": "parallelLineRatios",
  "similarity.construct-parallel-helper": "auxiliaryTwoRatios",
  "similarity.convert-collinear-segments": "nestedSimilarity",
  "similarity.read-crossed-vertex-order": "butterflySimilarity",
  "similarity.build-side-equation": "parallelLineRatios",
};
