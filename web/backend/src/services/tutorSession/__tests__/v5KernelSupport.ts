/**
 * F2 kernel 测试共用数据工件（node 链与 vitest 共用）。
 *
 * 只含纯数据构造（node:crypto + type-only import），不加载 db —— 两种测试
 * 进程都能安全按各自时序 require/import（node 链须先 ensureSqlite 设
 * SQLITE_PATH 再加载 db 单例）。
 */
import { createHash } from "node:crypto";

import type { V5SessionStartedPayload } from "../TutorSessionEventV5";
import type { PendingV5Event, V5EventType } from "../TutorSessionEventV5";

export const SHA = (seed: string): string => `sha256:${createHash("sha256").update(seed).digest("hex")}`;

export const REF = {
  question: { artifact_id: "QT-SMV-002", version: "v2", content_hash: SHA("qt-f2") },
  approachSet: { artifact_id: "AS-SMV-002", version: "v1", content_hash: SHA("as-f2") },
  solutionGraph: { artifact_id: "RG-SMV-002", version: "v1", content_hash: SHA("rg-f2") },
  protocol: { artifact_id: "PR-SMV-002", version: "v1", content_hash: SHA("pr-f2") },
  tutorPlan: { artifact_id: "TP-SMV-002", version: "v6", content_hash: SHA("tp-f2") },
} as const;

export const PROFILE_SNAPSHOT = {
  profile_id: "PP-SMV-001",
  version: "v1",
  primary_provider: "deterministic-rules",
  fallback_provider: "safe-fallback",
  model_id: "none",
  prompt_version: "pv-1",
} as const;

export const at = (): string => new Date().toISOString();

export interface SessionStartOverrides {
  tutorPlanRefOverride?: { artifact_id: string; version: string; content_hash: string };
  initialBeat?: string;
}

export function sessionStartedPayload(options?: SessionStartOverrides): V5SessionStartedPayload {
  return {
    task_id: "goldenMinhangCross2020",
    scenario_id: "golden-similarity-mvp-001:QT-SMV-002",
    question_ref: { ...REF.question },
    approach_set_ref: { ...REF.approachSet },
    solution_graph_ref: { ...REF.solutionGraph },
    protocol_refs: [{ ...REF.protocol }],
    tutor_plan_ref: { ...(options?.tutorPlanRefOverride ?? REF.tutorPlan) },
    policy_profile_snapshot: { ...PROFILE_SNAPSHOT },
    initial_cursor: { protocol_id: REF.protocol.artifact_id, beat_id: options?.initialBeat ?? "BT-01" },
  };
}

export function startInput(sessionId: string, options?: SessionStartOverrides) {
  return {
    sessionId,
    studentId: "student-f2",
    sessionStarted: sessionStartedPayload(options),
    occurred_at: at(),
  };
}

/** 便捷构造（sequence/state_revision/idempotency 由 store 分配）。 */
export function ev(
  event_type: V5EventType,
  payload: unknown,
  options?: { causation_sequence?: number; idempotency_key?: string },
): PendingV5Event {
  return {
    event_type,
    payload,
    occurred_at: at(),
    ...(options?.causation_sequence !== undefined ? { causation_sequence: options.causation_sequence } : {}),
    ...(options?.idempotency_key ? { idempotency_key: options.idempotency_key } : {}),
  };
}

export function decisionPayload(sessionId: string, ordinal: number, overrides: Record<string, unknown> = {}) {
  return {
    decision_id: `TD-${sessionId}-${ordinal}`,
    decision_kind: "execute_beat",
    protocol_id: REF.protocol.artifact_id,
    beat_id: "BT-01",
    policy_version: "navigator/v1",
    source_event_sequence: 2,
    source_state_revision: 2,
    ...overrides,
  };
}

export function voiceIssuedPayload(sessionId: string, ordinal: number, decisionOrdinal: number) {
  return {
    action_id: `VA-${sessionId}-${ordinal}`,
    decision_id: `TD-${sessionId}-${decisionOrdinal}`,
    text: "先看这两个三角形。",
    source: "deterministic-scaffold",
    interruptible: true,
  };
}

export function surfaceIssuedPayload(sessionId: string, ordinal: number, decisionOrdinal: number) {
  return {
    action_id: `WSA-${sessionId}-${ordinal}`,
    decision_id: `TD-${sessionId}-${decisionOrdinal}`,
    surface: "geometry",
    capability: "similarity.highlight-target",
    target_ids: ["seg-AB"],
    reveal_scope: "target_highlight",
  };
}

export function outcomePayload(actionId: string, actionKind: "voice" | "workspace_surface" | "student_command", outcome: "completed" | "rejected" | "interrupted" | "failed", extra: Record<string, unknown> = {}) {
  return { action_id: actionId, action_kind: actionKind, outcome, ...extra };
}

/**
 * 标准正向旅程（G2 主证据）：start → intent → interpretation+decision →
 * voice+wsa issued → outcomes（completed）→ gate satisfied → transition →
 * inquiry open/return → support evidence → failure 事实 → progressed → completed。
 * 返回逐批 append 计划（expectedRevision 由调用方跟踪）。
 */
export function journeyBatches(sessionId: string): PendingV5Event[][] {
  const decision1 = `TD-${sessionId}-1`;
  return [
    [ev("student_intent_recorded", { intent_kind: "submit_answer", text: "角相等", client_request_id: "cr-0001" })],
    [
      ev("semantic_interpretation_recorded", {
        intent: "derive_ratio_via_similarity",
        reasoning_location: "aligned",
        confidence: 0.92,
        interpreter_version: "interpreter/v1",
      }, { causation_sequence: 2 }),
      ev("policy_decision_made", decisionPayload(sessionId, 1), { causation_sequence: 2 }),
    ],
    [
      ev("voice_action_issued", voiceIssuedPayload(sessionId, 1, 1), { causation_sequence: 4 }),
      ev("workspace_surface_action_issued", surfaceIssuedPayload(sessionId, 1, 1), { causation_sequence: 4 }),
    ],
    [
      ev("action_outcome_recorded", outcomePayload(`VA-${sessionId}-1`, "voice", "completed"), { causation_sequence: 5 }),
      ev("action_outcome_recorded", outcomePayload(`WSA-${sessionId}-1`, "workspace_surface", "completed", { resulting_revision: 2 }), { causation_sequence: 6 }),
    ],
    [
      ev("gate_evaluated", { gate_id: "GT-01", beat_id: "BT-01", satisfied: true, evidence_sequence: 2 }, { causation_sequence: 2 }),
    ],
    [
      ev("policy_decision_made", decisionPayload(sessionId, 2, {
        decision_kind: "transition_beat",
        beat_id: "BT-01",
        to_beat_id: "BT-02",
        source_event_sequence: 9,
        source_state_revision: 6,
        transition_basis: { basis: "gate_satisfied", gate_id: "GT-01" },
      }), { causation_sequence: 2 }),
    ],
    [
      ev("inquiry_opened", { inquiry_id: `IQ-${sessionId}-0001`, return_beat_id: "BT-02", trigger: "ask_question" }, { causation_sequence: 2 }),
      ev("inquiry_returned", { inquiry_id: `IQ-${sessionId}-0001`, return_beat_id: "BT-02" }, { causation_sequence: 11 }),
    ],
    [
      ev("external_support_recorded", {
        evidence_id: `ESE-${sessionId}-0001`,
        beat_id: "BT-02",
        support_kinds: ["foreground"],
        initiated_by: "tutor_initiated",
        action_ids: [`VA-${sessionId}-1`],
        derived_partial: false,
      }, { causation_sequence: 10 }),
    ],
    [
      ev("policy_failed", { policy_version: "navigator/v1", failure_class: "no_legal_transition", fallback_used: false }, { causation_sequence: 2 }),
      ev("presentation_failed", { decision_id: decision1, failure_class: "timeout", message: "voice provider timeout" }, { causation_sequence: 4 }),
      ev("runtime_failure", { failure_class: "internal_error", message: "probe" }),
    ],
    [
      ev("student_progressed", { beat_id: "BT-02", part_id: "1", evidence_sequence: 2 }, { causation_sequence: 2 }),
    ],
    [
      ev("session_completed", { final_beat_id: "BT-02", completed_parts: ["1"] }),
    ],
  ];
}
