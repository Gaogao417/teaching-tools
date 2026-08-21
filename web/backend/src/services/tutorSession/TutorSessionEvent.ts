/**
 * TutorSessionEvent v2 词表与 payload 构造器（Phase 5 / P5-01，ADR-006 因果链）。
 *
 * canonical 合同：contracts/schemas/runtime/v2/tutor-session-event.schema.json
 * （Zod 镜像 web/shared/canonical/schemas.ts tutorSessionEventV2Schema）。
 * 这里只做两件事：
 * 1. 以 TS 类型固定 17 类事件的 payload 形状（strict，字段集与 Zod 完全一致）；
 * 2. 提供 deterministic id 派生（TD-/VA-/WA-），使 event replay 可重建同构因果链。
 *
 * 语义约定（与本仓 store/投影共同遵守）：
 * - state_revision = 该事件所在 append 事务提交后的 session revision
 *   （同一批事件共享一个 state_revision；projection 按 sequence 细序应用）；
 * - causation_sequence = 直接触发本事件的前驱事件 sequence（root 事实事件省略）；
 * - student_* / reasoning_aligned 是学生事实；tutor_move_decided / *_action_issued
 *   / hint_issued / repair_delivered 是教学决策与呈现；*_completed 是执行结果；
 *   policy_failed / runtime_failure 是系统失败（P5-14：与学生错误三分离）。
 */

export type SessionMode = "teach" | "guided_solve" | "repair";
export type MoveType = "explain" | "prompt" | "hint" | "confirm" | "wait" | "repair";
export type Alignment = "expected_checkpoint" | "alternate_valid" | "incorrect" | "unclear" | "no_progress";
export type VoiceOutcome = "completed" | "interrupted" | "rejected" | "failed";
export type VoiceSource = "approved-resource" | "model-generated" | "deterministic-scaffold";
export type InputKind =
  | "reasoning_utterance"
  | "question_asked"
  | "pointing_evidence"
  | "structured_action_evidence"
  | "silence_observed"
  | "student_interrupted";

export const V2_EVENT_TYPES = [
  "session_started",
  "mode_changed",
  "student_input_recorded",
  "reasoning_aligned",
  "tutor_move_decided",
  "voice_action_issued",
  "voice_action_completed",
  "workspace_action_issued",
  "workspace_action_completed",
  "hint_issued",
  "student_progressed",
  "student_self_corrected",
  "working_diagnosis_updated",
  "repair_delivered",
  "policy_failed",
  "runtime_failure",
  "session_completed",
] as const;

export type V2EventType = (typeof V2_EVENT_TYPES)[number];

/** 要求 causation_sequence 的事件集合（与 Zod V2_CAUSATION_REQUIRED 一致）。 */
export const CAUSATION_REQUIRED: ReadonlySet<V2EventType> = new Set([
  "mode_changed",
  "reasoning_aligned",
  "tutor_move_decided",
  "voice_action_issued",
  "workspace_action_issued",
  "voice_action_completed",
  "workspace_action_completed",
  "hint_issued",
  "working_diagnosis_updated",
  "policy_failed",
]);

/** 学生事实事件：working diagnosis 的合法 evidence 来源（P5-14 反例排除系统失败）。 */
export const STUDENT_FACT_EVENT_TYPES: ReadonlySet<V2EventType> = new Set([
  "student_input_recorded",
  "reasoning_aligned",
  "student_progressed",
  "student_self_corrected",
]);

// --------------------------------------------------------------------------- //
// payload 形状（strict 字段集；free payload 事件用宽松 record）
// --------------------------------------------------------------------------- //

export interface SessionStartedPayload {
  plan: { artifact_id: string; version: string; content_hash: string };
  initial_mode: SessionMode;
}

export interface ModeChangedPayload {
  from_mode: SessionMode;
  to_mode: SessionMode;
}

export interface StudentInputRecordedPayload {
  input_kind: InputKind;
  text?: string;
  object_id?: string;
  action_id?: string;
  /** canonical 合同：JSON 字符串（写入侧由对象序列化）。 */
  action_payload?: string;
  duration_ms?: number;
  /** v3：processTurn 幂等键（同 clientTurnId 重复提交返回同结果）。 */
  client_turn_id?: string;
}

export interface ReasoningAlignedPayload {
  alignment: Alignment;
  checkpoint_id?: string;
  alternate_description?: string;
  /** v3：alternate 命中的备选路线（投影据此真正切换路线）。 */
  route_id?: string;
  /** v3：置信度（expected/alternate 生效门 ≥0.85、incorrect ≥0.75）。 */
  confidence?: number;
  aligner_version?: string;
  workflow_version?: string;
  /** v3：grounding 引用（CPn.expected / CPn.alt[i] / CPn.deviation[i] / route.Rn.entry）。 */
  grounding_refs?: string[];
}

export interface TutorMoveDecidedPayload {
  decision_id: string;
  move_type: MoveType;
  purpose_code: string;
  policy_version: string;
  source_event_sequence: number;
  source_state_revision: number;
  checkpoint_id?: string;
  assistance_level?: number;
  resource_ids?: string[];
  fallback?: boolean;
  /** v3：智能链 provenance（deterministic provider 不携带）。 */
  model?: string;
  workflow_version?: string;
  prompt_versions?: string[];
  voice_source?: VoiceSource;
  workspace_resource_ids?: string[];
}

export interface VoiceActionIssuedPayload {
  action_id: string;
  decision_id: string;
  text: string;
  interruptible?: boolean;
  /** v3：voice 文本来源（approved-resource 时携带资源 id）。 */
  resource_ref?: string;
  /** v3：受控动态生成批次 id（model-generated 时携带；不保存生成过程）。 */
  generation_id?: string;
  voice_source?: VoiceSource;
}

export interface ActionCompletedPayload {
  action_id: string;
  outcome: VoiceOutcome;
  failure_class?: string;
  message?: string;
}

export interface WorkspaceActionIssuedPayload {
  action_id: string;
  decision_id: string;
  capability: string;
  target_ids: string[];
  /** canonical 合同：JSON 字符串（写入侧由对象序列化）。 */
  command_payload?: string;
}

export interface HintIssuedPayload {
  decision_id: string;
  checkpoint_id: string;
  level: number;
}

export interface WorkingDiagnosisUpdatedPayload {
  summary_code: string;
  candidate_skill_ids?: string[];
  evidence_sequences: number[];
}

export interface PolicyFailedPayload {
  policy_version: string;
  failure_class: string;
  fallback_used: boolean;
  fallback_resource_id?: string;
}

export interface RuntimeFailurePayload {
  failure_class: string;
  message: string;
  related_event_sequence?: number;
}

/** free payload 事件（student_progressed / self_corrected / repair_delivered / completed）。 */
export interface StudentProgressedPayload {
  checkpoint_id: string;
  part_id: string;
  assisted: boolean;
  via_action_evidence?: boolean;
}

export interface StudentSelfCorrectedPayload {
  checkpoint_id: string;
  deviation_sequence: number;
}

export interface RepairDeliveredPayload {
  source_checkpoint_id: string;
  resource_id: string;
  decision_id: string;
}

export interface SessionCompletedPayload {
  reason: string;
}

export type V2EventPayload =
  | SessionStartedPayload
  | ModeChangedPayload
  | StudentInputRecordedPayload
  | ReasoningAlignedPayload
  | TutorMoveDecidedPayload
  | VoiceActionIssuedPayload
  | ActionCompletedPayload
  | WorkspaceActionIssuedPayload
  | HintIssuedPayload
  | WorkingDiagnosisUpdatedPayload
  | PolicyFailedPayload
  | RuntimeFailurePayload
  | StudentProgressedPayload
  | StudentSelfCorrectedPayload
  | RepairDeliveredPayload
  | SessionCompletedPayload;

/** 待追加 v2/v3 事件（sequence/state_revision 由 store 分配，调用方不携带）。 */
export interface PendingV2Event<P extends V2EventPayload = V2EventPayload> {
  event_type: V2EventType;
  payload: P;
  occurred_at: string;
  causation_sequence?: number;
  idempotency_key?: string;
}

/** 已存储 v2 事件（canonical 全形状，replay 输入）。v3 同构，仅 schema 常量不同。 */
export interface StoredV2Event<P extends V2EventPayload = V2EventPayload> {
  schema: "ai_teaching_tutor_session_event/v2" | "ai_teaching_tutor_session_event/v3";
  session_id: string;
  sequence: number;
  state_revision: number;
  occurred_at: string;
  event_type: V2EventType;
  payload: P;
  causation_sequence?: number;
  idempotency_key: string;
}

// --------------------------------------------------------------------------- //
// deterministic id 派生
// --------------------------------------------------------------------------- //

const SESSION_ID_PATTERN = /^TS-[0-9]{4,}$/;

export function assertSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`invalid tutor session id: ${sessionId}（须匹配 ^TS-[0-9]{4,}$）`);
  }
}

/**
 * decision/action id 的会话内序号从事件流推导（prior 同前缀事件数 + 1），
 * 保证 event replay 重建因果链时 id 分配一致。
 */
export function decisionId(sessionId: string, ordinal: number): string {
  return `TD-${sessionId}-${ordinal}`;
}

export function voiceActionId(sessionId: string, ordinal: number): string {
  return `VA-${sessionId}-${ordinal}`;
}

export function workspaceActionId(sessionId: string, ordinal: number): string {
  return `WA-${sessionId}-${ordinal}`;
}

export function countDecisions(events: ReadonlyArray<{ event_type: V2EventType }>): number {
  return events.filter((event) => event.event_type === "tutor_move_decided").length;
}

export function countVoiceActions(events: ReadonlyArray<{ event_type: V2EventType }>): number {
  return events.filter((event) => event.event_type === "voice_action_issued").length;
}

export function countWorkspaceActions(events: ReadonlyArray<{ event_type: V2EventType }>): number {
  return events.filter((event) => event.event_type === "workspace_action_issued").length;
}
