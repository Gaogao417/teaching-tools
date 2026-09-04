/**
 * V7HttpSnapshotProjector（F7 Step 4 — 服务层快照 → HTTP application profile）。
 *
 * 组装链：OrchestratorV7.snapshot()（服务层，fresh rebuild 投影）→ 本投影补充
 * 线格式字段（question / render / turn / assessment）→ web/shared
 * tutorHttpProfile parse + 一致性门禁（fail closed 单入口——产出侧自证，前端
 * 采用侧同一入口，Step 5 接线）。
 *
 * render.geometry 纪律（复核 P0：fail closed，不回退题图）：合成 = pinned
 * baseGeometry + committed tutor DomainCommands 经 applyDomainCommands 的
 * 服务端结果；合成失败（命令与几何不匹配）= 流/内容损坏——显式
 * INTEGRITY_FAILURE 类错误 + 零 snapshot（服务端 revision 已前进而浏览器看到
 * 旧题图，正是此前 GeometryCanvas 异常最危险的漂移来源，不得静默回退）。
 */
import { applyDomainCommands } from "../../../../shared/actionWorld";
import { parseSessionSnapshotHttp, TUTOR_RUNTIME_HTTP_PROFILE, type SessionSnapshotHttpV1 } from "../../../../shared/tutorHttpProfile";
import type { WorkspaceFold } from "../tutorSession/WorkspaceRuntimeReducerV5";
import type { V7TurnResult } from "../tutorNavigator/NavigatorSessionV7";
import type { TutorSessionOrchestratorV7 } from "./TutorSessionOrchestratorV7";

/** render 合成失败（流/内容损坏——fail closed；路由映射 503 无快照）。 */
export class V7RenderProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "V7RenderProjectionError";
  }
}

/** student-safe composed geometry（pinned base + committed tutor 命令；fail closed）。 */
export function composeRenderGeometryV7(fold: WorkspaceFold, baseGeometry: unknown): Record<string, unknown> | null {
  if (baseGeometry === undefined || baseGeometry === null) return null;
  const base = baseGeometry as Parameters<typeof applyDomainCommands>[0]["geometry"];
  if (fold.context.tutorCommands.length === 0) return base as unknown as Record<string, unknown>;
  try {
    const world = applyDomainCommands({ revision: 0, geometry: base }, fold.context.tutorCommands);
    return world.geometry as unknown as Record<string, unknown>;
  } catch (error) {
    throw new V7RenderProjectionError(
      `render geometry composition failed (committed commands vs pinned base geometry are inconsistent; fail closed, no snapshot): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** V7TurnResult → 线 turn（spec §1.2：committed | revision-conflict | command-rejected | runtime-failure）。 */
function projectTurn(
  turn: V7TurnResult | undefined,
  source: "input" | "command",
): SessionSnapshotHttpV1["turn"] | undefined {
  if (!turn) return undefined;
  if (!turn.failure) {
    return {
      status: "committed",
      ...(turn.decision?.decision_kind !== undefined ? { decision_kind: turn.decision.decision_kind } : {}),
      ...(turn.decision?.to_beat_id !== undefined ? { to_beat_id: turn.decision.to_beat_id } : {}),
    };
  }
  const status =
    turn.failure.failure_class === "revision_conflict"
      ? "revision-conflict"
      : source === "command"
        ? "command-rejected"
        : "runtime-failure";
  return {
    status,
    failure: {
      category: status === "revision-conflict" ? "system" : source === "command" ? "command" : "system",
      failure_class: turn.failure.failure_class,
      ...(turn.failure.message !== undefined ? { message: turn.failure.message } : {}),
      retryable: status === "revision-conflict",
    },
  };
}

/**
 * 组装线格式快照（parseSessionSnapshotHttp 强制校验 + 一致性门禁——不符即抛，
 * 不产出「看似正常」的 snapshot）。
 */
export function projectHttpSnapshotV1(args: {
  orchestrator: TutorSessionOrchestratorV7;
  turn?: V7TurnResult;
  turnSource?: "input" | "command";
  promptLatex?: string;
}): SessionSnapshotHttpV1 {
  const { orchestrator } = args;
  const service = orchestrator.snapshot(args.promptLatex ?? orchestrator.question.stem);
  const fold = orchestrator.workspaceFold();
  const geometry = composeRenderGeometryV7(fold, orchestrator.sessionCatalog.baseGeometry);
  const payload = {
    profile: TUTOR_RUNTIME_HTTP_PROFILE,
    session_id: service.session_id,
    task_id: service.task_id,
    revision: service.revision,
    completed: service.completed,
    assessment: orchestrator.assessmentMode,
    question: {
      artifact_id: orchestrator.question.artifact_id,
      question_type: orchestrator.question.question_type,
      stem: orchestrator.question.stem,
    },
    views: {
      student_workspace_view: service.views.studentWorkspaceView,
      coach_panel_view: service.views.coachPanelView,
      // 独立 participation 成员补 canonical envelope（投影切片本身无 schema 常量；
      // 包装是纯加法——kind/gate_id 字段原样）。
      participation: {
        schema: "ai_teaching_mainline_participation/v1" as const,
        ...service.views.participation,
      },
      status: service.views.status,
    },
    render: {
      workspace_revision: fold.state.revision,
      geometry,
    },
    ...(service.active_action !== undefined
      ? {
          active_action: {
            action_id: service.active_action.action_id,
            resource_id: service.active_action.resource_id,
            action_ref: service.active_action.action_ref,
            capability: service.active_action.capability,
            target_ids: [...service.active_action.target_ids],
            student_view: service.active_action.student_view as unknown as Record<string, unknown>,
            action_plan: service.active_action.action_plan as unknown as Record<string, unknown>,
            form: service.active_action.form,
          },
        }
      : {}),
    ...(service.pending_presentation !== undefined ? { pending_presentation: service.pending_presentation } : {}),
    ...(args.turn !== undefined ? { turn: projectTurn(args.turn, args.turnSource ?? "input") } : {}),
  };
  const parsed = parseSessionSnapshotHttp(payload);
  if (!parsed.ok) {
    throw new V7RenderProjectionError(
      `projected snapshot fails the HTTP profile gate (fail closed, not returned): ${parsed.errors.join("; ")}`,
    );
  }
  return parsed.snapshot;
}
