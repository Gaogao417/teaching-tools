/**
 * F5 navigator Vitest 套件（Session 与 Protocol Navigator 内核）。
 *
 * node 链（tutorNavigatorV5.test.ts）以真实 Approved 链 + F2 kernel 覆盖 G5
 * 门禁正/负例；本套件补充单元语义：interpreter 假设分类（R3 后=模型裁决映射）、
 * gate 证据评估（模型 assessment 消费）、ESE 支持阶梯、事件流派生计数器、
 * decideNavigation 确定性与 fail-closed 分支，以及 vitest 进程下的 kernel 旅程
 * 闭环（SQLITE_PATH 由 vitest.setup.ts 前置）。
 *
 * R3（2026-08-31）：自然语言假设/gate 裁决来自固定响应 provider（判卷人换假
 * 模型，断言口径不变——用户裁定 4B）；新增 ModelGateAdjudicatorV5 薄边界单测、
 * reducer GATE_BEAT_MISMATCH、resume Plan-aware 核对单测。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validatePayload } from "../../../../../shared/canonical";
import * as importerModule from "../../planBuild/v5/ImportApprovedPlanV5";
import {
  buildNavigatorPlan,
  buildSessionStartedPayload,
} from "../NavigatorPlanV5";
import {
  ANSWER_ALTERNATE_COORDINATE,
  ANSWER_GOAL_OK,
  ANSWER_INVARIANTS_OK,
  adjudicationJson,
  failFor,
  FIXTURES_DIR,
  GOLDEN,
  passFor,
  QUESTION_IN_BOUND,
  QUESTION_OUT_OF_BOUND,
  questionOn,
  SCAFFOLD_STEP1_OK,
  importGoldenPlan,
  realCanonicalRoot,
} from "./navigatorSupport";
import {
  hypothesisEventPayload,
  hypothesisFromAdjudication,
  interpretStudentInput,
  isNaturalLanguageInput,
  noProgressHypothesis,
} from "../SemanticInterpreterV5";
import type { GateAdjudicationResult } from "../ModelGateAdjudicatorV5";
import { evaluateGateEvidence, type ModelGateAssessmentInput } from "../GateEvidenceEvaluatorV5";
import { buildExternalSupportEvidence } from "../ExternalSupportEvidenceV5";
import {
  MAX_LOCAL_INQUIRY_STEPS,
  NAVIGATOR_V5_VERSION,
  decideNavigation,
  deriveLocalInquirySteps,
  deriveUnresolvedClarifications,
  type NavigatorContext,
} from "../TutorNavigatorV5";
import { NavigatorSessionV5, NavigatorWriteBoundaryError } from "../NavigatorSessionV5";
import type { TutorRuntimeStateV5 } from "../../tutorSession/TutorRuntimeStateReducerV5";
import {
  assertLocalInquiryProtocolBoundary,
  buildLocalInquiryProtocol,
  findLocalInquiryProtocol,
  LocalInquiryBoundaryError,
} from "../LocalInquiryProtocolV5";
import {
  ModelGateAdjudicatorV5,
  FixedResponseGateProvider,
  HangingGateProvider,
  UnavailableGateProvider,
  buildGateAdjudicationContext,
  canonicalRefUniverse,
  validateAdjudicationResponse,
} from "../ModelGateAdjudicatorV5";
import {
  applyV5Event,
  foldCommittedV5Events,
} from "../../tutorSession/TutorRuntimeStateReducerV5";
import { compareTutorRuntimeStatesSemantically } from "../../tutorSession/RuntimeStateSemanticComparatorV5";
import type { StoredV5Event } from "../../tutorSession/TutorSessionEventV5";

const imported = importGoldenPlan(importerModule);
const plan = buildNavigatorPlan(imported);
const beat = (id: string) => {
  const view = plan.mainline.beats.get(id);
  if (!view) throw new Error(`missing beat ${id}`);
  return view;
};

function startSession(sessionId: string, options: { responses?: readonly string[]; modelTimeoutMs?: number } = {}): NavigatorSessionV5 {
  return NavigatorSessionV5.start({
    sessionId,
    studentId: "student-nav5-vitest",
    canonicalRoot: realCanonicalRoot(),
    tpId: GOLDEN.tpId,
    taskId: GOLDEN.taskId,
    scenarioId: GOLDEN.scenarioId,
    ...(options.responses !== undefined ? { gateProvider: new FixedResponseGateProvider(options.responses) } : {}),
    ...(options.modelTimeoutMs !== undefined ? { modelTimeoutMs: options.modelTimeoutMs } : {}),
  });
}

/** R1 workspace 回执链：意图 → appendExternalFacts 回执（F3 侧）→ 消费。 */
async function submitWorkspaceCommandWithReceipt(
  session: NavigatorSessionV5,
  input: { command_id: string; capability?: string; outcome?: "completed" | "rejected" | "failed"; expectedRevision?: number },
): Promise<import("../NavigatorSessionV5").TurnResult> {
  const capability = input.capability ?? "similarity.mark-known-segments";
  await session.acceptStudentIntent({
    intent_kind: "submit_workspace_command",
    client_request_id: `vr-wc-${input.command_id}`,
    workspace_command: {
      command_id: input.command_id,
      surface: "geometry",
      capability,
      target_ids: ["seg-AD"],
      expected_workspace_revision: input.expectedRevision ?? 0,
      client_command_id: `cc-${input.command_id}`,
    },
  });
  const intent = [...session.events].reverse().find((event) => event.event_type === "student_intent_recorded");
  const outcome = input.outcome ?? "completed";
  session.appendExternalFacts(session.revision, [
    {
      event_type: "action_outcome_recorded",
      payload: {
        action_id: input.command_id,
        action_kind: "student_command",
        outcome,
        ...(outcome === "failed" ? { failure_class: "internal_error" as const } : {}),
        ...(outcome === "completed" ? { resulting_revision: (input.expectedRevision ?? 0) + 1 } : {}),
      },
      occurred_at: new Date().toISOString(),
      causation_sequence: intent?.sequence ?? 1,
    },
  ]);
  return session.consumeWorkspaceCommandOutcome({ command_id: input.command_id });
}

function contextAt(session: NavigatorSessionV5): NavigatorContext {
  return {
    sessionId: session.sessionId,
    plan: session.plan,
    state: session.state,
    revision: session.revision,
    localInquirySteps: deriveLocalInquirySteps(session.events),
    unresolvedClarifications: deriveUnresolvedClarifications(session.events),
  };
}

/** 已提交 mainline 旅程（vitest 进程内独立会话；R1 回执消费模式 + R3 模型裁决）。 */
async function runMainline(sessionId: string): Promise<NavigatorSessionV5> {
  // v3 主线（6 拍）：confirm → 四个 student_answer gate（GT-02..GT-05）→ confirm；
  // v2 的标图 workspace 拍在教研修订后并入 beat 语义，主线不再含 operate 拍。
  const session = startSession(sessionId, {
    responses: [passFor("GT-02", "FN-06"), passFor("GT-03", "FN-10"), passFor("GT-04", "FN-19"), passFor("GT-05", "FN-23")],
  });
  await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-1" });
  await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "vr-2" });
  await session.acceptStudentIntent({ intent_kind: "submit_answer", text: "AD=CD=8/3、BD=10/3", client_request_id: "vr-3" });
  await session.acceptStudentIntent({ intent_kind: "submit_answer", text: "△DAO∽△DBA，AO=16/5、DO=32/15、BO=6/5、OE=4/5", client_request_id: "vr-4" });
  await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_GOAL_OK, client_request_id: "vr-5" });
  await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-6" });
  return session;
}

/** 固定裁决（server 已校验形状；单测直接构造 hypothesisFromAdjudication 输入）。 */
function adjudication(fields: {
  response_kind: GateAdjudicationResult["response_kind"];
  matched_gate_id?: string;
  verdict: GateAdjudicationResult["verdict"];
  reasoning_location: GateAdjudicationResult["reasoning_location"];
  grounding_refs: readonly string[];
  degraded_reason?: string;
}): GateAdjudicationResult {
  return {
    response_kind: fields.response_kind,
    ...(fields.matched_gate_id !== undefined ? { matched_gate_id: fields.matched_gate_id } : {}),
    verdict: fields.verdict,
    reasoning_location: fields.reasoning_location,
    grounding_refs: [...fields.grounding_refs],
    provider: "fixed-response",
    ...(fields.degraded_reason !== undefined ? { degraded_reason: fields.degraded_reason } : {}),
  };
}

describe("F5 navigator: plan index from real approved chain", () => {
  it("builds mainline + branch indexes and full-pin session_started payload (no invented structure)", () => {
    expect(plan.mainline.protocol_id).toBe("PR-SMV-001");
    expect(plan.mainline.beat_order).toEqual(["BT-01", "BT-02", "BT-03", "BT-04", "BT-05", "BT-06"]);
    expect([...plan.branches.keys()]).toEqual(["PR-SMV-002"]);
    expect(plan.facts.size).toBe(29);
    expect(plan.solution_variants.map((variant) => variant.variant_id)).toEqual(["SV-01", "SV-02"]);
    const payload = buildSessionStartedPayload(plan, {
      sessionId: "TS-9901",
      taskId: GOLDEN.taskId,
      scenarioId: GOLDEN.scenarioId,
    });
    expect(payload.tutor_plan_ref).toEqual({
      artifact_id: "TP-SMV-009",
      version: "v10",
      content_hash: imported.plan.content_hash,
    });
    expect(payload.protocol_refs.map((ref) => ref.artifact_id).sort()).toEqual(["PR-SMV-001", "PR-SMV-002"]);
    expect(payload.initial_cursor).toEqual({ protocol_id: "PR-SMV-001", beat_id: "BT-01" });
    // R3：题目内容摘要进入导航索引（裁决上下文 question 最小集）。
    expect(plan.question.artifact_id).toBe("QT-SMV-001");
    expect(plan.question.stem).toContain("翻折");
  });

  it("beat gates reflect the approved protocol (GT-01/GT-06 confirmation; GT-02..05 student answers on fine facts)", () => {
    expect(beat("BT-01").completion_evidence.evidence_kind).toBe("student_confirmation");
    expect(beat("BT-02").completion_evidence.evidence_kind).toBe("student_answer");
    expect(beat("BT-02").completion_evidence.gate?.graph_fact_id).toBe("FN-06");
    expect(beat("BT-03").completion_evidence.gate?.graph_fact_id).toBe("FN-10");
    expect(beat("BT-04").completion_evidence.gate?.graph_fact_id).toBe("FN-19");
    expect(beat("BT-05").completion_evidence.gate?.graph_fact_id).toBe("FN-23");
    expect(beat("BT-06").completion_evidence.evidence_kind).toBe("student_confirmation");
    expect(beat("BT-03").pacing).toEqual({ wait_policy: "bounded_wait", max_wait_seconds: 180 });
  });
});

describe("F5 navigator: model-adjudicated hypotheses (R3 merge; refutable)", () => {
  it("pass on the current beat gate -> aligned with grounding/focus and gate assessment attached", () => {
    const hypothesis = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-05"),
      intent_kind: "submit_answer",
      text: ANSWER_GOAL_OK,
      adjudication: adjudication({ response_kind: "final_answer", matched_gate_id: "GT-05", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-23"] }),
      evidence_sequence: 6,
    });
    expect(hypothesis.reasoning_location).toBe("aligned");
    expect(hypothesis.matched_fact_id).toBe("FN-23");
    expect(hypothesis.grounding_refs).toEqual(["FN-23"]);
    expect(hypothesis.gate_assessment).toEqual({ verdict: "pass", matched_gate_id: "GT-05", evidence_sequence: 6 });
    expect(hypothesis.in_bound).toBe(true);
  });

  it("unclear / wrong-value answers -> unknown or misaligned without a pass (threshold semantics moved to the model)", () => {
    // 模型判 fail 且锚定 FN-23 → misaligned + incorrect_reasoning（对抗负例断言口径）。
    const failed = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-05"),
      intent_kind: "submit_answer",
      text: "BE=2",
      adjudication: adjudication({ response_kind: "final_answer", matched_gate_id: "GT-05", verdict: "fail", reasoning_location: "misaligned", grounding_refs: ["FN-23"] }),
      evidence_sequence: 6,
    });
    expect(failed.reasoning_location).toBe("misaligned");
    expect(failed.reasoning_alignment).toEqual({ kind: "incorrect_reasoning", anchored_fact_ids: ["FN-23"] });
    expect(failed.gate_assessment?.verdict).toBe("fail");
    // 模型判 unclear（如 "BE=2" 类不明确输入）→ unknown，不强迫分类。
    const unclear = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-05"),
      intent_kind: "submit_answer",
      text: "BE=2",
      adjudication: adjudication({ response_kind: "mixed_or_ambiguous", verdict: "unclear", reasoning_location: "unknown", grounding_refs: [] }),
      evidence_sequence: 6,
    });
    expect(unclear.reasoning_location).toBe("unknown");
    expect(unclear.reasoning_alignment).toEqual({ kind: "unclear_reasoning" });
    expect(unclear.matched_fact_id).toBeUndefined();
  });

  it("double-angle answer grounds the alternate variant SV-02 (server-verified canonical id)", () => {
    const hypothesis = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-03"),
      intent_kind: "submit_answer",
      text: ANSWER_ALTERNATE_COORDINATE,
      adjudication: adjudication({ response_kind: "alternate_path", verdict: "not_applicable", reasoning_location: "aligned", grounding_refs: ["SV-02", "FN-23"] }),
      evidence_sequence: 6,
    });
    expect(hypothesis.matched_variant_id).toBe("SV-02");
    expect(hypothesis.intent).toBe("submit_answer:alternate_route");
    expect(hypothesis.reasoning_alignment).toEqual({
      kind: "alternate_valid_path",
      fact_ids: ["FN-23"],
      inference_ids: ["IF-07", "IF-20", "IF-21", "IF-22", "IF-23", "IF-24", "IF-25", "IF-26"],
    });
    expect(hypothesis.reasoning_focus?.graph_fact_refs).toEqual(["FN-23"]);
    // RG 内核实不了的替代路线（grounding 不含任何 variant goal fact）：不采信。
    const unverified = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-03"),
      intent_kind: "submit_answer",
      text: "我用了另一种方法",
      adjudication: adjudication({ response_kind: "alternate_path", verdict: "not_applicable", reasoning_location: "aligned", grounding_refs: ["FN-06"] }),
      evidence_sequence: 6,
    });
    expect(unverified.matched_variant_id).toBeUndefined();
    expect(unverified.reasoning_location).toBe("unknown");
  });

  it("ask_question in/out of bound is decided by canonical grounding from the same call", () => {
    const inBound = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-01"),
      intent_kind: "ask_question",
      text: QUESTION_IN_BOUND,
      adjudication: adjudication({ response_kind: "question", verdict: "not_applicable", reasoning_location: "aligned", grounding_refs: ["FN-03"] }),
      evidence_sequence: 3,
    });
    const outOfBound = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-01"),
      intent_kind: "ask_question",
      text: QUESTION_OUT_OF_BOUND,
      adjudication: adjudication({ response_kind: "question", verdict: "not_applicable", reasoning_location: "unknown", grounding_refs: [] }),
      evidence_sequence: 3,
    });
    expect(inBound.in_bound).toBe(true);
    expect(inBound.intent).toBe("ask_question");
    expect(outOfBound.in_bound).toBe(false);
    expect(outOfBound.intent).toBe("ask_question:out_of_bound");
    // 判卷人不再自报置信（R3 输出形状无 confidence）：服务端常量映射。
    expect(inBound.confidence).toBeGreaterThanOrEqual(0.6);
    expect(outOfBound.confidence).toBeLessThan(0.6);
  });

  it("hypothesis payload round-trips through the canonical v5 interpretation event", () => {
    const hypothesis = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-03"),
      intent_kind: "submit_answer",
      text: ANSWER_INVARIANTS_OK,
      adjudication: adjudication({ response_kind: "final_answer", matched_gate_id: "GT-03", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-05"] }),
      evidence_sequence: 5,
    });
    const event = {
      schema: "ai_teaching_tutor_session_event/v5",
      session_id: "TS-9902",
      sequence: 3,
      state_revision: 2,
      occurred_at: "2026-08-29T00:00:00.000Z",
      event_type: "semantic_interpretation_recorded",
      payload: hypothesisEventPayload(hypothesis),
      causation_sequence: 2,
      idempotency_key: "TS-9902:3",
    };
    expect(validatePayload(event)).toEqual({ ok: true, errors: [] });
  });

  it("structured (no-text) intents stay deterministic; natural-language routing is explicit", () => {
    expect(isNaturalLanguageInput("submit_answer", "BE=1")).toBe(true);
    expect(isNaturalLanguageInput("confirm", undefined)).toBe(false);
    expect(isNaturalLanguageInput("request_scaffold", undefined)).toBe(false);
    expect(isNaturalLanguageInput("submit_workspace_command", undefined)).toBe(false);
    const bare = interpretStudentInput(plan, { intent_kind: "request_scaffold", beat: beat("BT-01") });
    expect(bare.in_bound).toBe(true);
    expect(bare.confidence).toBe(0.8);
    // NL 输入直达确定性解释器 → fail loudly（防静默回退字符串裁决）。
    expect(() => interpretStudentInput(plan, { intent_kind: "submit_answer", text: "BE=1", beat: beat("BT-04") })).toThrow(/ModelGateAdjudicatorV5/);
  });
});

describe("F5 navigator: gate evidence evaluator (model assessment is the only student_answer path)", () => {
  it("narration and timeout cannot satisfy student-evidence gates (explicit rejection)", () => {
    for (const input of [
      { narration_completed: true, narration_attempted_as_evidence: true },
      { narration_completed: false, timeout_attempted_as_evidence: true },
    ]) {
      const assessment = evaluateGateEvidence(plan, beat("BT-01"), {
        confirmation_sequences: [],
        workspace_outcomes: [],
        ...input,
      });
      expect(assessment.satisfied).toBe(false);
      expect(assessment.reason).toBe("requires_student_evidence");
    }
  });

  it("student answer is satisfied only by a verified model pass on the bound gate", () => {
    const base = { confirmation_sequences: [] as number[], workspace_outcomes: [], narration_completed: false };
    const pass: ModelGateAssessmentInput = { verdict: "pass", matched_gate_id: "GT-03", evidence_sequence: 4 };
    const crossGate: ModelGateAssessmentInput = { verdict: "pass", matched_gate_id: "GT-04", evidence_sequence: 4 };
    const fail: ModelGateAssessmentInput = { verdict: "fail", matched_gate_id: "GT-03", evidence_sequence: 4 };
    expect(evaluateGateEvidence(plan, beat("BT-03"), { ...base, model_assessment: pass })).toEqual({
      satisfied: true,
      evidence_sequence: 4,
    });
    expect(evaluateGateEvidence(plan, beat("BT-03"), { ...base, model_assessment: crossGate }).satisfied).toBe(false);
    expect(evaluateGateEvidence(plan, beat("BT-03"), { ...base, model_assessment: fail }).satisfied).toBe(false);
    expect(evaluateGateEvidence(plan, beat("BT-03"), { ...base, model_assessment: fail }).reason).toBe("answer_not_matching");
    // 无模型裁决（模型失败/未调用）不得 pass、不得回退字符串规则。
    expect(evaluateGateEvidence(plan, beat("BT-03"), base)).toEqual({ satisfied: false, reason: "answer_not_adjudicated" });
  });

  it("workspace gate only satisfied by a completed outcome of the gate capability", () => {
    // v3 主线已无 workspace 拍（教研修订）；本测试的对象是评估器分支语义，
    // 用合成 beat view 构造 workspace_command gate（不改 plan pin 真源）。
    const workspaceBeat = {
      ...beat("BT-02"),
      completion_evidence: {
        evidence_kind: "workspace_command" as const,
        gate: { gate_id: "GT-02W", requirement: "标出已知线段", capability: "similarity.mark-known-segments" },
      },
    };
    const base = { confirmation_sequences: [], narration_completed: false };
    expect(
      evaluateGateEvidence(plan, workspaceBeat, {
        ...base,
        workspace_outcomes: [{ capability: "similarity.map-corresponding-sides", outcome: "completed", sequence: 5 }],
      }).satisfied,
    ).toBe(false);
    expect(
      evaluateGateEvidence(plan, workspaceBeat, {
        ...base,
        workspace_outcomes: [{ capability: "similarity.mark-known-segments", outcome: "rejected", sequence: 5 }],
      }).satisfied,
    ).toBe(false);
    expect(
      evaluateGateEvidence(plan, workspaceBeat, {
        ...base,
        workspace_outcomes: [{ capability: "similarity.mark-known-segments", outcome: "completed", sequence: 5 }],
      }),
    ).toEqual({ satisfied: true, evidence_sequence: 5 });
  });
});

describe("F5 navigator: external support evidence ladder", () => {
  it("orient is within every approved boundary; exceeding the beat ladder fails closed", () => {
    for (const beatId of ["BT-01", "BT-02", "BT-03", "BT-04", "BT-05", "BT-06"]) {
      const result = buildExternalSupportEvidence({
        session_id: "TS-9903",
        evidence_id: `ESE-TS-9903-${beatId}`,
        beat: beat(beatId),
        support_kinds: ["orient"],
        initiated_by: "tutor_initiated",
        action_ids: ["VA-x-0001"],
      });
      expect(result.ok, beatId).toBe(true);
    }
    expect(
      buildExternalSupportEvidence({
        session_id: "TS-9903",
        evidence_id: "ESE-TS-9903-9001",
        beat: beat("BT-01"),
        support_kinds: ["foreground"],
        initiated_by: "tutor_initiated",
        action_ids: ["VA-x-0001"],
      }).ok,
    ).toBe(false);
  });

  it("provide_final_conclusion and intermediate-on-locked beats are rejected; new facts never carry legacy fields", () => {
    expect(
      buildExternalSupportEvidence({
        session_id: "TS-9903",
        evidence_id: "ESE-TS-9903-9002",
        beat: beat("BT-05"),
        support_kinds: ["provide_final_conclusion"],
        initiated_by: "tutor_initiated",
        action_ids: ["VA-x-0002"],
      }).ok,
    ).toBe(false);
    expect(
      buildExternalSupportEvidence({
        session_id: "TS-9903",
        evidence_id: "ESE-TS-9903-9003",
        beat: beat("BT-01"), // may_reveal_intermediate=false
        support_kinds: ["provide_intermediate_conclusion"],
        initiated_by: "student_requested",
        action_ids: ["VA-x-0003"],
      }).ok,
    ).toBe(false);
    const ok = buildExternalSupportEvidence({
      session_id: "TS-9903",
      evidence_id: "ESE-TS-9903-9004",
      beat: beat("BT-04"), // max_support=specify_operation, may_reveal_intermediate=true
      support_kinds: ["name_strategy", "specify_operation"],
      initiated_by: "tutor_initiated",
      action_ids: ["VA-x-0004"],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.payload.derived_partial).toBe(false);
      expect("legacy_source" in ok.payload).toBe(false);
    }
  });
});

describe("F5 navigator: committed-stream derivations", () => {
  function decisionEvent(sessionId: string, sequence: number, kind: string, inquiry?: Record<string, unknown>): StoredV5Event {
    return {
      schema: "ai_teaching_tutor_session_event/v5",
      session_id: sessionId,
      sequence,
      state_revision: sequence,
      occurred_at: "2026-08-29T00:00:00.000Z",
      event_type: "policy_decision_made",
      payload: { decision_kind: kind, ...(inquiry ? { inquiry } : {}) },
      causation_sequence: sequence - 1,
      idempotency_key: `${sessionId}:${sequence}`,
    };
  }

  it("deriveLocalInquirySteps counts local continues and resets on return", () => {
    const events = [
      decisionEvent("TS-9904", 2, "open_inquiry", { inquiry_id: "IQ-1", return_beat_id: "BT-01" }),
      decisionEvent("TS-9904", 3, "continue_inquiry", { inquiry_id: "IQ-1", return_beat_id: "BT-01" }),
      decisionEvent("TS-9904", 4, "continue_inquiry", { inquiry_id: "IQ-1", return_beat_id: "BT-01" }),
    ];
    expect(deriveLocalInquirySteps(events)).toBe(2);
    expect(deriveLocalInquirySteps([...events, decisionEvent("TS-9904", 5, "return_to_mainline", { inquiry_id: "IQ-1", return_beat_id: "BT-01" })])).toBe(0);
    // 批准协议内的 continue 不计步（bounded 只约束 LocalInquiry）。
    expect(
      deriveLocalInquirySteps([
        decisionEvent("TS-9904", 2, "open_scaffold", { inquiry_id: "IQ-2", inquiry_protocol_id: "PR-SMV-002", return_beat_id: "BT-02" }),
        decisionEvent("TS-9904", 3, "continue_inquiry", { inquiry_id: "IQ-2", inquiry_protocol_id: "PR-SMV-002", return_beat_id: "BT-02" }),
      ]),
    ).toBe(0);
  });

  it("deriveUnresolvedClarifications counts trailing clarifications and resets on other decisions", () => {
    const events = [
      decisionEvent("TS-9905", 2, "request_clarification"),
      decisionEvent("TS-9905", 3, "request_clarification"),
    ];
    expect(deriveUnresolvedClarifications(events)).toBe(2);
    expect(deriveUnresolvedClarifications([...events, decisionEvent("TS-9905", 4, "safe_fallback")])).toBe(0);
  });
});

describe("F5 navigator: decideNavigation determinism and fail-closed branches", () => {
  it("session_start -> execute entry beat; repeated calls are identical", () => {
    const session = startSession("TS-9906");
    const ctx = contextAt(session);
    const trigger = { kind: "session_start" } as const;
    expect(decideNavigation(ctx, trigger)).toEqual(decideNavigation(ctx, trigger));
  });

  it("narration at a student-evidence gate deterministically fails gate_unresolvable", () => {
    const session = startSession("TS-9907");
    const failure = decideNavigation(contextAt(session), { kind: "narration_completed", sequence: 3 });
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.failure.failure_class).toBe("gate_unresolvable");
    }
    expect(decideNavigation(contextAt(session), { kind: "narration_completed", sequence: 3 })).toEqual(failure);
  });

  it("timeout at a student_driven beat is not a legal trigger", () => {
    const session = startSession("TS-9908");
    const outcome = decideNavigation(contextAt(session), { kind: "timeout", sequence: 2, beat_id: "BT-01" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.failure.failure_class).toBe("no_legal_transition");
  });

  it("completed state refuses any further decision", async () => {
    const session = await runMainline("TS-9909");
    expect(session.state.completed).toBe(true);
    const outcome = decideNavigation(contextAt(session), { kind: "session_start" });
    expect(outcome.ok).toBe(false);
  });

  it("R3: mismatched gate/beat binding is an explicit gate_binding_mismatch (no transition, no cursor effect)", () => {
    const session = startSession("TS-9916");
    const ctx = contextAt(session);
    const wrongGate = decideNavigation(ctx, { kind: "gate_evaluated", sequence: 3, gate_id: "GT-99", beat_id: "BT-01", satisfied: true });
    expect(wrongGate.ok).toBe(false);
    if (!wrongGate.ok) expect(wrongGate.failure.failure_class).toBe("gate_binding_mismatch");
    const futureBeat = decideNavigation(ctx, { kind: "gate_evaluated", sequence: 3, gate_id: "GT-04", beat_id: "BT-04", satisfied: true });
    expect(futureBeat.ok).toBe(false);
    if (!futureBeat.ok) expect(futureBeat.failure.failure_class).toBe("gate_binding_mismatch");
    // decide 是纯函数：重复调用同 failure；当前游标零变化。
    expect(decideNavigation(ctx, { kind: "gate_evaluated", sequence: 3, gate_id: "GT-99", beat_id: "BT-01", satisfied: true })).toEqual(wrongGate);
    expect(session.state.teaching_cursor.beat_id).toBe("BT-01");
    expect(session.state.teaching_cursor.phase).toBe("presenting");
  });
});

describe("F5 navigator: kernel journeys (vitest process)", () => {
  it("mainline journey completes and rebuilds identically with zero legacy control writes", async () => {
    const session = await runMainline("TS-9910");
    expect(session.state.completed).toBe(true);
    expect(session.state.teaching_cursor.beat_id).toBe("BT-06");
    expect(session.assertReplayParity()).toEqual(expect.objectContaining({ equal: true }));
    const serialized = JSON.stringify(session.events.map((event) => ({ t: event.event_type, p: event.payload })));
    for (const forbidden of ["tutor_move_decided", "hint_issued", "move_type", "hint_level", "assistance_level", "legacy_source"]) {
      expect(serialized.includes(forbidden), forbidden).toBe(false);
    }
  });

  it("approved inquiry freezes the mainline cursor and returns to the explicit return point", async () => {
    const session = startSession("TS-9911", { responses: [questionOn("FN-03"), passFor("GT-01", "FN-03")] });
    await session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "vr-1" });
    expect(session.state.inquiry_cursor).not.toBeNull();
    const frozen = session.state.teaching_cursor.beat_id;
    await session.acceptStudentIntent({ intent_kind: "submit_answer", text: SCAFFOLD_STEP1_OK, client_request_id: "vr-2" });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-3" });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-4" });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-5" });
    expect(session.state.inquiry_cursor).toBeNull();
    expect(session.state.teaching_cursor.beat_id).toBe(frozen);
    expect(session.assertReplayParity()).toEqual(expect.objectContaining({ equal: true }));
  });

  it("local inquiry is bounded by MAX_LOCAL_INQUIRY_STEPS and never advances the mainline cursor", async () => {
    const session = startSession("TS-9912", {
      responses: [questionOn("FN-03"), questionOn("FN-03"), questionOn("FN-03"), questionOn("FN-03")],
    });
    await session.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "vr-1" });
    const kinds: string[] = [];
    for (let step = 0; step <= MAX_LOCAL_INQUIRY_STEPS; step += 1) {
      const turn = await session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: `vr-l${step}` });
      kinds.push(turn.decision?.decision_kind ?? turn.failure?.failure_class ?? "none");
      expect(session.state.teaching_cursor.beat_id).toBe("BT-01");
    }
    expect(kinds[kinds.length - 1]).toBe("return_to_mainline");
    expect(kinds.filter((kind) => kind === "continue_inquiry")).toHaveLength(MAX_LOCAL_INQUIRY_STEPS);
    expect(session.state.inquiry_cursor).toBeNull();
  });

  it("policy failures are recorded as explicit facts and the stream stays canonically valid", () => {
    const session = startSession("TS-9913");
    const narration = session.completeNarration();
    expect(narration.advanced).toBe(false);
    const failures = session.events.filter((event) => event.event_type === "policy_failed");
    expect(failures).toHaveLength(1);
    for (const event of session.events) {
      expect(validatePayload(event)).toEqual({ ok: true, errors: [] });
    }
  });

  it("navigator decisions validate as canonical ai_teaching_tutor_policy_decision/v1", async () => {
    const session = await runMainline("TS-9914");
    const decisions = session.events.filter((event) => event.event_type === "policy_decision_made");
    expect(decisions.length).toBeGreaterThanOrEqual(6);
    for (const event of decisions) {
      const payload = event.payload as Record<string, unknown>;
      const canonical = {
        schema: "ai_teaching_tutor_policy_decision/v1",
        session_id: session.sessionId,
        decision_id: payload.decision_id,
        decision_kind: payload.decision_kind,
        protocol_id: payload.protocol_id,
        beat_id: payload.beat_id,
        ...(payload.to_beat_id !== undefined ? { to_beat_id: payload.to_beat_id } : {}),
        policy_version: payload.policy_version,
        source_event_sequence: payload.source_event_sequence,
        source_state_revision: payload.source_state_revision,
        ...(payload.transition_basis !== undefined ? { transition_basis: payload.transition_basis } : {}),
        ...(payload.inquiry !== undefined ? { inquiry: payload.inquiry } : {}),
      };
      expect(validatePayload(canonical)).toEqual({ ok: true, errors: [] });
    }
  });

  it("consumes canonical v5 policy-decision fixture in parallel with navigator decisions", async () => {
    const fixture = JSON.parse(readFileSync(`${FIXTURES_DIR}/tutor-session-event.v5.positive.policy-decision.json`, "utf8"));
    expect(validatePayload(fixture)).toEqual({ ok: true, errors: [] });
    const session = await runMainline("TS-9915");
    const committed = session.events.filter((event) => event.event_type === "policy_decision_made");
    expect(committed.every((event) => (event.payload as { policy_version: string }).policy_version === NAVIGATOR_V5_VERSION)).toBe(true);
  });
});

// --------------------------------------------------------------------------- //
// R1 修复波次（2026-08-31）：五类 alignment / ReasoningFocus / 对抗负例 /
// outcome 回执消费 / LocalInquiryProtocol 结构化。（判卷人=固定响应模型，4B。）
// --------------------------------------------------------------------------- //

describe("F5 R1: five-class reasoning alignment (09:1118 naming, model-filled)", () => {
  it("pass in the current beat -> expected_region with fact+inference refs", () => {
    const hypothesis = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-03"),
      intent_kind: "submit_answer",
      text: ANSWER_INVARIANTS_OK,
      adjudication: adjudication({ response_kind: "final_answer", matched_gate_id: "GT-03", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-10"] }),
      evidence_sequence: 4,
    });
    expect(hypothesis.reasoning_location).toBe("aligned");
    expect(hypothesis.reasoning_alignment).toEqual({
      kind: "expected_region",
      fact_ids: ["FN-10"],
      inference_ids: ["IF-06"],
    });
    expect(hypothesis.reasoning_focus).toEqual({ part_id: "1", graph_fact_refs: ["FN-10"] });
  });

  it("pass grounded on a fact outside the current beat -> expected_region limited to the aligned sub-region", () => {
    // BT-04 上作答但模型 grounding 命中 BT-03 的 FN-10：引用集只含命中 fact。
    const hypothesis = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-04"),
      intent_kind: "submit_answer",
      text: ANSWER_INVARIANTS_OK,
      adjudication: adjudication({ response_kind: "final_answer", matched_gate_id: "GT-04", verdict: "pass", reasoning_location: "partially_aligned", grounding_refs: ["FN-10"] }),
      evidence_sequence: 6,
    });
    expect(hypothesis.reasoning_location).toBe("partially_aligned");
    expect(hypothesis.reasoning_alignment?.kind).toBe("expected_region");
    expect(hypothesis.reasoning_alignment?.fact_ids).toEqual(["FN-10"]);
    expect(hypothesis.reasoning_focus?.graph_fact_refs).toEqual(["FN-10"]);
  });

  it("unclear -> unclear_reasoning (no ref sets); alternate route -> alternate_valid_path with variant refs", () => {
    const unknown = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-03"),
      intent_kind: "submit_answer",
      text: "完全不知道",
      adjudication: adjudication({ response_kind: "mixed_or_ambiguous", verdict: "unclear", reasoning_location: "unknown", grounding_refs: [] }),
      evidence_sequence: 4,
    });
    expect(unknown.reasoning_location).toBe("unknown");
    expect(unknown.reasoning_alignment).toEqual({ kind: "unclear_reasoning" });
    const alternate = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-03"),
      intent_kind: "submit_answer",
      text: ANSWER_ALTERNATE_COORDINATE,
      adjudication: adjudication({ response_kind: "alternate_path", verdict: "not_applicable", reasoning_location: "aligned", grounding_refs: ["SV-02", "FN-23"] }),
      evidence_sequence: 4,
    });
    expect(alternate.reasoning_alignment).toEqual({
      kind: "alternate_valid_path",
      fact_ids: ["FN-23"],
      inference_ids: ["IF-07", "IF-20", "IF-21", "IF-22", "IF-23", "IF-24", "IF-25", "IF-26"],
    });
    expect(alternate.reasoning_focus?.graph_fact_refs).toEqual(["FN-23"]);
  });

  it("adversarial answers -> incorrect_reasoning anchored at the hijacked fact (negation / wrong value / stuffing)", () => {
    // R3（4B 改写）：三个对抗样本的判卷人换固定响应模型（fail + 锚定 FN-06），
    // 断言口径与 R1 相同——关键词正确但结论错误的作答不得满足 gate。
    for (const text of ["△CAD 与 △CBA 并不相似", "AD=CD=3", "△CAD∽△CBA，AD=CD=8/3、BD=10/3，所以 BE=3"]) {
      const hypothesis = hypothesisFromAdjudication({
        plan,
        beat: beat("BT-03"),
        intent_kind: "submit_answer",
        text,
        adjudication: adjudication({ response_kind: "final_answer", matched_gate_id: "GT-03", verdict: "fail", reasoning_location: "misaligned", grounding_refs: ["FN-06"] }),
        evidence_sequence: 4,
      });
      expect(hypothesis.reasoning_location, text).toBe("misaligned");
      expect(hypothesis.reasoning_alignment, text).toEqual({ kind: "incorrect_reasoning", anchored_fact_ids: ["FN-06"] });
      expect(hypothesis.gate_assessment?.verdict, text).toBe("fail");
    }
    // 无 canonical 锚点的 fail：降为 unclear（不伪造 anchored 引用）。
    const unanchored = hypothesisFromAdjudication({
      plan,
      beat: beat("BT-03"),
      intent_kind: "submit_answer",
      text: "不知道",
      adjudication: adjudication({ response_kind: "final_answer", verdict: "fail", reasoning_location: "misaligned", grounding_refs: [] }),
      evidence_sequence: 4,
    });
    expect(unanchored.reasoning_location).toBe("unknown");
    expect(unanchored.reasoning_alignment).toEqual({ kind: "unclear_reasoning" });
  });

  it("no_progress hypothesis carries the no-ref-set kind and legacy mapping keeps reasoning_location required", () => {
    const silence = noProgressHypothesis();
    expect(silence.reasoning_alignment).toEqual({ kind: "no_progress" });
    expect(silence.reasoning_location).toBe("unknown");
    const payload = hypothesisEventPayload(silence);
    expect(payload.reasoning_location).toBe("unknown");
    expect(payload.reasoning_alignment).toEqual({ kind: "no_progress" });
  });
});

describe("F5 R1: reasoning focus reducer (fold == online, cursor untouched)", () => {
  const started = (sessionId: string, sequence = 1): StoredV5Event => ({
    schema: "ai_teaching_tutor_session_event/v5",
    session_id: sessionId,
    sequence,
    state_revision: sequence,
    occurred_at: "2026-08-31T00:00:00.000Z",
    event_type: "session_started",
    payload: {
      task_id: "goldenMinhangFold2020",
      scenario_id: "golden-similarity-mvp-001:QT-SMV-001",
      question_ref: plan.question_ref,
      approach_set_ref: plan.approach_set_ref,
      solution_graph_ref: plan.solution_graph_ref,
      protocol_refs: [plan.mainline].map((protocol) => ({ artifact_id: protocol.protocol_id, version: protocol.version, content_hash: protocol.content_hash })),
      tutor_plan_ref: plan.tutor_plan_ref,
      initial_cursor: { protocol_id: "PR-SMV-001", beat_id: "BT-01" },
    },
    idempotency_key: `${sessionId}:${sequence}`,
  });
  const interpretation = (sessionId: string, sequence: number, payload: Record<string, unknown>): StoredV5Event => ({
    ...started(sessionId, sequence),
    event_type: "semantic_interpretation_recorded",
    payload: {
      intent: "ask_question",
      reasoning_location: "unknown",
      confidence: 0.8,
      interpreter_version: "test",
      ...payload,
    },
    causation_sequence: sequence - 1,
  });

  it("carried reasoning_focus overwrites state focus; absent payload leaves it untouched; cursor never moves", () => {
    const events = [
      started("TS-9940"),
      interpretation("TS-9940", 2, { reasoning_focus: { graph_fact_refs: ["FN-03"] } }),
      interpretation("TS-9940", 3, { reasoning_focus: { part_id: "1", graph_fact_refs: ["FN-05", "FN-06"] } }),
      interpretation("TS-9940", 4, {}),
    ];
    let state = foldCommittedV5Events(events.slice(0, 2));
    expect(state.reasoning_focus).toEqual({ graph_fact_refs: ["FN-03"] });
    state = applyV5Event(state, events[2]);
    expect(state.reasoning_focus).toEqual({ part_id: "1", graph_fact_refs: ["FN-05", "FN-06"] });
    state = applyV5Event(state, events[3]);
    expect(state.reasoning_focus).toEqual({ part_id: "1", graph_fact_refs: ["FN-05", "FN-06"] });
    expect(state.teaching_cursor).toEqual({ protocol_id: "PR-SMV-001", beat_id: "BT-01", phase: "presenting" });
    // 全量重建 == 逐事件推进（同一 reducer；fold 起点=在线起点）。
    expect(compareTutorRuntimeStatesSemantically(state, foldCommittedV5Events(events)).equal).toBe(true);
  });

  it("legacy streams without focus payloads rebuild to a focus-less state (byte-identical field sets)", () => {
    const legacy = foldCommittedV5Events([
      started("TS-9941"),
      interpretation("TS-9941", 2, {}),
      interpretation("TS-9941", 3, { grounding_refs: ["FN-01"] }),
    ]);
    expect("reasoning_focus" in legacy).toBe(false);
    expect(compareTutorRuntimeStatesSemantically(legacy, foldCommittedV5Events([
      started("TS-9941"),
      interpretation("TS-9941", 2, {}),
      interpretation("TS-9941", 3, { grounding_refs: ["FN-01"] }),
    ])).equal).toBe(true);
  });
});

describe("F5 R1: model-assessment gate guards (evaluator consumes verified assessments only)", () => {
  it("fail / unclear / not_applicable / missing assessment cannot satisfy student_answer gates", () => {
    const base = { confirmation_sequences: [] as number[], workspace_outcomes: [], narration_completed: false };
    for (const verdict of ["fail", "unclear", "not_applicable"] as const) {
      const assessment = evaluateGateEvidence(plan, beat("BT-03"), {
        ...base,
        model_assessment: { verdict, matched_gate_id: "GT-03", evidence_sequence: 4 },
      });
      expect(assessment.satisfied, verdict).toBe(false);
      expect(assessment.reason, verdict).toBe("answer_not_matching");
    }
    expect(evaluateGateEvidence(plan, beat("BT-03"), base)).toEqual({ satisfied: false, reason: "answer_not_adjudicated" });
    // 正常 pass（固定响应模型）不受影响。
    expect(evaluateGateEvidence(plan, beat("BT-03"), { ...base, model_assessment: { verdict: "pass", matched_gate_id: "GT-03", evidence_sequence: 4 } })).toEqual({
      satisfied: true,
      evidence_sequence: 4,
    });
  });

  it("workspace gate capability comes from the committed command (mismatched capability stays unsatisfied)", async () => {
    const session = startSession("TS-9942");
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-1" });
    // v4：BT-02 是 student_answer gate——任何 workspace capability 都不能被错配成
    // 当前 gate 的证据；消费回执后零决策、游标不动（node TS-9821(b) 同口径）。
    const mismatched = await submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9942-0001", capability: "similarity.map-corresponding-sides" });
    expect(mismatched.decision).toBeUndefined();
    expect(session.state.teaching_cursor.beat_id).toBe("BT-02");
    expect(session.assertReplayParity().equal).toBe(true);
  });
});

describe("F5 R1: student_command receipt integrity fails closed in the reducer (append + rebuild boundaries)", () => {
  const started = (sessionId: string): StoredV5Event => ({
    schema: "ai_teaching_tutor_session_event/v5",
    session_id: sessionId,
    sequence: 1,
    state_revision: 1,
    occurred_at: "2026-08-31T00:00:00.000Z",
    event_type: "session_started",
    payload: {
      task_id: "goldenMinhangFold2020",
      scenario_id: "golden-similarity-mvp-001:QT-SMV-001",
      question_ref: plan.question_ref,
      approach_set_ref: plan.approach_set_ref,
      solution_graph_ref: plan.solution_graph_ref,
      protocol_refs: [plan.mainline].map((protocol) => ({ artifact_id: protocol.protocol_id, version: protocol.version, content_hash: protocol.content_hash })),
      tutor_plan_ref: plan.tutor_plan_ref,
      initial_cursor: { protocol_id: "PR-SMV-001", beat_id: "BT-01" },
    },
    idempotency_key: `${sessionId}:1`,
  });
  const intentWithCommand = (sessionId: string, sequence: number, commandId: string, expected = 0): StoredV5Event => ({
    ...started(sessionId),
    sequence,
    state_revision: sequence,
    event_type: "student_intent_recorded",
    payload: {
      intent_kind: "submit_workspace_command",
      client_request_id: `cr-${commandId}`,
      workspace_command: {
        command_id: commandId,
        surface: "geometry",
        capability: "similarity.mark-known-segments",
        target_ids: ["seg-AD"],
        expected_workspace_revision: expected,
        client_command_id: `cc-${commandId}`,
      },
    },
    idempotency_key: `${sessionId}:${sequence}`,
  });
  const outcome = (sessionId: string, sequence: number, actionId: string, extra: Record<string, unknown> = {}): StoredV5Event => ({
    ...started(sessionId),
    sequence,
    state_revision: sequence,
    event_type: "action_outcome_recorded",
    payload: { action_id: actionId, action_kind: "student_command", outcome: "completed", ...extra },
    causation_sequence: 2,
    idempotency_key: `${sessionId}:${sequence}`,
  });
  const expectCorrupt = (events: StoredV5Event[], fragment: string): void => {
    try {
      foldCommittedV5Events(events);
      throw new Error(`expected CORRUPT_EVENT containing "${fragment}"`);
    } catch (error) {
      expect(error instanceof Error && /CORRUPT_EVENT/.test(String((error as { name?: string }).name)) || (error as { code?: string }).code === "CORRUPT_EVENT").toBe(true);
      expect((error as Error).message).toContain(fragment);
    }
  };

  it("orphan outcome (no matching committed command) fails closed", () => {
    expectCorrupt([started("TS-9943"), outcome("TS-9943", 2, "SC-orphan")], "orphan student_command outcome");
  });

  it("causation not pointing at the student input chain fails closed", () => {
    const events = [
      started("TS-9944"),
      intentWithCommand("TS-9944", 2, "SC-TS-9944-1"),
      { ...outcome("TS-9944", 3, "SC-TS-9944-1"), causation_sequence: 1 }, // 指向 session_started，非学生输入链
    ];
    expectCorrupt(events, "does not point at the command's intent event");
  });

  it("resulting_revision violating the exact +1-or-unchanged semantics fails closed", () => {
    const events = [
      started("TS-9945"),
      intentWithCommand("TS-9945", 2, "SC-TS-9945-1", 0),
      outcome("TS-9945", 3, "SC-TS-9945-1", { resulting_revision: 4 }),
    ];
    expectCorrupt(events, "violates the exact semantics");
  });

  it("duplicate command registration and revision regression fail closed; valid receipts fold", () => {
    expectCorrupt(
      [started("TS-9946"), intentWithCommand("TS-9946", 2, "SC-dup"), intentWithCommand("TS-9946", 3, "SC-dup")],
      "registered twice",
    );
    const valid = foldCommittedV5Events([
      started("TS-9947"),
      intentWithCommand("TS-9947", 2, "SC-TS-9947-1", 0),
      outcome("TS-9947", 3, "SC-TS-9947-1", { resulting_revision: 1 }),
    ]);
    expect(valid.workspace_revision).toBe(1);
  });
});

describe("F5 R1: consume-mode API (no self-reported outcomes)", () => {
  it("consume fails closed on unknown command_id and on a missing receipt; no events are appended", () => {
    const session = startSession("TS-9948");
    const before = session.events.length;
    expect(() => session.consumeWorkspaceCommandOutcome({ command_id: "SC-unknown" })).toThrow(/nothing to consume/);
    expect(session.events.length).toBe(before);
  });

  it("rejected receipts do not satisfy the gate nor advance workspace_revision; recovery works", async () => {
    const session = startSession("TS-9949", { responses: [passFor("GT-02", "FN-06")] });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-1" });
    // v4：BT-02 是 student_answer gate——rejected 回执零决策、零 revision 旁路。
    const rejected = await submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9949-rej", outcome: "rejected" });
    expect(rejected.decision).toBeUndefined();
    expect(session.state.workspace_revision).toBe(0);
    const recovered = await submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9949-ok" });
    expect(recovered.decision).toBeUndefined();
    expect(session.state.teaching_cursor.beat_id).toBe("BT-02");
    // 恢复路径是学生作答（模型裁决 GT-02 pass），不是 workspace 回执旁路。
    const answered = await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "vr-2" });
    expect(answered.decision?.decision_kind).toBe("transition_beat");
    expect(session.state.teaching_cursor.beat_id).toBe("BT-03");
    expect(session.assertReplayParity().equal).toBe(true);
  });
});

describe("F5 R1: structured LocalInquiryProtocol (builder / boundary / replay / plan-untouched)", () => {
  it("builder is deterministic and asserts the approved boundary", () => {
    const input = { plan, anchorBeat: beat("BT-01"), sessionId: "TS-9950", sequence: 5, inquiryId: "IQ-TS-9950-0005" };
    expect(buildLocalInquiryProtocol(input)).toEqual(buildLocalInquiryProtocol(input));
    const protocol = buildLocalInquiryProtocol(input);
    expect(protocol.local_protocol_id).toBe("LPR-TS-9950-0005");
    expect(protocol.beats.map((b) => b.beat_id)).toEqual(["LBT-01", "LBT-02", "LBT-03"]);
    expect(protocol.return_beat_id).toBe("BT-01");
    expect(protocol.expires_with_session).toBe(true);
    const tampered = JSON.parse(JSON.stringify(protocol));
    tampered.anchor_fact_ids = ["FN-99"];
    expect(() => assertLocalInquiryProtocolBoundary(plan, tampered)).toThrow(LocalInquiryBoundaryError);
  });

  it("local inquiry journey persists the protocol once and replays it from committed events; plan untouched", async () => {
    const planSnapshot = JSON.stringify(importGoldenPlan(importerModule));
    const session = startSession("TS-9951", {
      responses: [questionOn("FN-03"), questionOn("FN-03"), questionOn("FN-03"), questionOn("FN-03")],
    });
    const opened = await session.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "vr-1" });
    const protocol = opened.decision?.local_inquiry_protocol;
    expect(protocol?.local_protocol_id.startsWith("LPR-TS-9951-")).toBe(true);
    expect(opened.decision?.inquiry?.inquiry_protocol_id).toBeUndefined();
    for (let step = 0; step <= MAX_LOCAL_INQUIRY_STEPS; step += 1) {
      await session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: `vr-l${step}` });
    }
    expect(session.state.inquiry_cursor).toBeNull();
    expect(findLocalInquiryProtocol(session.events, opened.decision?.inquiry?.inquiry_id ?? "")).toEqual(protocol);
    // Plan-untouched：深比较 + importer 公开入口 content hash 不变。
    expect(JSON.stringify(importGoldenPlan(importerModule))).toBe(planSnapshot);
    expect(session.state.pinned_plan.tutor_plan_ref.content_hash).toBe(imported.plan.content_hash);
    expect(session.assertReplayParity().equal).toBe(true);
  });

  it("silence records a no_progress interpretation and clarifies on the mainline", () => {
    const session = startSession("TS-9952");
    const silence = session.reportSilence();
    expect(silence.decision?.decision_kind).toBe("request_clarification");
    const interpretation = session.events.filter((event) => event.event_type === "semantic_interpretation_recorded").at(-1);
    expect((interpretation?.payload as { reasoning_alignment?: { kind: string } }).reasoning_alignment?.kind).toBe("no_progress");
    expect(session.state.teaching_cursor.beat_id).toBe("BT-01");
    expect(session.assertReplayParity().equal).toBe(true);
  });
});

// --------------------------------------------------------------------------- //
// R3 波次（2026-08-31）：ModelGateAdjudicatorV5 薄边界 / 异步幂等 / resume
// Plan-aware 核对 / reducer GATE_BEAT_MISMATCH / kernel 私有化公开面。
// --------------------------------------------------------------------------- //

describe("F5 R3: ModelGateAdjudicatorV5 thin-boundary validation (unclear, never pass, on any violation)", () => {
  const eligible = new Set(["GT-03"]);
  const universe = canonicalRefUniverse(plan);

  it("accepts a well-formed pass on a candidate gate with canonical grounding", () => {
    const result = validateAdjudicationResponse(
      adjudicationJson({ response_kind: "final_answer", matched_gate_id: "GT-03", verdict: "pass", grounding_refs: ["FN-05"] }),
      eligible,
      universe,
      "fixed",
    );
    expect(result.verdict).toBe("pass");
    expect(result.matched_gate_id).toBe("GT-03");
    expect(result.grounding_refs).toEqual(["FN-05"]);
    expect(result.degraded_reason).toBeUndefined();
  });

  it("degrades to unclear on: non-JSON / missing fields / out-of-candidate gate / pass without in-plan grounding", () => {
    const cases: Array<[string, string, string]> = [
      ["not json at all", "这个答案可以通过。", "invalid_json"],
      ["missing verdict", JSON.stringify({ response_kind: "final_answer" }), "invalid_shape:verdict"],
      ["unknown response_kind", JSON.stringify({ response_kind: "guess", verdict: "pass", reasoning_location: "aligned" }), "invalid_shape:response_kind"],
      ["gate not in candidates", adjudicationJson({ matched_gate_id: "GT-99", verdict: "pass", grounding_refs: ["FN-05"] }), "gate_not_in_candidates"],
      ["pass with out-of-plan grounding", adjudicationJson({ matched_gate_id: "GT-03", verdict: "pass", grounding_refs: ["FN-99"] }), "grounding_out_of_bounds"],
      ["question cannot pass", adjudicationJson({ response_kind: "question", matched_gate_id: "GT-03", verdict: "pass", grounding_refs: ["FN-05"] }), "response_kind_not_evidence"],
      ["restatement cannot pass", adjudicationJson({ response_kind: "restatement", matched_gate_id: "GT-03", verdict: "pass", grounding_refs: ["FN-05"] }), "response_kind_not_evidence"],
    ];
    for (const [label, raw, expectedReason] of cases) {
      const result = validateAdjudicationResponse(raw, eligible, universe, "fixed");
      expect(result.verdict, label).toBe("unclear");
      expect(result.degraded_reason, label).toContain(expectedReason);
    }
  });

  it("explicit null optional fields are treated as absent (real CLI observation, round 3 E12)", () => {
    const withNulls = JSON.stringify({
      response_kind: "alternate_path",
      matched_gate_id: null,
      verdict: "not_applicable",
      reasoning_location: "misaligned",
      grounding_refs: ["SV-01"],
      brief_reason: null,
    });
    const result = validateAdjudicationResponse(withNulls, eligible, universe, "fixed");
    expect(result.verdict).toBe("not_applicable");
    expect(result.response_kind).toBe("alternate_path");
    expect(result.matched_gate_id).toBeUndefined();
    expect(result.grounding_refs).toEqual(["SV-01"]);
  });

  it("truncated trailing string in model JSON is repaired without rewriting content (real CLI observation)", () => {
    // 真模型实测（2026-08-31 第二轮 E03）：brief_reason 字符串未闭合即 `}` 收尾。
    const truncated = '{"response_kind":"final_answer","matched_gate_id":"GT-04","verdict":"pass","reasoning_location":"aligned","grounding_refs":["FN-07","FN-06"],"brief_reason":"学生给出最终结论 BE=1，与 FN-06 一致且引用了蝶形相似路径（FN-07）。}';
    const repaired = validateAdjudicationResponse(truncated, new Set(["GT-04"]), universe, "fixed");
    expect(repaired.verdict).toBe("pass");
    expect(repaired.grounding_refs).toEqual(["FN-07", "FN-06"]);
    expect(repaired.matched_gate_id).toBe("GT-04");
    // 修复只补引号不重写内容：brief_reason 原文保留。
    expect(repaired.brief_reason).toContain("蝶形相似");
  });

  it("json embedded in prose is still extracted; provider timeout/unavailable degrade via the adjudicator", async () => {
    const embedded = validateAdjudicationResponse(
      `好的，裁决如下：\n${adjudicationJson({ matched_gate_id: "GT-03", verdict: "pass", grounding_refs: ["FN-05"] })}\n以上。`,
      eligible,
      universe,
      "fixed",
    );
    expect(embedded.verdict).toBe("pass");
    const unavailable = await new ModelGateAdjudicatorV5(new UnavailableGateProvider()).adjudicate(
      buildGateAdjudicationContext({ plan, beat: beat("BT-03"), events: [], studentInput: { intent_kind: "submit_answer", text: "BE=1" } }),
    );
    expect(unavailable.verdict).toBe("unclear");
    expect(unavailable.degraded_reason).toContain("provider_error");
    const hanging = new ModelGateAdjudicatorV5(new HangingGateProvider(), { timeoutMs: 25 });
    const timedOut = await hanging.adjudicate(
      buildGateAdjudicationContext({ plan, beat: beat("BT-03"), events: [], studentInput: { intent_kind: "submit_answer", text: "BE=1" } }),
    );
    expect(timedOut.verdict).toBe("unclear");
    expect(timedOut.degraded_reason).toContain("provider_timeout");
  });

  it("context assembly: eligible gates computed server-side from the pinned plan (question/beat/dialogue/focus minimal set)", () => {
    const context = buildGateAdjudicationContext({
      plan,
      beat: beat("BT-04"),
      events: [],
      reasoningFocus: { part_id: "1", graph_fact_refs: ["FN-06"] },
      studentInput: { intent_kind: "submit_answer", text: "BE=1" },
    });
    expect(context.eligible_gates).toEqual([
      { gate_id: "GT-04", criterion: beat("BT-04").completion_evidence.gate?.requirement, expected_fact: { fact_id: "FN-19", statement: plan.facts.get("FN-19")?.statement } },
    ]);
    expect(context.current_beat.beat_id).toBe("BT-04");
    expect(context.question.artifact_id).toBe("QT-SMV-001");
    expect(context.reasoning_focus).toEqual({ part_id: "1", graph_fact_refs: ["FN-06"] });
    expect(context.relevant_solution_context.some((fact) => fact.fact_id === "FN-19" && fact.in_current_beat)).toBe(true);
    expect(context.alternate_routes.map((route) => route.variant_id)).toEqual(["SV-01", "SV-02"]);
    // 无 gate 的 Beat（如纯 LocalInquiry）→ 候选集为空：模型只能在解释维度作答。
    const scaffoldContext = buildGateAdjudicationContext({
      plan,
      beat: { ...beat("BT-04"), completion_evidence: { evidence_kind: "student_answer" } },
      events: [],
      studentInput: { intent_kind: "submit_answer", text: "x" },
    });
    expect(scaffoldContext.eligible_gates).toEqual([]);
  });
});

describe("F5 R3: reducer fails closed on wrong-beat gate_evaluated (GATE_BEAT_MISMATCH)", () => {
  const started = (sessionId: string): StoredV5Event => ({
    schema: "ai_teaching_tutor_session_event/v5",
    session_id: sessionId,
    sequence: 1,
    state_revision: 1,
    occurred_at: "2026-08-31T00:00:00.000Z",
    event_type: "session_started",
    payload: {
      task_id: "goldenMinhangFold2020",
      scenario_id: "golden-similarity-mvp-001:QT-SMV-001",
      question_ref: plan.question_ref,
      approach_set_ref: plan.approach_set_ref,
      solution_graph_ref: plan.solution_graph_ref,
      protocol_refs: [plan.mainline].map((protocol) => ({ artifact_id: protocol.protocol_id, version: protocol.version, content_hash: protocol.content_hash })),
      tutor_plan_ref: plan.tutor_plan_ref,
      initial_cursor: { protocol_id: "PR-SMV-001", beat_id: "BT-01" },
    },
    idempotency_key: `${sessionId}:1`,
  });
  const gateEvent = (sessionId: string, sequence: number, payload: Record<string, unknown>): StoredV5Event => ({
    ...started(sessionId),
    sequence,
    state_revision: sequence,
    event_type: "gate_evaluated",
    payload: { satisfied: false, ...payload },
    causation_sequence: 1,
    idempotency_key: `${sessionId}:${sequence}`,
  });

  it("future/stale beat gate events are rejected; correctly bound gate events still fold", () => {
    for (const payload of [
      { gate_id: "GT-03", beat_id: "BT-03" }, // future beat
      { gate_id: "GT-01", beat_id: "BT-05" }, // stale/other beat
    ]) {
      try {
        foldCommittedV5Events([started("TS-9960"), gateEvent("TS-9960", 2, payload)]);
        throw new Error("expected GATE_BEAT_MISMATCH");
      } catch (error) {
        expect((error as { code?: string }).code).toBe("GATE_BEAT_MISMATCH");
        expect((error as Error).message).toContain(payload.beat_id);
      }
    }
    const legal = foldCommittedV5Events([started("TS-9961"), gateEvent("TS-9961", 2, { gate_id: "GT-01", beat_id: "BT-01", satisfied: true })]);
    expect(legal.teaching_cursor.phase).toBe("gate_satisfied");
  });
});

describe("F5 R3: session-level model-failure facts and kernel privatization surface", () => {
  it("model failure records runtime_failure + unclear interpretation + clarification (no student incorrect, no beat advance)", async () => {
    const session = startSession("TS-9962", { responses: ["不是 JSON"] });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-1" });
    const turn = await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "vr-2" });
    // v4：BT-02 是模型裁决 gate——non-JSON 输出降级 unclear，游标不动（node R3 矩阵同口径）。
    expect(session.state.teaching_cursor.beat_id).toBe("BT-02");
    expect(turn.decision?.decision_kind).toBe("request_clarification");
    const runtimeFailure = session.events.find((event) => event.event_type === "runtime_failure");
    expect(runtimeFailure).toBeDefined();
    expect((runtimeFailure?.payload as { message: string }).message).toContain("gate_adjudicator_model_failure");
    for (const event of session.events) {
      expect(validatePayload(event)).toEqual({ ok: true, errors: [] });
    }
    expect(session.assertReplayParity().equal).toBe(true);
  });

  it("kernel is private: public surface exposes state/revision/events + controlled appendExternalFacts/rebuildState", async () => {
    const session = startSession("TS-9963");
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-1" });
    expect(typeof session.appendExternalFacts).toBe("function");
    expect(typeof session.rebuildState).toBe("function");
    expect(typeof session.revision).toBe("number");
    expect((session as unknown as { kernel: unknown }).kernel).toBeUndefined();
    expect(session.rebuildState().teaching_cursor.beat_id).toBe("BT-02");
    const appended = session.appendExternalFacts(session.revision, [
      {
        event_type: "action_outcome_recorded",
        payload: { action_id: "SC-x", action_kind: "voice", outcome: "completed" },
        occurred_at: new Date().toISOString(),
        causation_sequence: 1,
      },
    ]);
    expect(appended.appendedSequences.length).toBe(1);
    expect(session.assertReplayParity().equal).toBe(true);
  });
});

describe("F5 R3.1: external-fact write boundary (appendExternalFacts allowlist, fail closed)", () => {
  /** 统一断言集：明确错误 + 整批零提交 + revision/游标深比较不变 + phase 不变 + replay parity。 */
  function expectWriteRefused(
    session: NavigatorSessionV5,
    before: { count: number; revision: number; cursor: TutorRuntimeStateV5["teaching_cursor"] },
    batch: Parameters<NavigatorSessionV5["appendExternalFacts"]>[1],
  ): void {
    try {
      session.appendExternalFacts(session.revision, batch);
      throw new Error("expected NavigatorWriteBoundaryError (EXTERNAL_FACT_TYPE_FORBIDDEN)");
    } catch (error) {
      expect(error).toBeInstanceOf(NavigatorWriteBoundaryError);
      expect((error as NavigatorWriteBoundaryError).code).toBe("EXTERNAL_FACT_TYPE_FORBIDDEN");
      expect((error as NavigatorWriteBoundaryError).forbiddenTypes).toEqual(["gate_evaluated"]);
    }
    expect(session.events.length).toBe(before.count);
    expect(session.revision).toBe(before.revision);
    expect(session.state.teaching_cursor).toEqual(before.cursor);
    expect(session.state.teaching_cursor.phase).not.toBe("gate_satisfied");
    expect(session.rebuildState().teaching_cursor.phase).not.toBe("gate_satisfied");
    expect(session.assertReplayParity().equal).toBe(true);
  }

  function snapshot(session: NavigatorSessionV5): { count: number; revision: number; cursor: TutorRuntimeStateV5["teaching_cursor"] } {
    return { count: session.events.length, revision: session.revision, cursor: { ...session.state.teaching_cursor } };
  }

  it("GT-99@BT-01 satisfied=true via appendExternalFacts is refused (user-reproduced pollution vector, now fail closed)", () => {
    const session = startSession("TS-9970");
    expect(session.state.teaching_cursor).toMatchObject({ beat_id: "BT-01", phase: "presenting" });
    const before = snapshot(session);
    expectWriteRefused(session, before, [
      {
        event_type: "gate_evaluated",
        payload: { gate_id: "GT-99", beat_id: "BT-01", satisfied: true, evidence_sequence: 2 },
        occurred_at: new Date().toISOString(),
        causation_sequence: 2,
      },
    ]);
    expect((session.state.teaching_cursor as { gate_id?: string }).gate_id).toBeUndefined();
  });

  it("correct GT-01@BT-01 with forged evidence_sequence is refused too (gate facts never enter externally)", () => {
    const session = startSession("TS-9971");
    const before = snapshot(session);
    expectWriteRefused(session, before, [
      {
        event_type: "gate_evaluated",
        payload: { gate_id: "GT-01", beat_id: "BT-01", satisfied: true, evidence_sequence: 999999 },
        occurred_at: new Date().toISOString(),
        causation_sequence: 2,
      },
    ]);
  });

  it("future / stale beat gate facts are refused at the boundary (zero commit, zero cursor change)", () => {
    for (const [sessionId, payload] of [
      ["TS-9972", { gate_id: "GT-04", beat_id: "BT-04", satisfied: true, evidence_sequence: 2 }],
      ["TS-9973", { gate_id: "GT-01", beat_id: "BT-05", satisfied: true, evidence_sequence: 2 }],
    ] as const) {
      const session = startSession(sessionId);
      const before = snapshot(session);
      expectWriteRefused(session, before, [
        { event_type: "gate_evaluated", payload: { ...payload }, occurred_at: new Date().toISOString(), causation_sequence: 2 },
      ]);
    }
  });

  it("a forged gate mixed with a legal receipt rolls back the WHOLE batch (no partial commit); the legal receipt alone still enters and satisfies the workspace gate", async () => {
    const session = startSession("TS-9974");
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-r31-1" }); // BT-01 → BT-02
    await session.acceptStudentIntent({
      intent_kind: "submit_workspace_command",
      client_request_id: "vr-r31-2",
      workspace_command: {
        command_id: "SC-TS-9974-0001",
        surface: "geometry",
        capability: "similarity.mark-known-segments",
        target_ids: ["seg-AD"],
        expected_workspace_revision: 0,
        client_command_id: "cc-r31-1",
      },
    });
    const intentSequence = [...session.events].reverse().find((event) => event.event_type === "student_intent_recorded")?.sequence ?? 1;
    const legalReceipt = {
      event_type: "action_outcome_recorded" as const,
      payload: { action_id: "SC-TS-9974-0001", action_kind: "student_command", outcome: "completed", resulting_revision: 1 },
      occurred_at: new Date().toISOString(),
      causation_sequence: intentSequence,
    };
    const before = snapshot(session);
    expectWriteRefused(session, before, [
      legalReceipt,
      {
        event_type: "gate_evaluated",
        payload: { gate_id: "GT-02", beat_id: "BT-02", satisfied: true, evidence_sequence: 2 },
        occurred_at: new Date().toISOString(),
        causation_sequence: 2,
      },
    ]);
    // 正例保留：同一合法回执单独提交 → 进入 → 可被消费；但 v4 BT-02 gate 是
    // student_answer，回执不得跨 evidence_kind 旁路满足它（node TS-9876 同口径）。
    session.appendExternalFacts(session.revision, [legalReceipt]);
    const turn = session.consumeWorkspaceCommandOutcome({ command_id: "SC-TS-9974-0001" });
    expect(turn.decision).toBeUndefined();
    expect(session.state.teaching_cursor.beat_id).toBe("BT-02");
    expect(session.assertReplayParity().equal).toBe(true);
  });

  it("every Navigator-internal event type is refused; only action_outcome_recorded receipts may enter", () => {
    const forbiddenTypes = [
      "session_started",
      "student_intent_recorded",
      "semantic_interpretation_recorded",
      "policy_decision_made",
      "gate_evaluated",
      "voice_action_issued",
      "workspace_surface_action_issued",
      "external_support_recorded",
      "inquiry_opened",
      "inquiry_returned",
      "student_progressed",
      "policy_failed",
      "presentation_failed",
      "runtime_failure",
      "session_completed",
    ] as const;
    const session = startSession("TS-9975");
    const before = snapshot(session);
    for (const event_type of forbiddenTypes) {
      try {
        session.appendExternalFacts(session.revision, [
          { event_type, payload: { forged: true }, occurred_at: new Date().toISOString(), causation_sequence: 2 },
        ]);
        throw new Error(`expected EXTERNAL_FACT_TYPE_FORBIDDEN for ${event_type}`);
      } catch (error) {
        expect(error).toBeInstanceOf(NavigatorWriteBoundaryError);
        expect((error as NavigatorWriteBoundaryError).code).toBe("EXTERNAL_FACT_TYPE_FORBIDDEN");
      }
    }
    expect(session.events.length).toBe(before.count);
    expect(session.revision).toBe(before.revision);
    expect(session.state.teaching_cursor).toEqual(before.cursor);
    expect(session.assertReplayParity().equal).toBe(true);
  });
});
