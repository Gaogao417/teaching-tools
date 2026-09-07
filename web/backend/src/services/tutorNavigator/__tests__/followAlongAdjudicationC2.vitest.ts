import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildGateAdjudicationContext, validateAdjudicationResponse, ModelGateAdjudicatorV5,
  FixedResponseGateProvider, HangingGateProvider, UnavailableGateProvider,
  GATE_ADJUDICATION_SYSTEM_PROMPT, LEGACY_GATE_ADJUDICATION_SYSTEM_PROMPT,
  MODEL_GATE_ADJUDICATOR_VERSION, LEGACY_MODEL_GATE_ADJUDICATOR_VERSION,
  type AdjudicationValidationOptions, type GateAdjudicationResult,
} from "../ModelGateAdjudicatorV5";
import { hypothesisFromAdjudication, hypothesisEventPayload, interpretStudentInput } from "../SemanticInterpreterV5";
import type { NavigatorBeatView, NavigatorPlanV5 } from "../NavigatorPlanV5";
import type { StoredV5Event } from "../../tutorSession/TutorSessionEventV5";

// All synthetic inputs are read-only fixtures. No session DB, model network, or asset publication.
const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "../shared/canonical/fixtures/teaching-protocol.v3.positive.mainline-follow-along.json"), "utf8"));
const beat: NavigatorBeatView = {
  ...fixture.beats[0], protocol_id: fixture.protocol_id,
  graph_fact_refs: ["FN-01"], inference_refs: [], resource_ids: [],
};
const plan = {
  question: { artifact_id: "QT-TEST-001", question_type: "solution", stem: "说明角的对应关系。" },
  facts: new Map([["FN-01", { fact_id: "FN-01", statement: "两组对应角相等。" }]]),
  graph_inferences: new Map(), solution_variants: [],
} as unknown as NavigatorPlanV5;
const options: AdjudicationValidationOptions = { followAlongGateIds: new Set(["GT-01"]), currentGateId: "GT-01", studentIntentKind: "submit_answer" };
const eligible = new Set(["GT-01"]);
const universe = new Set(["FN-01"]);
const raw = (patch: Partial<GateAdjudicationResult> = {}) => JSON.stringify({ response_kind: "understanding_confirmation", verdict: "pass", matched_gate_id: "GT-01", reasoning_location: "unknown", grounding_refs: [], ...patch });
const validate = (patch: Partial<GateAdjudicationResult> = {}, opts = options) => validateAdjudicationResponse(raw(patch), eligible, universe, "fixed", opts);
const context = (events: StoredV5Event[] = [], selectedBeat = beat, intent_kind = "submit_answer") => buildGateAdjudicationContext({ plan, beat: selectedBeat, events, studentInput: { intent_kind, text: "这一步我跟上了。" } });
const event = (sequence: number, event_type: string, payload: Record<string, unknown>): StoredV5Event => ({ schema: "ai_teaching_tutor_session_event/v5", session_id: "TS-1000", sequence, state_revision: sequence, occurred_at: "2026-09-07T00:00:00Z", event_type, payload, idempotency_key: `fixture-${sequence}` }) as StoredV5Event;
const legacyBeat = (): NavigatorBeatView => {
  const { confirmation_target: _target, ...completion_evidence } = beat.completion_evidence;
  return { ...beat, completion_evidence };
};
const hypothesis = (adjudication: GateAdjudicationResult, selectedBeat = beat, intent_kind: "submit_answer" | "continue" = "submit_answer") => hypothesisFromAdjudication({ plan, beat: selectedBeat, intent_kind, text: "这一步我跟上了。", adjudication, evidence_sequence: 20 });

afterEach(() => vi.useRealTimers());

describe("C2 explicit follow-along adjudication boundary", () => {
  it("accepts ungrounded self-report without manufacturing mathematical alignment", () => {
    expect(validate()).toMatchObject({ verdict: "pass", response_kind: "understanding_confirmation", grounding_refs: [] });
    expect(validate({ grounding_refs: ["FN-01"] }).grounding_refs).toEqual([]);
    const h = hypothesis(validate());
    expect(h).toMatchObject({ intent: "confirm:follow_along:self_reported", reasoning_location: "unknown", gate_assessment: { verdict: "pass" } });
    expect(h).not.toHaveProperty("matched_fact_id");
    expect(h).not.toHaveProperty("reasoning_alignment");
    expect(hypothesisEventPayload(h)).not.toHaveProperty("grounding_refs");
  });
  it("accepts correct own-understanding restatement, including no graph ID, without mastery", () => {
    for (const grounding_refs of [[], ["FN-01"]]) {
      const h = hypothesis(validate({ response_kind: "restatement", reasoning_location: "aligned", grounding_refs }));
      expect(h.intent).toBe("confirm:follow_along:expressed");
      expect(h).not.toHaveProperty("matched_fact_id");
      expect(h).not.toHaveProperty("reasoning_alignment");
      expect(hypothesisEventPayload(h).intent).toBe("confirm:follow_along:expressed");
    }
  });
  it.each(["question", "help_request", "mixed_or_ambiguous", "final_answer", "alternate_path"] as const)("does not pass %s at a follow-along target", (response_kind) => {
    expect(validate({ response_kind, reasoning_location: "aligned", grounding_refs: ["FN-01"] }).verdict).toBe("unclear");
  });
  it.each(["misaligned", "partially_aligned"] as const)("rejects pass with unresolved %s", (reasoning_location) => {
    expect(validate({ reasoning_location }).verdict).toBe("unclear");
    expect(validate({ response_kind: "restatement", reasoning_location }).verdict).toBe("unclear");
  });
  it("requires expressed understanding to be aligned and all supplied refs to be canonical", () => {
    expect(validate({ response_kind: "restatement" }).verdict).toBe("unclear");
    expect(validate({ grounding_refs: ["FN-99"] }).verdict).toBe("unclear");
  });
  it("requires an explicit marker set, the current gate, a candidate, and a matched ID", () => {
    for (const opts of [{}, { followAlongGateIds: new Set(["GT-01"]) }, { ...options, currentGateId: "GT-02" }, { ...options, followAlongGateIds: new Set(["GT-02"]) }]) {
      expect(validate({}, opts).verdict).toBe("unclear");
    }
    expect(validate({ matched_gate_id: undefined }).verdict).toBe("unclear");
    expect(validate({ matched_gate_id: "GT-99" }).degraded_reason).toBe("gate_not_in_candidates");
    expect(validateAdjudicationResponse(raw(), new Set(), universe, "fixed", options).verdict).toBe("unclear");
  });
  it("does not let missing/foreign IDs bypass current target through a legacy answer kind", () => {
    for (const matched_gate_id of [undefined, "GT-02"]) {
      const result = validateAdjudicationResponse(raw({ response_kind: "final_answer", matched_gate_id, grounding_refs: ["FN-01"] }), new Set(["GT-01", "GT-02"]), universe, "fixed", options);
      expect(result.degraded_reason).toBe("follow_along_requires_current_gate");
    }
    const h = hypothesis({ ...validate(), response_kind: "final_answer", grounding_refs: ["FN-01"] });
    expect(h.gate_assessment?.verdict).toBe("unclear");
    expect(h).not.toHaveProperty("matched_fact_id");
  });
  it("continues to reject legacy self-report/restatement pass while legacy grounded answers pass", () => {
    for (const response_kind of ["understanding_confirmation", "restatement"] as const) {
      expect(validateAdjudicationResponse(raw({ response_kind, grounding_refs: ["FN-01"] }), eligible, universe, "fixed").verdict).toBe("unclear");
    }
    expect(validateAdjudicationResponse(raw({ response_kind: "final_answer", grounding_refs: ["FN-01"] }), eligible, universe, "fixed").verdict).toBe("pass");
  });
  it("accepts confirm control but never continue as confirmation", () => {
    expect(validate({}, { ...options, studentIntentKind: "confirm" }).verdict).toBe("pass");
    expect(validate({}, { ...options, studentIntentKind: "continue" }).degraded_reason).toBe("continue_is_not_confirmation");
    for (const intent_kind of ["confirm", "continue"] as const) {
      const h = interpretStudentInput(plan, { beat, intent_kind });
      expect(h.intent).toBe(intent_kind);
      expect(h).not.toHaveProperty("matched_fact_id");
      expect(h).not.toHaveProperty("reasoning_alignment");
      expect(h).not.toHaveProperty("grounding_refs");
    }
  });
  it.each(["fail", "unclear", "not_applicable"] as const)("never persists confirmation on %s", (verdict) => {
    for (const response_kind of ["understanding_confirmation", "restatement"] as const) {
      const h = hypothesis(validate({ response_kind, verdict }));
      expect(h.intent).not.toMatch(/^confirm:follow_along:/);
      expect(h.gate_assessment?.verdict).toBe(verdict);
    }
  });
  it("preserves failed restatement misconception location for repair", () => {
    const h = hypothesis(validate({ response_kind: "restatement", verdict: "fail", reasoning_location: "misaligned", grounding_refs: ["FN-01"] }));
    expect(h).toMatchObject({ reasoning_location: "misaligned", reasoning_focus: { graph_fact_refs: ["FN-01"] }, reasoning_alignment: { kind: "incorrect_reasoning", anchored_fact_ids: ["FN-01"] }, gate_assessment: { verdict: "fail" } });
    expect(h).not.toHaveProperty("matched_fact_id");
  });
  it("rechecks marker/target/kind/pass when mapping an adjudication, not trusting forged pass", () => {
    const result = validate();
    expect(hypothesis(result, legacyBeat()).gate_assessment?.verdict).toBe("unclear");
    expect(hypothesis({ ...result, matched_gate_id: "GT-02" }).gate_assessment?.verdict).toBe("unclear");
    expect(hypothesis(result, beat, "continue").gate_assessment?.verdict).toBe("unclear");
    expect(hypothesis({ ...result, degraded_reason: "forged" }).gate_assessment?.verdict).toBe("unclear");
  });
});

describe("C2 model context from persisted presentation facts", () => {
  const planned = (sequence: number, id: string, scope: Record<string, unknown>, text = "这两个角相等，你跟上了吗？") => event(sequence, "presentation_sequence_planned", { sequence_id: id, scope, actions: [{ ordinal: 0, kind: "voice", voice_action: { action_id: `VA-${id}`, text, intent: "question" } }] });
  const outcome = (sequence: number, id: string, result: string, extra = {}) => event(sequence, "presentation_action_outcome_recorded", { sequence_id: id, ordinal: 0, action_id: `VA-${id}`, kind: "voice", outcome: result, ...extra });
  const scope = { kind: "approved", protocol_id: beat.protocol_id, beat_id: beat.beat_id };
  it("includes completion target and actual question, excludes planned/delivered/failed/interrupted voices", () => {
    const events = [planned(1, "1", scope), event(2, "presentation_action_delivered", { sequence_id: "1", action_id: "VA-1", ordinal: 0, kind: "voice" }), planned(3, "2", scope), outcome(4, "2", "failed"), planned(5, "3", scope), outcome(6, "3", "interrupted"), planned(7, "4", scope), outcome(8, "4", "presented")];
    const before = structuredClone(events);
    const ctx = context(events);
    expect(ctx.current_beat.completion_evidence?.confirmation_target).toBe("follow_along");
    expect(ctx.recent_presentations).toEqual([{ protocol_id: beat.protocol_id, beat_id: beat.beat_id, action_id: "VA-4", text: "这两个角相等，你跟上了吗？", intent: "question", in_current_beat: true, outcome_sequence: 8 }]);
    expect(events).toEqual(before);
  });
  it("matches full action identity and distinguishes same Beat ID in another protocol/local inquiry", () => {
    const ctx = context([planned(1, "1", scope), outcome(2, "1", "presented", { ordinal: 1 }), planned(3, "2", { ...scope, protocol_id: "PR-OTHER-001" }), outcome(4, "2", "presented"), planned(5, "3", { kind: "local", local_protocol_id: "LIP-1", local_beat_id: "LBT-01", anchor: scope }), outcome(6, "3", "presented")]);
    expect(ctx.recent_presentations).toHaveLength(2);
    expect(ctx.recent_presentations?.every((v) => !v.in_current_beat)).toBe(true);
    expect(ctx.recent_presentations?.[1]).toMatchObject({ protocol_id: "LIP-1", beat_id: "LBT-01" });
  });
  it("reads legacy completed voice via its decision and retains misconception history", () => {
    const ctx = context([
      event(1, "policy_decision_made", { decision_id: "TD-1", decision_kind: "execute_current_beat", protocol_id: beat.protocol_id, beat_id: beat.beat_id }),
      event(2, "voice_action_issued", { decision_id: "TD-1", action_id: "VA-1", text: "看这两组对应角。" }),
      event(3, "action_outcome_recorded", { action_id: "VA-1", action_kind: "voice", outcome: "completed" }),
      event(4, "student_intent_recorded", { intent_kind: "submit_answer", text: "对应角不相等。" }),
      event(5, "semantic_interpretation_recorded", { intent: "submit_answer:restatement", reasoning_location: "misaligned", grounding_refs: ["FN-01"] }),
    ]);
    expect(ctx.recent_presentations?.[0]).toMatchObject({ text: "看这两组对应角。", in_current_beat: true });
    expect(ctx.recent_dialogue).toContainEqual({ source: "student", intent_kind: "submit_answer", text: "对应角不相等。" });
    expect(ctx.recent_interpretations?.[0]).toMatchObject({ reasoning_location: "misaligned" });
  });
  it("retains raw ambiguous utterances without derived intents and deduplicates raw/intent pairs", () => {
    const intent = event(2, "student_intent_recorded", { intent_kind: "submit_answer", text: "这两个角不相等。" });
    intent.causation_sequence = 1;
    const ctx = context([
      event(1, "student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "这两个角不相等。" } }), intent,
      event(3, "student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "但我也不知道，可能我没懂。" } }),
      event(4, "student_input_recorded", { input: { kind: "control", command: "continue" } }),
    ]);
    expect(ctx.recent_dialogue).toEqual([
      { source: "student", intent_kind: "utterance", text: "这两个角不相等。" },
      { source: "student", intent_kind: "utterance", text: "但我也不知道，可能我没懂。" },
      { source: "student", intent_kind: "continue" },
    ]);
  });
  it("F12 keeps empty-text confirm as a structured input fact with completed current-Beat context", () => {
    const ctx = buildGateAdjudicationContext({ plan, beat, events: [planned(1, "confirm", scope), outcome(2, "confirm", "presented")], studentInput: { intent_kind: "confirm", text: "" } });
    expect(ctx.student_input).toEqual({ intent_kind: "confirm", text: "" });
    expect(ctx.recent_presentations?.[0].in_current_beat).toBe(true);
    expect(ctx.current_beat.completion_evidence?.confirmation_target).toBe("follow_along");
    for (const phrase of ["原始结构化控件事实", "text 是空字符串", "无待修复误解", "understanding_confirmation并可pass", "标记缺失就是未标记旧协议", "student_answer/practice仍须满足其原criterion", "绝不能写进 response_kind"]) expect(GATE_ADJUDICATION_SYSTEM_PROMPT).toContain(phrase);
  });
  it("pins changed instructions and preserves the exact old prompt export", () => {
    expect(LEGACY_MODEL_GATE_ADJUDICATOR_VERSION).toBe("model-gate-adjudicator/v5");
    expect(MODEL_GATE_ADJUDICATOR_VERSION).toBe("model-gate-adjudicator/v5-follow-along-1");
    expect(LEGACY_GATE_ADJUDICATION_SYSTEM_PROMPT).not.toContain("understanding_confirmation");
    for (const term of ["矛盾尚未修复", "引用/照搬", "控件 intent_kind=confirm", "intent_kind=continue", "grounding_refs=[]", "绝非 verified mastery"]) expect(GATE_ADJUDICATION_SYSTEM_PROMPT).toContain(term);
  });
});

describe("C2 provider integration and timer lifetime", () => {
  it("passes options from the current completion target through real adjudicator validation", async () => {
    const provider = new FixedResponseGateProvider([raw(), raw(), raw()]);
    const adjudicator = new ModelGateAdjudicatorV5(provider);
    expect((await adjudicator.adjudicate(context())).verdict).toBe("pass");
    expect((await adjudicator.adjudicate(context([], legacyBeat()))).verdict).toBe("unclear");
    expect((await adjudicator.adjudicate(context([], beat, "continue"))).verdict).toBe("unclear");
    expect(JSON.parse(provider.calls[0]).current_beat.completion_evidence.confirmation_target).toBe("follow_along");
  });
  it("clears the 30s timer immediately on success and provider error", async () => {
    vi.useFakeTimers();
    await new ModelGateAdjudicatorV5(new FixedResponseGateProvider([raw()])).adjudicate(context());
    expect(vi.getTimerCount()).toBe(0);
    expect((await new ModelGateAdjudicatorV5(new UnavailableGateProvider()).adjudicate(context())).degraded_reason).toContain("provider_error");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retains an effective timeout and clears its timer after timeout", async () => {
    vi.useFakeTimers();
    const pending = new ModelGateAdjudicatorV5(new HangingGateProvider(), { timeoutMs: 10 }).adjudicate(context());
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(10);
    expect((await pending).degraded_reason).toContain("provider_timeout");
    expect(vi.getTimerCount()).toBe(0);
  });
});
