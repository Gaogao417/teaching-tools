import type { LearningProjectionSpec, TaskId } from "../../../shared/contracts";
import { getEnginePlugin } from "./runtime/platform/engineRegistry";
import { resolveContentDefinition } from "./runtime/platform/contentRegistry";
import { getTaskDefinition } from "./tasks/catalogService";

export function getLearningProjection(taskId: TaskId): LearningProjectionSpec {
  const task = getTaskDefinition(taskId);
  const content = resolveContentDefinition(task.contentId);
  const plugin = getEnginePlugin(task.engineKind);
  const state = plugin.createState(task, content, 0);
  return plugin.buildLearningProjection(task, content, state);
}
