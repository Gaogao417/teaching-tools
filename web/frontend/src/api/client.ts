import {
  FinishPracticeResponse,
  LearningProjectionSpec,
  LearningActionResponse,
  RuntimeActionEvent,
  RuntimeActionResponse,
  RestorePracticeResponse,
  ResultSnapshot,
  StartPracticeResponse,
  TaskHistoryResponse,
  TaskId,
  TaskTreeResponse,
} from "../../../shared/contracts";
import type { LearningMapResponse, RemediationDiagnosis } from "../../../shared/similarityLearningMap";
import type {
  ActionCheckpointRequest,
  ActionCheckpointResponse,
  ActionEvaluationRequest,
  ActionEvaluationResponse,
  ActionPlanResponse,
  CoachRequest,
  CoachResponse,
  ExercisePlan,
} from "../../../shared/actionRuntime";
import { assertExercisePlan, isActionCheckpointResponse, isActionEvaluationResponse, isActionPlanResponse, isCoachResponse } from "../../../shared/actionRuntime";

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

async function requestActionPlan(path: string): Promise<ActionPlanResponse> {
  const response = await request<unknown>(path);
  if (!isActionPlanResponse(response)) throw new Error("Invalid Action Runtime plan response");
  return response;
}

async function validated<T>(path: string, init: RequestInit, guard: (value: unknown) => value is T, label: string): Promise<T> {
  const response = await request<unknown>(path, init);
  if (!guard(response)) throw new Error(`Invalid Action Runtime ${label} response`);
  return response;
}

async function requestLearningActionPlan(path: string): Promise<ExercisePlan> {
  const plan = await request<ExercisePlan>(path);
  assertExercisePlan(plan);
  return plan;
}

export const api = {
  getTaskTree: () => request<TaskTreeResponse>("/api/task-tree"),
  getSimilarityLearningMap: (studentName: string) =>
    request<LearningMapResponse>(`/api/learning-maps/similarity?studentName=${encodeURIComponent(studentName)}`),
  recordSimilarityLearnProgress: (taskId: TaskId, studentName: string, state: "in_progress" | "completed", lastStepId?: string) =>
    request<{ ok: true }>("/api/learning-maps/similarity/progress", {
      method: "POST",
      body: JSON.stringify({ taskId, studentName, state, lastStepId }),
    }),
  getLearningProjection: (taskId: TaskId) =>
    request<LearningProjectionSpec>(`/api/learn/${taskId}`),
  getLearningActionPlan: (taskId: TaskId) =>
    requestLearningActionPlan(`/api/learn/${taskId}/action-plan`),
  submitLearningAction: (taskId: TaskId, stepId: string, value: string) =>
    request<LearningActionResponse>("/api/learn/runtime-action", {
      method: "POST",
      body: JSON.stringify({ taskId, stepId, value }),
    }),
  getTaskHistory: (taskId: TaskId, studentName: string, limit = 5) =>
    request<TaskHistoryResponse>(
      `/api/task-history/${taskId}?studentName=${encodeURIComponent(studentName)}&limit=${limit}`,
    ),
  startPractice: (taskId: TaskId, studentName: string) =>
    request<StartPracticeResponse>("/api/practice/start", {
      method: "POST",
      body: JSON.stringify({ taskId, studentName }),
    }),
  startChallenge: (challengeId: string, studentName: string) =>
    request<StartPracticeResponse>(`/api/challenges/${challengeId}/start`, {
      method: "POST",
      body: JSON.stringify({ studentName }),
    }),
  getChallengeDiagnosis: (sessionId: string) =>
    request<RemediationDiagnosis>(`/api/challenges/session/${sessionId}/diagnosis`),
  startRemediation: (sessionId: string) =>
    request<StartPracticeResponse>(`/api/challenges/session/${sessionId}/remediation`, { method: "POST" }),
  submitRuntimeAction: (sessionId: string, instanceId: string, action: RuntimeActionEvent) =>
    request<RuntimeActionResponse>("/api/practice/runtime-action", {
      method: "POST",
      body: JSON.stringify({ sessionId, instanceId, action }),
    }),
  restorePractice: (sessionId: string) =>
    request<RestorePracticeResponse>(`/api/practice/session/${sessionId}`),
  getActionRuntimePlan: (sessionId: string) =>
    requestActionPlan(`/api/practice/session/${sessionId}/action-plan`),
  evaluateAction: (payload: ActionEvaluationRequest) =>
    validated("/api/practice/action-evaluation", {
      method: "POST",
      body: JSON.stringify(payload),
    }, isActionEvaluationResponse, "evaluation"),
  checkpointAction: (payload: ActionCheckpointRequest) =>
    validated("/api/practice/action-checkpoint", {
      method: "POST",
      body: JSON.stringify(payload),
    }, isActionCheckpointResponse, "checkpoint"),
  askActionCoach: (payload: CoachRequest) =>
    validated("/api/practice/action-coach", {
      method: "POST",
      body: JSON.stringify(payload),
    }, isCoachResponse, "coach"),
  finishPractice: (sessionId: string) =>
    request<FinishPracticeResponse>("/api/practice/finish", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
  getResult: (sessionId: string) =>
    request<ResultSnapshot>(`/api/practice/result/${sessionId}`),
};
