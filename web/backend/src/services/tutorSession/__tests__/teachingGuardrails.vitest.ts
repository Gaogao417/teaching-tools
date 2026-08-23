/**
 * 波次 G 任务 3：讲解质量护栏单测（反馈 (b) confirm 接地 + (d) clarify 逃逸）。
 *
 * - confirm/进度类话术由 curriculum 投影确定性生成：课程在第 1 小问中途时
 *   话术只能说第 1 小问进度，结构性杜绝「第一问完成、进入第二问」越级宣称
 *   （实证：TS-1787477632529000003 课程停 CP2、DeepSeek 却宣称进第二问）；
 *   结论操作步未提交时该小问不会被叙事跳过。
 * - confirm 不再接受模型动态文案（模型话术只承载讲解内容）。
 * - 连续 ≥3 次 unclear → explain.clarify_escape 直接开讲当前 checkpoint
 *   （deterministic 分支 + 决策不变量 I7 双 provider 同纪律）。
 */
import { describe, expect, it } from "vitest";

import { enforceDecisionInvariants, CLARIFY_ESCAPE_THRESHOLD } from "../decisionInvariants";
import { projectRuntimeState, type TutorRuntimeState } from "../TutorRuntimeStateProjection";
import { preparePresentation } from "../../tutorPresentation/PreparePresentation";
import { renderProgressNarrative } from "../../tutorPresentation/curriculumNarrative";
import { decideWithDeterministicRules } from "../../tutorPolicy/adapters/model/deterministicRulesPolicy";
import type { StoredV2Event } from "../TutorSessionEvent";
import type { TutorPlanV2Payload } from "../../planBuild/canonicalInputs";
import type { PolicyTrigger } from "../../tutorPolicy/TutorPolicyPort";
import type { TutorDecision } from "../../tutorPolicy/TutorMove";

const PLAN = {
  artifact_id: "TP-GUARD-1",
  version: "v3",
  content_hash: "sha256:" + "0".repeat(64),
  checkpoints: [
    { checkpoint_id: "CP1", part_id: "1", expected_reasoning: "学生能把等积式改写成比例式。" },
    { checkpoint_id: "CP2", part_id: "1", expected_reasoning: "学生能找到两个直角三角形。" },
    { checkpoint_id: "CP3", part_id: "1", expected_reasoning: "学生能写全导角链条。" },
    { checkpoint_id: "CP4", part_id: "2", expected_reasoning: "学生能改写目标比例式。" },
  ],
  recommended_routes: [
    { route_id: "R1", role: "primary", part_id: "1", checkpoint_ids: ["CP1", "CP2", "CP3"] },
    { route_id: "R3", role: "primary", part_id: "2", checkpoint_ids: ["CP4"] },
  ],
  resources: [
    { resource_id: "RES1", kind: "explanation", checkpoint_id: "CP2", content: "以 D 为公共直角顶点找两个直角三角形。" },
    { resource_id: "RES2", kind: "hint", checkpoint_id: "CP2", assistance_level: 1, content: "看哪两个三角形共享直角顶点？" },
    { resource_id: "RES3", kind: "hint", checkpoint_id: "CP2", assistance_level: 2, content: "Rt△ADB 与 Rt△ODC。" },
    {
      resource_id: "ACT1", kind: "action_template", checkpoint_id: "CP3", capability: "agent:set-answer",
      content: "{}",
    },
  ],
  policy_constraints: {
    allowed_move_types: ["explain", "prompt", "hint", "confirm", "wait", "repair"],
    maximum_assistance_level: 2,
    allowed_capabilities: ["agent:set-answer"],
  },
} as unknown as TutorPlanV2Payload;

let sequence = 0;
function event(eventType: StoredV2Event["event_type"], payload: Record<string, unknown>): StoredV2Event {
  sequence += 1;
  return {
    schema: "ai_teaching_tutor_session_event/v2",
    session_id: "TS-GUARD",
    sequence,
    state_revision: sequence,
    occurred_at: "2026-08-24T00:00:00Z",
    event_type: eventType,
    payload: payload as unknown as StoredV2Event["payload"],
    idempotency_key: `TS-GUARD:${sequence}`,
  };
}

function stateWith(events: StoredV2Event[]): TutorRuntimeState {
  return projectRuntimeState(PLAN, [
    event("session_started", {
      plan: { artifact_id: "TP-GUARD-1", version: "v3", content_hash: "sha256:" + "0".repeat(64) },
      initial_mode: "guided_solve",
    }),
    ...events,
  ]);
}

function confirmPresentation(state: TutorRuntimeState, dynamicVoice?: { text: string; source: "model-generated" }) {
  const decision: TutorDecision = {
    decision_id: "TD-1",
    move_type: "confirm",
    purpose_code: "confirm.progress",
    checkpoint_id: "CP2",
    policy_version: "tutor-policy-deterministic-rules/v1",
    source_event_sequence: 9,
    source_state_revision: 5,
  };
  return preparePresentation({
    decision,
    plan: PLAN,
    state,
    sessionId: "TS-GUARD",
    voiceOrdinal: 1,
    workspaceOrdinal: 1,
    answerValues: ["CE⊥AB"],
    ...(dynamicVoice ? { dynamicVoice } : {}),
  });
}

describe("confirm/进度类话术接地（反馈 (b)）", () => {
  it("课程在第 1 小问中途：话术只说第 1 小问进度，不出现第二问宣称", () => {
    // CP1、CP2 完成（第 1 小问 2/3），CP3 未完成、结论操作步无证据。
    const state = stateWith([
      event("student_progressed", { checkpoint_id: "CP1", part_id: "1", assisted: false }),
      event("student_progressed", { checkpoint_id: "CP2", part_id: "1", assisted: false }),
    ]);
    const result = confirmPresentation(state);
    expect(result.ok).toBe(true);
    const text = result.presentation!.voice[0].text;
    expect(text).toContain("对，这一步成立");
    expect(text).toContain("第 1 小问");
    expect(text).toContain("2/3");
    expect(text).not.toContain("第 2 小问");
    expect(text).not.toContain("第二问");
    expect(text).not.toContain("进入");
  });

  it("第 1 小问推理全部成立但结论操作步未提交：叙事停在操作提交，不宣称进入第 2 小问", () => {
    const state = stateWith([
      event("student_progressed", { checkpoint_id: "CP1", part_id: "1", assisted: false }),
      event("student_progressed", { checkpoint_id: "CP2", part_id: "1", assisted: false }),
      event("student_progressed", { checkpoint_id: "CP3", part_id: "1", assisted: false }),
    ]);
    const narrative = renderProgressNarrative(PLAN, state);
    expect(narrative).toContain("第 1 小问");
    expect(narrative).toContain("推理已经全部成立");
    expect(narrative).toContain("操作提交");
    expect(narrative).not.toContain("第 2 小问");
  });

  it("第 1 小问结论已提交：叙事进入第 2 小问（接地下才允许）", () => {
    const state = stateWith([
      event("student_progressed", { checkpoint_id: "CP1", part_id: "1", assisted: false }),
      event("student_progressed", { checkpoint_id: "CP2", part_id: "1", assisted: false }),
      event("student_progressed", { checkpoint_id: "CP3", part_id: "1", assisted: false }),
      event("workspace_action_issued", {
        action_id: "WA-1", decision_id: "TD-0", capability: "agent:set-answer",
        target_ids: [], command_payload: JSON.stringify({ resource_id: "ACT1", action_ref: "ACT1", mode: "learn" }),
      }),
      event("workspace_action_completed", { action_id: "WA-1", outcome: "completed" }),
    ]);
    const narrative = renderProgressNarrative(PLAN, state);
    expect(narrative).toContain("第 2 小问");
    expect(narrative).toContain("0/1");
  });

  it("confirm 不再接受模型动态文案（越级宣称的载体被移除）", () => {
    const state = stateWith([
      event("student_progressed", { checkpoint_id: "CP1", part_id: "1", assisted: false }),
      event("student_progressed", { checkpoint_id: "CP2", part_id: "1", assisted: false }),
    ]);
    const result = confirmPresentation(state, {
      text: "你已经正确完成了第一问的推理。接下来我们进入第二问。",
      source: "model-generated",
    });
    expect(result.ok).toBe(true);
    const voice = result.presentation!.voice[0];
    expect(voice.text).not.toContain("进入第二问");
    expect(voice.voice_source).toBeUndefined();
    expect(voice.text).toContain("第 1 小问");
  });
});

describe("clarify 逃逸（反馈 (d)）", () => {
  function unclearTrigger(sequenceNumber: number): PolicyTrigger {
    return {
      kind: "student_input",
      event_sequence: sequenceNumber,
      input_kind: "reasoning_utterance",
      alignment: "unclear",
      alignment_checkpoint_id: "CP2",
    };
  }

  function stateWithUnclear(count: number): TutorRuntimeState {
    // CP1 已推进（课程停在 CP2，与教师实测会话同构），随后连续 count 次
    // unclear 对齐 + prompt.clarify 决策。
    const events: StoredV2Event[] = [
      event("student_progressed", { checkpoint_id: "CP1", part_id: "1", assisted: false }),
    ];
    for (let index = 0; index < count; index += 1) {
      events.push(event("reasoning_aligned", { alignment: "unclear", checkpoint_id: "CP2" }));
      events.push(event("tutor_move_decided", { move_type: "prompt", purpose_code: "prompt.clarify", checkpoint_id: "CP2" }));
    }
    return stateWith(events);
  }

  it("投影：连续 unclear 计数累加，非 unclear 对齐归零", () => {
    const state = stateWithUnclear(CLARIFY_ESCAPE_THRESHOLD);
    expect(state.reasoning.consecutive_unclear).toBe(CLARIFY_ESCAPE_THRESHOLD);
    const recovered = stateWith([
      ...Array.from({ length: CLARIFY_ESCAPE_THRESHOLD }, () =>
        event("reasoning_aligned", { alignment: "unclear", checkpoint_id: "CP2" })),
      event("reasoning_aligned", { alignment: "expected_checkpoint", checkpoint_id: "CP2" }),
    ]);
    expect(recovered.reasoning.consecutive_unclear).toBe(0);
  });

  it("deterministic：连续达到阈值 → explain.clarify_escape 带本 checkpoint 讲解资源", () => {
    const state = stateWithUnclear(CLARIFY_ESCAPE_THRESHOLD);
    const outcome = decideWithDeterministicRules({
      plan: PLAN,
      state,
      trigger: unclearTrigger(state.last_sequence),
      session_kind: "tutoring",
    });
    expect(outcome.ok).toBe(true);
    const decision = outcome.ok ? outcome.decision : undefined;
    expect(decision?.move_type).toBe("explain");
    expect(decision?.purpose_code).toBe("explain.clarify_escape");
    expect(decision?.resource_ids).toEqual(["RES1"]);
  });

  it("deterministic：阈值之下维持 clarify（首个 unclear 仍追问一次）", () => {
    // 课程停在 CP2、首个 unclear（无既往 prompt 台账）→ prompt.clarify。
    const state = stateWith([
      event("student_progressed", { checkpoint_id: "CP1", part_id: "1", assisted: false }),
    ]);
    const outcome = decideWithDeterministicRules({
      plan: PLAN,
      state,
      trigger: unclearTrigger(state.last_sequence),
      session_kind: "tutoring",
    });
    const clarifyDecision = outcome.ok ? outcome.decision : undefined;
    expect(clarifyDecision?.move_type).toBe("prompt");
    expect(clarifyDecision?.purpose_code).toBe("prompt.clarify");
  });

  it("不变量 I7：模型连续提 prompt.clarify 也被改写为直接开讲（丢动态文案）", () => {
    const state = stateWithUnclear(CLARIFY_ESCAPE_THRESHOLD);
    const enforced = enforceDecisionInvariants({
      draft: { move_type: "prompt", purpose_code: "prompt.clarify", checkpoint_id: "CP2" },
      plan: PLAN,
      candidateState: state,
      trigger: unclearTrigger(state.last_sequence),
    });
    expect(enforced.draft.move_type).toBe("explain");
    expect(enforced.draft.purpose_code).toBe("explain.clarify_escape");
    expect(enforced.draft.resource_ids).toEqual(["RES1"]);
    expect(enforced.dropDynamicVoice).toBe(true);
    expect(enforced.rewrites).toContain("clarify_escape_explained");
  });

  it("不变量 I7：模型已主动提 explain 时不改写（讲解方向一致）", () => {
    const state = stateWithUnclear(CLARIFY_ESCAPE_THRESHOLD);
    const enforced = enforceDecisionInvariants({
      draft: { move_type: "explain", purpose_code: "explain.answer_question", checkpoint_id: "CP2", resource_ids: ["RES1"] },
      plan: PLAN,
      candidateState: state,
      trigger: unclearTrigger(state.last_sequence),
    });
    expect(enforced.draft.move_type).toBe("explain");
    expect(enforced.draft.purpose_code).toBe("explain.answer_question");
    expect(enforced.rewrites).toEqual([]);
  });
});
