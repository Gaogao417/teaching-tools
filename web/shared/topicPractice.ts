import type { AuthoringRun, ScenarioRecord, ScenarioValidationReport } from "./scenarios";

export type TopicPracticeTaskId =
  | "quadraticCompletion"
  | "parallelLineRatios"
  | "auxiliaryTwoRatios"
  | "reverseASimilarity"
  | "nestedSimilarity"
  | "butterflySimilarity";

export type TopicActionPrimitive =
  | "select"
  | "input"
  | "construct-parallel"
  | "mark-segments"
  | "mark-ratio"
  | "ratio-scratch"
  | "convert-collinear"
  | "equation";

export interface TopicGeometryPoint {
  id: string;
  x: number;
  y: number;
}

export interface TopicGeometrySegment {
  id: string;
  from: string;
  to: string;
}

export interface TopicGeometryModel {
  viewBox: { width: number; height: number };
  points: TopicGeometryPoint[];
  segments: TopicGeometrySegment[];
}

export interface TopicSegmentLabel {
  segmentId: string;
  displayName: string;
  valueLatex: string;
}

export interface TopicGeometryInteraction {
  kind: "construct-parallel" | "mark-segments" | "mark-ratio" | "ratio-scratch" | "convert-collinear" | "equation";
  geometry?: TopicGeometryModel;
  availableSegments?: string[];
  expectedLabels?: TopicSegmentLabel[];
  expectedOrder?: string[];
  construction?: {
    throughPoint: string;
    parallelSegment: string;
    carrierPoints: [string, string];
    resultPoint: string;
  };
  collinear?: {
    wholeSegment: string;
    targetSegment: string;
    knownSegment: string;
    relationLatex: string;
  };
  ratioScratch?: {
    firstSegmentId: string;
    firstDisplayName: string;
    firstValueLatex: string;
    secondSegmentId: string;
    secondDisplayName: string;
    secondValueLatex: string;
    simplifiedFirstLatex: string;
    simplifiedSecondLatex: string;
  };
  equation?: {
    targetLatex: string;
    factorSlots: [string, string, string];
    resultLatex: string;
    shareValues?: [string, string];
    knownValueLatex?: string;
  };
  presentation?: TopicInteractionPresentation;
}

export interface TopicCoachSlotHint {
  hintLatex: string;
  correctLatex: string;
  errorLatex: string;
}

export interface TopicCoachScript {
  entryLatex: string;
  idleHintsLatex?: string[];
  invalidObjectLatex?: string;
  objectCategoryHintLatex?: string;
  targetHintsLatex?: Record<string, string>;
  explanationLatex?: string;
  nextActionLatex?: string;
  slotHints?: Record<string, TopicCoachSlotHint>;
}

export interface TopicInteractionPresentation {
  selectionMode?: "single" | "pair" | "ordered";
  inputAnchor?: "segment-midpoint" | "point-offset" | "workspace";
  retainCompletedMarks?: boolean;
  allowLocalUndo?: boolean;
  availableObjectIds?: string[];
  capabilityIds?: import("./similarityLearningMap").SimilarityCapabilityId[];
  autoFocusSequence?: boolean;
  autoSubmitOnComplete?: boolean;
  prefillKnownFactor?: boolean;
  requiredInputCount?: number;
  completedLabels?: TopicSegmentLabel[];
  completedObjectIds?: string[];
}

export interface TopicChoiceOption {
  value: string;
  labelLatex: string;
  diagnosis?: string;
}

export interface TopicActionContract {
  id: string;
  title: string;
  goal: string;
  primitive: TopicActionPrimitive;
  target: string;
  promptLatex: string;
  options?: TopicChoiceOption[];
  acceptedAnswers: string[];
  expectedLatex: string;
  successCondition: string;
  errorDiagnosis: string;
  feedbackLatex: string;
  hintLatex: string;
  diagramAsset?: string;
  interaction?: TopicGeometryInteraction;
  presentation?: TopicInteractionPresentation;
  coach?: TopicCoachScript;
  nextStepId?: string;
}

/** Learner-visible projection. Answer truth must never cross the backend boundary. */
export type TopicActionProjection = Omit<TopicActionContract, "acceptedAnswers" | "expectedLatex">;

export interface TopicScenarioPromptData {
  sourceBankId: string;
  sourceBankTitle: string;
  sourceQuestionId: string;
  sourceAssignment: string;
  title: string;
  modelLabel: string;
  difficulty: string;
  skillTags: string[];
  promptLatex: string;
  promptDiagramAsset?: string;
  promptGeometry?: TopicGeometryModel;
  explanationLatex: string;
  teaching: {
    goal: string;
    expectedBlocker: string;
    fallbackMove: string;
  };
  steps: TopicActionProjection[];
}

export interface TopicScenarioAnswerKey {
  answerLatex: string;
  steps: Record<string, {
    acceptedAnswers: string[];
    expectedLatex: string;
  }>;
}

export type TopicScenarioValidationReport = ScenarioValidationReport;

export type TopicScenarioRecord = Omit<ScenarioRecord, "taskId" | "engineKind" | "promptData" | "answerKey" | "metadata"> & {
  taskId: TopicPracticeTaskId;
  engineKind: "topic-practice";
  promptData: TopicScenarioPromptData & Record<string, unknown>;
  answerKey: TopicScenarioAnswerKey & Record<string, unknown>;
  metadata: ScenarioRecord["metadata"] & {
    sourceBankId: string;
    sourceQuestionId: string;
    sourceAssignment: string;
    importTool: string;
  };
  validation: TopicScenarioValidationReport;
};

/** Backend-only hydrated scenario used by topic-practice evaluation. */
export type TopicResolvedScenario = Omit<TopicScenarioPromptData, "steps"> & {
  id: string;
  taskId: TopicPracticeTaskId;
  contentId: string;
  version: string;
  answerLatex: string;
  steps: TopicActionContract[];
};

export interface TopicLessonSideItem {
  kind: "hint" | "mistake" | "note";
  title: string;
  contentLatex: string;
}

export interface TopicLessonExample {
  id: string;
  label: string;
  sectionTitle?: string;
  stemLatex: string;
  promptDiagramAsset?: string;
  coreTitle?: string;
  coreRules: string[];
  steps: Array<{
    id: string;
    title: string;
    contentLatex: string;
    diagramAsset?: string;
  }>;
  sideItems: TopicLessonSideItem[];
  sourceTex?: string;
}

export interface TopicLessonRecord {
  taskId: TopicPracticeTaskId;
  title: string;
  objective: string;
  sourceAssignments: string[];
  examples: TopicLessonExample[];
}

export interface TopicScenarioBundle {
  schema: "teaching-tools/topic-scenario-bundle/v2";
  version: string;
  generatedAt: string;
  sourceRoot: string;
  authoringRun: AuthoringRun;
  lessons: Record<TopicPracticeTaskId, TopicLessonRecord>;
  scenarios: Record<TopicPracticeTaskId, TopicScenarioRecord[]>;
}

export interface TopicPracticeContentDefinition {
  id: string;
  engineKind: "topic-practice";
  taskId: TopicPracticeTaskId;
  version: string;
  sourceExplanation: string;
  additionalSourceExplanations?: string[];
  sourceBanks: string[];
  guideTemplate: { banner: string; hint: string };
  feedbackTemplate: { correct: ["correct"]; wrong: ["wrong"]; finish: ["finish"] };
}

export interface TopicPracticeWorkspaceModel {
  topicLabel: TopicPracticeTaskId;
  modelLabel: string;
  sourceBank: string;
  sourceQuestionId: string;
  sourceAssignment: string;
  promptLatex: string;
  promptDiagramAsset?: string;
  promptGeometry?: TopicGeometryModel;
  skillTags: string[];
  activeStepId: string;
  completedStepIds: string[];
  contracts: Record<string, TopicActionProjection>;
  guidedMode: boolean;
}

export function normalizeTopicAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\left|\\right/g, "")
    .replace(/\\d?frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\$/g, "")
    .replace(/[，,]/g, "")
    .replace(/[。；;]/g, "")
    .replace(/：/g, ":")
    .replace(/²/g, "^2")
    .replace(/√/g, "sqrt")
    .replace(/\s+/g, "")
    .replace(/\\times|\\cdot|×/g, "*")
    .replace(/[{}]/g, "");
}

export function isTopicAnswerAccepted(value: string, acceptedAnswers: string[]): boolean {
  const normalized = normalizeTopicAnswer(value);
  return acceptedAnswers.some((answer) => normalizeTopicAnswer(answer) === normalized);
}
