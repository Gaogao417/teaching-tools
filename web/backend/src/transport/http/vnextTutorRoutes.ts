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
import { transcribeForTutor, SpeechProviderError } from "../../services/tutorSession/asrService";
import {
  actionSubmissionHttpV1Schema,
  asrRequestHttpV1Schema,
  TUTOR_RUNTIME_HTTP_PROFILE,
} from "../../../../shared/tutorHttpProfile";

const sessionIdParam = z.string().regex(/^TS-[0-9]{4,}$/);
const taskIdParam = z.string().min(1).max(64);
const actionIdParam = z.string().min(1).max(128);

/** OrchestratorError.code → HTTP 状态（错误码原样透出；spec §2.1 表）。 */
const ERROR_STATUS: Record<string, number> = {
  ASSESSMENT_INTENT_FORBIDDEN: 403,
  WORKSPACE_COMMAND_PAYLOAD_DRIFT: 409,
  WORKSPACE_COMMAND_UNRESOLVABLE: 404,
  WORKSPACE_COMMAND_REQUIRED: 400,
  NO_ACTIVE_ACTION: 400,
  MODEL_PIN_MISMATCH: 409,
  PLAN_IMPORT_FAILED: 503,
  NO_EXECUTABLE_DECISION: 409,
  PRESENTATION_CURSOR_MISMATCH: 409,
  PRESENTATION_FAILED_PENDING_RECOVERY: 409,
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

function createApplication(): TutorRuntimeApplicationV7 {
  return TutorRuntimeApplicationV7.create({ canonicalRoot: canonicalRoot(), model: vNextGateModel() });
}

function toHttpError(error: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") } });
    return;
  }
  if (error instanceof TutorRuntimeApplicationV7Error) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: error.message } });
    return;
  }
  if (error instanceof TutorSessionEventStoreV7Error) {
    if (error.code === "SESSION_NOT_FOUND") {
      res.status(404).json({ error: { code: "SESSION_NOT_FOUND", message: error.message } });
      return;
    }
    // 用户输入在 append 边界被 canonical 校验拒绝（如夹带未知字段）→ 400。
    if (error.code === "VALIDATION_FAILED") {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: error.message } });
      return;
    }
    res.status(error.code === "SESSION_VERSION_UNSUPPORTED" ? 409 : 500).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof TutorSessionIntegrityV7Error) {
    if (error.code === "SESSION_NOT_FOUND") {
      res.status(404).json({ error: { code: "SESSION_NOT_FOUND", message: error.message } });
      return;
    }
    // verified rebuild 家族（v5/v6 行版本不支持 / gap / corrupt / revision / hash）
    // → 409（spec §2.4 restore 409 集；REPLAY_MISMATCH 语义）。
    res.status(409).json({
      error: {
        code: error.code === "SESSION_VERSION_UNSUPPORTED" ? "SESSION_VERSION_UNSUPPORTED" : "REPLAY_MISMATCH",
        message: error.message,
      },
    });
    return;
  }
  if (error instanceof TutorTaskBindingError) {
    const status = error.code === "UNKNOWN_TASK" ? 404 : error.code === "PLAN_IMPORT_FAILED" ? 503 : 409;
    res.status(status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof OrchestratorV7Error) {
    const status = error.code === "PLAN_IMPORT_FAILED" && error.message.includes("no committed stream")
      ? 404
      : ERROR_STATUS[error.code] ?? 500;
    res.status(status).json({ error: { code: status === 404 ? "SESSION_NOT_FOUND" : error.code, message: error.message } });
    return;
  }
  if (error instanceof V7RenderProjectionError) {
    // render 合成/一致性门禁失败 = 系统完整性失败——不产出「看似正常」snapshot。
    res.status(503).json({ error: { code: "RUNTIME_INTEGRITY_FAILURE", message: error.message } });
    return;
  }
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) } });
}

/** ASR 音频上限（data_url 字符数；F7 one-golden 显式配置，spec §2.1）。 */
const ASR_MAX_DATA_URL_CHARS = Number(process.env.TUTOR_VNEXT_ASR_MAX_BYTES ?? 6_000_000);
const ASR_ALLOWED_MIME = new Set(["audio/wav", "audio/webm", "audio/mpeg", "audio/mp4", "audio/ogg"]);

export interface VNextTutorRoutesOptions {
  /** 测试注入 ASR transcriber（生产 = tutorSession/asrService，ADR-005 层边界）。 */
  transcriber?: (input: { dataUrl: string; durationMs?: number }) => Promise<{ transcript: string; model: string }>;
}

export function createVNextTutorRoutes(options: VNextTutorRoutesOptions = {}): Router {
  const router = Router();
  const transcribe = options.transcriber ?? transcribeForTutor;

  router.get("/availability/:taskId", (req, res) => {
    const parsed = taskIdParam.safeParse(req.params.taskId);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "invalid taskId" } });
      return;
    }
    const enabled = Boolean(process.env.TUTOR_VNEXT_ROOT?.trim()) && vNextTaskIds().includes(parsed.data);
    res.json({ task_id: parsed.data, enabled, profile: TUTOR_RUNTIME_HTTP_PROFILE });
  });

  router.post("/tutor-sessions", (req, res) => {
    try {
      const application = createApplication();
      const outcome = application.start({
        task_id: z.string().min(1).max(64).parse(req.body?.task_id),
        student_id: z.string().trim().min(1).max(64).parse(req.body?.student_id),
        assessment: z.boolean().optional().parse(req.body?.assessment),
        client_request_id: z.string().regex(/^[A-Za-z0-9._:-]{4,128}$/).parse(req.body?.client_request_id),
      });
      if (outcome.kind === "payload-drift") {
        res.status(409).json({
          error: {
            code: "REQUEST_PAYLOAD_DRIFT",
            message: `client_request_id=${outcome.clientRequestId} payload drifts from the committed start (committed hash ${outcome.committedPayloadHash}); explicit refusal, zero facts`,
          },
        });
        return;
      }
      const snapshot = projectHttpSnapshotV1({ orchestrator: outcome.orchestrator });
      res.status(outcome.kind === "created" ? 201 : 200).json(snapshot);
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.get("/tutor-sessions/:sessionId", (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const orchestrator = createApplication().restore(sessionId);
      res.json(projectHttpSnapshotV1({ orchestrator }));
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.post("/tutor-sessions/:sessionId/student-inputs", async (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = z
        .object({
          input: z.object({ kind: z.enum(["utterance", "control"]) }).passthrough(),
          client_request_id: z.string().regex(/^[A-Za-z0-9._:-]{4,128}$/),
          expected_revision: z.number().int().min(0),
        })
        .parse(req.body);
      const application = createApplication();
      const orchestrator = application.restore(sessionId);
      // 只透传 canonical input 联合的已知字段（HTTP 面白名单——夹带未知字段 400）。
      const input = z
        .object({
          kind: z.enum(["utterance", "control"]),
          channel: z.enum(["mainline", "assistance"]).optional(),
          text: z.string().min(1).optional(),
          command: z
            .enum(["confirm", "continue", "request_scaffold", "request_rephrase", "barge_in", "return_to_mainline", "retry_recovery"])
            .optional(),
        })
        .strict()
        .superRefine((value, ctx) => {
          if (value.kind === "utterance" && (value.channel === undefined || value.text === undefined)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "kind=utterance requires channel and text" });
          }
          if (value.kind === "control" && value.command === undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "kind=control requires command" });
          }
        })
        .parse(body.input);
      const result = await application.submitStudentInput(orchestrator, {
        input,
        client_request_id: body.client_request_id,
      }, { expectedRevision: body.expected_revision });
      res.json(projectHttpSnapshotV1({ orchestrator, turn: result.turn, turnSource: "input" }));
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.post("/tutor-sessions/:sessionId/action-evidence", (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = z
        .object({
          evidence: z
            .object({
              actionId: z.string().min(1),
              sourceStepId: z.string().min(1),
              kind: z.string().min(1),
              version: z.literal(1),
              values: z.record(z.string(), z.string()),
            })
            .strict(),
          expected_revision: z.number().int().min(0),
          client_request_id: z.string().regex(/^[A-Za-z0-9._:-]{4,128}$/),
        })
        .parse(req.body);
      const application = createApplication();
      const orchestrator = application.restore(sessionId);
      const submission = application.submitActionEvidence(orchestrator, body.evidence, {
        expectedRevision: body.expected_revision,
        client_request_id: body.client_request_id,
      });
      const snapshot = projectHttpSnapshotV1({ orchestrator, turn: submission.turn, turnSource: "command" });
      const actionSubmission = actionSubmissionHttpV1Schema.parse(
        "evaluation" in submission
          ? { revision: submission.revision, status: submission.status, evaluation: submission.evaluation }
          : { revision: submission.revision, status: submission.status, failure: submission.failure },
      );
      res.json({ ...snapshot, action_submission: actionSubmission });
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.post("/tutor-sessions/:sessionId/workspace-commands", (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = z
        .object({
          command: z.object({ session_id: z.literal(sessionId) }).passthrough(),
          expected_revision: z.number().int().min(0),
        })
        .parse(req.body);
      const command = z
        .object({
          schema: z.literal("ai_teaching_student_workspace_command/v1"),
          session_id: z.string().regex(/^TS-[0-9]{4,}$/),
          command_id: z.string().regex(/^SC-[A-Za-z0-9._:-]{4,}$/),
          surface: z.enum(["geometry", "solution_board"]),
          capability: z.string().min(1).max(128),
          origin: z.literal("student"),
          target_ids: z.array(z.string().min(1).max(64)).min(1).max(32),
          expected_workspace_revision: z.number().int().min(0),
          client_command_id: z.string().regex(/^[A-Za-z0-9._:-]{4,128}$/),
          params: z.record(z.string(), z.unknown()).optional(),
        })
        .strict()
        .parse(body.command);
      const application = createApplication();
      const orchestrator = application.restore(sessionId);
      const result = application.submitWorkspaceCommand(
        orchestrator,
        { ...command, session_id: sessionId },
        { expectedRevision: body.expected_revision },
      );
      res.json(projectHttpSnapshotV1({ orchestrator, turn: result.turn, turnSource: "command" }));
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.post("/tutor-sessions/:sessionId/presentation-actions/:actionId/outcomes", (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const actionId = actionIdParam.parse(req.params.actionId);
      const body = z
        .object({
          sequence_id: z.string().regex(/^PS-[0-9]{4,}$/),
          ordinal: z.number().int().min(0),
          outcome: z.enum(["presented", "interrupted", "failed"]),
          failure_class: z.string().min(1).optional(),
          message: z.string().optional(),
          client_request_id: z.string().regex(/^[A-Za-z0-9._:-]{4,128}$/),
          expected_revision: z.number().int().min(0),
        })
        .parse(req.body);
      const application = createApplication();
      const orchestrator = application.restore(sessionId);
      application.reportPresentationOutcome(orchestrator, {
        sequence_id: body.sequence_id,
        ordinal: body.ordinal,
        action_id: actionId,
        outcome: body.outcome,
        ...(body.failure_class !== undefined ? { failure_class: body.failure_class } : {}),
        ...(body.message !== undefined ? { message: body.message } : {}),
        expected_revision: body.expected_revision,
        client_request_id: body.client_request_id,
      });
      res.json(projectHttpSnapshotV1({ orchestrator }));
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.post("/tutor-sessions/:sessionId/asr", async (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = asrRequestHttpV1Schema.parse(req.body);
      if (!ASR_ALLOWED_MIME.has(body.audio.mime_type)) {
        res.status(415).json({ error: { code: "AUDIO_FORMAT_UNSUPPORTED", message: `mime_type ${body.audio.mime_type} is not supported` } });
        return;
      }
      if (body.audio.data_url.length > ASR_MAX_DATA_URL_CHARS) {
        res.status(413).json({ error: { code: "AUDIO_TOO_LARGE", message: `audio data_url exceeds the configured cap (${ASR_MAX_DATA_URL_CHARS} chars)` } });
        return;
      }
      // observe-only：restore 零模型调用取 observed_revision；ASR 只转写，零教学事实。
      const application = createApplication();
      const orchestrator = application.restore(sessionId);
      const transcript = await transcribe({
        dataUrl: body.audio.data_url,
        ...(body.audio.duration_ms !== undefined ? { durationMs: body.audio.duration_ms } : {}),
      });
      if (!transcript.transcript.trim()) {
        res.status(422).json({ error: { code: "EMPTY_TRANSCRIPT", message: "transcription returned an empty transcript" } });
        return;
      }
      res.json({
        session_id: sessionId,
        observed_revision: orchestrator.revision,
        transcript: transcript.transcript,
        model: transcript.model,
      });
    } catch (error) {
      if (error instanceof SpeechProviderError) {
        res.status(503).json({ error: { code: "ASR_UNAVAILABLE", message: (error as Error).message } });
        return;
      }
      toHttpError(error, res);
    }
  });

  return router;
}
