/**
 * P5-02/11/12/14：TutorRuntimeState 投影测试（五类 state 由 plan+events 重建、
 * assistance 台账、working diagnosis、repair 上下文、失败三分、revision 快照）。
 */
import assert from "node:assert/strict";

const { projectRuntimeState, stateAtRevision } = require("../TutorRuntimeStateProjection") as typeof import("../TutorRuntimeStateProjection");

interface TestPlan {
  checkpoints: Array<{ checkpoint_id: string; part_id: string }>;
  recommended_routes: Array<{ route_id: string; role: string; part_id?: string; checkpoint_ids: string[] }>;
}

const PLAN: TestPlan = {
  checkpoints: [
    { checkpoint_id: "CP1", part_id: "1" },
    { checkpoint_id: "CP2", part_id: "1" },
    { checkpoint_id: "CP3", part_id: "1" },
    { checkpoint_id: "CP4", part_id: "2" },
  ],
  recommended_routes: [
    { route_id: "R1", role: "primary", part_id: "1", checkpoint_ids: ["CP1", "CP2", "CP3"] },
    { route_id: "R3", role: "primary", part_id: "2", checkpoint_ids: ["CP4"] },
  ],
};

function event(sequence: number, state_revision: number, event_type: string, payload: Record<string, unknown>, causation?: number) {
  return {
    schema: "ai_teaching_tutor_session_event/v2" as const,
    session_id: "TS-9201",
    sequence,
    state_revision,
    occurred_at: "2026-08-21T00:00:00Z",
    event_type,
    payload,
    ...(causation !== undefined ? { causation_sequence: causation } : {}),
    idempotency_key: `TS-9201:${sequence}`,
  };
}

function main(): void {
  const events = [
    event(1, 1, "session_started", { plan: { artifact_id: "TP-SMV-001", version: "v2", content_hash: "sha256:" + "0".repeat(64) }, initial_mode: "teach" }),
    event(2, 2, "tutor_move_decided", { decision_id: "TD-1", move_type: "explain", purpose_code: "explain.open", policy_version: "p/v1", source_event_sequence: 1, source_state_revision: 1, checkpoint_id: "CP1" }, 1),
    event(3, 3, "mode_changed", { from_mode: "teach", to_mode: "guided_solve" }, 2),
    event(4, 4, "student_input_recorded", { input_kind: "reasoning_utterance", text: "硬凑勾股" }),
    event(5, 4, "reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" }, 4),
    event(6, 5, "tutor_move_decided", { decision_id: "TD-2", move_type: "hint", purpose_code: "hint.escalate", policy_version: "p/v1", source_event_sequence: 5, source_state_revision: 4, checkpoint_id: "CP1", assistance_level: 1 }, 5),
    event(7, 5, "hint_issued", { decision_id: "TD-2", checkpoint_id: "CP1", level: 1 }, 6),
    event(8, 6, "student_input_recorded", { input_kind: "reasoning_utterance", text: "写出判定" }),
    event(9, 6, "reasoning_aligned", { alignment: "expected_checkpoint", checkpoint_id: "CP1" }, 8),
    event(10, 6, "student_progressed", { checkpoint_id: "CP1", part_id: "1", assisted: true }, 9),
    event(11, 7, "working_diagnosis_updated", { summary_code: "progress.with_assistance", evidence_sequences: [7, 9] }, 6),
    event(12, 8, "policy_failed", { policy_version: "p/v1", failure_class: "policy_timeout", fallback_used: true }, 11),
    event(13, 9, "runtime_failure", { failure_class: "voice_provider_error", message: "tts down" }),
    event(14, 10, "student_input_recorded", { input_kind: "student_interrupted" }),
    event(15, 10, "voice_action_completed", { action_id: "VA-1", outcome: "interrupted" }, 14),
    event(16, 11, "tutor_move_decided", { decision_id: "TD-3", move_type: "repair", purpose_code: "repair.ladder_exhausted", policy_version: "p/v1", source_event_sequence: 14, source_state_revision: 10, checkpoint_id: "CP2", resource_ids: ["RES13"] }, 14),
    event(17, 11, "mode_changed", { from_mode: "guided_solve", to_mode: "repair" }, 16),
    event(18, 11, "repair_delivered", { source_checkpoint_id: "CP2", resource_id: "RES13", decision_id: "TD-3" }, 16),
    event(19, 12, "workspace_action_issued", { action_id: "WA-1", decision_id: "TD-3", capability: "similarity.plan-similarity-proof", target_ids: [], command_payload: { resource_id: "RES14" } }, 16),
    event(20, 12, "workspace_action_completed", { action_id: "WA-1", outcome: "completed" }, 19),
    event(21, 13, "mode_changed", { from_mode: "repair", to_mode: "guided_solve" }, 18),
    event(22, 14, "session_completed", { reason: "finished" }),
  ];

  const state = projectRuntimeState(PLAN as never, events as never);

  assert.equal(state.mode, "guided_solve");
  assert.equal(state.initial_mode, "teach");
  assert.equal(state.revision, 14);
  assert.equal(state.last_sequence, 22);
  assert.equal(state.completed, true);

  // curriculum：CP1 完成（经 assisted progression），repair 恢复不额外推进
  const part1 = state.curriculum.parts[0];
  assert.deepEqual(part1.completed_checkpoints, ["CP1"]);
  assert.equal(part1.current_index, 1);

  // assistance 台账（P5-11）
  const ledger = state.assistance["CP1"];
  assert.deepEqual(ledger.hintLevelsIssued, [1]);
  assert.equal(ledger.lastHintSequence, 7);
  assert.deepEqual(ledger.incorrectSequences, [5]);
  assert.equal(ledger.explainedSequences.length, 1);
  assert.ok(ledger.promptsIssued >= 0);

  // reasoning：打断与对齐
  assert.deepEqual(state.reasoning.interruptions, [15]);
  assert.equal(state.reasoning.last_alignment?.alignment, "expected_checkpoint");
  assert.equal(state.reasoning.current_checkpoint_id, "CP2", "CP1 推进后 current 应落在 CP2");

  // workspace
  assert.equal(state.workspace.action_history.length, 1);
  assert.equal(state.workspace.action_history[0].outcome, "completed");
  assert.equal(state.workspace.action_history[0].resource_id, "RES14");
  assert.equal(state.workspace.active_action_id, undefined);

  // working diagnosis（P5-12）与失败三分（P5-14）
  assert.equal(state.working_diagnosis.length, 1);
  assert.equal(state.working_diagnosis[0].summary_code, "progress.with_assistance");
  assert.deepEqual(state.failures.policy_failures, [12]);
  assert.deepEqual(state.failures.runtime_failures, [13]);

  // repair 上下文：进入→退出后清空
  assert.equal(state.repair.active, false);

  // repair 中途快照（revision 11）：mode=repair、上下文指向 CP2
  const midRepair = stateAtRevision(PLAN as never, events as never, 11);
  assert.equal(midRepair.mode, "repair");
  assert.equal(midRepair.repair.active, true);
  assert.equal(midRepair.repair.source_checkpoint_id, "CP2");
  assert.equal(midRepair.mode_before_repair, "guided_solve");

  // revision 快照确定性：同一前缀两次投影一致
  const again = stateAtRevision(PLAN as never, events as never, 6);
  const again2 = stateAtRevision(PLAN as never, events as never, 6);
  assert.deepEqual(again, again2);

  console.log("PASS tutorRuntimeStateProjection (five-state replay, ledger, repair, failures)");
}

main();
