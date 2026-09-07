/**
 * F7 Step 4 — 统一 HTTP application profile 路由（v7 生产组合链）。
 *
 * ```text
 * vnextTutorRoutes → TutorRuntimeApplicationV7 → TutorSessionOrchestratorV7
 *                                                 → TutorSessionKernelV7
 * ```
 *
 * - GET  /api/vnext/availability/:taskId                                可用性（无副作用）
 * - POST /api/vnext/tutor-sessions                                      创建 v7 会话（start 原子幂等）
 * - GET  /api/vnext/tutor-sessions/:sessionId                           恢复（verified rebuild 零模型调用）
 * - POST /api/vnext/tutor-sessions/:sessionId/student-inputs            utterance|control（后端解释 intent）
 * - POST /api/vnext/tutor-sessions/:sessionId/action-evidence           typed evidence → 判别式 ActionSubmission
 * - POST /api/vnext/tutor-sessions/:sessionId/workspace-commands        canonical 学生命令（F3 + evaluator/Gate）
 * - POST /api/vnext/tutor-sessions/:sessionId/presentation-actions/:actionId/outcomes  浏览器 outcome
 * - POST /api/vnext/tutor-sessions/:sessionId/asr                       只转写（零教学事实）
 *
 * 纪律（f7 spec §0-§2 / 复核 P0-3 冻结）：
 * - 所有成功端点返回同一 `f7-tutor-runtime-http/v1` SessionSnapshot（web/shared
 *   tutorHttpProfile——前后端共用真源；经 parseSessionSnapshotHttp + 一致性门禁
 *   fail closed 自证，本层零手拼线格式）；
 * - 新生产 start/restore 只服务 v7：v5/v6 会话行 → 409 SESSION_VERSION_UNSUPPORTED
 *   （V6 reader 保留给历史测试/诊断；V5 旧链 /api/tutor-sessions 不动，F8 退场）；
 * - 本层零教学语义：教学判断全在 Navigator/F3 evaluator；轮内显式失败
 *   （revision_conflict 等）是 committed 事实，随 turn.failure 透出（HTTP 200）；
 * - 错误保持稳定 error.code（spec §2.1 表）；4xx/5xx 不构造学生 correct/wrong。
 */
import { VisualLifecycleError } from "../../services/tutorSession/TutorRuntimeStateReducerV10";
import { TutorSessionEventStoreV9Error, TutorSessionIntegrityV9Error } from "../../services/tutorSession/TutorSessionEventV9";
import { Router } from "express";
import { z } from "zod";

import { vNextGateModel } from "../../services/tutorOrchestration/VNextGateModelFactory";
import {
  TutorRuntimeApplicationV7,
  TutorRuntimeApplicationV7Error,
} from "../../services/tutorOrchestration/TutorRuntimeApplicationV7";
import { OrchestratorV7Error } from "../../services/tutorOrchestration/TutorSessionOrchestratorV7";
import {
  TutorTaskBindingError,
} from "../../services/tutorOrchestration/TutorTaskBindingResolver";
import {
  TutorSessionEventStoreV7Error,
  TutorSessionIntegrityV7Error,
} from "../../services/tutorSession/TutorSessionEventV7";
import { projectHttpSnapshotV1, V7RenderProjectionError } from "../../services/tutorOrchestration/V7HttpSnapshotProjector";
import { createPresenterGenerator } from "../../services/tutorOrchestration/presentationGeneration/GeneratorPort";
import { transcribeForTutor, SpeechProviderError } from "../../services/tutorSession/asrService";
import {
  actionEvidenceRequestHttpV1Schema,
  asrRequestHttpV1Schema,
  availabilityResponseHttpV1Schema,
  errorEnvelopeHttpV1Schema,
  parseActionEvidenceResponseHttp,
  presentationOutcomeRequestHttpV1Schema,
  startRequestHttpV1Schema,
  studentInputRequestHttpV1Schema,
  TUTOR_RUNTIME_HTTP_PROFILE,
  workspaceCommandRequestHttpV1Schema,
} from "../../../../shared/tutorHttpProfile";

const sessionIdParam = z.string().regex(/^TS-[0-9]{4,}$/);
const taskIdParam = z.string().min(1).max(64);
const actionIdParam = z.string().min(1).max(128);

/** OrchestratorError.code → HTTP 状态（错误码原样透出；spec §2.1 表）。 */
const ERROR_STATUS: Record<string, number> = {
  ASSESSMENT_INTENT_FORBIDDEN: 403,
  WORKSPACE_COMMAND_PAYLOAD_DRIFT: 409,
  REQUEST_PAYLOAD_DRIFT: 409,
  WORKSPACE_COMMAND_UNRESOLVABLE: 404,
  WORKSPACE_COMMAND_REQUIRED: 400,
  NO_ACTIVE_ACTION: 400,
  MODEL_PIN_MISMATCH: 409,
  PLAN_IMPORT_FAILED: 503,
  NO_EXECUTABLE_DECISION: 409,
  PRESENTATION_CURSOR_MISMATCH: 409,
  PRESENTATION_FAILED_PENDING_RECOVERY: 409,
  PRESENTATION_AWAITING_BROWSER: 409,
  WORKSPACE_APPLY_REJECTED: 409,
  RETRY_RECOVERY_WITHOUT_FAILURE: 409,
  SESSION_VERSION_UNSUPPORTED: 409,
};

function canonicalRoot(): string {
  const root = process.env.TUTOR_VNEXT_ROOT?.trim();
  if (!root) throw new OrchestratorV7Error("PLAN_IMPORT_FAILED", "TUTOR_VNEXT_ROOT is not configured (vnext routes must not mount)");
  return root;
}

/** vNext 任务 allowlist（F7 = 唯一 golden task；F8 扩展为 supported+approved+enabled 路由）。 */
function vNextTaskIds(): string[] {
  return (process.env.TUTOR_VNEXT_TASKS?.trim() || "goldenMinhangFold2020")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createApplication(): TutorRuntimeApplicationV7 {
  // F7 RT4：TUTOR_VNEXT_GENERATION=1 显式启用 v9 生成会话（presenter 端口注入；
  // 模型键缺失时端口构造成功、调用时如实 provider_failure——不以 stub 冒充）。
  // 缺省 off ⇒ v7 既有链零变化；snapshot 线格式本轮不变（generation 字段组合
  // 属 P3 与 A decoder 同一版本原子上线——S1 §1 边界）。
  const presenter = process.env.TUTOR_VNEXT_GENERATION === "1" ? createPresenterGenerator() : undefined;
  return TutorRuntimeApplicationV7.create({
    canonicalRoot: canonicalRoot(),
    model: vNextGateModel(),
    ...(presenter !== undefined ? { presenter } : {}),
  });
}

/**
 * F7 P3（A5 pending 轮询）：mutation 预约生成后**立即回包**（快照透出
 * generation=pending——含 waiting_retry 的 phase/attempt/retry_at 与 active scope），
 * 不再阻塞驱动模型至终态；驱动交由后台 recovery worker（预约通知 wake 即时接管，
 * 新建 pending 与崩溃恢复同一认领路径；CAS/epoch 规则不变——coordinator 唯一
 * 裁决，模型调用仍在 DB 事务外）。v7 会话 hasPendingGeneration 恒 false ⇒
 * 通知零触发（缺省链行为零变化）。
 */
function notifyPendingGeneration(
  orchestrator: import("../../services/tutorOrchestration/TutorSessionOrchestratorV7").TutorSessionOrchestratorV7,
  wake: (() => void) | undefined,
): void {
  if (orchestrator.hasPendingGeneration()) wake?.();
}

function toHttpError(error: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): void {
  /** 错误 envelope 过共享 schema 自证（稳定 error.code 线格式；Step 4.1）。 */
  const emit = (status: number, code: string, message: string): void => {
    res.status(status).json(errorEnvelopeHttpV1Schema.parse({ error: { code, message } }));
  };
  if (error instanceof z.ZodError) {
    emit(400, "BAD_REQUEST", error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    return;
  }
  if (error instanceof VisualLifecycleError || error instanceof TutorSessionEventStoreV9Error || error instanceof TutorSessionIntegrityV9Error) {
    emit(error.code === "SESSION_NOT_FOUND" ? 404 : 409,error.code,error.message); return;
  }
  if (error instanceof TutorRuntimeApplicationV7Error) {
    emit(400, "BAD_REQUEST", error.message);
    return;
  }
  if (error instanceof TutorSessionEventStoreV7Error) {
    if (error.code === "SESSION_NOT_FOUND") {
      emit(404, "SESSION_NOT_FOUND", error.message);
      return;
    }
    // 用户输入在 append 边界被 canonical 校验拒绝（如夹带未知字段）→ 400。
    if (error.code === "VALIDATION_FAILED") {
      emit(400, "BAD_REQUEST", error.message);
      return;
    }
    emit(error.code === "SESSION_VERSION_UNSUPPORTED" ? 409 : 500, error.code, error.message);
    return;
  }
  if (error instanceof TutorSessionIntegrityV7Error) {
    if (error.code === "SESSION_NOT_FOUND") {
      emit(404, "SESSION_NOT_FOUND", error.message);
      return;
    }
    // verified rebuild 家族（v5/v6 行版本不支持 / gap / corrupt / revision / hash）
    // → 409（spec §2.4 restore 409 集；REPLAY_MISMATCH 语义）。
    emit(409, error.code === "SESSION_VERSION_UNSUPPORTED" ? "SESSION_VERSION_UNSUPPORTED" : "REPLAY_MISMATCH", error.message);
    return;
  }
  if (error instanceof TutorTaskBindingError) {
    const status = error.code === "UNKNOWN_TASK" ? 404 : error.code === "PLAN_IMPORT_FAILED" ? 503 : 409;
    emit(status, error.code, error.message);
    return;
  }
  if (error instanceof OrchestratorV7Error) {
    const status = error.code === "PLAN_IMPORT_FAILED" && error.message.includes("no committed stream")
      ? 404
      : ERROR_STATUS[error.code] ?? 500;
    emit(status, status === 404 ? "SESSION_NOT_FOUND" : error.code, error.message);
    return;
  }
  if (error instanceof V7RenderProjectionError) {
    // render 合成/一致性门禁失败 = 系统完整性失败——不产出「看似正常」snapshot。
    emit(503, "RUNTIME_INTEGRITY_FAILURE", error.message);
    return;
  }
  emit(500, "INTERNAL_ERROR", error instanceof Error ? error.message : String(error));
}

/** ASR 音频上限（data_url 字符数；F7 one-golden 显式配置，spec §2.1）。 */
const ASR_MAX_DATA_URL_CHARS = Number(process.env.TUTOR_VNEXT_ASR_MAX_BYTES ?? 6_000_000);
const ASR_ALLOWED_MIME = new Set(["audio/wav", "audio/webm", "audio/mpeg", "audio/mp4", "audio/ogg"]);

export interface VNextTutorRoutesOptions {
  /** Local review server injects its composition; no request can select an importer. */
  applicationFactory?: () => TutorRuntimeApplicationV7;
  /** 测试注入 ASR transcriber（生产 = tutorSession/asrService，ADR-005 层边界）。 */
  transcriber?: (input: { dataUrl: string; durationMs?: number }) => Promise<{ transcript: string; model: string }>;
  /**
   * F7 P3（A5 pending 轮询）：v9 mutation 预约生成后的后台驱动通知（fire-and-forget
   * wake——GenerationRecoveryWorker 即时扫描接管；认领 CAS/epoch 规则不变）。缺省
   * 未接线时仅剩 worker 周期扫描兜底；GET/restore 永不通知（只读零模型调用）。
   */
  generationWake?: () => void;
}

export function createVNextTutorRoutes(options: VNextTutorRoutesOptions = {}): Router {
  const router = Router();
  const applicationFactory = options.applicationFactory ?? createApplication;
  const transcribe = options.transcriber ?? transcribeForTutor;
  const generationWake = options.generationWake;

  router.get("/availability/:taskId", (req, res) => {
    const parsed = taskIdParam.safeParse(req.params.taskId);
    if (!parsed.success) {
      res.status(400).json(errorEnvelopeHttpV1Schema.parse({ error: { code: "BAD_REQUEST", message: "invalid taskId" } }));
      return;
    }
    const enabled = Boolean(process.env.TUTOR_VNEXT_ROOT?.trim()) && vNextTaskIds().includes(parsed.data);
    res.json(availabilityResponseHttpV1Schema.parse({ task_id: parsed.data, enabled, profile: TUTOR_RUNTIME_HTTP_PROFILE }));
  });

  router.post("/tutor-sessions", async (req, res) => {
    try {
      const body = startRequestHttpV1Schema.parse(req.body);
      const application = applicationFactory();
      const outcome = application.start({
        task_id: body.task_id,
        student_id: body.student_id,
        ...(body.client_instance_id?{client_instance_id:body.client_instance_id}:{}),
        ...(body.assessment !== undefined ? { assessment: body.assessment } : {}),
        client_request_id: body.client_request_id,
      });
      if (outcome.kind === "payload-drift") {
        res.status(409).json(errorEnvelopeHttpV1Schema.parse({
          error: {
            code: "REQUEST_PAYLOAD_DRIFT",
            message: `client_request_id=${outcome.clientRequestId} payload drifts from the committed start (committed hash ${outcome.committedPayloadHash}); explicit refusal, zero facts`,
          },
        }));
        return;
      }
      notifyPendingGeneration(outcome.orchestrator, generationWake);
      const snapshot = projectHttpSnapshotV1({ orchestrator: outcome.orchestrator });
      res.status(outcome.kind === "created" ? 201 : 200).json(snapshot);
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.get("/tutor-sessions/:sessionId", (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const orchestrator = applicationFactory().restore(sessionId);
      res.json(projectHttpSnapshotV1({ orchestrator }));
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.post("/tutor-sessions/:sessionId/student-inputs", async (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = studentInputRequestHttpV1Schema.parse(req.body);
      const application = applicationFactory();
      const orchestrator = application.restore(sessionId);
      const result = await application.submitStudentInput(orchestrator, {
        input: body.input,
        execution_owner:body.execution_owner,
        client_request_id: body.client_request_id,
      }, { expectedRevision: body.expected_revision });
      notifyPendingGeneration(orchestrator, generationWake);
      res.json(projectHttpSnapshotV1({ orchestrator, turn: result.turn, turnSource: "input" }));
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.post("/tutor-sessions/:sessionId/action-evidence", async (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = actionEvidenceRequestHttpV1Schema.parse(req.body);
      const application = applicationFactory();
      const orchestrator = application.restore(sessionId);
      const submission = application.submitActionEvidence(orchestrator, body.evidence, {
        expectedRevision: body.expected_revision,
        execution_owner:body.execution_owner,
        client_request_id: body.client_request_id,
      });
      // 组合响应（snapshot + action_submission）经共享组合 parser + 一致性门禁
      // 自证后发出（Step 4.1：前后端同一入口，路由零手拼）。
      const response = parseActionEvidenceResponseHttp({
        ...projectHttpSnapshotV1({ orchestrator, turn: submission.turn, turnSource: "command" }),
        action_submission: "evaluation" in submission
          ? { revision: submission.revision, status: submission.status, evaluation: submission.evaluation }
          : { revision: submission.revision, status: submission.status, failure: submission.failure },
      });
      notifyPendingGeneration(orchestrator, generationWake);
      if (!response.ok) {
        res.status(500).json(errorEnvelopeHttpV1Schema.parse({ error: { code: "INTERNAL_ERROR", message: response.errors.join("; ") } }));
        return;
      }
      res.json({ ...response.snapshot, action_submission: response.submission });
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.post("/tutor-sessions/:sessionId/workspace-commands", async (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      // 共享 request schema（canonical student-workspace-command/v1 全形状——
      // 含 input_evidence_sequence；session_id 与路径参数的对账在 parse 后强制）。
      const body = workspaceCommandRequestHttpV1Schema.parse(req.body);
      if (body.command.session_id !== sessionId) {
        res.status(400).json(errorEnvelopeHttpV1Schema.parse({ error: { code: "BAD_REQUEST", message: `command.session_id ${body.command.session_id} does not match the path session ${sessionId}` } }));
        return;
      }
      const command = body.command;
      const application = applicationFactory();
      const orchestrator = application.restore(sessionId);
      const result = application.submitWorkspaceCommand(orchestrator, command, {
        expectedRevision: body.expected_revision,
        execution_owner:body.execution_owner,
      });
      notifyPendingGeneration(orchestrator, generationWake);
      res.json(projectHttpSnapshotV1({ orchestrator, turn: result.turn, turnSource: "command" }));
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.post("/tutor-sessions/:sessionId/presentation-actions/:actionId/outcomes", (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const actionId = actionIdParam.parse(req.params.actionId);
      const body = presentationOutcomeRequestHttpV1Schema.parse(req.body);
      const application = applicationFactory();
      const orchestrator = application.restore(sessionId);
      const result = application.reportPresentationOutcome(orchestrator, {
        execution_owner:body.execution_owner,
        hold_for_control:body.hold_for_control,
        sequence_id: body.sequence_id,
        ordinal: body.ordinal,
        action_id: actionId,
        outcome: body.outcome,
        ...(body.failure_class !== undefined ? { failure_class: body.failure_class } : {}),
        ...(body.message !== undefined ? { message: body.message } : {}),
        expected_revision: body.expected_revision,
        client_request_id: body.client_request_id,
      });
      res.json(projectHttpSnapshotV1({ orchestrator, serviceSnapshot:result.snapshot }));
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.post("/tutor-sessions/:sessionId/asr", async (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = asrRequestHttpV1Schema.parse(req.body);
      if (!ASR_ALLOWED_MIME.has(body.audio.mime_type)) {
        res.status(415).json(errorEnvelopeHttpV1Schema.parse({ error: { code: "AUDIO_FORMAT_UNSUPPORTED", message: `mime_type ${body.audio.mime_type} is not supported` } }));
        return;
      }
      if (body.audio.data_url.length > ASR_MAX_DATA_URL_CHARS) {
        res.status(413).json(errorEnvelopeHttpV1Schema.parse({ error: { code: "AUDIO_TOO_LARGE", message: `audio data_url exceeds the configured cap (${ASR_MAX_DATA_URL_CHARS} chars)` } }));
        return;
      }
      // observe-only：restore 零模型调用取 observed_revision；ASR 只转写，零教学事实。
      const application = applicationFactory();
      const orchestrator = application.restore(sessionId);
      orchestrator.assertVisualWrite(body.execution_owner);
      const transcript = await transcribe({
        dataUrl: body.audio.data_url,
        ...(body.audio.duration_ms !== undefined ? { durationMs: body.audio.duration_ms } : {}),
      });
      // A takeover while ASR is running fences its eventual response too.
      const current=application.restore(sessionId);
      current.assertVisualWrite(body.execution_owner);
      if (!transcript.transcript.trim()) {
        res.status(422).json(errorEnvelopeHttpV1Schema.parse({ error: { code: "EMPTY_TRANSCRIPT", message: "transcription returned an empty transcript" } }));
        return;
      }
      res.json({
        session_id: sessionId,
        observed_revision: current.revision,
        ...(current.visualLifecycle?{execution_owner:current.visualLifecycle.presentation_execution_owner}:{}),
        transcript: transcript.transcript,
        model: transcript.model,
      });
    } catch (error) {
      if (error instanceof SpeechProviderError) {
        res.status(503).json(errorEnvelopeHttpV1Schema.parse({ error: { code: "ASR_UNAVAILABLE", message: (error as Error).message } }));
        return;
      }
      toHttpError(error, res);
    }
  });

  return router;
}
