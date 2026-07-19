import type { ReactNode } from "react";
import type { TaskId, TaskNode, TaskTreeResponse } from "../../../../shared/contracts";

export type WorkspaceTopNavState = {
  content: ReactNode;
  tone?: "default" | "practice";
};

export type WorkspaceOutletContext = {
  tree: TaskTreeResponse | null;
  focusedTaskId: TaskId | null;
  focusedTask: TaskNode | null;
  activeTaskId: TaskId | null;
  studentName: string;
  isStudentReady: boolean;
  requestAuth: () => void;
  setFocusedTaskId: (taskId: TaskId) => void;
  setTopNavContent: (state: WorkspaceTopNavState | null) => void;
  setNavigationGuard: (guard: (() => boolean) | null) => void;
};
