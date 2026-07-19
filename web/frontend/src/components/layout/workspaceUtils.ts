import type { ChapterNode, GradeNode, TaskId, TaskNode, TaskTreeResponse } from "../../../../shared/contracts";

export type TaskTreePath = {
  grade: GradeNode;
  chapter: ChapterNode;
  task: TaskNode;
};

export function formatSeconds(ms: number | null | undefined) {
  if (!Number.isFinite(ms)) return "--";
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
