/**
 * 智能 Tutor 会话前端 API 合同（Phase 5 remediation 波次 E）。
 *
 * 镜像 backend TutorTurnResponse/SessionView 的学生安全面——前端只消费
 * 已验证 presentation，不解析 action_template JSON、不持有 truth。
 */
import type { ActionContract } from "../../../../shared/actionRuntime";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

export type TutorInputKind =
  | "reasoning_utterance"
  | "question_asked"
  | "pointing_evidence"
  | "structured_action_evidence"
  | "silence_observed"
  | "student_interrupted";

export interface TutorVoiceAction {
  action_id: string;
  text: string;
  interruptible: boolean;
  voice_source?: "approved-resource" | "model-generated" | "deterministic-scaffold";
}

export interface TutorWorkspaceAction {
  action_id: string;
  decision_id: string;
  capability: string;
  target_ids: string[];
  resource_id: string;
  action_ref: string;
  /** 学生面投影（assessment 形态 ActionContract：无 localTruth/teachingInput）。 */
  student_view: ActionContract;
}

export interface TutorTurnResponse {
  session_id: string;
  revision: number;
  client_turn_id: string;
  idempotent_replay: boolean;
  mode: "teach" | "guided_solve" | "repair";
  current_checkpoint: { checkpoint_id: string; part_id: string; route_id: string };
  alignment?: {
    alignment: string;
    checkpoint_id?: string;
    route_id?: string;
    confidence?: number;
  };
  decision: {
    decision_id: string;
    move_type: "explain" | "prompt" | "hint" | "confirm" | "wait" | "repair";
    purpose_code: string;
    policy_version: string;
    fallback?: boolean;
  } | null;
  voice: TutorVoiceAction[];
  workspace: TutorWorkspaceAction[];
  fallback?: { used: boolean; failure_class?: string };
  event_cursor: number;
}

export interface TutorSessionView {
  session_id: string;
  revision: number;
  mode: "teach" | "guided_solve" | "repair";
  completed: boolean;
  current_checkpoint: { checkpoint_id: string; part_id: string; route_id: string };
  pending_voice: TutorVoiceAction[];
  pending_workspace: TutorWorkspaceAction[];
  event_cursor: number;
}

export interface TutorStartResponse {
  session_id: string;
  opening: TutorTurnResponse;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
    const error = new Error(body?.error?.message || `Request failed (${response.status})`) as Error & {
      status?: number;
      code?: string;
    };
    error.status = response.status;
    error.code = body?.error?.code;
    throw error;
  }
  return response.json() as Promise<T>;
}

export const tutorApi = {
  start(tpId: string, studentId: string): Promise<TutorStartResponse> {
    return request("/api/tutor-sessions", {
      method: "POST",
      body: JSON.stringify({ tpId, studentId }),
    });
  },
  view(sessionId: string): Promise<TutorSessionView> {
    return request(`/api/tutor-sessions/${sessionId}`);
  },
  turn(
    sessionId: string,
    clientTurnId: string,
    expectedRevision: number,
    input: { input_kind: TutorInputKind; text?: string; object_id?: string; duration_ms?: number; action_evidence?: Record<string, unknown> },
  ): Promise<TutorTurnResponse> {
    return request(`/api/tutor-sessions/${sessionId}/turns`, {
      method: "POST",
      body: JSON.stringify({ clientTurnId, expectedRevision, input }),
    });
  },
  voiceCompletion(
    sessionId: string,
    actionId: string,
    outcome: "completed" | "interrupted" | "rejected" | "failed",
  ): Promise<TutorTurnResponse> {
    return request(`/api/tutor-sessions/${sessionId}/voice-completions`, {
      method: "POST",
      body: JSON.stringify({ action_id: actionId, outcome }),
    });
  },
  complete(sessionId: string, reason = "finished"): Promise<{ session_id: string; completed: boolean }> {
    return request(`/api/tutor-sessions/${sessionId}/complete`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },
  asr(sessionId: string, audio: { dataUrl: string; durationMs?: number }): Promise<{ transcript: string; model: string }> {
    return request(`/api/tutor-sessions/${sessionId}/asr`, {
      method: "POST",
      body: JSON.stringify({ audio: { dataUrl: audio.dataUrl, durationMs: audio.durationMs } }),
    });
  },
};
