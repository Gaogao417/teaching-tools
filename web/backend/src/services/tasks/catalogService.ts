import { ContentDefinition, TaskDefinition, TaskId } from "../../../../shared/contracts";
import { CONTENT_DEFINITIONS, TASK_DEFINITIONS, TASK_TREE } from "../../../../shared/tasks";

export function getTaskTree() {
  return TASK_TREE;
}

export function getTaskDefinition(taskId: TaskId): TaskDefinition {
  const task = TASK_DEFINITIONS[taskId];
  if (!task) {
    throw {
      status: 404,
      body: {
        error: {
          code: "TASK_NOT_FOUND",
          message: `Task ${taskId} not found`,
        },
      },
    };
  }
  return task;
}

export function getContentDefinition(contentId: string): ContentDefinition {
  const content = CONTENT_DEFINITIONS[contentId];
  if (!content) {
    throw {
      status: 500,
      body: {
        error: {
          code: "RUNTIME_CONTRACT_INVALID",
          message: `Content ${contentId} not found`,
        },
      },
    };
  }
  return content;
}
