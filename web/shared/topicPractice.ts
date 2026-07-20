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
  kind: "construct-parallel" | "mark-segments" | "mark-ratio" | "equation";
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
  equation?: {
    targetLatex: string;
    factorSlots: [string, string, string];
    resultLatex: string;
  };
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
  nextStepId?: string;
}

export interface TopicScenarioRecord {
  id: string;
  taskId: TopicPracticeTaskId;
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
  answerLatex: string;
  explanationLatex: string;
  teaching: {
    goal: string;
    expectedBlocker: string;
    fallbackMove: string;
  };
  steps: TopicActionContract[];
}

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
  schema: "teaching-tools/topic-scenario-bundle/v1";
  version: string;
  generatedAt: string;
  sourceRoot: string;
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
  contracts: Record<string, TopicActionContract>;
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
