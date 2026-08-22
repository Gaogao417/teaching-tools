/**
 * 学习入口体验路由（Phase 5 UI 集成 / 计划 §2）。
 *
 * POST /api/learn/:taskId/experience  { studentId, switchFromSessionId? }
 *
 * 联合结果：
 * - kind=tutor  ：Approved Binding 已选定 Question + 默认（或 alternate）讲法，
 *                 已创建 TutorSession（v4 事件，session_started 携带 Topic/
 *                 Question/讲法 provenance + policy_profile_snapshot）并返回
 *                 开场回合；
 * - kind=legacy ：无 Approved Binding（或缺 canonical root），前端继续当前
 *                 LearnPage；
 * - 明确错误    ：Binding stale、Plan/Profile 非 Approved、hash 不匹配时
 *                 fail closed（409/403），不静默换题或换讲法。
 *
 * 前端不再调用公开的 POST /api/tutor-sessions {tpId}（波次 C 已随隔离页下线）；
 * Coordinator 内部仍可按 Plan ref 启动。
 */
import { Router } from "express";
import { z } from "zod";

import {
  createDefaultTutorSessionCoordinator,
  TutorSessionCoordinatorError,
  type TutorSessionCoordinator,
} from "../../services/tutorSession/TutorSession";
import {
  resolvePolicyProvider,
  selectTopicQuestionTeaching,
  selectTopicQuestionTeachingWithRole,
  type TopicQuestionSelectionError,
} from "../../services/tutorSession/topicQuestionExperience";
import { tutorOpeningBody } from "./tutorSessionRoutes";

const experienceSchema = z.object({
  studentId: z.string().trim().min(1).max(64),
  /** 同题换讲法：结束/挂起该会话并以同题 alternate Plan 创建关联会话。 */
  switchFromSessionId: z.string().regex(/^TS-[0-9]{4,}$/).optional(),
});

const SELECTION_ERROR_STATUS: Record<TopicQuestionSelectionError, number> = {
  AMBIGUOUS_BINDING: 409,
  BINDING_QUESTION_STALE: 409,
  BINDING_APPROACH_SET_STALE: 409,
  APPROACH_SET_MISMATCH: 409,
  PLAN_APPROACH_SET_MISMATCH: 409,
  PLAN_NOT_APPROVED: 403,
  PROFILE_NOT_APPROVED: 403,
  PROFILE_VERSION_MISMATCH: 409,
  TRUTH_NOT_APPROVED: 403,
};

export function coordinatorErrorStatus(code: string): number {
  if (code === "SESSION_NOT_FOUND") return 404;
  if (code === "APPROACH_SET_MISMATCH" || code === "POLICY_PROFILE_INVALID") return 409;
  if (code === "PLAN_NOT_APPROVED" || code === "FEATURE_FLAG_OFF" || code === "ASSESSMENT_FAIL_CLOSED") return 403;
  if (code === "INVALID_INPUT") return 400;
  return 500;
}

export interface LearnExperienceRoutesOptions {
  /** canonical authoring 根目录（默认 env TUTOR_CANONICAL_ROOT；缺失 → legacy）。 */
  canonicalRoot?: string;
  /** 测试注入 coordinator；提供时忽略 canonicalRoot。 */
  coordinator?: TutorSessionCoordinator;
}

/** 会话 ID 生成（同毫秒并发下仍唯一：Date.now() + 进程内单调计数后缀）。 */
let sessionSeq = 0;
function nextSessionId(): string {
  sessionSeq = (sessionSeq + 1) % 1_000_000;
  return `TS-${Date.now()}${String(sessionSeq).padStart(6, "0")}`;
}

export function createLearnExperienceRoutes(options: LearnExperienceRoutesOptions = {}): Router {
  const router = Router();
  const canonicalRoot = options.canonicalRoot ?? process.env.TUTOR_CANONICAL_ROOT ?? "";
  const coordinator =
    options.coordinator ??
    createDefaultTutorSessionCoordinator({ canonicalRoot }).coordinator;

  router.post("/:taskId/experience", async (req, res, next) => {
    try {
      const taskId = z.string().trim().min(1).max(128).parse(req.params.taskId);
      const body = experienceSchema.parse(req.body);

      const role = body.switchFromSessionId ? "alternate" : "default";
      const selection = selectTopicQuestionTeachingWithRole({ canonicalRoot }, taskId, role);
      if (selection.kind === "legacy") {
        if (body.switchFromSessionId) {
          // 换讲法没有可用 alternate（或本就无 Binding）＝显式错误，
          // 不静默回 legacy 体验（计划 §2：仅在存在 alternate 时可切换）。
          res.status(409).json({
            error: {
              code: "NO_ALTERNATE_APPROACH",
              message:
                selection.reason === "no_alternate_variant"
                  ? `task ${taskId} 的 Binding 未登记 alternate 讲法`
                  : `task ${taskId} 无 Approved Binding，不能换讲法`,
            },
          });
          return;
        }
        res.json({
          kind: "legacy",
          task_id: taskId,
          reason: selection.reason,
        });
        return;
      }
      if (selection.kind === "error") {
        res.status(SELECTION_ERROR_STATUS[selection.code]).json({
          error: { code: selection.code, message: selection.message },
        });
        return;
      }

      const { provider } = resolvePolicyProvider(selection.profile);
      const previous = body.switchFromSessionId;
      if (previous) {
        // 切换前置检查：旧会话必须存在且未完成（completed 会话不可换讲法）。
        const oldView = coordinator.getSessionView(previous);
        if (oldView.completed) {
          res.status(409).json({
            error: { code: "SESSION_ALREADY_COMPLETED", message: `会话 ${previous} 已完成，不能换讲法` },
          });
          return;
        }
        coordinator.completeSession(previous, "alternate_approach");
      }

      const sessionId = nextSessionId();
      coordinator.start({
        sessionId,
        studentId: body.studentId,
        tpId: selection.plan.artifact_id,
        access: "binding",
        experience: {
          task_id: selection.binding.task_id,
          scenario_id: selection.binding.scenario_id,
          approach_set_ref: selection.variant.approach_set_ref,
          policy_profile_snapshot: selection.profileSnapshot,
          provider,
          ...(previous ? { previous_session_id: previous, switch_reason: "alternate_approach" as const } : {}),
          alternates_available: selection.binding.teaching_variants.some((entry) => entry.role === "alternate"),
        },
      });
      const turn = await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" });

      const hasAlternate = selection.binding.teaching_variants.some((entry) => entry.role === "alternate");
      res.status(previous ? 201 : 200).json({
        kind: "tutor",
        task_id: selection.binding.task_id,
        scenario_id: selection.binding.scenario_id,
        binding: {
          artifact_id: selection.binding.artifact_id,
          default_plan: selection.binding.teaching_variants.find((entry) => entry.role === "default")
            ?.tutor_plan_ref.artifact_id,
          variants: selection.binding.teaching_variants.map((entry) => ({
            role: entry.role,
            approach_set_id: entry.approach_set_ref.artifact_id,
            tutor_plan_id: entry.tutor_plan_ref.artifact_id,
          })),
          alternates_available: hasAlternate,
        },
        question: {
          artifact_id: selection.truth.artifact_id,
          stem: selection.truth.stem,
          subquestions: (selection.truth.subquestions ?? []).map((entry) => ({
            part_id: entry.part_id,
            prompt: entry.prompt,
          })),
        },
        session_id: sessionId,
        ...(previous ? { previous_session_id: previous, switch_reason: "alternate_approach" } : {}),
        opening: tutorOpeningBody(coordinator, sessionId, turn),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(error);
        return;
      }
      if (error instanceof TutorSessionCoordinatorError) {
        res.status(coordinatorErrorStatus(error.code)).json({
          error: { code: error.code, message: error.message },
        });
        return;
      }
      next(error);
    }
  });

  return router;
}
