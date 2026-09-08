/** Claim preserves a completed teaching turn's wait for evidence, from actual receipts. */
import {expect,it} from 'vitest';
import {resolve} from 'node:path';
import {TutorRuntimeApplicationV7} from '../TutorRuntimeApplicationV7';
import {TutorTaskBindingResolver} from '../TutorTaskBindingResolver';
import {importVisualReviewCandidate} from '../../planBuild/visual/ImportVisualReviewCandidate';
import {FixedResponseGateProvider} from '../../tutorNavigator/ModelGateAdjudicatorV5';
import {f6Model,realCanonicalRoot} from './f6Support';
import {VISUAL_PRESENTER_PROMPT_VERSION} from '../presentationGeneration/PresenterPrompts';
import {VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION} from '../presentationGeneration/VisualPresentationTools';
import type {PresenterGeneratorPort} from '../presentationGeneration/GeneratorPort';
const root=realCanonicalRoot();
const loaded=importVisualReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});
if(!loaded.ok)throw Error(loaded.errors.join(';'));
let serial=0;
function setup(){
 let calls=0;
 const gate=new FixedResponseGateProvider([],'claim-recovery');
 const presenter:PresenterGeneratorPort={provider:'claim-recovery',modelId:'claim-recovery',pin:{provider:'claim-recovery',model_id:'claim-recovery',prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION},async generatePresentationDraft(r){calls++;const payload=r.userPayload as {required_board_bindings?:Array<{binding_ref:string}>};return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:r.request_id,items:[{type:'tool_intent',tool:'geometry.annotate',args:{binding_ref:'VB-101',params:{form:'angle-arcs',lifetime:'teaching-scope'}}},{type:'tool_intent',tool:'geometry.emphasize',args:{binding_ref:'VB-101',params:{group:'given',mode:'steady'}}},{type:'speech',text:'我们先看题目给出的两个相等角。',basis_refs:['FN-03']},...(payload.required_board_bindings??[]).map(b=>({type:'tool_intent' as const,tool:'board.explain',args:{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}}}))]}};}};
 const app=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:new TutorTaskBindingResolver(root,()=>loaded),model:f6Model(gate,'claim-recovery'),presenter});
 const result=app().start({task_id:'goldenMinhangFold2020',student_id:'claim-recovery',client_instance_id:'CI-claim-original',client_request_id:`claim-recovery-${++serial}`,sessionIdAllocator:()=>`TS-9977500${serial}`});if(result.kind==='payload-drift')throw Error('drift');
 return {s:result.orchestrator,app,gate,calls:()=>calls};
}
type Session=ReturnType<typeof setup>['s'];
function outcome(s:Session,value:'presented'|'failed'='presented'){
 const c=s.rebuildRuntimeState().presentation_cursor;if(c.status!=='awaiting_browser')throw Error('missing real delivery');
 return s.reportPresentationOutcome({sequence_id:c.sequence_id,ordinal:c.ordinal,action_id:c.action_id,outcome:value,...(value==='failed'?{failure_class:'internal_error',message:'injected playback failure'}:{}),execution_owner:s.visualLifecycle!.presentation_execution_owner,expected_revision:s.revision,client_request_id:`claim-outcome-${++serial}`});
}
async function claim(s:Session){return s.submitStudentInput({input:{kind:'control',command:'claim_presentation'},execution_owner:{client_instance_id:`CI-page-${++serial}`,epoch:999},client_request_id:`claim-request-${serial}`},{expectedRevision:s.revision});}
const reservations=(s:Session)=>s.events.filter(e=>String(e.event_type)==='presentation_generation_requested').length;
it('complete actual presented sequence remains awaiting evidence across repeated and nested claims, refresh and scanner ticks',async()=>{
 const f=setup();await f.s.drivePendingGeneration();
 for(let n=0;n<20&&f.s.rebuildRuntimeState().presentation_cursor.status==='awaiting_browser';n++)outcome(f.s);
 expect(f.s.rebuildRuntimeState().teaching_cursor.phase).toBe('awaiting_evidence');const count=reservations(f.s);
 for(let round=0;round<2;round++){
  await claim(f.s);if(round===1)await claim(f.s);outcome(f.s);
  const restored=f.app().restore(f.s.sessionId);const before=structuredClone(restored.events);
  restored.recoverVisualContinuation();restored.recoverVisualContinuation();
  expect(restored.events).toEqual(before);expect(reservations(restored)).toBe(count);
  expect(restored.hasPendingGeneration()).toBe(false);expect(restored.rebuildRuntimeState().presentation_cursor.status).toBe('idle');
  expect(restored.rebuildRuntimeState().teaching_cursor.phase).toBe('awaiting_evidence');
 }
 expect(f.calls()).toBe(1);expect(f.gate.callCount).toBe(0);expect(f.s.events.filter(e=>e.event_type==='gate_evaluated')).toEqual([]);
});
it.each(['unfinished','failed','pending-generation'] as const)('%s claim retains real recovery instead of pretending teaching completed',async state=>{
 const f=setup();if(state!=='pending-generation')await f.s.drivePendingGeneration();if(state==='failed')outcome(f.s,'failed');
 const count=reservations(f.s);await claim(f.s);outcome(f.s);
 expect(f.s.hasPendingGeneration()).toBe(true);expect(reservations(f.s)).toBe(count+1);
 expect((await f.s.drivePendingGeneration()).kind).toBe('committed');expect(f.gate.callCount).toBe(0);
 expect(f.s.rebuildRuntimeState().presentation_cursor.status).toBe('awaiting_browser');
});
