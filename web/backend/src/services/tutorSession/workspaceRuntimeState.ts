/**
 * VS1 统一 WorkspaceRuntimeState 与 StudentWorkspaceView（mvp/vs-01 /
 * ADR-008 §4-§5）。
 *
 * 职责三分（不得混写）：
 * - `adaptLegacyWorkspaceIntoState`：legacy read adapter——把现有 Geometry
 *   world snapshot（authored 题图 + 演示披露效果命令）与 server-materialized
 *   Board context（snapshotAt 可见行）读入统一 state。纯读取：不生成
 *   reveal、不判断正确性、不新增教学规则（REQ-03）；
 * - `projectStudentWorkspace`：纯 State → View（学生安全；单 revision）；
 * - `buildWorkspaceView`：turn response 与 session view 共用的唯一构建入口
 *   （REQ-02：两条读取路径同一 View shape、同一 revision 来源）。
 *
 * 披露权威仍是既有 demonstration 投影（buildTutorDemonstrationPlan /
 * snapshotAt）；本模块只消费其产物。hidden 板书行在 snapshotAt 已被过滤，
 * adapter 不放宽（REQ-07）。
 */
import { renderBoardExpression, type SolutionBoardProjection } from "../../../../shared/solutionBoard";
import { applyDomainCommands, type DomainCommand } from "../../../../shared/actionWorld";
import type { TopicGeometryModel } from "../../../../shared/topicPractice";
import type {
  GeometrySurfaceView,
  StudentBoardView,
  StudentWorkspaceView,
} from "../../../../shared/studentWorkspace";
import type { ValidatedWorkspaceAction } from "../tutorPresentation/WorkspaceAction";
import type { ExercisePlan } from "../../../../shared/actionRuntime";

// --------------------------------------------------------------------------- //
// 统一 RuntimeState（backend 内部权威；两 slice 共享 session/revision）
// --------------------------------------------------------------------------- //

export interface GeometryRuntimeState {
  /** authored 学生安全题图（studentQuestionGeometry 产物：仅 viewBox/points/segments）。 */
  baseGeometry?: TopicGeometryModel;
  diagramAsset?: string;
  /** 已披露演示效果命令（构造线/标注/对应/强调；按全量 action 序）。 */
  committedCommands: DomainCommand[];
}

export interface SolutionBoardRuntimeState {
  /** 服务端投影的可见板书（hidden 行已被 snapshotAt 过滤，不进 state）。 */
  board?: SolutionBoardProjection;
  currentExpressionId?: string;
}

export interface ParticipationRuntimeState {
  mode: "listen" | "respond" | "operate" | "review";
  activeAction?: {
    actionId: string;
    plan: ExercisePlan;
  };
}

export interface WorkspaceRuntimeState {
  sessionId: string;
  revision: number;
  geometry: GeometryRuntimeState;
  solutionBoard: SolutionBoardRuntimeState;
  participation: ParticipationRuntimeState;
}

// --------------------------------------------------------------------------- //
// Legacy read adapter（REQ-03：只读；fail closed）
// --------------------------------------------------------------------------- //

export interface LegacyWorkspaceSnapshot {
  baseGeometry?: TopicGeometryModel;
  diagramAsset?: string;
  disclosedEffects: DomainCommand[];
}

export interface LegacyBoardContext {
  board: SolutionBoardProjection;
  /** 当前讲解步对应的板书行（缺省取最后一行）。 */
  currentExpressionId?: string;
}

/** legacy 输入结构校验失败 → 错误列表（不静默降级；REQ-08/AC-07）。 */
export function adaptLegacyWorkspaceIntoState(args: {
  sessionId: string;
  revision: number;
  legacyWorldSnapshot: LegacyWorkspaceSnapshot;
  legacyBoardContext?: LegacyBoardContext;
  operations: ValidatedWorkspaceAction[];
  pendingVoiceCount: number;
  completed: boolean;
}): { ok: true; state: WorkspaceRuntimeState } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const { legacyWorldSnapshot, legacyBoardContext } = args;
  if (legacyWorldSnapshot.baseGeometry) {
    const geometry = legacyWorldSnapshot.baseGeometry;
    if (!geometry.viewBox || !Array.isArray(geometry.points) || !Array.isArray(geometry.segments)) {
      errors.push("legacy world snapshot: baseGeometry 不是合法 TopicGeometryModel");
    }
  }
  if (!Array.isArray(legacyWorldSnapshot.disclosedEffects)) {
    errors.push("legacy world snapshot: disclosedEffects 必须是命令数组");
  }
  if (legacyBoardContext && !Array.isArray(legacyBoardContext.board?.expressions)) {
    errors.push("legacy board context: board.expressions 缺失");
  }
  for (const operation of args.operations) {
    if (!operation.action_id) errors.push("operation 缺 action_id");
    if (!operation.action_plan) errors.push(`operation ${operation.action_id} 缺学生安全 action_plan`);
  }
  if (errors.length) return { ok: false, errors };

  const operation = args.operations.find((entry) => entry.form !== "demonstration" && entry.action_plan);
  const mode = args.completed
    ? "review"
    : operation
      ? "operate"
      : args.pendingVoiceCount > 0
        ? "listen"
        : "respond";
  return {
    ok: true,
    state: {
      sessionId: args.sessionId,
      revision: args.revision,
      geometry: {
        baseGeometry: legacyWorldSnapshot.baseGeometry,
        diagramAsset: legacyWorldSnapshot.diagramAsset,
        committedCommands: [...legacyWorldSnapshot.disclosedEffects],
      },
      solutionBoard: legacyBoardContext
        ? { board: legacyBoardContext.board, currentExpressionId: legacyBoardContext.currentExpressionId }
        : {},
      participation: {
        mode,
        ...(operation?.action_plan ? { activeAction: { actionId: operation.action_id, plan: operation.action_plan } } : {}),
      },
    },
  };
}

// --------------------------------------------------------------------------- //
// 纯 State → View projector（REQ-05：单 revision；REQ-07：学生安全）
// --------------------------------------------------------------------------- //

export function projectStudentWorkspace(state: WorkspaceRuntimeState): StudentWorkspaceView {
  const composed = composeCanvasGeometry(state.geometry);
  const board = projectBoardView(state.solutionBoard);
  return {
    sessionId: state.sessionId,
    revision: state.revision,
    canvas: {
      ...(composed ? { geometry: composed } : {}),
      ...(state.geometry.diagramAsset ? { diagramAsset: state.geometry.diagramAsset } : {}),
    },
    solutionBoard: board,
    participation: state.participation.mode === "operate" && !state.participation.activeAction
      ? { mode: "respond" }
      : state.participation,
  };
}

/** authored 题图 + 已披露效果命令 → 学生安全组合画布（纯应用；失败回退题图）。 */
function composeCanvasGeometry(geometry: GeometryRuntimeState): TopicGeometryModel | undefined {
  const base = geometry.baseGeometry;
  if (!base) return undefined;
  if (!geometry.committedCommands.length) return base;
  try {
    const world = applyDomainCommands({ revision: 0, geometry: base }, geometry.committedCommands);
    // 组合产物可能带 derivedLines/teachingMarks（演示构造线/标注）——都是
    // 已披露呈现内容，学生安全；保持服务端组合结果原样下发。
    return world.geometry;
  } catch {
    // 效果命令与几何不匹配（内容缺口）：退回题图原样（与旧演示渲染同口径）。
    return base;
  }
}

/** 可见板书投影 → 学生安全 board view（行已服务端渲染；无独立 revision；
 *  行形状与既有前端 SolutionBoardView 一致——isCurrent/isComplete）。 */
function projectBoardView(slice: SolutionBoardRuntimeState): StudentBoardView {
  const board = slice.board;
  if (!board) return { headingLatex: "", visibleExpressions: [] };
  const current = slice.currentExpressionId && board.expressions.some((expression) => expression.expressionId === slice.currentExpressionId)
    ? slice.currentExpressionId
    : board.expressions.at(-1)?.expressionId;
  return {
    headingLatex: board.headingLatex,
    visibleExpressions: board.expressions.map((expression) => ({
      expressionId: expression.expressionId,
      sourceStepId: expression.sourceStepId,
      latex: renderBoardExpression(expression),
      isCurrent: expression.expressionId === current,
      isComplete: expression.phase === "complete",
    })),
    currentExpressionId: current,
  };
}
