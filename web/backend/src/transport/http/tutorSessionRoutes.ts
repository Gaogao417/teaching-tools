/**
 * Tutor session HTTP 合同（Phase 5 remediation / 完整收口计划 §2.5）。
 *
 * - POST /api/tutor-sessions                     启动 golden plan 会话（含开场回合）
 * - GET  /api/tutor-sessions/:sessionId          恢复学生安全视图 + pending actions + revision
 * - POST /api/tutor-sessions/:sessionId/turns    clientTurnId + expectedRevision + 六类输入
 * - POST /api/tutor-sessions/:sessionId/voice-completions
 * - POST /api/tutor-sessions/:sessionId/complete
 *
 * TutorTurnResponse 只含学生安全面（revision/mode/checkpoint+route/alignment/
 * decision/Voice+Workspace actions/fallback/event cursor）；答案真值与模型
 * 私有推理绝不出现在任何响应（结构性由 coordinator 类型保证）。
 * Assessment / 非 golden plan 拒绝（coordinator fail closed + 路由层白名单）。
 */
import { Router } from "express";
import { z } from "zod";

import {
  createDefaultTutorSessionCoordinator,
  STATEFUL_TUTOR_POLICY_GOLDEN_PLANS,
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

const startSchema = z.object({
  tpId: z.string().regex(/^TP-[A-Z0-9]+-[0-9]{3,}$/),
  studentId: z.string().trim().min(1).max(64),
  sessionId: sessionIdParam.optional(),
  initialMode: z.enum(["teach", "guided_solve", "repair"]).optional(),
});

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

export interface TutorSessionRoutesOptions {
  /** canonical authoring 根目录（默认 env TUTOR_CANONICAL_ROOT）。 */
  canonicalRoot?: string;
  /** 测试注入 coordinator；提供时忽略 canonicalRoot。 */
  coordinator?: TutorSessionCoordinator;
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

  router.post("/", async (req, res, next) => {
    try {
      const body = startSchema.parse(req.body);
      if (!STATEFUL_TUTOR_POLICY_GOLDEN_PLANS.includes(body.tpId)) {
        res.status(403).json({
          error: {
            code: "PLAN_NOT_GOLDEN",
            message: `tutor 闭环只对 golden 白名单 plan 开放：${STATEFUL_TUTOR_POLICY_GOLDEN_PLANS.join(", ")}`,
          },
        });
        return;
      }
      const sessionId =
        body.sessionId ?? `TS-${String(Date.now()).padStart(4, "0").slice(0, 10)}`;
      coordinator.start({
        sessionId,
        studentId: body.studentId,
        tpId: body.tpId,
        ...(body.initialMode ? { initialMode: body.initialMode } : {}),
      });
      // 开场回合（session_started 系统触发，不产生学生输入事实）：
      // 调用方立即拿到第一段教学呈现。
      const turn = await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" });
      const view = coordinator.getSessionView(sessionId);
      res.status(201).json({
        session_id: sessionId,
        opening: {
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
          event_cursor: view.event_cursor,
        },
      });
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

  return router;
}
