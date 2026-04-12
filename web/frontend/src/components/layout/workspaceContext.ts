import type { TaskId, TaskNode, TaskTreeResponse } from "../../../../shared/contracts";

export type WorkspaceOutletContext = {
  tree: TaskTreeResponse | null;
  focusedTaskId: TaskId | null;
  focusedTask: TaskNode | null;
  activeTaskId: TaskId | null;
  studentName: string;
  isStudentReady: boolean;
  requestAuth: () => void;
  setFocusedTaskId: (taskId: TaskId) => void;
};
