/**
 * F5 navigator Vitest 套件（Session 与 Protocol Navigator 内核）。
 *
 * node 链（tutorNavigatorV5.test.ts）以真实 Approved 链 + F2 kernel 覆盖 G5
 * 门禁正/负例；本套件补充单元语义：interpreter 假设分类、gate 证据评估、
 * ESE 支持阶梯、事件流派生计数器、decideNavigation 确定性与 fail-closed 分支，
 * 以及 vitest 进程下的 kernel 旅程闭环（SQLITE_PATH 由 vitest.setup.ts 前置）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validatePayload } from "../../../../../shared/canonical";
import * as importerModule from "../../planBuild/v4/ImportApprovedPlanV4";
import {
  buildNavigatorPlan,
  buildSessionStartedPayload,
} from "../NavigatorPlanV5";
import {
  ANSWER_ALTERNATE_COORDINATE,
  ANSWER_GOAL_OK,
  ANSWER_INVARIANTS_OK,
  FIXTURES_DIR,
  GOLDEN,
  QUESTION_IN_BOUND,
  QUESTION_OUT_OF_BOUND,
  importGoldenPlan,
  realCanonicalRoot,
} from "./navigatorSupport";
import {
  INTERPRETATION_MATCH_THRESHOLD,
  interpretStudentInput,
  interpretationMatchScore,
  hypothesisEventPayload,
} from "../SemanticInterpreterV5";
import { evaluateGateEvidence } from "../GateEvidenceEvaluatorV5";
import { buildExternalSupportEvidence } from "../ExternalSupportEvidenceV5";
import {
  MAX_LOCAL_INQUIRY_STEPS,
  NAVIGATOR_V5_VERSION,
  decideNavigation,
  deriveLocalInquirySteps,
  deriveUnresolvedClarifications,
  type NavigatorContext,
} from "../TutorNavigatorV5";
import { NavigatorSessionV5 } from "../NavigatorSessionV5";
import {
  assertLocalInquiryProtocolBoundary,
  buildLocalInquiryProtocol,
  findLocalInquiryProtocol,
  LocalInquiryBoundaryError,
} from "../LocalInquiryProtocolV5";
import {
  analyzeAnswerAgainstBasis,
  factDigitUniverse,
  noProgressHypothesis,
} from "../SemanticInterpreterV5";
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

function startSession(sessionId: string): NavigatorSessionV5 {
  return NavigatorSessionV5.start({
    sessionId,
    studentId: "student-nav5-vitest",
    canonicalRoot: realCanonicalRoot(),
    tpId: GOLDEN.tpId,
    taskId: GOLDEN.taskId,
    scenarioId: GOLDEN.scenarioId,
  });
}

/** R1 workspace 回执链：意图 → kernel.append 回执（F3 侧）→ 消费。 */
function submitWorkspaceCommandWithReceipt(
  session: NavigatorSessionV5,
  input: { command_id: string; capability?: string; outcome?: "completed" | "rejected" | "failed"; expectedRevision?: number },
): import("../NavigatorSessionV5").TurnResult {
  const capability = input.capability ?? "similarity.mark-known-segments";
  session.acceptStudentIntent({
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
  session.kernel.append(session.kernel.revision, [
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
    revision: session.kernel.revision,
    localInquirySteps: deriveLocalInquirySteps(session.events),
    unresolvedClarifications: deriveUnresolvedClarifications(session.events),
  };
}

/** 已提交 mainline 旅程（vitest 进程内独立会话；R1 回执消费模式）。 */
function runMainline(sessionId: string): NavigatorSessionV5 {
  const session = startSession(sessionId);
  session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-1" });
  submitWorkspaceCommandWithReceipt(session, { command_id: `SC-${sessionId}-0001` });
  session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "vr-3" });
  session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_GOAL_OK, client_request_id: "vr-4" });
  session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-5" });
  return session;
}

describe("F5 navigator: plan index from real approved chain", () => {
  it("builds mainline + branch indexes and full-pin session_started payload (no invented structure)", () => {
    expect(plan.mainline.protocol_id).toBe("PR-SMV-001");
    expect(plan.mainline.beat_order).toEqual(["BT-01", "BT-02", "BT-03", "BT-04", "BT-05"]);
    expect([...plan.branches.keys()]).toEqual(["PR-SMV-002"]);
    expect(plan.facts.size).toBe(8);
    expect(plan.solution_variants.map((variant) => variant.variant_id)).toEqual(["SV-01", "SV-02"]);
    const payload = buildSessionStartedPayload(plan, {
      sessionId: "TS-9901",
      taskId: GOLDEN.taskId,
      scenarioId: GOLDEN.scenarioId,
    });
    expect(payload.tutor_plan_ref).toEqual({
      artifact_id: "TP-SMV-009",
      version: "v1",
      content_hash: imported.plan.content_hash,
    });
    expect(payload.protocol_refs.map((ref) => ref.artifact_id).sort()).toEqual(["PR-SMV-001", "PR-SMV-002"]);
    expect(payload.initial_cursor).toEqual({ protocol_id: "PR-SMV-001", beat_id: "BT-01" });
  });

  it("beat gates reflect the approved protocol (GT-01 confirmation / GT-02 workspace / GT-03,04 answers)", () => {
    expect(beat("BT-01").completion_evidence.evidence_kind).toBe("student_confirmation");
    expect(beat("BT-02").completion_evidence.evidence_kind).toBe("workspace_command");
    expect(beat("BT-02").completion_evidence.gate?.capability).toBe("similarity.mark-known-segments");
    expect(beat("BT-03").completion_evidence.gate?.graph_fact_id).toBe("FN-05");
    expect(beat("BT-04").completion_evidence.gate?.graph_fact_id).toBe("FN-08");
    expect(beat("BT-03").pacing).toEqual({ wait_policy: "bounded_wait", max_wait_seconds: 180 });
  });
});

describe("F5 navigator: semantic interpreter (refutable hypotheses)", () => {
  it("submit_answer on the current beat fact -> aligned with grounding", () => {
    const hypothesis = interpretStudentInput(plan, {
      intent_kind: "submit_answer",
      text: ANSWER_GOAL_OK,
      beat: beat("BT-04"),
    });
    expect(hypothesis.reasoning_location).toBe("aligned");
    expect(hypothesis.matched_fact_id).toBe("FN-08");
    expect(hypothesis.grounding_refs).toEqual(["FN-08"]);
  });

  it("unrelated text -> unknown (no forced classification), threshold is 4 normalized chars", () => {
    expect(interpretationMatchScore("BE=2", "BE=1")).toBeLessThan(INTERPRETATION_MATCH_THRESHOLD);
    const hypothesis = interpretStudentInput(plan, {
      intent_kind: "submit_answer",
      text: "BE=2",
      beat: beat("BT-04"),
    });
    expect(hypothesis.reasoning_location).toBe("unknown");
    expect(hypothesis.matched_fact_id).toBeUndefined();
  });

  it("coordinate-method answer grounds the alternate variant SV-02 (not a mainline fact)", () => {
    const hypothesis = interpretStudentInput(plan, {
      intent_kind: "submit_answer",
      text: ANSWER_ALTERNATE_COORDINATE,
      beat: beat("BT-03"),
    });
    expect(hypothesis.matched_variant_id).toBe("SV-02");
    expect(hypothesis.intent).toBe("submit_answer:alternate_route");
  });

  it("ask_question in/out of bound is decided by approved-content overlap", () => {
    const inBound = interpretStudentInput(plan, { intent_kind: "ask_question", text: QUESTION_IN_BOUND, beat: beat("BT-01") });
    const outOfBound = interpretStudentInput(plan, { intent_kind: "ask_question", text: QUESTION_OUT_OF_BOUND, beat: beat("BT-01") });
    expect(inBound.in_bound).toBe(true);
    expect(inBound.intent).toBe("ask_question");
    expect(outOfBound.in_bound).toBe(false);
    expect(outOfBound.intent).toBe("ask_question:out_of_bound");
  });

  it("hypothesis payload round-trips through the canonical v5 interpretation event", () => {
    const hypothesis = interpretStudentInput(plan, { intent_kind: "submit_answer", text: ANSWER_GOAL_OK, beat: beat("BT-04") });
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
});

describe("F5 navigator: gate evidence evaluator", () => {
  it("narration and timeout cannot satisfy student-evidence gates (explicit rejection)", () => {
    for (const input of [
      { narration_completed: true, narration_attempted_as_evidence: true },
      { narration_completed: false, timeout_attempted_as_evidence: true },
    ]) {
      const assessment = evaluateGateEvidence(plan, beat("BT-01"), {
        confirmation_sequences: [],
        submitted_answers: [],
        workspace_outcomes: [],
        ...input,
      });
      expect(assessment.satisfied).toBe(false);
      expect(assessment.reason).toBe("requires_student_evidence");
    }
  });

  it("student answer must match the gate graph fact statement", () => {
    const base = { confirmation_sequences: [] as number[], workspace_outcomes: [], narration_completed: false };
    const good = evaluateGateEvidence(plan, beat("BT-03"), {
      ...base,
      submitted_answers: [{ text: ANSWER_INVARIANTS_OK, sequence: 4 }],
    });
    const bad = evaluateGateEvidence(plan, beat("BT-03"), {
      ...base,
      submitted_answers: [{ text: "不知道", sequence: 4 }],
    });
    expect(good).toEqual({ satisfied: true, evidence_sequence: 4 });
    expect(bad.satisfied).toBe(false);
    expect(bad.reason).toBe("answer_not_matching");
  });

  it("workspace gate only satisfied by a completed outcome of the gate capability", () => {
    const base = { confirmation_sequences: [], submitted_answers: [], narration_completed: false };
    expect(
      evaluateGateEvidence(plan, beat("BT-02"), {
        ...base,
        workspace_outcomes: [{ capability: "similarity.map-corresponding-sides", outcome: "completed", sequence: 5 }],
      }).satisfied,
    ).toBe(false);
    expect(
      evaluateGateEvidence(plan, beat("BT-02"), {
        ...base,
        workspace_outcomes: [{ capability: "similarity.mark-known-segments", outcome: "rejected", sequence: 5 }],
      }).satisfied,
    ).toBe(false);
    expect(
      evaluateGateEvidence(plan, beat("BT-02"), {
        ...base,
        workspace_outcomes: [{ capability: "similarity.mark-known-segments", outcome: "completed", sequence: 5 }],
      }),
    ).toEqual({ satisfied: true, evidence_sequence: 5 });
  });
});

describe("F5 navigator: external support evidence ladder", () => {
  it("orient is within every approved boundary; exceeding the beat ladder fails closed", () => {
    for (const beatId of ["BT-01", "BT-02", "BT-03", "BT-04", "BT-05"]) {
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

  it("completed state refuses any further decision", () => {
    const session = runMainline("TS-9909");
    expect(session.state.completed).toBe(true);
    const outcome = decideNavigation(contextAt(session), { kind: "session_start" });
    expect(outcome.ok).toBe(false);
  });
});

describe("F5 navigator: kernel journeys (vitest process)", () => {
  it("mainline journey completes and rebuilds identically with zero legacy control writes", () => {
    const session = runMainline("TS-9910");
    expect(session.state.completed).toBe(true);
    expect(session.state.teaching_cursor.beat_id).toBe("BT-05");
    expect(session.assertReplayParity()).toEqual(expect.objectContaining({ equal: true }));
    const serialized = JSON.stringify(session.events.map((event) => ({ t: event.event_type, p: event.payload })));
    for (const forbidden of ["tutor_move_decided", "hint_issued", "move_type", "hint_level", "assistance_level", "legacy_source"]) {
      expect(serialized.includes(forbidden), forbidden).toBe(false);
    }
  });

  it("approved inquiry freezes the mainline cursor and returns to the explicit return point", () => {
    const session = startSession("TS-9911");
    session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "vr-1" });
    expect(session.state.inquiry_cursor).not.toBeNull();
    const frozen = session.state.teaching_cursor.beat_id;
    session.acceptStudentIntent({ intent_kind: "submit_answer", text: "我说不出这道题问的是什么", client_request_id: "vr-2" });
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-3" });
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-4" });
    expect(session.state.inquiry_cursor).toBeNull();
    expect(session.state.teaching_cursor.beat_id).toBe(frozen);
    expect(session.assertReplayParity()).toEqual(expect.objectContaining({ equal: true }));
  });

  it("local inquiry is bounded by MAX_LOCAL_INQUIRY_STEPS and never advances the mainline cursor", () => {
    const session = startSession("TS-9912");
    session.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "vr-1" });
    const kinds: string[] = [];
    for (let step = 0; step <= MAX_LOCAL_INQUIRY_STEPS; step += 1) {
      const turn = session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: `vr-l${step}` });
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

  it("navigator decisions validate as canonical ai_teaching_tutor_policy_decision/v1", () => {
    const session = runMainline("TS-9914");
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

  it("consumes canonical v5 policy-decision fixture in parallel with navigator decisions", () => {
    const fixture = JSON.parse(readFileSync(`${FIXTURES_DIR}/tutor-session-event.v5.positive.policy-decision.json`, "utf8"));
    expect(validatePayload(fixture)).toEqual({ ok: true, errors: [] });
    const session = runMainline("TS-9915");
    const committed = session.events.filter((event) => event.event_type === "policy_decision_made");
    expect(committed.every((event) => (event.payload as { policy_version: string }).policy_version === NAVIGATOR_V5_VERSION)).toBe(true);
  });
});

// --------------------------------------------------------------------------- //
// R1 修复波次（2026-08-31）：五类 alignment / ReasoningFocus / 对抗守卫 /
// outcome 回执消费 / LocalInquiryProtocol 结构化。
// --------------------------------------------------------------------------- //

describe("F5 R1: five-class reasoning alignment (09:1118 naming, old 4-value mapping)", () => {
  it("aligned answer in the current beat -> expected_region with fact+inference refs", () => {
    const hypothesis = interpretStudentInput(plan, { intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, beat: beat("BT-03") });
    expect(hypothesis.reasoning_location).toBe("aligned");
    expect(hypothesis.reasoning_alignment).toEqual({
      kind: "expected_region",
      fact_ids: ["FN-05"],
      inference_ids: ["IF-02"],
    });
    expect(hypothesis.reasoning_focus).toEqual({ graph_fact_refs: ["FN-05"] });
  });

  it("partially_aligned (fact matched outside the current beat) -> expected_region limited to the aligned sub-region", () => {
    // BT-04 上作答命中 BT-03 的 FN-05：partially_aligned，引用集只含命中 fact。
    const hypothesis = interpretStudentInput(plan, { intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, beat: beat("BT-04") });
    expect(hypothesis.reasoning_location).toBe("partially_aligned");
    expect(hypothesis.reasoning_alignment?.kind).toBe("expected_region");
    expect(hypothesis.reasoning_alignment?.fact_ids).toEqual(["FN-05"]);
    expect(hypothesis.reasoning_focus?.graph_fact_refs).toEqual(["FN-05"]);
  });

  it("unknown -> unclear_reasoning (no ref sets); alternate route -> alternate_valid_path with variant refs", () => {
    const unknown = interpretStudentInput(plan, { intent_kind: "submit_answer", text: "完全不知道", beat: beat("BT-03") });
    expect(unknown.reasoning_location).toBe("unknown");
    expect(unknown.reasoning_alignment).toEqual({ kind: "unclear_reasoning" });
    const alternate = interpretStudentInput(plan, { intent_kind: "submit_answer", text: ANSWER_ALTERNATE_COORDINATE, beat: beat("BT-03") });
    expect(alternate.reasoning_alignment).toEqual({
      kind: "alternate_valid_path",
      fact_ids: ["FN-08"],
      inference_ids: ["IF-01", "IF-02", "IF-06"],
    });
    expect(alternate.reasoning_focus?.graph_fact_refs).toEqual(["FN-08"]);
  });

  it("adversarial answers -> incorrect_reasoning anchored at the hijacked fact (negation / wrong value / stuffing)", () => {
    const universe = factDigitUniverse(plan);
    for (const text of ["并不是 AE=AC=4", "AE=AC=5", "翻折不变量 AE=AC=4、DE=DC=t，所以 BE=3，勾股定理 AB=5"]) {
      const hypothesis = interpretStudentInput(plan, { intent_kind: "submit_answer", text, beat: beat("BT-03") });
      expect(hypothesis.reasoning_location, text).toBe("misaligned");
      expect(hypothesis.reasoning_alignment, text).toEqual({ kind: "incorrect_reasoning", anchored_fact_ids: ["FN-05"] });
      expect(hypothesis.matched_fact_id).toBe("FN-05");
    }
    // 守卫口径单测：同一入口，negation/数值/编造三道守卫各自可命中。注：
    // 编造值守卫是批准值域的粗口径——取值恰与他处 fact 重合（如 "BE=3" 的 3
    // ∈ FN-06 的 8/3）时不触发，登记为确定性 MVP interpreter 的已知限制（F6
    // 模型 interpreter 取代口径时消除）。
    const statement = plan.facts.get("FN-05")?.statement ?? "";
    expect(analyzeAnswerAgainstBasis("并不是 AE=AC=4", statement, universe).negation_anchored).toBe(true);
    expect(analyzeAnswerAgainstBasis("AE=AC=5", statement, universe).value_mismatch).toBe(true);
    expect(analyzeAnswerAgainstBasis("翻折不变量 AE=AC=4、DE=DC=t，所以 BE=3，勾股定理 AB=5", statement, universe).invented_values).toBe(true);
    expect(analyzeAnswerAgainstBasis(ANSWER_INVARIANTS_OK, statement, universe).adversarial).toBe(false);
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

describe("F5 R1: adversarial gate guards (evaluator reuses the interpreter guard)", () => {
  it("negation / wrong-value / stuffed answers cannot satisfy student_answer gates", () => {
    const base = { confirmation_sequences: [] as number[], workspace_outcomes: [], narration_completed: false };
    for (const text of ["并不是 AE=AC=4", "AE=AC=5", "翻折不变量 AE=AC=4、DE=DC=t 所以 BE=3 勾股定理 AB=5"]) {
      const assessment = evaluateGateEvidence(plan, beat("BT-03"), { ...base, submitted_answers: [{ text, sequence: 4 }] });
      expect(assessment.satisfied, text).toBe(false);
      expect(assessment.reason, text).toBe("answer_not_matching");
    }
    // 正常作答不受守卫误伤。
    expect(evaluateGateEvidence(plan, beat("BT-03"), { ...base, submitted_answers: [{ text: ANSWER_INVARIANTS_OK, sequence: 4 }] })).toEqual({
      satisfied: true,
      evidence_sequence: 4,
    });
  });

  it("workspace gate capability comes from the committed command (mismatched capability stays unsatisfied)", () => {
    const session = startSession("TS-9942");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-1" });
    const mismatched = submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9942-0001", capability: "similarity.map-corresponding-sides" });
    expect(mismatched.decision?.decision_kind).toBe("request_clarification");
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

  it("rejected receipts do not satisfy the gate nor advance workspace_revision; recovery works", () => {
    const session = startSession("TS-9949");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "vr-1" });
    const rejected = submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9949-rej", outcome: "rejected" });
    expect(rejected.decision?.decision_kind).toBe("request_clarification");
    expect(session.state.workspace_revision).toBe(0);
    const recovered = submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9949-ok" });
    expect(recovered.decision?.decision_kind).toBe("transition_beat");
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

  it("local inquiry journey persists the protocol once and replays it from committed events; plan untouched", () => {
    const planSnapshot = JSON.stringify(importGoldenPlan(importerModule));
    const session = startSession("TS-9951");
    const opened = session.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "vr-1" });
    const protocol = opened.decision?.local_inquiry_protocol;
    expect(protocol?.local_protocol_id.startsWith("LPR-TS-9951-")).toBe(true);
    expect(opened.decision?.inquiry?.inquiry_protocol_id).toBeUndefined();
    for (let step = 0; step <= MAX_LOCAL_INQUIRY_STEPS; step += 1) {
      session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: `vr-l${step}` });
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
