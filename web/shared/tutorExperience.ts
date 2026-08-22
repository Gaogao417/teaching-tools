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
}

export interface TutorTurnResponse {
  session_id: string;
  revision: number;
  client_turn_id: string;
  idempotent_replay: boolean;
  mode: "teach" | "guided_solve" | "repair";
  current_checkpoint: { checkpoint_id: string; part_id: string; route_id: string };
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
  workspace: TutorWorkspaceAction[];
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
  current_checkpoint: { checkpoint_id: string; part_id: string; route_id: string };
  pending_voice: TutorVoiceAction[];
  pending_workspace: TutorWorkspaceAction[];
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
    || !hasString(value, "resource_id") || !hasString(value, "action_ref") || !isRecord(value.student_view)) return false;
  return isRecord(value.action_plan) && Array.isArray((value.action_plan as Record<string, unknown>).actions);
}

export function isTutorTurnResponse(value: unknown): value is TutorTurnResponse {
  if (!isRecord(value) || !hasString(value, "session_id") || !hasString(value, "client_turn_id")
    || typeof value.revision !== "number" || !isRecord(value.current_checkpoint)
    || !Array.isArray(value.voice) || !Array.isArray(value.workspace)) return false;
  return value.voice.every(isTutorVoiceAction) && value.workspace.every(isTutorWorkspaceAction);
}

export function isTutorSessionView(value: unknown): value is TutorSessionView {
  return isRecord(value) && hasString(value, "session_id") && typeof value.revision === "number"
    && typeof value.completed === "boolean" && isRecord(value.current_checkpoint)
    && Array.isArray(value.pending_voice) && Array.isArray(value.pending_workspace)
    && (value.pending_voice as unknown[]).every(isTutorVoiceAction)
    && (value.pending_workspace as unknown[]).every(isTutorWorkspaceAction);
}

export function isTutorExperienceResponse(value: unknown): value is TutorExperienceResponse {
  if (!isRecord(value) || value.kind !== "tutor" || !hasString(value, "session_id")
    || !isRecord(value.question) || !hasString(value.question, "stem") || !isRecord(value.binding)) return false;
  return isTutorTurnResponse(value.opening);
}
