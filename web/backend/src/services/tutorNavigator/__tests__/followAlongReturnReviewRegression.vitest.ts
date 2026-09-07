/** Independent regression of two review reproductions; synthetic pure events/plan,
 * real replay verifier/reducer/commitDecisions. No model calls or asset approval. */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NavigatorSessionV7, verifyGateAttributionAgainstPlanV7 } from '../NavigatorSessionV7';
import { applyV7Event, initialStateFromSessionStartedV7 } from '../../tutorSession/TutorRuntimeStateReducerV7';

const fixture = (name: string) => JSON.parse(readFileSync(resolve('../shared/canonical/fixtures', name), 'utf8'));
const event = (sequence: number, revision: number, type: string, payload: any, cause?: number): any => ({
  schema: 'ai_teaching_tutor_session_event/v7', session_id: 'TS-4242', sequence,
  state_revision: revision, event_type: type, payload, occurred_at: '2026-09-07T09:00:00Z',
  idempotency_key: `return-review-${sequence}`, ...(cause ? { causation_sequence: cause } : {}),
});
function setup() {
  const protocol = fixture('teaching-protocol.v3.positive.mainline-follow-along.json');
  const mainline = { ...protocol, beat_order: ['BT-01', 'BT-02'], beats: new Map(protocol.beats.map((b: any) => [b.beat_id, { ...b, protocol_id: protocol.protocol_id, graph_fact_refs: b.solution_refs.fact_ids, inference_refs: b.solution_refs.inference_ids }])) };
  const branch = { ...mainline, protocol_id: 'PR-SMV-002', protocol_kind: 'inquiry', beats: new Map([...mainline.beats].map(([id,b]: any) => [id, { ...b, protocol_id: 'PR-SMV-002' }])) };
  const plan: any = { mainline, branches: new Map([[branch.protocol_id, branch]]), facts: new Map(), graph_inferences: new Map(), solution_variants: [], pinned_resource_ids: new Set() };
  const start = fixture('tutor-session-event.v7.positive.session-started-with-mode.json');
  start.payload.initial_cursor.protocol_id = protocol.protocol_id;
  start.payload.protocol_refs[0].artifact_id = protocol.protocol_id;
  const context: any = {}; // These event families do not access capability registries.
  return { plan, start, context };
}
const semantic = (intent: string) => ({ intent, reasoning_location: 'unknown', confidence: 0.8, interpreter_version: 'model-gate-adjudicator/v5-follow-along-1' });
const raw = { input: { kind: 'utterance', channel: 'mainline', text: '整条关系我都跟上了' }, client_request_id: 'return-review-input' };

describe('return review: replay scope cannot be supplied by a suffix alone', () => {
  it.each([3, 4])('rejects exact return suffix without any Inquiry, gate revision=%s', (revision) => {
    const {plan,start,context} = setup();
    const events = [start, event(2,2,'student_input_recorded',raw),
      event(3,3,'semantic_interpretation_recorded',semantic('confirm:follow_along:self_reported:return:PR-SMV-001:BT-01:GT-01'),2),
      event(4,3,'student_intent_recorded',{intent_kind:'confirm',client_request_id:'return-review-input'},2),
      event(5,revision,'gate_evaluated',{gate_id:'GT-01',beat_id:'BT-01',satisfied:true,evidence_sequence:4},4)];
    expect(() => verifyGateAttributionAgainstPlanV7(plan,[],events,context)).toThrow(/same input's interpreted/);
  });
  it('allows legitimate direct same-transaction confirmation but rejects moving its gate into a later transaction', () => {
    const {plan,start,context} = setup();
    const events = [start,event(2,2,'student_input_recorded',raw),
      event(3,3,'semantic_interpretation_recorded',semantic('confirm:follow_along:self_reported'),2),
      event(4,3,'student_intent_recorded',{intent_kind:'confirm',client_request_id:'return-review-input'},2),
      event(5,3,'gate_evaluated',{gate_id:'GT-01',beat_id:'BT-01',satisfied:true,evidence_sequence:4},4)];
    expect(() => verifyGateAttributionAgainstPlanV7(plan,[],events,context)).not.toThrow();
    events[4].state_revision = 4;
    expect(() => verifyGateAttributionAgainstPlanV7(plan,[],events,context)).toThrow(/same input's interpreted/);
  });
});

describe('return review: failed commit preserves the same instance Inquiry beat', () => {
  it.each(['no_legal_transition', 'append_failure'])('%s cannot reset BT-02 to Inquiry entry BT-01', (failure) => {
    const {plan,start,context} = setup();
    const target: any = plan.mainline.beats.get('BT-01');
    if (failure === 'no_legal_transition') target.transitions = [{to_beat:'BT-02',on:'student_request'}];
    const inquiry = {inquiry_id:'IQ-001',inquiry_protocol_id:'PR-SMV-002',return_beat_id:'BT-01'};
    const events = [start,event(2,1,'inquiry_opened',{...inquiry,local:false,trigger:'unclear'}),event(3,2,'student_input_recorded',raw)];
    const state = events.slice(1).reduce((s,e) => applyV7Event(s,e,context),initialStateFromSessionStartedV7(start));
    const append = vi.fn(() => { throw new Error('injected append failure'); });
    // Inject only storage dependencies. Production getters, reducer, navigator and
    // commitDecisions execute unchanged, including the prospective batch fold.
    const session: any = Object.create(NavigatorSessionV7.prototype);
    Object.assign(session,{plan,sessionId:'TS-4242',inquiryBeatId:'BT-02',registryProvider:()=>context,kernelRef:{state,revision:2,append}});
    Object.defineProperty(session,'events',{get:()=>events});
    const before = structuredClone(state);
    const decision = {decision_id:'TD-001',decision_kind:'return_to_mainline',protocol_id:'PR-SMV-001',beat_id:'BT-01',policy_version:'navigator/v5',source_event_sequence:5,source_state_revision:2,inquiry};
    const prefix = [
      {event_type:'semantic_interpretation_recorded',payload:semantic('confirm:follow_along:self_reported'),causation_sequence:3},
      {event_type:'student_intent_recorded',payload:{intent_kind:'confirm',client_request_id:'return-review-input'},causation_sequence:3},
      {event_type:'semantic_interpretation_recorded',payload:semantic('confirm:follow_along:expressed:return:PR-SMV-001:BT-01:GT-01'),causation_sequence:3},
    ];
    expect(session.currentBeat.beat_id).toBe('BT-02');
    expect(() => session.commitDecisions(2,[{kind:'plain',sequence:5,decision}],prefix,{beat:target,evidenceSequence:5}))
      .toThrow(failure === 'no_legal_transition' ? /return feedback cannot take a legal transition/ : /injected append failure/);
    expect(append).toHaveBeenCalledTimes(failure === 'no_legal_transition' ? 0 : 1);
    expect(session.state).toEqual(before);
    expect(events).toHaveLength(3);
    expect(session.inquiryBeatId).toBe('BT-02');
    expect(session.currentBeat.protocol_id).toBe('PR-SMV-002');
    expect(session.currentBeat.beat_id).toBe('BT-02');
  });
});
