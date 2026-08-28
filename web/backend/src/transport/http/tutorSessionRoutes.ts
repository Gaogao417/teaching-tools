/**
 * Tutor session HTTP 合同（Phase 5 remediation / 完整收口计划 §2.5；
 * Phase 5 UI 集成波次 C：公开 tpId 直启下线）。
 *
 * - GET  /api/tutor-sessions/:sessionId          恢复学生安全视图 + pending actions + revision
 * - POST /api/tutor-sessions/:sessionId/turns    clientTurnId + expectedRevision + 六类输入
 * - POST /api/tutor-sessions/:sessionId/voice-completions
 * - POST /api/tutor-sessions/:sessionId/complete
 * - POST /api/tutor-sessions/:sessionId/asr
 *
 * 会话创建统一走 POST /api/learn/:taskId/experience（Approved Binding，
 * learnExperienceRoutes）；公开 POST /api/tutor-sessions {tpId} 已随隔离
 * 演示页下线。Coordinator 的 golden-whitelist 访问面与
 * STATEFUL_TUTOR_POLICY_GOLDEN_PLANS 保留（benchmark/runner 内部使用）。
 *
 * TutorTurnResponse 只含学生安全面（revision/mode/checkpoint+route/alignment/
 * decision/Voice+Workspace actions/fallback/event cursor）；答案真值与模型
 * 私有推理绝不出现在任何响应（结构性由 coordinator 类型保证）。
 * Assessment / 非 golden plan 拒绝（coordinator fail closed）。
 */
import { Router } from "express";
import { z } from "zod";


import { SpeechProviderError, transcribeForTutor } from "../../services/tutorSession/asrService";
import {
  createDefaultTutorSessionCoordinator,
  TutorSessionCoordinatorError,
  type ProcessTurnInput,
  type TutorSessionCoordinator,
} from "../../services/tutorSession/TutorSession";

const sessionIdParam = z.string().regex(/^TS-[0-9]{4,}$/);
const inputKindEnum = z.enum([
  "reasoning_utterance",
  "question_asked",
  "pointing_evidence",
  "structured_action_evidence",
  "silence_observed",
  "student_interrupted",
]);

const actionEvidenceSchema = z
  .object({
    actionId: z.string().min(1),
    sourceStepId: z.string().min(1),
    kind: z.string().min(1),
    version: z.number().int().min(1),
    value: z.string().optional(),
    targetId: z.string().optional(),
  })
  .passthrough();

const turnSchema = z.object({
  clientTurnId: z.string().regex(/^[A-Za-z0-9._:-]{4,128}$/),
  expectedRevision: z.number().int().min(0),
  input: z
    .object({
      input_kind: inputKindEnum,
      text: z.string().max(2000).optional(),
      object_id: z.string().max(128).optional(),
      duration_ms: z.number().int().min(0).optional(),
      action_evidence: actionEvidenceSchema.optional(),
    })
    .strict(),
  correlationId: z.string().max(128).optional(),
});

const voiceCompletionSchema = z.object({
  action_id: z.string().min(1),
  outcome: z.enum(["completed", "interrupted", "rejected", "failed"]),
  failure_class: z.string().max(128).optional(),
  message: z.string().max(500).optional(),
  correlationId: z.string().max(128).optional(),
});

const completeSchema = z.object({
  reason: z.string().max(128).optional(),
});

const asrSchema = z.object({
  audio: z.object({
    dataUrl: z.string().regex(/^data:audio\/[a-z0-9.+-]+(?:;codecs=[^;,]+)?;base64,[a-z0-9+/=]+$/i),
    durationMs: z.number().int().min(0).max(60_000).optional(),
  }),
  correlationId: z.string().max(128).optional(),
});

function coordinatorErrorStatus(code: string): number {
  if (code === "SESSION_NOT_FOUND") return 404;
  if (code === "REVISION_CONFLICT" || code === "NO_ACTIVE_ACTION") return 409;
  if (code === "ASSESSMENT_FAIL_CLOSED" || code === "FEATURE_FLAG_OFF" || code === "PLAN_NOT_APPROVED") return 403;
  if (code === "INVALID_INPUT" || code === "LEGACY_SESSION") return 400;
  return 500;
}

function fail(res: import("express").Response, error: unknown): void {
  if (error instanceof TutorSessionCoordinatorError) {
    res.status(coordinatorErrorStatus(error.code)).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }
  throw error;
}

/** 开场回合响应体（POST /tutor-sessions 与 /learn/:taskId/experience 共用的学生安全面）。 */
export function tutorOpeningBody(
  coordinator: TutorSessionCoordinator,
  sessionId: string,
  turn: Awaited<ReturnType<TutorSessionCoordinator["driveTutorTurn"]>>,
): Record<string, unknown> {
  const view = coordinator.getSessionView(sessionId);
  return {
    session_id: sessionId,
    revision: view.revision,
    client_turn_id: "system.open",
    idempotent_replay: false,
    mode: view.mode,
    current_checkpoint: view.current_checkpoint,
    decision: turn.decision
      ? {
          decision_id: turn.decision.decision_id,
          move_type: turn.decision.move_type,
          purpose_code: turn.decision.purpose_code,
          policy_version: turn.decision.policy_version,
          ...(turn.decision.fallback ? { fallback: true } : {}),
        }
      : null,
    voice: turn.presentation.voice.map((voice) => ({
      action_id: voice.action_id,
      text: voice.text,
      interruptible: voice.interruptible,
    })),
    workspace: turn.presentation.workspace,
    // VS1：开场（session start）与 turn/recovery 同一 View（REQ-02）；直取
    // session view 的投影——与刷新路径同源同 revision。
    workspace_view: view.workspace_view,
    question_completed: view.question_completed ?? false,
    event_cursor: view.event_cursor,
  };
}

export interface TutorSessionRoutesOptions {
  /** canonical authoring 根目录（默认 env TUTOR_CANONICAL_ROOT）。 */
  canonicalRoot?: string;
  /** 测试注入 coordinator；提供时忽略 canonicalRoot。 */
  coordinator?: TutorSessionCoordinator;
  /** 测试注入 ASR 转写器（默认 coach 侧 Qwen ASR 链路）。 */
  transcriber?: (input: { dataUrl: string; durationMs?: number }) => Promise<{ transcript: string; model: string }>;
}

export function createTutorSessionRoutes(options: TutorSessionRoutesOptions = {}): Router {
  const router = Router();
  const coordinator =
    options.coordinator ??
    createDefaultTutorSessionCoordinator({
      canonicalRoot: options.canonicalRoot ?? process.env.TUTOR_CANONICAL_ROOT ?? "",
    }).coordinator;

  const correlationOf = (headerValue: unknown, fallback: string): string => {
    return (typeof headerValue === "string" && headerValue.trim() ? headerValue.trim() : fallback).slice(0, 128);
  };

  router.get("/:sessionId", (req, res, next) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      res.json(coordinator.getSessionView(sessionId));
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(error);
        return;
      }
      try {
        fail(res, error);
      } catch (unwrapped) {
        next(unwrapped);
      }
    }
  });

  router.post("/:sessionId/turns", async (req, res, next) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = turnSchema.parse(req.body);
      const { action_evidence, ...restInput } = body.input;
      const response = await coordinator.processTurn(
        sessionId,
        body.expectedRevision,
        body.clientTurnId,
        {
          ...restInput,
          // 深层 typed 校验由 evaluateWorkspaceEvidence 执行（fail closed）；
          // 路由层只保证形状可送入 evaluator。
          ...(action_evidence ? { action_evidence: action_evidence as ProcessTurnInput["action_evidence"] } : {}),
        },
        correlationOf(req.headers["x-correlation-id"], body.correlationId ?? `corr-${sessionId}-${body.clientTurnId}`),
      );
      res.json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(error);
        return;
      }
      try {
        fail(res, error);
      } catch (unwrapped) {
        next(unwrapped);
      }
    }
  });

  router.post("/:sessionId/voice-completions", async (req, res, next) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = voiceCompletionSchema.parse(req.body);
      const response = await coordinator.completeVoiceAndContinue(
        sessionId,
        {
          action_id: body.action_id,
          outcome: body.outcome,
          ...(body.failure_class ? { failure_class: body.failure_class } : {}),
          ...(body.message ? { message: body.message } : {}),
        },
        correlationOf(req.headers["x-correlation-id"], body.correlationId ?? `corr-${sessionId}-voice`),
      );
      res.json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(error);
        return;
      }
      try {
        fail(res, error);
      } catch (unwrapped) {
        next(unwrapped);
      }
    }
  });

  router.post("/:sessionId/complete", (req, res, next) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = completeSchema.parse(req.body ?? {});
      const appended = coordinator.completeSession(sessionId, body.reason ?? "finished");
      const view = coordinator.getSessionView(sessionId);
      res.json({ session_id: sessionId, completed: view.completed, appended_sequences: appended, revision: view.revision });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(error);
        return;
      }
      try {
        fail(res, error);
      } catch (unwrapped) {
        next(unwrapped);
      }
    }
  });

  router.post("/:sessionId/asr", async (req, res, next) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = asrSchema.parse(req.body);
      // 复用 coach 侧 Qwen ASR 链路（经 tutorSession/asrService，ADR-005 层边界）；
      // 未配置 key → 503（前端降级文字输入，不伪装成功）。
      const transcribe = options.transcriber ?? transcribeForTutor;
      const transcript = await transcribe({
        dataUrl: body.audio.dataUrl,
        durationMs: body.audio.durationMs,
      });
      res.json({ session_id: sessionId, transcript: transcript.transcript, model: transcript.model });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(error);
        return;
      }
      if (error instanceof SpeechProviderError) {
        res.status(503).json({
          error: { code: "ASR_UNAVAILABLE", message: (error as Error).message },
        });
        return;
      }
      next(error);
    }
  });

  return router;
}
