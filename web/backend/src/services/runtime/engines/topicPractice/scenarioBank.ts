import bundleJson from "../../../../content/topicScenarioBundle.json";
import type {
  TopicLessonRecord,
  TopicPracticeTaskId,
  TopicScenarioBundle,
  TopicScenarioRecord,
} from "../../../../../../shared/topicPractice";

// Generated offline from final explanation TeX plus ready-bank YAML.
const bundle = bundleJson as TopicScenarioBundle;

function withRuntimeInteractionSteps(scenario: TopicScenarioRecord): TopicScenarioRecord {
  if (scenario.taskId !== "nestedSimilarity" || scenario.steps.some((step) => step.primitive === "convert-collinear")) {
    return scenario;
  }

  const [markKnown, mapRatio, ...remaining] = scenario.steps;
  if (!markKnown || !mapRatio) return scenario;

  const conversionStepId = `${markKnown.id}-collinear`;
  const conversionStep = {
    id: conversionStepId,
    title: "互化共线整段与分段",
    goal: "依次点击整段、目标分段和已知分段，建立共线线段关系。",
    primitive: "convert-collinear" as const,
    target: "topic-answer",
    promptLatex: "依次点击 $AC$、$AD$、$DC$，建立 $AC=AD+DC$。",
    acceptedAnswers: ["AC,AD,CD"],
    expectedLatex: "$AC=AD+DC$",
    successCondition: "整段、目标分段和已知分段的关系正确。",
    errorDiagnosis: "整段与两个分段的对应关系不一致。",
    feedbackLatex: "$AC=AD+DC$，因此先由整段减去已知分段得到 $AD$。",
    hintLatex: "先找包含另外两段的整段，再确定要求出的分段。",
    nextStepId: mapRatio.id,
    interaction: {
      kind: "convert-collinear" as const,
      geometry: mapRatio.interaction?.geometry || markKnown.interaction?.geometry || scenario.promptGeometry,
      availableSegments: ["AC", "AD", "CD"],
      expectedOrder: ["AC", "AD", "CD"],
      collinear: {
        wholeSegment: "AC",
        targetSegment: "AD",
        knownSegment: "CD",
        relationLatex: "AC=AD+DC",
      },
    },
  };

  return {
    ...scenario,
    steps: [
      { ...markKnown, nextStepId: conversionStepId },
      conversionStep,
      mapRatio,
      ...remaining,
    ],
  };
}

export function getTopicBundleVersion(): string {
  return bundle.version;
}

export function getTopicLesson(taskId: TopicPracticeTaskId): TopicLessonRecord {
  const lesson = bundle.lessons[taskId];
  if (!lesson) throw new Error(`Unknown topic lesson ${taskId}`);
  return lesson;
}

export function pickTopicScenario(taskId: TopicPracticeTaskId, index: number): TopicScenarioRecord {
  const scenarios = bundle.scenarios[taskId];
  if (!scenarios?.length) throw new Error(`No scenarios for ${taskId}`);
  return withRuntimeInteractionSteps(scenarios[index % scenarios.length]);
}

export function getTopicScenario(taskId: TopicPracticeTaskId, scenarioId: string): TopicScenarioRecord {
  const scenario = bundle.scenarios[taskId]?.find((item) => item.id === scenarioId);
  if (!scenario) throw new Error(`Unknown topic scenario ${scenarioId}`);
  return withRuntimeInteractionSteps(scenario);
}
