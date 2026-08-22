/**
 * Canonical candidate state + 统一决策不变量层单测（Phase 5 完整收口计划 §3，
 * TS-7004/TS-7075 B1 族与护栏盲区闭合的回归锚）。
 */
import { describe, expect, it } from "vitest";

import { projectCandidateState } from "../candidateState";
import { enforceDecisionInvariants } from "../decisionInvariants";
import { projectRuntimeState, type TutorRuntimeState } from "../TutorRuntimeStateProjection";
import type { PendingV2Event, StoredV2Event } from "../TutorSessionEvent";
import type { TutorPlanV2Payload } from "../../planBuild/canonicalInputs";
import type { PolicyTrigger } from "../../tutorPolicy/TutorPolicyPort";

// --------------------------------------------------------------------------- //
// fixtures（与 tutorIntelligence.vitest.ts 同形状的最小 plan）
// --------------------------------------------------------------------------- //

const PLAN = {
  artifact_id: "TP-SMV-001",
  version: "v2",
  content_hash: "sha256:" + "0".repeat(64),
  checkpoints: [
    {
      checkpoint_id: "CP1",
      part_id: "1",
      expected_reasoning: "学生看到 ∠DAC=∠ACD 能立刻写出 AD=DC 并设元。",
      skill_annotations: [{ skill_id: "SKILL-SMV-001", evidence_refs: ["TA-SMV-009@v1#S1"] }],
      common_deviations: ["在斜三角形中硬凑勾股"],
    },
    { checkpoint_id: "CP2", part_id: "1", expected_reasoning: "学生能列出翻折不变量清单。" },
  ],
  recommended_routes: [
    { route_id: "R1", role: "primary", part_id: "1", checkpoint_ids: ["CP1", "CP2"] },
  ],
  resources: [
    { resource_id: "RES1", kind: "explanation", checkpoint_id: "CP1", content: "先标注等腰条件，再由等角对等边设元。" },
    { resource_id: "RES2", kind: "hint", checkpoint_id: "CP1", assistance_level: 1, content: "翻折保长保角，先列哪些量不变？" },
    { resource_id: "RES3", kind: "hint", checkpoint_id: "CP1", assistance_level: 2, content: "翻折后 AE=AC、DE=DC，逐项对照。" },
    { resource_id: "RES4", kind: "repair", checkpoint_id: "CP2", content: "回到目标节点，教师重新示范后请学生复述关键一步。" },
  ],
  policy_constraints: {
    allowed_move_types: ["explain", "prompt", "hint", "confirm", "wait", "repair"],
    maximum_assistance_level: 2,
    allowed_capabilities: [],
  },
} as unknown as TutorPlanV2Payload;

let sequence = 0;
function event(eventType: StoredV2Event["event_type"], payload: Record<string, unknown>): StoredV2Event {
  sequence += 1;
  return {
    schema: "ai_teaching_tutor_session_event/v2",
    session_id: "TS-9500",
    sequence,
    state_revision: sequence,
    occurred_at: "2026-08-22T00:00:00Z",
    event_type: eventType,
    payload: payload as unknown as StoredV2Event["payload"],
    idempotency_key: `TS-9500:${sequence}`,
  };
}

function pending(eventType: PendingV2Event["event_type"], payload: Record<string, unknown>): PendingV2Event {
  return {
    event_type: eventType,
    payload: payload as unknown as PendingV2Event["payload"],
    occurred_at: "2026-08-22T00:00:00Z",
  };
}

function baseEvents(): StoredV2Event[] {
  sequence = 0;
  return [
    event("session_started", {
      plan: { artifact_id: "TP-SMV-001", version: "v2", content_hash: "sha256:" + "0".repeat(64) },
      initial_mode: "guided_solve",
    }),
  ];
}

function incorrectTrigger(alignmentSequence: number, checkpointId = "CP1"): PolicyTrigger {
  return {
    kind: "student_input",
    event_sequence: alignmentSequence,
    input_kind: "reasoning_utterance",
    alignment: "incorrect",
    alignment_checkpoint_id: checkpointId,
  };
}

describe("projectCandidateState", () => {
  it("空 pending 批 = 已提交投影（逐字段一致）", () => {
    const events = baseEvents();
    expect(projectCandidateState(PLAN, events, [])).toEqual(projectRuntimeState(PLAN, events));
  });

  it("pending 对齐事实全量进入投影：incorrect 台账 + 自我修正 + 推进（TS-7075 视角）", () => {
    const events = [
      ...baseEvents(),
      event("student_input_recorded", { input_kind: "reasoning_utterance", text: "偏差输入" }),
      event("reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" }),
      event("tutor_move_decided", { decision_id: "TD-1", move_type: "prompt", purpose_code: "prompt.self_check", policy_version: "t" }),
      event("voice_action_issued", { action_id: "VA-1", decision_id: "TD-1", text: "自查", interruptible: true }),
      event("voice_action_completed", { action_id: "VA-1", outcome: "completed" }),
      event("student_input_recorded", { input_kind: "reasoning_utterance", text: "正确输入" }),
    ];
    const committed = projectRuntimeState(PLAN, events);
    // committed 视角：看不到本轮 expected 对齐（旧 stateForDecision 的盲区）。
    expect(committed.assistance.CP1?.incorrectSequences).toEqual([3]);
    expect(committed.reasoning.self_corrections).toEqual([]);

    const pendingBatch: PendingV2Event[] = [
      pending("reasoning_aligned", { alignment: "expected_checkpoint", checkpoint_id: "CP1" }),
      pending("student_self_corrected", { checkpoint_id: "CP1", deviation_sequence: 3 }),
      pending("student_progressed", { checkpoint_id: "CP1", part_id: "1", assisted: false }),
    ];
    const candidate = projectCandidateState(PLAN, events, pendingBatch);
    expect(candidate.assistance.CP1?.incorrectSequences).toEqual([3]);
    expect(candidate.reasoning.self_corrections.at(-1)).toMatchObject({
      checkpoint_id: "CP1",
      deviation_sequence: 3,
      sequence: 9, // base 8 + 1：预指派 sequence 与 store 追加规则一致
    });
    expect(candidate.reasoning.current_checkpoint_id).toBe("CP2");
    expect(candidate.revision).toBe(committed.revision + 1);
  });
});

describe("enforceDecisionInvariants", () => {
  function stateOf(events: StoredV2Event[], pendingBatch: PendingV2Event[] = []): TutorRuntimeState {
    return projectCandidateState(PLAN, events, pendingBatch);
  }

  it("I1：首个 incorrect 上的 hint 提案改写 prompt.self_check（丢弃动态文案）", () => {
    const events = [...baseEvents()];
    const trigger = incorrectTrigger(2);
    const result = enforceDecisionInvariants({
      draft: { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: "CP1", assistance_level: 1, resource_ids: ["RES2"] },
      plan: PLAN,
      candidateState: stateOf(events, [pending("reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" })]),
      trigger,
    });
    expect(result.draft).toMatchObject({ move_type: "prompt", purpose_code: "prompt.self_check", checkpoint_id: "CP1" });
    expect(result.dropDynamicVoice).toBe(true);
    expect(result.rewrites).toContain("first_incorrect_self_check");
  });

  it("I2：重复档位 hint 改写为首个未用档 + approved 资源；缺省档位补 L1", () => {
    const events = [
      ...baseEvents(),
      event("reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" }),
      event("tutor_move_decided", { decision_id: "TD-1", move_type: "prompt", purpose_code: "prompt.self_check", policy_version: "t" }),
      event("hint_issued", { decision_id: "TD-2", checkpoint_id: "CP1", level: 1 }),
      event("reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" }),
    ];
    const trigger = incorrectTrigger(6);
    const candidate = stateOf(events, [pending("reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" })]);
    const repeat = enforceDecisionInvariants({
      draft: { move_type: "hint", purpose_code: "hint.ladder", checkpoint_id: "CP1", assistance_level: 1, resource_ids: ["RES2"] },
      plan: PLAN,
      candidateState: candidate,
      trigger,
    });
    expect(repeat.draft).toMatchObject({ move_type: "hint", assistance_level: 2, resource_ids: ["RES3"] });
    expect(repeat.rewrites[0]).toContain("hint_level_canonicalized:1->2");

    const noLevel = enforceDecisionInvariants({
      draft: { move_type: "hint", purpose_code: "hint.ladder", checkpoint_id: "CP1" },
      plan: PLAN,
      candidateState: projectRuntimeState(PLAN, [
        ...baseEvents(),
        event("reasoning_aligned", { alignment: "unclear", checkpoint_id: "CP1" }),
        event("tutor_move_decided", { decision_id: "TD-1", move_type: "prompt", purpose_code: "prompt.clarify", policy_version: "t" }),
        event("tutor_move_decided", { decision_id: "TD-2", move_type: "prompt", purpose_code: "prompt.diagnostic_probe", policy_version: "t" }),
      ]),
      trigger: { kind: "student_input", event_sequence: 2, input_kind: "reasoning_utterance", alignment: "unclear", alignment_checkpoint_id: "CP1" },
    });
    expect(noLevel.draft).toMatchObject({ assistance_level: 1, resource_ids: ["RES2"] });
    expect(noLevel.dropDynamicVoice).toBe(true);
  });

  it("I3：incorrect 挣扎 + 档位耗尽 → 任意非 repair/wait 提案改写 repair.ladder_exhausted（TS-7004）", () => {
    const events = [
      ...baseEvents(),
      event("reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" }),
      event("tutor_move_decided", { decision_id: "TD-1", move_type: "prompt", purpose_code: "prompt.self_check", policy_version: "t" }),
      event("hint_issued", { decision_id: "TD-2", checkpoint_id: "CP1", level: 1 }),
      event("reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" }),
      event("hint_issued", { decision_id: "TD-3", checkpoint_id: "CP1", level: 2 }),
    ];
    const pendingIncorrect = pending("reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" });
    const trigger = incorrectTrigger(6);
    for (const original of [
      { move_type: "wait", purpose_code: "wait.safe_fallback", fallback: true } as const,
      { move_type: "prompt", purpose_code: "prompt.reengage" } as const,
    ]) {
      const result = enforceDecisionInvariants({
        draft: { ...original, checkpoint_id: "CP1" },
        plan: PLAN,
        candidateState: stateOf(events, [pendingIncorrect]),
        trigger,
      });
      expect(result.draft).toMatchObject({
        move_type: "repair",
        purpose_code: "repair.ladder_exhausted",
        checkpoint_id: "CP1",
        resource_ids: ["RES4"],
        mode_change: { to_mode: "repair" },
      });
    }
  });

  it("I3 边界：unclear 阶梯耗尽后的首个 incorrect 仍先 self-check（不直接 repair）", () => {
    const events = [
      ...baseEvents(),
      event("reasoning_aligned", { alignment: "unclear", checkpoint_id: "CP1" }),
      event("tutor_move_decided", { decision_id: "TD-1", move_type: "prompt", purpose_code: "prompt.clarify", policy_version: "t" }),
      event("tutor_move_decided", { decision_id: "TD-2", move_type: "prompt", purpose_code: "prompt.diagnostic_probe", policy_version: "t" }),
      event("hint_issued", { decision_id: "TD-3", checkpoint_id: "CP1", level: 1 }),
      event("hint_issued", { decision_id: "TD-4", checkpoint_id: "CP1", level: 2 }),
    ];
    const result = enforceDecisionInvariants({
      draft: { move_type: "hint", purpose_code: "hint.ladder", checkpoint_id: "CP1", assistance_level: 1, resource_ids: ["RES2"] },
      plan: PLAN,
      candidateState: stateOf(events, [pending("reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" })]),
      trigger: incorrectTrigger(7),
    });
    expect(result.draft).toMatchObject({ move_type: "prompt", purpose_code: "prompt.self_check" });
  });

  it("I4：repair mode 内的 repair 提案改写 Wait", () => {
    const events = [
      ...baseEvents(),
      event("mode_changed", { from_mode: "guided_solve", to_mode: "repair" }),
    ];
    const result = enforceDecisionInvariants({
      draft: { move_type: "repair", purpose_code: "repair.ladder_exhausted", checkpoint_id: "CP1", resource_ids: ["RES4"], mode_change: { to_mode: "repair" } },
      plan: PLAN,
      candidateState: stateOf(events),
      trigger: incorrectTrigger(3),
    });
    expect(result.draft).toMatchObject({ move_type: "wait", purpose_code: "wait.after_exhausted_repair" });
  });

  it("I5：偏差后无实质协助而改对 → confirm.* 改写 confirm.self_correction（TS-7075）", () => {
    const events = [
      ...baseEvents(),
      event("student_input_recorded", { input_kind: "reasoning_utterance", text: "偏差" }),
      event("reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" }),
      event("tutor_move_decided", { decision_id: "TD-1", move_type: "prompt", purpose_code: "prompt.self_check", policy_version: "t" }),
      event("student_input_recorded", { input_kind: "reasoning_utterance", text: "正确" }),
    ];
    const pendingBatch = [
      pending("reasoning_aligned", { alignment: "expected_checkpoint", checkpoint_id: "CP1" }),
      pending("student_self_corrected", { checkpoint_id: "CP1", deviation_sequence: 3 }),
    ];
    const result = enforceDecisionInvariants({
      draft: { move_type: "confirm", purpose_code: "confirm.assisted_progress", checkpoint_id: "CP1" },
      plan: PLAN,
      candidateState: stateOf(events, pendingBatch),
      trigger: { kind: "student_input", event_sequence: 6, input_kind: "reasoning_utterance", alignment: "expected_checkpoint", alignment_checkpoint_id: "CP1" },
    });
    expect(result.draft.purpose_code).toBe("confirm.self_correction");
    expect(result.draft.diagnosis_updates).toEqual([
      { summary_code: "progress.self_corrected", evidence_sequences: [3, 7] },
    ]);
    expect(result.dropDynamicVoice).toBe(true);
  });

  it("I6：repair 内答对 → confirm 改写 confirm.repair_complete 并退出 repair mode", () => {
    const events = [
      ...baseEvents(),
      event("mode_changed", { from_mode: "guided_solve", to_mode: "repair" }),
      event("repair_delivered", { source_checkpoint_id: "CP1", resource_id: "RES4", decision_id: "TD-9" }),
    ];
    const result = enforceDecisionInvariants({
      draft: { move_type: "confirm", purpose_code: "confirm.progress", checkpoint_id: "CP1" },
      plan: PLAN,
      candidateState: stateOf(events, [pending("reasoning_aligned", { alignment: "expected_checkpoint", checkpoint_id: "CP1" })]),
      trigger: { kind: "student_input", event_sequence: 4, input_kind: "reasoning_utterance", alignment: "expected_checkpoint", alignment_checkpoint_id: "CP1" },
    });
    expect(result.draft).toMatchObject({
      purpose_code: "confirm.repair_complete",
      mode_change: { to_mode: "guided_solve" },
    });
  });

  it("合规草案原样通过（零改写、保留动态文案）", () => {
    const events = [
      ...baseEvents(),
      event("reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" }),
      event("tutor_move_decided", { decision_id: "TD-1", move_type: "prompt", purpose_code: "prompt.self_check", policy_version: "t" }),
      event("reasoning_aligned", { alignment: "incorrect", checkpoint_id: "CP1" }),
    ];
    const result = enforceDecisionInvariants({
      draft: { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: "CP1", assistance_level: 1, resource_ids: ["RES2"] },
      plan: PLAN,
      candidateState: stateOf(events),
      trigger: incorrectTrigger(5),
    });
    expect(result.rewrites).toEqual([]);
    expect(result.dropDynamicVoice).toBe(false);
    expect(result.draft).toEqual({
      move_type: "hint",
      purpose_code: "hint.escalate",
      checkpoint_id: "CP1",
      assistance_level: 1,
      resource_ids: ["RES2"],
    });
  });
});
