import type { TaskId } from "./contracts";
import type { TopicActionPrimitive, TopicPracticeTaskId } from "./topicPractice";

export const SIMILARITY_MAP_ID = "similarity-v1" as const;
export const CAPABILITY_RULE_VERSION = "similarity-capabilities/v3" as const;

export const SIMILARITY_CAPABILITY_IDS = [
  "similarity.mark-known-segments",
  "similarity.map-corresponding-sides",
  "similarity.transfer-ratio-shares",
  "similarity.construct-parallel-helper",
  "similarity.convert-collinear-segments",
  "similarity.read-crossed-vertex-order",
  "similarity.build-side-equation",
  "similarity.recognize-similarity-model",
  "similarity.plan-similarity-proof",
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
  "similarity.recognize-similarity-model": "看结构识别可能相似的三角形",
  "similarity.plan-similarity-proof": "看目标规划证明路线、找缺口补条件",
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
  {
    id: "reverse-a-four-similarity",
    kind: "topic",
    taskId: "reverseAFourSimilarity",
    title: "反A一图四相似",
    actionLabel: "发现候选、规划证明",
    primaryCapabilityId: "similarity.recognize-similarity-model",
    requiredCapabilityIds: [
      "similarity.map-corresponding-sides",
      "similarity.read-crossed-vertex-order",
    ],
  },
  // Phase 5 UI 集成波次 E：golden 六题（一模真题）独立 Topic 节点。
  // required 从对应教学章节的能力全集起步（教师可调整解锁结构）。
  {
    id: "golden-minhang-fold-2020",
    kind: "topic",
    taskId: "goldenMinhangFold2020",
    title: "一模·折叠等腰求长",
    actionLabel: "真题实练：折叠不变量",
    primaryCapabilityId: "similarity.build-side-equation",
    requiredCapabilityIds: ["similarity.mark-known-segments"],
  },
  {
    id: "golden-minhang-cross-2020",
    kind: "topic",
    taskId: "goldenMinhangCross2020",
    title: "一模·双垂直交叉证明",
    actionLabel: "真题实练：8 字交叉",
    primaryCapabilityId: "similarity.plan-similarity-proof",
    requiredCapabilityIds: ["similarity.read-crossed-vertex-order"],
  },
  {
    id: "golden-minhang-parent-child-2020",
    kind: "topic",
    taskId: "goldenMinhangParentChild2020",
    title: "一模·母子型综合压轴",
    actionLabel: "真题实练：母子型三问",
    primaryCapabilityId: "similarity.recognize-similarity-model",
    requiredCapabilityIds: ["similarity.convert-collinear-segments"],
  },
  {
    id: "golden-huangpu-tree-height-2025",
    kind: "topic",
    taskId: "goldenHuangpuTreeHeight2025",
    title: "一模·A 字型测高应用",
    actionLabel: "真题实练：建模测量",
    primaryCapabilityId: "similarity.transfer-ratio-shares",
    requiredCapabilityIds: ["similarity.mark-known-segments"],
  },
  {
    id: "golden-huangpu-angle-bisector-2025",
    kind: "topic",
    taskId: "goldenHuangpuAngleBisector2025",
    title: "一模·共角 SAS 证明",
    actionLabel: "真题实练：共角 SAS",
    primaryCapabilityId: "similarity.map-corresponding-sides",
    requiredCapabilityIds: ["similarity.recognize-similarity-model"],
  },
  {
    id: "golden-huangpu-moving-point-2025",
    kind: "topic",
    taskId: "goldenHuangpuMovingPoint2025",
    title: "一模·动点相似压轴",
    actionLabel: "真题实练：动点分类",
    primaryCapabilityId: "similarity.plan-similarity-proof",
    requiredCapabilityIds: ["similarity.recognize-similarity-model"],
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
  { from: "reverse-a-similarity", to: "reverse-a-four-similarity", kind: "required" as const },
  { from: "butterfly-similarity", to: "reverse-a-four-similarity", kind: "required" as const },
  { from: "reverse-a-four-similarity", to: "golden-minhang-fold-2020", kind: "required" as const },
  { from: "butterfly-similarity", to: "golden-minhang-cross-2020", kind: "required" as const },
  { from: "nested-similarity", to: "golden-minhang-parent-child-2020", kind: "required" as const },
  { from: "reverse-a-similarity", to: "golden-huangpu-tree-height-2025", kind: "required" as const },
  { from: "auxiliary-two-ratios", to: "golden-huangpu-angle-bisector-2025", kind: "required" as const },
  { from: "reverse-a-four-similarity", to: "golden-huangpu-moving-point-2025", kind: "required" as const },
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
  // reverseAFourSimilarity trains two proof-planning capabilities. Current
  // evidence rules filter by step primitive, and both capabilities hang off
  // select steps, so any select step records evidence for both (coarse by
  // design; per-role attribution needs an evidence-rule schema change).
  if (taskId === "reverseAFourSimilarity" && primitive === "select") {
    return ["similarity.recognize-similarity-model", "similarity.plan-similarity-proof"];
  }
  if (taskId === "reverseAFourSimilarity" && primitive === "mark-ratio") {
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
  "similarity.recognize-similarity-model": "reverseAFourSimilarity",
  "similarity.plan-similarity-proof": "reverseAFourSimilarity",
};
