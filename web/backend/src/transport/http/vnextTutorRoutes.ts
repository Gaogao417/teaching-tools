/**
 * F7 — vNext 学生端 HTTP 合同（golden task 真实 Runtime 因果链出口）。
 *
 * - POST /api/vnext/tutor-sessions                      创建会话（start：pin 原子写入 + 开场呈现）
 * - GET  /api/vnext/tutor-sessions/:sessionId           恢复（verified rebuild，零模型调用；refresh/reconnect 用）
 * - POST /api/vnext/tutor-sessions/:sessionId/student-intents   主线/Assistance/inquiry 类型化 intent
 * - POST /api/vnext/tutor-sessions/:sessionId/workspace-commands 学生 workspace 命令（不经 Presenter，F3 执行）
 * - GET  /api/vnext/availability/:taskId                vNext 可用性（TUTOR_VNEXT_ROOT + 任务 allowlist）
 *
 * 纪律（f7-scope-ledger）：
 * - 每请求实例化 orchestrator（start/resume 均从事件流重建状态——HTTP 层无
 *   第二份会话内存真源）；教学判断全部在 Navigator，本层零教学语义；
 * - 响应只含学生安全面：统一三视图 + status（canonical view/v1 形状）+
 *   静态题面（question stem + 题图 geometry，来自同一 canonical/bundle 真源）；
 *   答案真值与模型私有推理绝不出现在响应；
 * - OrchestratorError → 类型化 HTTP 错误（错误码保留）；轮内显式失败
 *   （revision_conflict 等）是 committed 事实，随 views.status.last_failure
 *   与 turn.failure 透出（HTTP 200），不冒充传输层错误；
 * - 旧 /api/tutor-sessions（turns/asr 形态）不动——F8 退场，本层不消费它。
 */
import { Router } from "express";
import { z } from "zod";

import { buildNavigatorPlan } from "../../services/tutorNavigator/NavigatorPlanV5";
import { pickTopicScenario } from "../../services/runtime/engines/topicPractice/scenarioBank";
import type { TopicPracticeTaskId } from "../../../../shared/topicPractice";
import { importApprovedPlanV5 } from "../../services/planBuild/v5/ImportApprovedPlanV5";
import { buildGoldenWorkspaceCatalogV5 } from "../../services/tutorOrchestration/GoldenWorkspaceCatalog";
import { TutorSessionEventStoreV5Error } from "../../services/tutorSession/TutorSessionEventV5";
import { vNextGateModel } from "../../services/tutorOrchestration/VNextGateModelFactory";
import { OrchestratorError, TutorSessionOrchestratorV5 } from "../../services/tutorOrchestration/TutorSessionOrchestratorV5";

const GOLDEN_TP_ID = "TP-SMV-009";
const sessionIdParam = z.string().regex(/^TS-[0-9]{4,}$/);
const taskIdParam = z.string().min(1).max(64);
const studentIdSchema = z.string().trim().min(1).max(64);
const clientRequestIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{4,128}$/);

const intentKindEnum = z.enum([
  "submit_answer",
  "confirm",
  "continue",
  "ask_question",
  "request_scaffold",
  "request_rephrase",
  "barge_in",
  "return_to_mainline",
]);

const startSchema = z.object({
  student_id: studentIdSchema,
  assessment: z.boolean().optional(),
});

const intentSchema = z.object({
  intent_kind: intentKindEnum,
  text: z.string().max(2000).optional(),
  client_request_id: clientRequestIdSchema,
  expected_revision: z.number().int().min(0),
});

const workspaceCommandSchema = z.object({
  command_id: z.string().regex(/^SC-[A-Za-z0-9._:-]{3,64}$/),
  client_command_id: z.string().regex(/^cc-[A-Za-z0-9._:-]{3,64}$/),
  surface: z.enum(["geometry", "solution_board"]),
  capability: z.string().min(1).max(128),
  target_ids: z.array(z.string().min(1).max(64)).min(1).max(32),
  expected_workspace_revision: z.number().int().min(0),
  params: z.record(z.string(), z.unknown()).optional(),
});

/** OrchestratorError.code → HTTP 状态（错误码原样透出）。 */
const ERROR_STATUS: Record<string, number> = {
  ASSESSMENT_INTENT_FORBIDDEN: 403,
  WORKSPACE_COMMAND_PAYLOAD_DRIFT: 409,
  WORKSPACE_COMMAND_UNRESOLVABLE: 404,
  WORKSPACE_COMMAND_REQUIRED: 400,
  MODEL_PIN_MISMATCH: 409,
  PLAN_IMPORT_FAILED: 503,
  NO_EXECUTABLE_DECISION: 409,
};

function canonicalRoot(): string {
  const root = process.env.TUTOR_VNEXT_ROOT?.trim();
  if (!root) throw new OrchestratorError("PLAN_IMPORT_FAILED", "TUTOR_VNEXT_ROOT is not configured (vNext routes must not mount)");
  return root;
}

/** vNext 任务 allowlist（F7 = 唯一 golden task；F8 扩展为 supported+approved+enabled 路由）。 */
function vNextTaskIds(): string[] {
  return (process.env.TUTOR_VNEXT_TASKS?.trim() || "goldenMinhangFold2020")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 静态题面（canonical 链 question + golden catalog 题图）：只读派生，不触会话。
 * 题图用 catalog.baseGeometry（与 workspace 命令 target 真源同源——segment-XX）。 */
function taskContent(taskId: string): { question: { artifact_id: string; question_type: string; stem: string }; geometry: unknown } {
  const imported = importApprovedPlanV5({ canonicalRoot: canonicalRoot(), anchored: true }, GOLDEN_TP_ID);
  if (!imported.ok) {
    throw new OrchestratorError("PLAN_IMPORT_FAILED", `approved plan import failed (fail closed): ${imported.errors.join("; ")}`);
  }
  const plan = buildNavigatorPlan(imported.imported);
  const golden = buildGoldenWorkspaceCatalogV5(imported.imported);
  return {
    question: {
      artifact_id: plan.question.artifact_id,
      question_type: plan.question.question_type,
      stem: plan.question.stem,
    },
    geometry: golden.catalog.baseGeometry ?? pickTopicScenario(taskId as TopicPracticeTaskId, 0).promptGeometry ?? null,
  };
}

/** 学生安全响应体：统一三视图 + status（+ 首拍呈现事实的轮摘要）。 */
function sessionPayload(
  orch: TutorSessionOrchestratorV5,
  options: { turn?: { decision_kind?: string; to_beat_id?: string; failure?: { failure_class: string; message: string } } } = {},
): Record<string, unknown> {
  const projection = orch.projectUnifiedViews();
  return {
    session_id: orch.sessionId,
    revision: orch.revision,
    completed: projection.status.completed,
    assessment: orch.assessmentMode,
    ...(options.turn ? { turn: options.turn } : {}),
    views: {
      student_workspace_view: projection.studentWorkspaceView,
      coach_panel_view: projection.coachPanelView,
      participation: projection.participation,
      status: projection.status,
    },
  };
}

/** 会话 id：TS-<epoch 毫秒><两位序号>（满足 TS-[0-9]{4,}，进程内唯一）。 */
let sessionSerial = 0;
function nextSessionId(): string {
  sessionSerial = (sessionSerial + 1) % 100;
  return `TS-${Date.now()}${String(sessionSerial).padStart(2, "0")}`;
}

function toHttpError(error: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }): void {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: { code: "BAD_REQUEST", message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") } });
    return;
  }
  if (error instanceof TutorSessionEventStoreV5Error && error.code === "SESSION_NOT_FOUND") {
    res.status(404).json({ error: { code: "SESSION_NOT_FOUND", message: error.message } });
    return;
  }
  if (error instanceof OrchestratorError) {
    // resume 对「空流（会话不存在）」与「链导入失败」共用 PLAN_IMPORT_FAILED——
    // HTTP 层按消息区分 404/503（不区分会把刷新死循环误报为服务故障）。
    const status = error.code === "PLAN_IMPORT_FAILED" && error.message.includes("no committed stream")
      ? 404
      : ERROR_STATUS[error.code] ?? 500;
    res.status(status).json({ error: { code: status === 404 ? "SESSION_NOT_FOUND" : error.code, message: error.message } });
    return;
  }
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) } });
}

export function createVNextTutorRoutes(): Router {
  const router = Router();

  router.get("/availability/:taskId", (req, res) => {
    const parsed = taskIdParam.safeParse(req.params.taskId);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "invalid taskId" } });
      return;
    }
    const enabled = Boolean(process.env.TUTOR_VNEXT_ROOT?.trim()) && vNextTaskIds().includes(parsed.data);
    res.json({ task_id: parsed.data, enabled });
  });

  router.post("/tutor-sessions", async (req, res) => {
    try {
      const body = startSchema.parse(req.body);
      const sessionId = nextSessionId();
      const orch = TutorSessionOrchestratorV5.start({
        sessionId,
        studentId: body.student_id,
        canonicalRoot: canonicalRoot(),
        model: vNextGateModel(),
        ...(body.assessment ? { assessment: true } : {}),
      });
      const content = taskContent(vNextTaskIds()[0]);
      res.status(201).json({ ...sessionPayload(orch), ...content });
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.get("/tutor-sessions/:sessionId", (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const orch = TutorSessionOrchestratorV5.resume({ sessionId, canonicalRoot: canonicalRoot(), model: vNextGateModel() });
      const content = taskContent(vNextTaskIds()[0]);
      res.json({ ...sessionPayload(orch), ...content });
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.post("/tutor-sessions/:sessionId/student-intents", async (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = intentSchema.parse(req.body);
      const orch = TutorSessionOrchestratorV5.resume({ sessionId, canonicalRoot: canonicalRoot(), model: vNextGateModel() });
      const result = await orch.submitStudentIntent(
        { intent_kind: body.intent_kind, client_request_id: body.client_request_id, ...(body.text !== undefined ? { text: body.text } : {}) },
        { expectedRevision: body.expected_revision },
      );
      res.json(
        sessionPayload(orch, {
          turn: {
            ...(result.turn.decision ? { decision_kind: result.turn.decision.decision_kind, to_beat_id: result.turn.decision.to_beat_id } : {}),
            ...(result.turn.failure ? { failure: result.turn.failure } : {}),
          },
        }),
      );
    } catch (error) {
      toHttpError(error, res);
    }
  });

  router.post("/tutor-sessions/:sessionId/workspace-commands", (req, res) => {
    try {
      const sessionId = sessionIdParam.parse(req.params.sessionId);
      const body = workspaceCommandSchema.parse(req.body);
      const orch = TutorSessionOrchestratorV5.resume({ sessionId, canonicalRoot: canonicalRoot(), model: vNextGateModel() });
      const result = orch.submitWorkspaceCommand(
        {
          schema: "ai_teaching_student_workspace_command/v1",
          session_id: sessionId,
          origin: "student",
          command_id: body.command_id,
          surface: body.surface,
          capability: body.capability,
          target_ids: body.target_ids,
          expected_workspace_revision: body.expected_workspace_revision,
          client_command_id: body.client_command_id,
          ...(body.params !== undefined ? { params: body.params } : {}),
        },
      );
      res.json(
        sessionPayload(orch, {
          turn: {
            ...(result.turn.decision ? { decision_kind: result.turn.decision.decision_kind, to_beat_id: result.turn.decision.to_beat_id } : {}),
            ...(result.turn.failure ? { failure: result.turn.failure } : {}),
          },
        }),
      );
    } catch (error) {
      toHttpError(error, res);
    }
  });

  return router;
}
