/**
 * F7 Step 7 — vNext 学生端 API client（唯一新增前端数据通道）。
 *
 * 纪律（f7 ledger 增补 4/6）：本客户端只传类型化 intent / action evidence /
 * workspace 命令与 expected_revision；响应 = canonical view/v1 三视图 + status
 * + active_action（ActiveActionProjector 产物）。错误保留服务端错误码；系统
 * 失败（RevisionConflict/CommandRejected/RuntimeFailure）以 reject 上抛——
 * 调用方绝不将其映射为学生错误（方案 A 映射规则）。
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

export interface VNextViews {
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
}

export interface VNextActiveAction {
  action_id: string;
  resource_id: string;
  action_ref: string;
  capability: string;
  target_ids: string[];
  student_view: { actionId: string; kind: string; version: number; input: Record<string, unknown> };
  action_plan: unknown;
  form: "operation";
}

export interface VNextSessionResponse {
  session_id: string;
  revision: number;
  completed: boolean;
  assessment: boolean;
  active_action?: VNextActiveAction;
  turn?: { decision_kind?: string; to_beat_id?: string; failure?: { failure_class: string; message: string } };
  question?: { stem: string };
  views: VNextViews;
}

/** 方案 A：action-evidence 应用层 envelope（evaluation 出自真实 typed evaluator）。 */
export interface VNextActionSubmission {
  status: "evidence-rejected" | "workspace-committed" | "command-rejected" | "revision-conflict";
  evaluation: {
    outcome: "accepted" | "rejected" | "conflict";
    evaluation: "correct" | "wrong" | "progress";
    revision: number;
    diagnosis?: { messageLatex: string; wrongObjectIds: string[]; wrongActionIds?: string[]; wrongSlotIds?: string[] };
    phase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished";
    nextIndex: number;
  };
}

export type VNextIntentKind =
  | "submit_answer"
  | "confirm"
  | "continue"
  | "ask_question"
  | "request_scaffold"
  | "request_rephrase"
  | "barge_in"
  | "return_to_mainline";

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
    throw new VNextApiError(response.status, payload?.error?.code ?? "HTTP_ERROR", payload?.error?.message ?? `vNext request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

let clientSerial = 0;
function nextId(prefix: string): string {
  clientSerial += 1;
  return `${prefix}-${Date.now().toString(36)}-${String(clientSerial).padStart(4, "0")}`;
}

export const vnextApi = {
  availability: (taskId: string): Promise<{ task_id: string; enabled: boolean }> =>
    request("GET", `/api/vnext/availability/${encodeURIComponent(taskId)}`),

  start: (input: { studentId: string }): Promise<VNextSessionResponse> =>
    request("POST", "/api/vnext/tutor-sessions", { student_id: input.studentId }),

  restore: (sessionId: string): Promise<VNextSessionResponse> =>
    request("GET", `/api/vnext/tutor-sessions/${encodeURIComponent(sessionId)}`),

  submitIntent: (sessionId: string, input: { intentKind: VNextIntentKind; text?: string; expectedRevision: number }): Promise<VNextSessionResponse> =>
    request("POST", `/api/vnext/tutor-sessions/${encodeURIComponent(sessionId)}/student-intents`, {
      intent_kind: input.intentKind,
      ...(input.text !== undefined ? { text: input.text } : {}),
      client_request_id: nextId("fe-cr"),
      expected_revision: input.expectedRevision,
    }),

  submitActionEvidence: (
    sessionId: string,
    input: { evidence: { actionId: string; sourceStepId: string; kind: string; version: number; values: Record<string, string> }; expectedRevision: number },
  ): Promise<VNextSessionResponse & { action_submission: VNextActionSubmission }> =>
    request("POST", `/api/vnext/tutor-sessions/${encodeURIComponent(sessionId)}/action-evidence`, {
      evidence: input.evidence,
      expected_revision: input.expectedRevision,
      client_command_id: nextId("fe-cc"),
    }),
};
