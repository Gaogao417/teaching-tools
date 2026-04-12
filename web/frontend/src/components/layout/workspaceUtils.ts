import type { ChapterNode, GradeNode, TaskId, TaskNode, TaskTreeResponse } from "../../../../shared/contracts";

export type TaskTreePath = {
  grade: GradeNode;
  chapter: ChapterNode;
  task: TaskNode;
};

export function formatSeconds(ms: number | null | undefined) {
  if (!Number.isFinite(ms)) return "--";
  return `${((ms || 0) / 1000).toFixed(1)}s`;
}

export function findFirstTask(tree: TaskTreeResponse | null) {
  return tree?.grades[0]?.chapters[0]?.tasks[0] || null;
}

export function findTaskPath(taskId: string | null | undefined, tree: TaskTreeResponse | null): TaskTreePath | null {
  if (!taskId || !tree) return null;
  for (const grade of tree.grades) {
    for (const chapter of grade.chapters) {
      const task = chapter.tasks.find((item) => item.id === taskId);
      if (task) {
        return { grade, chapter, task };
      }
    }
  }
  return null;
}

export function getTaskNode(taskId: TaskId | null, tree: TaskTreeResponse | null) {
  return findTaskPath(taskId, tree)?.task || null;
}
