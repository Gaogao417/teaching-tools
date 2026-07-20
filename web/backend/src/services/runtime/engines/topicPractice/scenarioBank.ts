import bundleJson from "../../../../content/topicScenarioBundle.json";
import type {
  TopicLessonRecord,
  TopicPracticeTaskId,
  TopicScenarioBundle,
  TopicScenarioRecord,
} from "../../../../../../shared/topicPractice";

// Generated offline from final explanation TeX plus ready-bank YAML.
const bundle = bundleJson as TopicScenarioBundle;

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
  return scenarios[index % scenarios.length];
}

export function getTopicScenario(taskId: TopicPracticeTaskId, scenarioId: string): TopicScenarioRecord {
  const scenario = bundle.scenarios[taskId]?.find((item) => item.id === scenarioId);
  if (!scenario) throw new Error(`Unknown topic scenario ${scenarioId}`);
  return scenario;
}
