/**
 * Tutor 学习体验前端合同（Phase 5 UI 集成 / 计划 §2–§3）。
 *
 * 镜像 backend /experience、/tutor-sessions/:id 学生安全面——前端只消费
 * 已验证 presentation：workspace 步直接携带服务端投影的完整、学生安全
 * `action_plan`（assessment 形态：server-authoritative、无 localTruth/
 * teachingInput），页面不解析 action_template JSON、不持有 truth。
 */
import type {
  ActionContract,
  ActionEvaluationResponse,
  ExercisePlan,
} from "./actionRuntime";
import type { TopicGeometryModel } from "./topicPractice";
import { isStudentWorkspaceView, type StudentWorkspaceView } from "./studentWorkspace";

export type TutorInputKind =
  | "reasoning_utterance"
  | "question_asked"
  | "pointing_evidence"
  | "structured_action_evidence"
  | "silence_observed"
  | "student_interrupted";

export interface TutorStudentInput {
  input_kind: TutorInputKind;
  text?: string;
  object_id?: string;
  duration_ms?: number;
  action_evidence?: Record<string, unknown>;
}

export interface TutorVoiceAction {
  action_id: string;
  text: string;
  interruptible: boolean;
  voice_source?: "approved-resource" | "model-generated" | "deterministic-scaffold";
}

export interface TutorWorkspaceAction {
  action_id: string;
  decision_id: string;
  capability: string;
  target_ids: string[];
  resource_id: string;
  action_ref: string;
  /** 学生面投影（assessment 形态 ActionContract：无 localTruth/teachingInput）。 */
  student_view: ActionContract;
  /** 服务端投影的完整学生安全 ExercisePlan（单 action、server-authoritative）。 */
  action_plan: ExercisePlan;
  /**
   * 波次 G 任务 2（(a) 第一层）：workspace 条目形态（additive）。缺省
   * "operation"=学生操作步；"demonstration"=讲解演示（只读，demonstration
   * 形态 ExercisePlan，无 evidence 通道，推进权在会话）。
   */
  form?: "operation" | "demonstration";
}

export interface TutorCheckpointView {
  checkpoint_id: string;
  part_id: string;
  route_id: string;
  /** VS1 remediation-2（只读展示合同）：全局拍点序号/总数（1-based，跨
   *  part 连续计数）——Coach Panel「教学拍点 N/M」数据源；不参与推进。 */
  index: number;
  total: number;
  /** 当前拍标题（可选；缺省由前端按 part_id 派生「第N小问」，VS4 Beat
   *  化后改由协议下发）。 */
  title?: string;
}

export interface TutorTurnResponse {
  session_id: string;
  revision: number;
  client_turn_id: string;
  idempotent_replay: boolean;
  mode: "teach" | "guided_solve" | "repair";
  current_checkpoint: TutorCheckpointView;
  alignment?: {
    alignment: string;
    checkpoint_id?: string;
    route_id?: string;
    confidence?: number;
  };
  decision: {
    decision_id: string;
    move_type: "explain" | "prompt" | "hint" | "confirm" | "wait" | "repair";
    purpose_code: string;
    policy_version: string;
    fallback?: boolean;
  } | null;
  voice: TutorVoiceAction[];
  /** L-04 冻结（VS1）：legacy workspace 条目。新 UI 只消费 workspace_view。 */
  workspace: TutorWorkspaceAction[];
  /**
   * VS1 统一学生工作台 View（REQ-02/04/05）：Geometry/Board/Participation
   * 同 revision 的唯一学生安全投影；与 GET session view 同一类型。必填
   * （guard fail-closed——缺字段按 schema 失败进 recoverable error）。
   */
  workspace_view: StudentWorkspaceView;
  fallback?: { used: boolean; failure_class?: string };
  /** structured_action_evidence 回合附带 typed evaluator 判定（更新 Action Runtime）。 */
  action_evaluation?: ActionEvaluationResponse;
  /** 当前 Question 的全部小问已完成（curriculum 投影）。 */
  question_completed?: boolean;
  event_cursor: number;
}

export interface TutorQuestionView {
  artifact_id: string;
  stem: string;
  subquestions: Array<{ part_id: string; prompt: string }>;
  /**
   * 开场讲解的题目画布（波次 C-2 裁定 1）：authored 学生安全
   * TopicGeometryModel（viewBox/points/segments；backend 已剥掉
   * derivedLines/teachingMarks 运行时投影），与 workspace
   * `action_plan.world.geometry` 同源同形状。无几何题目缺省。
   */
  geometry?: TopicGeometryModel;
}

export interface TutorSessionView {
  session_id: string;
  revision: number;
  mode: "teach" | "guided_solve" | "repair";
  completed: boolean;
  question_completed?: boolean;
  current_checkpoint: TutorCheckpointView;
  pending_voice: TutorVoiceAction[];
  /** L-04 冻结（VS1）：legacy pending workspace。新 UI 只消费 workspace_view。 */
  pending_workspace: TutorWorkspaceAction[];
  /** VS1：与 turn response 同一 View（REQ-02/06：refresh parity）。 */
  workspace_view: StudentWorkspaceView;
  event_cursor: number;
  /** 刷新恢复时的题目/讲法上下文（v4 binding 会话）。 */
  task_id?: string;
  question?: TutorQuestionView;
  alternates_available?: boolean;
}

export interface TutorExperienceResponse {
  kind: "tutor";
  task_id: string;
  scenario_id: string;
  binding: {
    artifact_id: string;
    default_plan?: string;
    variants: Array<{
      role: "default" | "alternate";
      approach_set_id: string;
      tutor_plan_id: string;
    }>;
    alternates_available: boolean;
  };
  question: TutorQuestionView;
  session_id: string;
  previous_session_id?: string;
  switch_reason?: string;
  opening: TutorTurnResponse;
}

export interface LegacyExperienceResponse {
  kind: "legacy";
  task_id: string;
  reason: "canonical_root_missing" | "no_approved_binding" | "no_alternate_variant";
}

export type LearnExperienceResponse = TutorExperienceResponse | LegacyExperienceResponse;

// --------------------------------------------------------------------------- //
// 结构性 guards（与 actionRuntime.ts 同口径：只验证前端依赖的形状，不复制后端类型）
// --------------------------------------------------------------------------- //

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string";
}

export function isTutorVoiceAction(value: unknown): value is TutorVoiceAction {
  return isRecord(value) && hasString(value, "action_id") && hasString(value, "text")
    && typeof value.interruptible === "boolean";
}

export function isTutorWorkspaceAction(value: unknown): value is TutorWorkspaceAction {
  if (!isRecord(value) || !hasString(value, "action_id") || !hasString(value, "decision_id")
    || !hasString(value, "resource_id") || !hasString(value, "action_ref")) return false;
  // 波次 G 任务 2：demonstration 形态条目无 student_view（只读演示，携带
  // demonstration 形态 action_plan）；操作步形态要求 assessment 学生面投影。
  if (value.form === "demonstration") {
    return isRecord(value.action_plan) && Array.isArray((value.action_plan as Record<string, unknown>).actions);
  }
  return isRecord(value.student_view)
    && isRecord(value.action_plan) && Array.isArray((value.action_plan as Record<string, unknown>).actions);
}

function isTutorCheckpointView(value: unknown): value is TutorCheckpointView {
  return isRecord(value) && hasString(value, "checkpoint_id") && hasString(value, "part_id")
    && hasString(value, "route_id") && typeof value.index === "number" && typeof value.total === "number";
}

export function isTutorTurnResponse(value: unknown): value is TutorTurnResponse {
  if (!isRecord(value) || !hasString(value, "session_id") || !hasString(value, "client_turn_id")
    || typeof value.revision !== "number" || !isTutorCheckpointView(value.current_checkpoint)
    || !Array.isArray(value.voice) || !Array.isArray(value.workspace)) return false;
  if (!isStudentWorkspaceView(value.workspace_view)) return false;
  return value.voice.every(isTutorVoiceAction) && value.workspace.every(isTutorWorkspaceAction);
}

export function isTutorSessionView(value: unknown): value is TutorSessionView {
  return isRecord(value) && hasString(value, "session_id") && typeof value.revision === "number"
    && typeof value.completed === "boolean" && isTutorCheckpointView(value.current_checkpoint)
    && Array.isArray(value.pending_voice) && Array.isArray(value.pending_workspace)
    && (value.pending_voice as unknown[]).every(isTutorVoiceAction)
    && (value.pending_workspace as unknown[]).every(isTutorWorkspaceAction)
    && isStudentWorkspaceView(value.workspace_view);
}

export function isTutorExperienceResponse(value: unknown): value is TutorExperienceResponse {
  if (!isRecord(value) || value.kind !== "tutor" || !hasString(value, "session_id")
    || !isRecord(value.question) || !hasString(value.question, "stem") || !isRecord(value.binding)) return false;
  return isTutorTurnResponse(value.opening);
}
