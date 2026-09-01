/**
 * F7 — vNext 学生端 API client（/api/vnext/tutor-sessions）。
 *
 * 只传类型化 intent / workspace 命令与 expected_revision；响应是学生安全面
 * （统一三视图 + status + 静态题面）。错误保留服务端错误码（供 UI 区分
 * 403 assessment 禁用 / 409 漂移 / 404 会话丢失等），不静默吞。
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

export type VNextIntentKind =
  | "submit_answer"
  | "confirm"
  | "continue"
  | "ask_question"
  | "request_scaffold"
  | "request_rephrase"
  | "barge_in"
  | "return_to_mainline";

export interface VNextTurnSummary {
  decision_kind?: string;
  to_beat_id?: string;
  failure?: { failure_class: string; message: string };
}

export interface VNextSessionResponse {
  session_id: string;
  revision: number;
  completed: boolean;
  assessment: boolean;
  turn?: VNextTurnSummary;
  question?: { artifact_id: string; question_type: string; stem: string };
  geometry?: unknown;
  views: {
    student_workspace_view: unknown;
    coach_panel_view: unknown;
    participation: unknown;
    status: {
      session_id: string;
      session_revision: number;
      workspace_revision: number;
      completed: boolean;
      last_failure?: { category: string; failure_class: string; message?: string };
    };
  };
}

export class VNextApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "VNextApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new VNextApiError(
      response.status,
      payload?.error?.code ?? "HTTP_ERROR",
      payload?.error?.message ?? `vNext request failed (${response.status})`,
    );
  }
  return response.json() as Promise<T>;
}

export const vnextApi = {
  availability: (taskId: string): Promise<{ task_id: string; enabled: boolean }> =>
    request<{ task_id: string; enabled: boolean }>("GET", `/api/vnext/availability/${encodeURIComponent(taskId)}`),

  start: (input: { studentId: string; assessment?: boolean }): Promise<VNextSessionResponse> =>
    request<VNextSessionResponse>("POST", "/api/vnext/tutor-sessions", {
      student_id: input.studentId,
      ...(input.assessment ? { assessment: true } : {}),
    }),

  restore: (sessionId: string): Promise<VNextSessionResponse> =>
    request<VNextSessionResponse>("GET", `/api/vnext/tutor-sessions/${encodeURIComponent(sessionId)}`),

  submitIntent: (
    sessionId: string,
    input: { intentKind: VNextIntentKind; text?: string; expectedRevision: number },
  ): Promise<VNextSessionResponse> =>
    request<VNextSessionResponse>("POST", `/api/vnext/tutor-sessions/${encodeURIComponent(sessionId)}/student-intents`, {
      intent_kind: input.intentKind,
      ...(input.text !== undefined ? { text: input.text } : {}),
      client_request_id: nextClientRequestId(),
      expected_revision: input.expectedRevision,
    }),

  submitWorkspaceCommand: (
    sessionId: string,
    input: {
      surface: "geometry" | "solution_board";
      capability: string;
      targetIds: string[];
      expectedWorkspaceRevision: number;
      params?: Record<string, unknown>;
    },
  ): Promise<VNextSessionResponse> =>
    request<VNextSessionResponse>("POST", `/api/vnext/tutor-sessions/${encodeURIComponent(sessionId)}/workspace-commands`, {
      command_id: nextCommandId(),
      client_command_id: nextClientCommandId(),
      surface: input.surface,
      capability: input.capability,
      target_ids: input.targetIds,
      expected_workspace_revision: input.expectedWorkspaceRevision,
      ...(input.params !== undefined ? { params: input.params } : {}),
    }),
};

let clientSerial = 0;
function nextClientRequestId(): string {
  clientSerial += 1;
  return `fe-${Date.now().toString(36)}-${String(clientSerial).padStart(4, "0")}`;
}

function nextClientCommandId(): string {
  clientSerial += 1;
  return `fecc-${Date.now().toString(36)}-${String(clientSerial).padStart(4, "0")}`;
}

function nextCommandId(): string {
  clientSerial += 1;
  return `SC-fe-${Date.now().toString(36)}-${String(clientSerial).padStart(4, "0")}`;
}
