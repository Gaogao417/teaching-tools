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
  CoachTurnRequest,
  CoachTurnResponse,
  DirectSpeechRequest,
  DirectSpeechResponse,
  ExercisePlan,
} from "../../../shared/actionRuntime";
import { assertExercisePlan, isActionCheckpointResponse, isActionEvaluationResponse, isActionPlanResponse, isCoachResponse, isCoachTurnResponse, isDirectSpeechResponse } from "../../../shared/actionRuntime";
import { isTrainingReceipt, type TrainingCheckpoint, type TrainingReceipt, type TrainingResult } from "../../../shared/trainingRuntime";
import { isCoachTurnEvent, type CoachTurnEvent, type VoiceTelemetryEvent } from "../../../shared/coachMedia";
import type { SolutionBoardProjection } from "../../../shared/solutionBoard";
import {
  isTutorExperienceResponse,
  isTutorSessionView,
  isTutorTurnResponse,
  type LearnExperienceResponse,
  type TutorSessionView,
  type TutorStudentInput,
  type TutorTurnResponse,
} from "../../../shared/tutorExperience";

/** 波次 F 任务 1：GET /api/learn/:taskId/solution-board 响应（内容面）。 */
export interface SolutionBoardReviewResponse {
  task_id: string;
  scenario_id: string;
  board: SolutionBoardProjection | null;
}

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

async function streamCoachTurn(payload: CoachTurnRequest, onEvent: (event: CoachTurnEvent) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/coach/turn-stream`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal,
  });
  if (!response.ok || !response.body) throw new Error("Coach stream request failed");
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split("\n"); pending = lines.pop() || "";
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line) as unknown;
      if (!isCoachTurnEvent(event)) throw new Error("Invalid Coach stream event");
      onEvent(event);
    }
    if (done) break;
  }
  if (pending.trim()) {
    const event = JSON.parse(pending) as unknown;
    if (!isCoachTurnEvent(event)) throw new Error("Invalid Coach stream event");
    onEvent(event);
  }
}

async function streamActionSpeech(payload: DirectSpeechRequest, signal?: AbortSignal): Promise<DirectSpeechResponse> {
  if (typeof MediaSource === "undefined" || !MediaSource.isTypeSupported("audio/mpeg")) {
    return validated<DirectSpeechResponse>("/api/action-speech", { method: "POST", body: JSON.stringify(payload), signal }, isDirectSpeechResponse, "speech");
  }
  const response = await fetch(`${API_BASE_URL}/api/action-speech-stream`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal,
  });
  if (!response.ok || !response.body) throw new Error("Speech stream request failed");
  const mediaSource = new MediaSource();
  const audioUrl = URL.createObjectURL(mediaSource);
  void new Promise<void>((resolve, reject) => {
    mediaSource.addEventListener("sourceopen", async () => {
      try {
        const source = mediaSource.addSourceBuffer("audio/mpeg");
        const reader = response.body!.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await new Promise<void>((appended, failed) => {
            const finish = () => { source.removeEventListener("updateend", finish); source.removeEventListener("error", fail); appended(); };
            const fail = () => { source.removeEventListener("updateend", finish); source.removeEventListener("error", fail); failed(new Error("Speech buffer append failed")); };
            source.addEventListener("updateend", finish, { once: true }); source.addEventListener("error", fail, { once: true });
            source.appendBuffer(value);
          });
        }
        if (mediaSource.readyState === "open") mediaSource.endOfStream();
        resolve();
      } catch (error) { if (mediaSource.readyState === "open") mediaSource.endOfStream("decode"); reject(error); }
    }, { once: true });
  }).catch(() => URL.revokeObjectURL(audioUrl));
  return { audioUrl };
}

export const api = {
  reportVoiceTelemetry: (event: VoiceTelemetryEvent) => request<{ accepted: true }>("/api/coach/telemetry", { method: "POST", body: JSON.stringify(event), keepalive: true }),
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
  /** 波次 F 任务 1：完成页板书回顾（既有 /api/learn 内容面；仅
   * question_completed 后调用；board 为 null 时完成页不渲染板书）。 */
  getLearnSolutionBoard: (taskId: TaskId, scenarioId?: string) =>
    request<SolutionBoardReviewResponse>(
      `/api/learn/${taskId}/solution-board${scenarioId ? `?scenario=${encodeURIComponent(scenarioId)}` : ""}`,
    ),
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
  uploadTrainingRecord: (kind: "checkpoint" | "result", payload: TrainingCheckpoint | TrainingResult) =>
    validated<TrainingReceipt>(`/api/training/${kind === "checkpoint" ? "checkpoints" : "results"}`, {
      method: "POST",
      body: JSON.stringify(payload),
    }, isTrainingReceipt, `training ${kind}`),
  askActionCoach: (payload: CoachRequest) =>
    validated("/api/practice/action-coach", {
      method: "POST",
      body: JSON.stringify(payload),
    }, isCoachResponse, "coach"),
  conductActionCoach: (payload: CoachTurnRequest, options?: { signal?: AbortSignal }) =>
    validated<CoachTurnResponse>("/api/action-coach", {
      method: "POST",
      body: JSON.stringify(payload),
      signal: options?.signal,
    }, isCoachTurnResponse, "multimodal coach"),
  streamActionCoach: streamCoachTurn,
  synthesizeActionSpeech: (payload: DirectSpeechRequest, signal?: AbortSignal) =>
    validated<DirectSpeechResponse>("/api/action-speech", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    }, isDirectSpeechResponse, "speech"),
  streamActionSpeech,
  finishPractice: (sessionId: string) =>
    request<FinishPracticeResponse>("/api/practice/finish", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
  getResult: (sessionId: string) =>
    request<ResultSnapshot>(`/api/practice/result/${sessionId}`),
  // ----------------------------------------------------------------------- //
  // Phase 5 UI 集成（波次 C）：Tutor 学习体验（原 features/tutor-session 的
  // 请求能力迁入；类型在 shared/tutorExperience.ts）。
  // ----------------------------------------------------------------------- //
  startLearnExperience: async (taskId: TaskId, body: { studentId: string; switchFromSessionId?: string }): Promise<LearnExperienceResponse> => {
    const response = await request<unknown>(`/api/learn/${taskId}/experience`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const result = response as LearnExperienceResponse;
    if (result.kind === "tutor" && !isTutorExperienceResponse(response)) {
      throw new Error("Invalid tutor experience response");
    }
    return result;
  },
  getTutorSession: async (sessionId: string): Promise<TutorSessionView> => {
    const response = await request<unknown>(`/api/tutor-sessions/${sessionId}`);
    if (!isTutorSessionView(response)) throw new Error("Invalid tutor session view");
    return response;
  },
  submitTutorTurn: async (
    sessionId: string,
    clientTurnId: string,
    expectedRevision: number,
    input: TutorStudentInput,
  ): Promise<TutorTurnResponse> => {
    const response = await request<unknown>(`/api/tutor-sessions/${sessionId}/turns`, {
      method: "POST",
      body: JSON.stringify({ clientTurnId, expectedRevision, input }),
    });
    if (!isTutorTurnResponse(response)) throw new Error("Invalid tutor turn response");
    return response;
  },
  completeTutorVoice: async (
    sessionId: string,
    actionId: string,
    outcome: "completed" | "interrupted" | "rejected" | "failed",
  ): Promise<TutorTurnResponse | null> => {
    const response = await request<unknown>(`/api/tutor-sessions/${sessionId}/voice-completions`, {
      method: "POST",
      body: JSON.stringify({ action_id: actionId, outcome }),
    });
    return isTutorTurnResponse(response) ? response : null;
  },
  completeTutorSession: (sessionId: string, reason = "finished"): Promise<{ session_id: string; completed: boolean }> =>
    request(`/api/tutor-sessions/${sessionId}/complete`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  tutorAsr: (sessionId: string, audio: { dataUrl: string; durationMs?: number }): Promise<{ transcript: string; model: string }> =>
    request(`/api/tutor-sessions/${sessionId}/asr`, {
      method: "POST",
      body: JSON.stringify({ audio: { dataUrl: audio.dataUrl, durationMs: audio.durationMs } }),
    }),
};
