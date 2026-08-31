/**
 * VS1 统一 Workspace 呈现合同（mvp/vs-01-unified-workspace-view.md /
 * ADR-008）。前后端共用：backend 把会话教学状态投影为唯一的
 * `StudentWorkspaceView`；turn response 与 session view 复用同一类型，
 * Geometry 与 Solution Board 共享同一 revision（无独立 slice revision）。
 *
 * 学生安全边界：hidden 板书行在服务端投影时即被过滤，本类型的板书行
 * 只含可见内容；canvas 为组合后的学生安全画布（authored 题图 + 已披露
 * 演示效果）。任何 truth 键（localTruth/teachingInput/expectedValues）
 * 不得出现在本文件的任何载荷里。
 *
 * ---------------------------------------------------------------------------
 * 【收敛登记（F3，2026-08-29；G1 报告 §2 指定收敛位）】
 * 本文件是手写 View 类型（F0 contract matrix §2 第 1 行登记债），目标形态由
 * canonical `ai_teaching_student_workspace_view/v1`（PRDS contracts/schemas/
 * view/v1；TS 镜像 web/shared/canonical studentWorkspaceViewV1Schema）取代。
 *
 * - F3 侧收敛已完成：vNext Workspace 投影（tutorSession/WorkspaceViewProjectorV5）
 *   只消费 canonical Zod 推导类型，不再引用本文件；
 * - 剩余 consumer（legacy 链，冻结不改、删除属 F7+）：
 *   backend：tutorSession/TutorSession.ts（v2–v4 主链 response）、
 *   tutorSession/workspaceRuntimeState.ts（VS1 只读 adapter，L-04 冻结面）；
 *   shared：tutorExperience.ts（legacy response，L-04）；
 *   frontend：action-runtime/tutor/useTutorLearning.ts、
 *   action-runtime/tutor/tutorTestFixtures.ts、
 *   presentation/workspace/StudentWorkspaceFrame.tsx 及相关测试（F7 收敛）。
 * 新代码禁止 import 本文件（frontend/presentation/canonicalView 已用 canonical）。
 * ---------------------------------------------------------------------------
 */
import type { ExercisePlan, LearningMode } from "./actionRuntime";
import type { TopicGeometryModel } from "./topicPractice";

/** 画布 surface 的学生安全视图（只读呈现面；交互实体状态由操作步
 *  ActionRuntimeFrame 的 action machine 在前端推导——VS1 不改内核）。 */
export interface GeometrySurfaceView {
  /** 服务端组合后的几何模型（authored 题图 + 已披露演示效果命令）。 */
  geometry?: TopicGeometryModel;
  diagramAsset?: string;
}

/** 板书行（服务端已渲染 LaTeX；与既有前端 SolutionBoardView 行形状一致
 *  ——ADR-008：现有前端 View 是 StudentWorkspaceView 的实现基础。
 *  hidden 行在服务端投影时即被过滤，不存在 isComplete 之外的第三态）。 */
export interface StudentBoardExpressionView {
  expressionId: string;
  sourceStepId: string;
  latex: string;
  isCurrent: boolean;
  isComplete: boolean;
}

export interface StudentBoardView {
  headingLatex: string;
  visibleExpressions: StudentBoardExpressionView[];
  currentExpressionId?: string;
  announcement?: string;
}

/** 学生参与方式（服务端事实投影；不驱动前端 phase 标签的播放态推导）。 */
export type WorkspaceParticipationMode = "listen" | "respond" | "operate" | "review";

export interface ParticipationView {
  mode: WorkspaceParticipationMode;
  /** 进行中的操作步（学生安全 ExercisePlan；讲解/听/答/回顾态缺省）。 */
  activeAction?: {
    actionId: string;
    plan: ExercisePlan;
  };
}

/** 唯一学生工作台 View（REQ-02：turn 与 recovery 复用）。 */
export interface StudentWorkspaceView {
  sessionId: string;
  /** 与响应 revision 一致（REQ-05：两 surface 无独立 revision）。 */
  revision: number;
  canvas: GeometrySurfaceView;
  solutionBoard: StudentBoardView;
  participation: ParticipationView;
}

// --------------------------------------------------------------------------- //
// 结构性 guard（与 tutorExperience.ts 同口径：只验证依赖形状，fail-closed）
// --------------------------------------------------------------------------- //

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string";
}

function isStudentBoardExpression(value: unknown): value is StudentBoardExpressionView {
  return isRecord(value) && hasString(value, "expressionId") && hasString(value, "sourceStepId")
    && hasString(value, "latex") && typeof value.isCurrent === "boolean"
    && typeof value.isComplete === "boolean";
}

export function isStudentBoardView(value: unknown): value is StudentBoardView {
  return isRecord(value) && hasString(value, "headingLatex")
    && Array.isArray(value.visibleExpressions)
    && value.visibleExpressions.every(isStudentBoardExpression);
}

function isParticipationView(value: unknown): value is ParticipationView {
  if (!isRecord(value)) return false;
  if (!["listen", "respond", "operate", "review"].includes(String(value.mode))) return false;
  if (value.activeAction === undefined) return true;
  const active = value.activeAction as Record<string, unknown>;
  return hasString(active, "actionId") && isRecord(active.plan)
    && typeof (active.plan as { planVersion?: unknown }).planVersion === "number"
    && Array.isArray((active.plan as { actions?: unknown }).actions);
}

export function isStudentWorkspaceView(value: unknown): value is StudentWorkspaceView {
  if (!isRecord(value) || !hasString(value, "sessionId") || typeof value.revision !== "number") return false;
  if (!isRecord(value.canvas) || !isStudentBoardView(value.solutionBoard) || !isParticipationView(value.participation)) return false;
  // REQ-05：View 内不允许出现第二份 revision（canvas/board slice 无独立 revision）。
  if (isRecord(value.canvas) && "revision" in value.canvas) return false;
  if (isRecord(value.solutionBoard) && "revision" in value.solutionBoard) return false;
  return true;
}

/** LearningMode re-export（guard 内计划校验的宽口径；严格计划校验由
 *  shared/actionRuntime 的 isExercisePlan 承担，前端 Frame 挂载时执行）。 */
export type { LearningMode };
