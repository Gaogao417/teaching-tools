import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { rmSync } from 'node:fs';
import { ensureSqlite } from './support';
const testSqlitePath=ensureSqlite(`g2-visual-lifecycle-${process.pid}`);
import { at, sessionStartedPayloadV6, syntheticRegistry, SHA } from './v6KernelSupport';
import type { PendingSessionEvent, StoredSessionEvent } from '../kernel/sessionKernelTypes';
import type { V10RegistryProvider } from '../RuntimeStateRebuilderV10';
import { emptyVisualState, visualHash } from '../WorkspaceVisualReducer';
import { VisualBindingCatalog } from '../VisualBindingCatalog';
import { projectVisualView } from '../VisualViewProjector';

const {TutorSessionKernelV10}=require('../TutorSessionKernelV10') as typeof import('../TutorSessionKernelV10');
const {planVisualTransition,planCleanupDelivery}=require('../../tutorOrchestration/VisualTransitionPlanner') as typeof import('../../tutorOrchestration/VisualTransitionPlanner');
const {readTutorSessionEventsV10}=require('../RuntimeStateRebuilderV10') as typeof import('../RuntimeStateRebuilderV10');
const {db}=require('../../../db/database') as typeof import('../../../db/database');
after(()=>{db.close();for(const suffix of ['', '-wal', '-shm'])rmSync(testSqlitePath+suffix,{force:true});});
const catalog=new VisualBindingCatalog({planHash:SHA('v8'),bindings:[],approvedBasisRefs:new Set(),approvedScopes:new Set(),expressions:new Map(),pointIds:new Set(),segments:new Map(),constructionOutputs:new Map()});
const owner={scope:{kind:'approved' as const,protocol_id:'PR-SMV-002',beat_id:'BT-01'},scope_epoch:1,part_ref:'1'};
const target=projectVisualView(emptyVisualState(),catalog,{currentOwner:owner,ownerAuthorized:()=>true,completedConstructions:new Set(),existingPoints:new Map(),revealAuthorized:()=>true});
const invalidation={reason:'barge-in' as const,owner_keys:[],group_ids:[],lease_ids:[],rollback_action_keys:[],resulting_visual_revision:0,resulting_workspace_revision:0};
const provider:V10RegistryProvider=()=>{
  const registry=syntheticRegistry();
  return {...registry,capabilities:new Map([...registry.capabilities,['geometry.visual.reconcile',{capability:'geometry.visual.reconcile',origin:'tutor' as const,surface:'geometry' as const}]]),visual:{catalogHash:SHA('catalog'),projectAt:()=>target,
    prepareInvalidation:(_events,reason)=>({invalidation:{...invalidation,reason},target,workspaceRevision:0}),
    validateInvalidation:(_history,event)=>assert.deepEqual(event.payload,{...invalidation,reason:event.payload.reason})}};
};
let counter=7800;
function start() {
  const sessionId=`TS-${++counter}`;
  const kernel=TutorSessionKernelV10.start({sessionId,studentId:'visual-student',occurred_at:at(),sessionStarted:{...sessionStartedPayloadV6(),session_mode:'teaching',
    presenter_generation_pin:{provider:'p',model_id:'m',prompt_version:'1',context_builder_version:'1',tool_catalog_version:'1'},
    presentation_execution_owner:{client_instance_id:'client-a-0001',epoch:1}}},provider);
  kernel.append(kernel.revision,[{event_type:'policy_decision_made',occurred_at:at(),causation_sequence:1,payload:{decision_id:`TD-${sessionId}-0001`,decision_kind:'execute_beat',protocol_id:'PR-SMV-002',beat_id:'BT-01',policy_version:'p1',source_event_sequence:1,source_state_revision:1}}]);
  return kernel;
}
const history=(kernel:ReturnType<typeof start>)=>readTutorSessionEventsV10(kernel.sessionId,provider);
function cleanup(kernel:ReturnType<typeof start>) {
  const prefix:PendingSessionEvent[]=[{event_type:'student_input_recorded',payload:{client_request_id:'barge-1',input:{kind:'control',command:'barge_in'}},occurred_at:at()}];
  return planVisualTransition({state:kernel.state,history:history(kernel),prefix,cause:'barge-in',controlRequestId:'barge-1',invalidation,target,catalogHash:SHA('catalog'),occurredAt:at()});
}
function receipt(kernel:ReturnType<typeof start>,outcome:'presented'|'failed') {
  const cursor=kernel.state.presentation_cursor;
  assert.notEqual(cursor.status,'idle');
  if(cursor.status==='idle') throw new Error('missing cursor');
  const delivery=history(kernel).at(-1)!;
  return {event_type:'presentation_action_outcome_recorded',occurred_at:at(),causation_sequence:delivery.sequence,payload:{sequence_id:cursor.sequence_id,ordinal:cursor.ordinal,action_id:cursor.action_id,kind:'workspace',outcome,...(outcome==='failed'?{failure_class:'internal_error'}:{})}} satisfies PendingSessionEvent;
}
test('V10 real SQLite start and replay retain execution owner, pin and epoch',()=>{
  const kernel=start();assert.equal(kernel.state.scope_epoch,1);assert.equal(kernel.state.schema,'ai_teaching_tutor_runtime_state/v5');
  assert.deepEqual(TutorSessionKernelV10.resume(kernel.sessionId,provider).state,kernel.state);assert.equal(kernel.assertReplayParity().equal,true);
});
test('H30 invalidation without cleanup rolls back every row; complete cleanup uses the sole cursor',()=>{
  const kernel=start(),batch=cleanup(kernel),before=kernel.revision;
  assert.throws(()=>kernel.append(before,batch.slice(0,2)),/VISUAL|cleanup|CAS/);
  assert.equal(kernel.revision,before);assert.equal(history(kernel).length,2);
  kernel.append(before,batch);assert.equal(kernel.state.visual_barrier?.status,'awaiting-cleanup');
  assert.equal(kernel.state.presentation_cursor.status,'awaiting_browser');assert.deepEqual(kernel.rebuild(),kernel.state);
});
test('H18/H30 cleanup presented without same-CAS release rolls back; receipt+release succeeds',()=>{
  const kernel=start();kernel.append(kernel.revision,cleanup(kernel));const before=kernel.revision;
  const outcome=receipt(kernel,'presented');assert.throws(()=>kernel.append(before,[outcome]),/release|CAS|cleanup cursor/);assert.equal(kernel.revision,before);
  kernel.append(before,[outcome,{event_type:'visual_barrier_changed',occurred_at:at(),causation_sequence:history(kernel).length+1,
    payload:{previous_barrier_id:kernel.state.visual_barrier!.barrier_id,barrier:null}}]);
  assert.equal(kernel.state.visual_barrier,null);assert.equal(kernel.state.presentation_cursor.status,'idle');assert.deepEqual(kernel.rebuild(),kernel.state);
});
test('H16 DB abort inside delivery rolls back invalidation, barrier and action together',()=>{
  const kernel=start(),revision=kernel.revision;
  db.exec("CREATE TRIGGER visual_delivery_fault BEFORE INSERT ON tutor_session_events WHEN NEW.event_type='presentation_action_delivered' BEGIN SELECT RAISE(ABORT, 'visual injected fault'); END");
  try {assert.throws(()=>kernel.append(revision,cleanup(kernel)),/visual injected fault/);} finally {db.exec('DROP TRIGGER visual_delivery_fault');}
  assert.equal(history(kernel).length,2);assert.equal(kernel.revision,revision);assert.equal(kernel.rebuild().visual_barrier,null);
});
test('H17 two real kernel instances at one revision commit exactly one cleanup',()=>{
  const kernel=start(),other=TutorSessionKernelV10.resume(kernel.sessionId,provider),revision=kernel.revision;
  kernel.append(revision,cleanup(kernel));assert.throws(()=>other.append(revision,cleanup(other)),/revision/i);
  assert.equal(history(kernel).filter(e=>e.event_type==='workspace_visual_owners_invalidated').length,1);
});
test('H23/H32 cleanup recovery keeps frozen target, changes delivery identity and retains failed outcome',()=>{
  const kernel=start();kernel.append(kernel.revision,cleanup(kernel));const original=kernel.state.visual_barrier!;
  kernel.append(kernel.revision,[receipt(kernel,'failed'),{event_type:'visual_barrier_changed',occurred_at:at(),causation_sequence:history(kernel).length+1,payload:{previous_barrier_id:original.barrier_id,barrier:{...original,status:'failed'}}}]);
  const failed=kernel.state.visual_barrier!;assert.notEqual(failed.status,'awaiting-control');if(failed.status==='awaiting-control')return;
  const prefix:PendingSessionEvent={event_type:'presentation_sequence_superseded',occurred_at:at(),causation_sequence:history(kernel).length,payload:{sequence_id:failed.cleanup_sequence_id,reason:'retry_recovery'}};
  const retry={...failed,status:'awaiting-cleanup' as const,cleanup_sequence_id:'PS-9999'};
  assert.throws(()=>kernel.append(kernel.revision,[prefix,...planCleanupDelivery(kernel.state,history(kernel),{...retry,target_digest:SHA('drift')},history(kernel).length+1,at())]),/target|retry/i);
  kernel.append(kernel.revision,[prefix,...planCleanupDelivery(kernel.state,history(kernel),retry,history(kernel).length+1,at())]);
  assert.equal(kernel.state.visual_barrier?.barrier_id,original.barrier_id);assert.equal(history(kernel).filter(e=>e.event_type==='presentation_action_outcome_recorded'&&e.payload.outcome==='failed').length,1);
  assert.deepEqual(kernel.rebuild(),kernel.state);
});

const {commitVisualControl}=require('../../tutorOrchestration/VisualLifecycleCommands') as typeof import('../../tutorOrchestration/VisualLifecycleCommands');
function voice(kernel:ReturnType<typeof start>) {
  const first=history(kernel).length+1,sequence_id='PS-1010',action_id=`VA-${kernel.sessionId}-1010`;
  const ref={sequence_id,action_id,ordinal:0,kind:'voice'};
  kernel.append(kernel.revision,[{event_type:'presentation_sequence_planned',occurred_at:at(),causation_sequence:2,payload:{sequence_id,decision_id:`TD-${kernel.sessionId}-0001`,purpose:'teaching',scope:owner.scope,actions:[{ordinal:0,kind:'voice',voice_action:{action_id,decision_id:`TD-${kernel.sessionId}-0001`,text:'Look at the angle.',source:'deterministic-scaffold',interruptible:true,intent:'narrate'}}]}},
    {event_type:'presentation_action_validated',occurred_at:at(),causation_sequence:first,payload:ref},
    {event_type:'presentation_action_delivered',occurred_at:at(),causation_sequence:first,payload:ref}]);
  return ref;
}
function control(kernel:ReturnType<typeof start>,command:'barge_in'|'claim_presentation'|'retry_recovery',request='control-1',extra:Record<string,unknown>={}) {
  return commitVisualControl({kernel,history:history(kernel),context:provider({}),expectedRevision:kernel.revision,
    input:{schema:'ai_teaching_student_input/v2',session_id:kernel.sessionId,expected_revision:kernel.revision,client_request_id:request,
      execution_owner:kernel.state.presentation_execution_owner,input:{kind:'control',command},...extra} as never});
}
test('H12 actual naturally presented remains presented with durable hold; barge creates only cleanup',()=>{
  const kernel=start(),ref=voice(kernel),outcomeSequence=history(kernel).length+1;
  kernel.append(kernel.revision,[{event_type:'presentation_action_outcome_recorded',occurred_at:at(),causation_sequence:outcomeSequence-1,payload:{...ref,outcome:'presented'}},
    {event_type:'visual_barrier_changed',occurred_at:at(),causation_sequence:outcomeSequence,payload:{previous_barrier_id:null,barrier:{barrier_id:`${kernel.sessionId}/event/${outcomeSequence}`,status:'awaiting-control',cause:'barge-in',execution_owner:kernel.state.presentation_execution_owner,control_request_id:'control-1'}}}]);
  assert.equal(kernel.state.visual_barrier?.status,'awaiting-control');assert.equal(kernel.state.presentation_cursor.status,'idle');
  const restored=TutorSessionKernelV10.resume(kernel.sessionId,provider);control(restored,'barge_in');
  assert.equal(restored.state.visual_barrier?.status,'awaiting-cleanup');
  assert.deepEqual(history(restored).filter(e=>e.event_type==='presentation_action_outcome_recorded').map(e=>e.payload.outcome),['presented']);
});
test('H13 exact not-started cancellation writes cancellation, never interrupted; late actual outcome is rejected',()=>{
  const kernel=start(),ref=voice(kernel),revision=kernel.revision;
  assert.throws(()=>control(kernel,'barge_in'),/actual outcome/);assert.equal(kernel.revision,revision);
  control(kernel,'barge_in','control-1',{input:{kind:'control',command:'barge_in',not_started_delivery:{sequence_id:ref.sequence_id,action_id:ref.action_id,ordinal:0}}});
  assert.equal(history(kernel).filter(e=>e.event_type==='presentation_action_outcome_recorded').length,0);
  assert.ok(history(kernel).some(e=>e.event_type==='presentation_sequence_superseded'&&e.payload.reason==='superseded-before-start'));
  assert.throws(()=>kernel.append(kernel.revision,[{event_type:'presentation_action_outcome_recorded',occurred_at:at(),causation_sequence:5,payload:{...ref,outcome:'presented'}}]),/cleanup|barrier/);
});
test('H33 claim ignores client epoch; old claim retry cannot reacquire after another claim',()=>{
  const kernel=start();voice(kernel);
  const claim=(client:string,key:string)=>control(kernel,'claim_presentation',key,{execution_owner:{client_instance_id:client,epoch:999}});
  claim('client-b-0002','claim-b');assert.deepEqual(kernel.state.presentation_execution_owner,{client_instance_id:'client-b-0002',epoch:2});
  claim('client-c-0003','claim-c');assert.deepEqual(kernel.state.presentation_execution_owner,{client_instance_id:'client-c-0003',epoch:3});
  const revision=kernel.revision;assert.equal(claim('client-b-0002','claim-b').replayed,true);assert.equal(kernel.revision,revision);
  assert.equal(kernel.state.presentation_execution_owner.client_instance_id,'client-c-0003');
  assert.throws(()=>control(kernel,'barge_in','stale',{execution_owner:{client_instance_id:'client-b-0002',epoch:2}}),/owner is stale/);
  assert.equal(history(kernel).filter(e=>e.event_type==='presentation_action_outcome_recorded').length,0);
});
test('H35 incomplete bootstrap does not create a claim, fake decision or partial owner',()=>{
  const sessionId=`TS-${++counter}`;
  const kernel=TutorSessionKernelV10.start({sessionId,studentId:'v10-student',occurred_at:at(),sessionStarted:{...sessionStartedPayloadV6(),session_mode:'teaching',presenter_generation_pin:{provider:'p',model_id:'m',prompt_version:'1',context_builder_version:'1',tool_catalog_version:'1'},presentation_execution_owner:{client_instance_id:'client-a-0001',epoch:1}}},provider);
  assert.throws(()=>control(kernel,'claim_presentation','bootstrap-claim',{execution_owner:{client_instance_id:'client-b-0002',epoch:1}}),/real first decision/);
  assert.equal(history(kernel).length,1);assert.equal(kernel.state.presentation_execution_owner.epoch,1);
  assert.deepEqual(TutorSessionKernelV10.resume(sessionId,provider).state,kernel.state);
});
test('H30 every ordinary event family fails closed while a cleanup barrier is active',()=>{
  const kernel=start();kernel.append(kernel.revision,cleanup(kernel));const revision=kernel.revision;
  const cases:PendingSessionEvent[]=[
    {event_type:'policy_decision_made',payload:{decision_id:`TD-${kernel.sessionId}-0999`,decision_kind:'execute_beat',protocol_id:'PR-SMV-002',beat_id:'BT-01',policy_version:'p1',source_event_sequence:2,source_state_revision:revision},occurred_at:at(),causation_sequence:2},
    {event_type:'student_input_recorded',payload:{client_request_id:'blocked-ordinary',input:{kind:'control',command:'continue'}},occurred_at:at()},
    {event_type:'session_completed',payload:{final_beat_id:'BT-01',completed_parts:['1']},occurred_at:at()},
    {event_type:'inquiry_opened',payload:{inquiry_id:'IQ-0001',return_beat_id:'BT-01',local:true,trigger:'ask_question'},occurred_at:at(),causation_sequence:2},
  ];
  for(const event of cases){assert.throws(()=>kernel.append(revision,[event]));assert.equal(kernel.revision,revision);}
});
test('H13/H33 direct append cannot forge not-started or execution-revoked causation',()=>{
  const kernel=start(),ref=voice(kernel),revision=kernel.revision;
  for(const reason of ['superseded-before-start','execution-revoked'])assert.throws(()=>kernel.append(revision,[
    {event_type:'student_input_recorded',payload:{client_request_id:`fake-${reason}`,input:{kind:'control',command:'continue'}},occurred_at:at()},
    {event_type:'presentation_sequence_superseded',payload:{sequence_id:ref.sequence_id,pending_action_id:ref.action_id,pending_ordinal:0,reason},occurred_at:at(),causation_sequence:history(kernel).length+1},
  ]),/requires|revocation/);
  assert.equal(kernel.revision,revision);assert.equal(kernel.state.presentation_cursor.status,'awaiting_browser');
});
test('H31 idle cursor + pending generation is invalidated in the cleanup CAS; late result remains fenced after release',()=>{
  const kernel=start();
  const request={request_id:`GR-${kernel.sessionId}-0001`,source_request_id:'source-generation',decision_id:`TD-${kernel.sessionId}-0001`,scope:owner.scope,reservation_revision:kernel.revision,epoch:1,attempt:1,max_attempts:3,retry_policy_version:'retry-1',timeout_ms:1000,retry_delays_ms:[10,20],
    context:{plan_ref:kernel.state.pinned_plan.tutor_plan_ref,graph_ref:kernel.state.pinned_plan.solution_graph_ref,selected_fact_ids:['FN-03'],selected_inference_ids:[],resource_ids:[],event_cutoff:history(kernel).length,workspace_revision:0},input_digest:SHA('generation'),presenter_pin:kernel.state.pinned_plan.presenter_generation_pin,status:'pending',phase:'running'};
  kernel.append(kernel.revision,[{event_type:'presentation_generation_requested',payload:request,occurred_at:at(),causation_sequence:2}]);
  control(kernel,'barge_in');assert.equal(kernel.state.generation_requests[0].status,'cancelled');assert.equal(kernel.state.generation_slot.status,'idle');
  const invalidated=history(kernel).find(e=>e.event_type==='presentation_generation_invalidated')!;
  const barrier=history(kernel).find(e=>e.event_type==='visual_barrier_changed')!;
  assert.equal(invalidated.state_revision,barrier.state_revision);assert.ok(invalidated.sequence<barrier.sequence);
  kernel.append(kernel.revision,[receipt(kernel,'presented'),{event_type:'visual_barrier_changed',occurred_at:at(),causation_sequence:history(kernel).length+1,payload:{previous_barrier_id:kernel.state.visual_barrier!.barrier_id,barrier:null}}]);
  assert.throws(()=>kernel.append(kernel.revision,[{event_type:'presentation_generation_attempt_started',payload:{...request,epoch:2},occurred_at:at(),causation_sequence:2}]),/terminal|status/);
});
test('H34 old-decision system reconcile survives scope change; teaching-purpose forgery fails',()=>{
  const kernel=start();const prefix:PendingSessionEvent[]=[{event_type:'policy_decision_made',occurred_at:at(),causation_sequence:2,payload:{decision_id:`TD-${kernel.sessionId}-0002`,decision_kind:'transition_beat',protocol_id:'PR-SMV-002',beat_id:'BT-01',to_beat_id:'BT-02',policy_version:'p1',source_event_sequence:2,source_state_revision:kernel.revision,transition_basis:{basis:'gate_satisfied',gate_id:'GT-01'}}}];
  const batch=planVisualTransition({state:kernel.state,history:history(kernel),prefix,cause:'scope-transition',invalidation:{...invalidation,reason:'scope-transition'},target,catalogHash:SHA('catalog'),occurredAt:at()});
  const forged=batch.map(e=>e.event_type==='presentation_sequence_planned'?{...e,payload:{...(e.payload as Record<string,unknown>),purpose:'teaching'}}:e);
  assert.throws(()=>kernel.append(kernel.revision,forged));
  kernel.append(kernel.revision,batch);assert.equal(kernel.state.teaching_cursor.beat_id,'BT-02');assert.equal(kernel.state.scope_epoch,2);assert.equal(kernel.state.visual_barrier?.status,'awaiting-cleanup');
});

test('H23 ordinary failed delivery recovery first creates cleanup and retains actual failure',()=>{
  const kernel=start(),ref=voice(kernel);
  kernel.append(kernel.revision,[{event_type:'presentation_action_outcome_recorded',occurred_at:at(),causation_sequence:history(kernel).length,payload:{...ref,outcome:'failed',failure_class:'internal_error'}}]);
  control(kernel,'retry_recovery','ordinary-retry');
  assert.equal(kernel.state.visual_barrier?.cause,'recovery');
  assert.equal(kernel.state.visual_barrier?.status,'awaiting-cleanup');
  assert.deepEqual(history(kernel).filter(e=>e.event_type==='presentation_action_outcome_recorded').map(e=>e.payload.outcome),['failed']);
  assert.deepEqual(kernel.rebuild(),kernel.state);
});

test('H20 inquiry visits advance only for actual approved-node change and restore anchor epoch',()=>{
  const {visualScopeEpochs}=require('../TutorRuntimeStateReducerV10') as typeof import('../TutorRuntimeStateReducerV10');
  const decisions:StoredSessionEvent[]=[];
  const add=(payload:Record<string,unknown>)=>{decisions.push({event_type:'policy_decision_made',payload} as StoredSessionEvent);return visualScopeEpochs(decisions,()=> 'BT-01');};
  add({decision_kind:'execute_beat',protocol_id:'PR-SMV-001',beat_id:'BT-01'});
  assert.deepEqual(add({decision_kind:'open_inquiry',protocol_id:'PR-SMV-001',beat_id:'BT-07',inquiry:{inquiry_protocol_id:'PR-SMV-002'}}),{counter:2,current:2,anchor:1});
  assert.deepEqual(add({decision_kind:'continue_inquiry',protocol_id:'PR-SMV-002',beat_id:'BT-01'}),{counter:2,current:2,anchor:1});
  assert.deepEqual(add({decision_kind:'continue_inquiry',protocol_id:'PR-SMV-002',beat_id:'BT-02'}),{counter:3,current:3,anchor:1});
  assert.deepEqual(add({decision_kind:'return_to_mainline',protocol_id:'PR-SMV-001',to_beat_id:'BT-01'}),{counter:3,current:1,anchor:null});
  add({decision_kind:'open_inquiry',protocol_id:'PR-SMV-001',beat_id:'BT-01',inquiry:{inquiry_id:'local-inquiry'}});
  assert.deepEqual(add({decision_kind:'continue_inquiry',protocol_id:'PR-SMV-001',beat_id:'BT-01'}),{counter:4,current:4,anchor:1});
});
