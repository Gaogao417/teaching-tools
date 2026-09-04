/**
 * TutorRuntimeClient port + 具体 HTTP adapter（F7 Step 5，spec §0/§2/§4.1）。
 *
 * - 全前端唯一知道 `/api/vnext` 的运行时模块（spec §0 裁决 1：该字符串只允许
 *   存在于本 adapter；组件只消费 port result，不理解 REST/HTTP status）；
 * - 线格式单真源 = web/shared/tutorHttpProfile（spec §0 裁决 2：禁止后端手拼
 *   一份、前端再声明一份）——每个成功响应经 `parseSessionSnapshotHttp`
 *   （schema parse + §1.3 一致性门禁）fail closed，本层零手写 DTO / `as` cast；
 * - 请求发出前用同一组共享 request schema 自校验（如 outcome=failed 缺
 *   failure_class 在客户端即拒，不产生网络往返）；
 * - 错误保持服务端 `error.code`（TutorRuntimeHttpError）；schema/一致性失败是
 *   recoverable protocol error（ProtocolParseError——调用方保留最后一份合法
 *   snapshot，不得部分采用或回落 legacy，spec §4.3）。
 */
import {
  actionEvidenceRequestHttpV1Schema,
  actionSubmissionHttpV1Schema,
  asrRequestHttpV1Schema,
  asrResponseHttpV1Schema,
  parseSessionSnapshotHttp,
  presentationOutcomeRequestHttpV1Schema,
  startRequestHttpV1Schema,
  studentInputRequestHttpV1Schema,
  workspaceCommandRequestHttpV1Schema,
  TUTOR_RUNTIME_HTTP_PROFILE,
  type ActionSubmissionHttpV1,
  type SessionSnapshotHttpV1,
} from "../../../shared/tutorHttpProfile";
import { studentWorkspaceCommandV1Schema } from "../../../shared/canonical/schemas";

/** 经 parseSessionSnapshotHttp（parse + §1.3 门禁）原子校验后的会话快照。 */
export type ValidatedSessionSnapshot = SessionSnapshotHttpV1;

export interface TutorRuntimeAvailability {
  taskId: string;
  enabled: boolean;
  profile: string;
}

/** spec §2.5：HTTP /student-inputs 只收浏览器入口子集（utterance|control）。 */
export type StudentUtteranceInput = {
  kind: "utterance";
  channel: "mainline" | "assistance";
  text: string;
};
export type StudentControlCommand =
  | "confirm"
  | "continue"
  | "request_scaffold"
  | "request_rephrase"
  | "barge_in"
  | "return_to_mainline"
  | "retry_recovery";
export type StudentControlInput = { kind: "control"; command: StudentControlCommand };
export type StudentBrowserInput = StudentUtteranceInput | StudentControlInput;

/** action-evidence 成功响应（snapshot + 判别式 ActionSubmission，spec §2.6）。 */
export interface ActionEvidenceResult {
  snapshot: ValidatedSessionSnapshot;
  actionSubmission: ActionSubmissionHttpV1;
}

/** ASR observe-only 响应（只转写，零教学事实，spec §2.9）。 */
export interface AsrTranscription {
  sessionId: string;
  observedRevision: number;
  transcript: string;
  model: string;
  language?: string;
}

/** 服务端/HTTP 错误：code 原样保留（spec §2.1 错误表；4xx/5xx 不构造学生 correct/wrong）。 */
export class TutorRuntimeHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? `${code} (HTTP ${status})`);
    this.name = "TutorRuntimeHttpError";
    this.status = status;
    this.code = code;
  }
}

/** 响应未通过共享 schema/一致性门禁：recoverable protocol error（保留旧 snapshot）。 */
export class ProtocolParseError extends Error {
  readonly errors: readonly string[];
  constructor(errors: readonly string[]) {
    super(`SessionSnapshot 协议校验失败（fail closed）：${errors.join("; ")}`);
    this.name = "ProtocolParseError";
    this.errors = errors;
  }
}

/** 请求在客户端即未通过共享 request schema（编程错误，未发出网络请求）。 */
export class TutorRuntimeRequestError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`请求未通过客户端 request schema 校验：${issues.join("; ")}`);
    this.name = "TutorRuntimeRequestError";
    this.issues = issues;
  }
}

/** client_request_id（`^[A-Za-z0-9._:-]{4,128}$`；幂等键由调用方管理重试稳定性）。 */
export function newRuntimeRequestId(): string {
  return crypto.randomUUID();
}

function buildBody<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new TutorRuntimeRequestError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`));
  }
  return parsed.data;
}

async function readHttpError(response: Response): Promise<TutorRuntimeHttpError> {
  const body: unknown = await response.json().catch(() => undefined);
  const error = (body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
  const code = error && typeof error.code === "string" ? error.code : "HTTP_ERROR";
  const message = error && typeof error.message === "string" ? error.message : undefined;
  return new TutorRuntimeHttpError(response.status, code, message);
}

/** spec §2.1：2xx 只表示请求被理解；application outcome 由判别字段穷尽处理。 */
export interface TutorRuntimeClient {
  availability(taskId: string): Promise<TutorRuntimeAvailability>;
  start(input: {
    taskId: string;
    studentId: string;
    assessment?: boolean;
    clientRequestId: string;
  }): Promise<ValidatedSessionSnapshot>;
  restore(sessionId: string): Promise<ValidatedSessionSnapshot>;
  submitStudentInput(
    sessionId: string,
    input: StudentBrowserInput,
    expectedRevision: number,
    clientRequestId: string,
  ): Promise<ValidatedSessionSnapshot>;
  submitActionEvidence(
    sessionId: string,
    request: {
      evidence: { actionId: string; sourceStepId: string; kind: string; version: number; values: Record<string, string> };
      expectedRevision: number;
      clientRequestId: string;
    },
  ): Promise<ActionEvidenceResult>;
  submitWorkspaceCommand(
    sessionId: string,
    command: unknown,
    expectedRevision: number,
  ): Promise<ValidatedSessionSnapshot>;
  reportPresentationOutcome(
    sessionId: string,
    actionId: string,
    request: {
      sequenceId: string;
      ordinal: number;
      outcome: "presented" | "interrupted" | "failed";
      failureClass?: string;
      message?: string;
      clientRequestId: string;
      expectedRevision: number;
    },
  ): Promise<ValidatedSessionSnapshot>;
  transcribe(
    sessionId: string,
    request: {
      audio: { dataUrl: string; mimeType: string; durationMs?: number };
      clientRequestId: string;
    },
  ): Promise<AsrTranscription>;
}

export class HttpTutorRuntimeClient implements TutorRuntimeClient {
  /** 迁移期 HTTP namespace（spec §0 裁决 1）——只存在于本 adapter。 */
  private static readonly API_ROOT = "/api/vnext";

  private static parseSnapshot(payload: unknown): ValidatedSessionSnapshot {
    const result = parseSessionSnapshotHttp(payload);
    if (!result.ok) throw new ProtocolParseError(result.errors);
    return result.snapshot;
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(`${HttpTutorRuntimeClient.API_ROOT}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!response.ok) throw await readHttpError(response);
    return response.json();
  }

  private post(path: string, body: unknown): Promise<unknown> {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }

  async availability(taskId: string): Promise<TutorRuntimeAvailability> {
    const payload = await this.request(`/availability/${encodeURIComponent(taskId)}`);
    const body = payload as { task_id?: unknown; enabled?: unknown; profile?: unknown };
    if (typeof body.task_id !== "string" || typeof body.enabled !== "boolean" || typeof body.profile !== "string") {
      throw new ProtocolParseError(["availability: 响应缺 task_id/enabled/profile 或类型不符"]);
    }
    if (body.task_id !== taskId) {
      throw new ProtocolParseError([`availability: task_id 不匹配（请求 ${taskId}，响应 ${body.task_id}）`]);
    }
    if (body.enabled && body.profile !== TUTOR_RUNTIME_HTTP_PROFILE) {
      throw new ProtocolParseError([`availability: unknown profile ${body.profile}`]);
    }
    return { taskId: body.task_id, enabled: body.enabled, profile: body.profile };
  }

  async start(input: {
    taskId: string;
    studentId: string;
    assessment?: boolean;
    clientRequestId: string;
  }): Promise<ValidatedSessionSnapshot> {
    const body = buildBody(startRequestHttpV1Schema, {
      task_id: input.taskId,
      student_id: input.studentId,
      ...(input.assessment !== undefined ? { assessment: input.assessment } : {}),
      client_request_id: input.clientRequestId,
    });
    return HttpTutorRuntimeClient.parseSnapshot(await this.post("/tutor-sessions", body));
  }

  async restore(sessionId: string): Promise<ValidatedSessionSnapshot> {
    return HttpTutorRuntimeClient.parseSnapshot(await this.request(`/tutor-sessions/${encodeURIComponent(sessionId)}`));
  }

  async submitStudentInput(
    sessionId: string,
    input: StudentBrowserInput,
    expectedRevision: number,
    clientRequestId: string,
  ): Promise<ValidatedSessionSnapshot> {
    const body = buildBody(studentInputRequestHttpV1Schema, {
      input,
      client_request_id: clientRequestId,
      expected_revision: expectedRevision,
    });
    return HttpTutorRuntimeClient.parseSnapshot(
      await this.post(`/tutor-sessions/${encodeURIComponent(sessionId)}/student-inputs`, body),
    );
  }

  async submitActionEvidence(
    sessionId: string,
    request: {
      evidence: { actionId: string; sourceStepId: string; kind: string; version: number; values: Record<string, string> };
      expectedRevision: number;
      clientRequestId: string;
    },
  ): Promise<ActionEvidenceResult> {
    const body = buildBody(actionEvidenceRequestHttpV1Schema, {
      evidence: request.evidence,
      expected_revision: request.expectedRevision,
      client_request_id: request.clientRequestId,
    });
    const payload = await this.post(`/tutor-sessions/${encodeURIComponent(sessionId)}/action-evidence`, body);
    // snapshot 与 action_submission 分别过共享 schema（snapshot 同走一致性门禁）。
    const { action_submission: submissionPayload, ...snapshotPayload } = payload as Record<string, unknown> & { action_submission?: unknown };
    const snapshot = HttpTutorRuntimeClient.parseSnapshot(snapshotPayload);
    const submission = actionSubmissionHttpV1Schema.safeParse(submissionPayload);
    if (!submission.success) {
      throw new ProtocolParseError(submission.error.issues.map((issue) => `action_submission.${issue.path.join(".")}: ${issue.message}`));
    }
    return { snapshot, actionSubmission: submission.data };
  }

  async submitWorkspaceCommand(
    sessionId: string,
    command: unknown,
    expectedRevision: number,
  ): Promise<ValidatedSessionSnapshot> {
    // canonical student-workspace-command/v1 由共享 schema 全形状校验（含
    // session_id 与路径参数对账——服务端 parse 后强制，客户端同校）。
    const commandBody = (() => {
      const parsed = studentWorkspaceCommandV1Schema.safeParse(command);
      if (!parsed.success) {
        throw new TutorRuntimeRequestError(parsed.error.issues.map((issue) => `command.${issue.path.join(".")}: ${issue.message}`));
      }
      return parsed.data;
    })();
    if (commandBody.session_id !== sessionId) {
      throw new TutorRuntimeRequestError([`command.session_id ${commandBody.session_id} does not match path session ${sessionId}`]);
    }
    const body = buildBody(workspaceCommandRequestHttpV1Schema, {
      command: commandBody,
      expected_revision: expectedRevision,
    });
    return HttpTutorRuntimeClient.parseSnapshot(
      await this.post(`/tutor-sessions/${encodeURIComponent(sessionId)}/workspace-commands`, body),
    );
  }

  async reportPresentationOutcome(
    sessionId: string,
    actionId: string,
    request: {
      sequenceId: string;
      ordinal: number;
      outcome: "presented" | "interrupted" | "failed";
      failureClass?: string;
      message?: string;
      clientRequestId: string;
      expectedRevision: number;
    },
  ): Promise<ValidatedSessionSnapshot> {
    const body = buildBody(presentationOutcomeRequestHttpV1Schema, {
      sequence_id: request.sequenceId,
      ordinal: request.ordinal,
      outcome: request.outcome,
      ...(request.failureClass !== undefined ? { failure_class: request.failureClass } : {}),
      ...(request.message !== undefined ? { message: request.message } : {}),
      client_request_id: request.clientRequestId,
      expected_revision: request.expectedRevision,
    });
    return HttpTutorRuntimeClient.parseSnapshot(
      await this.post(
        `/tutor-sessions/${encodeURIComponent(sessionId)}/presentation-actions/${encodeURIComponent(actionId)}/outcomes`,
        body,
      ),
    );
  }

  async transcribe(
    sessionId: string,
    request: {
      audio: { dataUrl: string; mimeType: string; durationMs?: number };
      clientRequestId: string;
    },
  ): Promise<AsrTranscription> {
    const body = buildBody(asrRequestHttpV1Schema, {
      audio: {
        data_url: request.audio.dataUrl,
        mime_type: request.audio.mimeType,
        ...(request.audio.durationMs !== undefined ? { duration_ms: request.audio.durationMs } : {}),
      },
      client_request_id: request.clientRequestId,
    });
    const payload = await this.post(`/tutor-sessions/${encodeURIComponent(sessionId)}/asr`, body);
    const parsed = asrResponseHttpV1Schema.safeParse(payload);
    if (!parsed.success) {
      throw new ProtocolParseError(parsed.error.issues.map((issue) => `asr.${issue.path.join(".")}: ${issue.message}`));
    }
    return {
      sessionId: parsed.data.session_id,
      observedRevision: parsed.data.observed_revision,
      transcript: parsed.data.transcript,
      model: parsed.data.model,
      ...(parsed.data.language !== undefined ? { language: parsed.data.language } : {}),
    };
  }
}

/** LearnPage availability 探测用单例（port 实例注入 experience，spec §4.1 依赖方向）。 */
export const tutorRuntimeHttp = new HttpTutorRuntimeClient();
