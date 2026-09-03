/**
 * F7 Step 2 V6 kernel 测试共用数据工件（node 链与 vitest 共用）。
 *
 * 只含纯数据构造（node:crypto + type-only import），不加载 db——两种测试进程
 * 都能安全按各自时序 require/import（node 链须先 ensureSqlite 设 SQLITE_PATH
 * 再加载 db 单例）。合成 session-pinned registry 不依赖真实 plan 导入。
 */
import { createHash } from "node:crypto";

import type { V5SessionStartedPayload } from "../TutorSessionEventV5";
import type { PendingV6Event, V6EventType } from "../TutorSessionEventV6";
import type { V6RegistryProvider } from "../RuntimeStateRebuilderV6";
import { syntheticSessionPinnedRegistry } from "../SessionPinnedCapabilityRegistry";

export const SHA = (seed: string): string => `sha256:${createHash("sha256").update(seed).digest("hex")}`;

export const REF = {
  question: { artifact_id: "QT-SMV-002", version: "v2", content_hash: SHA("qt-f7") },
  approachSet: { artifact_id: "AS-SMV-002", version: "v1", content_hash: SHA("as-f7") },
  solutionGraph: { artifact_id: "RG-SMV-002", version: "v1", content_hash: SHA("rg-f7") },
  protocol: { artifact_id: "PR-SMV-002", version: "v1", content_hash: SHA("pr-f7") },
  tutorPlan: { artifact_id: "TP-SMV-002", version: "v7", content_hash: SHA("tp-f7") },
} as const;

export const PROFILE_SNAPSHOT = {
  profile_id: "PP-SMV-001",
  version: "v1",
  primary_provider: "deterministic-rules",
  fallback_provider: "safe-fallback",
  model_id: "none",
  prompt_version: "pv-1",
} as const;

/** 合成会话的固定 catalog pin（registry provider 对账负例用）。 */
export const SYNTHETIC_CATALOG_PIN = {
  catalog_schema_version: 5,
  content_hash: SHA("v6-synthetic-catalog"),
  entry_count: 1,
} as const;

export const SYNTHETIC_TASK_ID = "goldenMinhangCross2020";

export const at = (): string => new Date().toISOString();

export function sessionStartedPayloadV6(options?: {
  tutorPlanRefOverride?: { artifact_id: string; version: string; content_hash: string };
  withCatalogPin?: boolean;
}): V5SessionStartedPayload {
  return {
    task_id: SYNTHETIC_TASK_ID,
    scenario_id: "golden-similarity-mvp-001:QT-SMV-002",
    question_ref: { ...REF.question },
    approach_set_ref: { ...REF.approachSet },
    solution_graph_ref: { ...REF.solutionGraph },
    protocol_refs: [{ ...REF.protocol }],
    tutor_plan_ref: { ...(options?.tutorPlanRefOverride ?? REF.tutorPlan) },
    policy_profile_snapshot: { ...PROFILE_SNAPSHOT },
    initial_cursor: { protocol_id: REF.protocol.artifact_id, beat_id: "BT-01" },
    ...(options?.withCatalogPin ? { workspace_catalog_pin: { ...SYNTHETIC_CATALOG_PIN } } : {}),
  };
}

export function startInputV6(sessionId: string, options?: { withCatalogPin?: boolean }) {
  return {
    sessionId,
    studentId: "student-f7",
    sessionStarted: sessionStartedPayloadV6(options),
    occurred_at: at(),
  };
}

/** 合成 session-pinned registry（capability 面 + target 宇宙，含已声明构造产物）。 */
export function syntheticRegistry() {
  return syntheticSessionPinnedRegistry(
    [
      { capability: "geometry.construct", surface: "geometry", origin: "tutor" },
      { capability: "geometry.annotate", surface: "geometry", origin: "tutor" },
      { capability: "similarity.foreground-segment", surface: "geometry", origin: "tutor" },
      { capability: "board.reveal-entry", surface: "solution_board", origin: "tutor" },
      { capability: "board.activate-entry", surface: "solution_board", origin: "tutor" },
    ],
    ["seg-AB", "seg-CD", "line-XY", "pt-P", "BE-01", "BE-02"],
  );
}

/** 默认 provider：忽略 payload，恒返回合成 registry。 */
export const syntheticRegistryProvider: V6RegistryProvider = () => syntheticRegistry();

/** pin 对账 provider：payload 带 workspace_catalog_pin 时必须与合成值一致。 */
export const pinCheckingRegistryProvider: V6RegistryProvider = (payload) => {
  const pin = (payload.workspace_catalog_pin as { content_hash?: string } | undefined)?.content_hash;
  if (pin !== undefined && pin !== SYNTHETIC_CATALOG_PIN.content_hash) {
    throw new Error(`synthetic catalog pin mismatch: ${pin}`);
  }
  return syntheticRegistry();
};

/** 便捷构造（sequence/state_revision/idempotency 由 store 分配）。 */
export function ev6(
  event_type: V6EventType,
  payload: unknown,
  options?: { causation_sequence?: number; idempotency_key?: string },
): PendingV6Event {
  return {
    event_type,
    payload,
    occurred_at: at(),
    ...(options?.causation_sequence !== undefined ? { causation_sequence: options.causation_sequence } : {}),
    ...(options?.idempotency_key ? { idempotency_key: options.idempotency_key } : {}),
  };
}

// --------------------------------------------------------------------------- //
// presentation 家族 payload 构造（单一有序 actions[]：Geometry→Voice→Board）
// --------------------------------------------------------------------------- //

export function decisionPayloadV6(sessionId: string, ordinal: number, overrides: Record<string, unknown> = {}) {
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

export function plannedPayloadV6(sessionId: string, sequenceOrdinal: number, overrides: Record<string, unknown> = {}) {
  const decisionId = `TD-${sessionId}-${sequenceOrdinal}`;
  return {
    sequence_id: `PS-000${sequenceOrdinal}`,
    decision_id: decisionId,
    protocol_id: REF.protocol.artifact_id,
    beat_id: "BT-01",
    actions: [
      {
        ordinal: 0,
        kind: "workspace",
        workspace_action: {
          action_id: `WSA-${sessionId}-${sequenceOrdinal}0`,
          decision_id: decisionId,
          surface: "geometry",
          capability: "geometry.construct",
          origin: "tutor",
          target_ids: ["seg-AB"],
          command_payload: JSON.stringify({ type: "construct-carrier", outputLineId: "line-XY" }),
          reveal_scope: "none",
        },
      },
      {
        ordinal: 1,
        kind: "voice",
        voice_action: {
          action_id: `VA-${sessionId}-${sequenceOrdinal}1`,
          decision_id: decisionId,
          text: "先看这两个三角形。",
          source: "deterministic-scaffold",
          interruptible: true,
        },
      },
      {
        ordinal: 2,
        kind: "workspace",
        workspace_action: {
          action_id: `WSA-${sessionId}-${sequenceOrdinal}2`,
          decision_id: decisionId,
          surface: "solution_board",
          capability: "board.reveal-entry",
          origin: "tutor",
          target_ids: ["BE-01"],
          reveal_scope: "step_narration",
        },
      },
    ],
    ...overrides,
  };
}

export function actionRefV6(sessionId: string, sequenceOrdinal: number, ordinal: number, kind: "voice" | "workspace", overrides: Record<string, unknown> = {}) {
  const actionId = kind === "voice" ? `VA-${sessionId}-${sequenceOrdinal}${ordinal}` : `WSA-${sessionId}-${sequenceOrdinal}${ordinal}`;
  return { sequence_id: `PS-000${sequenceOrdinal}`, ordinal, action_id: actionId, kind, ...overrides };
}

export function appliedV6(sessionId: string, sequenceOrdinal: number, ordinal: number, resultingWorkspaceRevision?: number) {
  return actionRefV6(sessionId, sequenceOrdinal, ordinal, "workspace", {
    ...(resultingWorkspaceRevision !== undefined ? { resulting_workspace_revision: resultingWorkspaceRevision } : {}),
  });
}

export function outcomeV6(
  sessionId: string,
  sequenceOrdinal: number,
  ordinal: number,
  kind: "voice" | "workspace",
  outcome: "presented" | "interrupted" | "failed",
  extra: Record<string, unknown> = {},
) {
  return actionRefV6(sessionId, sequenceOrdinal, ordinal, kind, { outcome, ...extra });
}

/**
 * 标准正向旅程（G2 主证据，v6 语义）：start → student_input → interpretation
 * + intent（causation→input，同 client_request_id）+ decision → sequence planned
 * （Geometry 构造→Voice→Board reveal）→ 逐项 validated/applied/delivered/
 * presented（workspace_revision 在 applied 推进；最后一项 presented →
 * awaiting_evidence）→ gate satisfied → transition BT-02 → completed。
 * 返回逐批 append 计划（expectedRevision 由调用方跟踪）。
 */
export function journeyBatchesV6(sessionId: string): PendingV6Event[][] {
  const decisionId = `TD-${sessionId}-1`;
  return [
    [ev6("student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "角相等" }, client_request_id: "cr-0001" })],
    [
      ev6("semantic_interpretation_recorded", {
        intent: "derive_ratio_via_similarity",
        reasoning_location: "aligned",
        confidence: 0.92,
        interpreter_version: "interpreter/v1",
      }, { causation_sequence: 2 }),
      ev6("student_intent_recorded", { intent_kind: "submit_answer", text: "角相等", client_request_id: "cr-0001" }, { causation_sequence: 2 }),
      ev6("policy_decision_made", decisionPayloadV6(sessionId, 1), { causation_sequence: 4 }),
    ],
    [
      ev6("presentation_sequence_planned", plannedPayloadV6(sessionId, 1), { causation_sequence: 5 }),
    ],
    // ordinal 0（Geometry 构造）：validated → applied（workspace_revision=1）→ delivered。
    [
      ev6("presentation_action_validated", actionRefV6(sessionId, 1, 0, "workspace"), { causation_sequence: 6 }),
      ev6("presentation_action_applied", appliedV6(sessionId, 1, 0, 1), { causation_sequence: 6 }),
      ev6("presentation_action_delivered", actionRefV6(sessionId, 1, 0, "workspace"), { causation_sequence: 6 }),
    ],
    [ev6("presentation_action_outcome_recorded", outcomeV6(sessionId, 1, 0, "workspace", "presented"), { causation_sequence: 9 })],
    // ordinal 1（Voice）：validated → delivered（无权威状态应用）。
    [
      ev6("presentation_action_validated", actionRefV6(sessionId, 1, 1, "voice"), { causation_sequence: 6 }),
      ev6("presentation_action_delivered", actionRefV6(sessionId, 1, 1, "voice"), { causation_sequence: 6 }),
    ],
    [ev6("presentation_action_outcome_recorded", outcomeV6(sessionId, 1, 1, "voice", "presented"), { causation_sequence: 12 })],
    // ordinal 2（Board reveal）：validated → applied（workspace_revision=2）→ delivered。
    [
      ev6("presentation_action_validated", actionRefV6(sessionId, 1, 2, "workspace"), { causation_sequence: 6 }),
      ev6("presentation_action_applied", appliedV6(sessionId, 1, 2, 2), { causation_sequence: 6 }),
      ev6("presentation_action_delivered", actionRefV6(sessionId, 1, 2, "workspace"), { causation_sequence: 6 }),
    ],
    // 最后一项 presented：cursor idle + presenting → awaiting_evidence。
    [ev6("presentation_action_outcome_recorded", outcomeV6(sessionId, 1, 2, "workspace", "presented"), { causation_sequence: 16 })],
    [
      ev6("gate_evaluated", { gate_id: "GT-01", beat_id: "BT-01", satisfied: true, evidence_sequence: 2 }, { causation_sequence: 2 }),
    ],
    [
      ev6("policy_decision_made", decisionPayloadV6(sessionId, 2, {
        decision_kind: "transition_beat",
        beat_id: "BT-01",
        to_beat_id: "BT-02",
        source_event_sequence: 18,
        source_state_revision: 11,
      }), { causation_sequence: 2 }),
    ],
    [
      ev6("session_completed", { final_beat_id: "BT-02", completed_parts: ["1"] }),
    ],
  ];
}
