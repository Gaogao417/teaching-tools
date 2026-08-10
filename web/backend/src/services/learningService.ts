import type { LearningActionResponse, LearningProjectionSpec, TaskId } from "../../../shared/contracts";
import { isTopicAnswerAccepted } from "../../../shared/topicPractice";
import { getEnginePlugin } from "./runtime/platform/engineRegistry";
import { resolveContentDefinition } from "./runtime/platform/contentRegistry";
import { getTaskDefinition } from "./tasks/catalogService";
import { selectApprovedScenario } from "./runtime/platform/scenarioSelector";
import { resolveTopicScenarioRecord } from "./runtime/engines/topicPractice/scenarioBank";
import { appError } from "./runtime/platform/errors";
import type { ExercisePlan } from "../../../shared/actionRuntime";
import type { TopicPracticeEngineState } from "./runtime/engines/topicPractice/types";
import { buildTopicExercisePlan } from "./actionRuntime/topicPlanProjector";

export function getLearningProjection(taskId: TaskId): LearningProjectionSpec {
  const task = getTaskDefinition(taskId);
  const content = resolveContentDefinition(task.contentId);
  const plugin = getEnginePlugin(task.engineKind);
  const state = plugin.createState(task, content, 0, selectApprovedScenario(task, content, 0));
  return plugin.buildLearningProjection(task, content, state);
}

export function getLearningActionPlan(taskId: TaskId): ExercisePlan {
  const task = getTaskDefinition(taskId);
  if (task.engineKind !== "topic-practice") {
    throw appError("ACTION_NOT_ALLOWED", "Action Runtime v2 is currently available for topic practice", 409);
  }
  const content = resolveContentDefinition(task.contentId);
  const plugin = getEnginePlugin(task.engineKind);
  const state = plugin.createState(task, content, 0, selectApprovedScenario(task, content, 0)) as TopicPracticeEngineState;
  state.isLearningProjection = true;
  return buildTopicExercisePlan(state, "practice");
}

export function submitLearningAction(taskId: TaskId, stepId: string, value: string): LearningActionResponse {
  const task = getTaskDefinition(taskId);
  if (task.engineKind !== "topic-practice") {
    throw appError("ACTION_NOT_ALLOWED", "Interactive Learn validation is only available for topic practice", 409);
  }
  const content = resolveContentDefinition(task.contentId);
  const record = selectApprovedScenario(task, content, 0);
  const scenario = resolveTopicScenarioRecord(record as Parameters<typeof resolveTopicScenarioRecord>[0]);
  const step = scenario.steps.find((item) => item.id === stepId);
  if (!step) throw appError("ACTION_NOT_ALLOWED", `Unknown Learn step ${stepId}`, 409);
  return {
    accepted: true,
    evaluation: isTopicAnswerAccepted(value.trim(), step.acceptedAnswers) ? "correct" : "wrong",
  };
}
