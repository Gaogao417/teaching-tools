import {
  FinishPracticeResponse,
  LearningProjectionSpec,
  RuntimeActionEvent,
  RuntimeActionResponse,
  RestorePracticeResponse,
  ResultSnapshot,
  StartPracticeResponse,
  TaskHistoryResponse,
  TaskId,
  TaskTreeResponse,
} from "../../../shared/contracts";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3001";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || "Request failed");
  }
  return response.json() as Promise<T>;
}

export const api = {
  getTaskTree: () => request<TaskTreeResponse>("/api/task-tree"),
  getLearningProjection: (taskId: TaskId) =>
    request<LearningProjectionSpec>(`/api/learn/${taskId}`),
  getTaskHistory: (taskId: TaskId, studentName: string, limit = 5) =>
    request<TaskHistoryResponse>(
      `/api/task-history/${taskId}?studentName=${encodeURIComponent(studentName)}&limit=${limit}`,
    ),
  startPractice: (taskId: TaskId, studentName: string) =>
    request<StartPracticeResponse>("/api/practice/start", {
      method: "POST",
      body: JSON.stringify({ taskId, studentName }),
    }),
  submitRuntimeAction: (sessionId: string, instanceId: string, action: RuntimeActionEvent) =>
    request<RuntimeActionResponse>("/api/practice/runtime-action", {
      method: "POST",
      body: JSON.stringify({ sessionId, instanceId, action }),
    }),
  restorePractice: (sessionId: string) =>
    request<RestorePracticeResponse>(`/api/practice/session/${sessionId}`),
  finishPractice: (sessionId: string) =>
    request<FinishPracticeResponse>("/api/practice/finish", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
  getResult: (sessionId: string) =>
    request<ResultSnapshot>(`/api/practice/result/${sessionId}`),
};
