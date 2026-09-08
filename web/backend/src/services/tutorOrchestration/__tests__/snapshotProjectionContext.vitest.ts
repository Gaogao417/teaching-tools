/** Claim preserves a completed teaching turn's wait for evidence, from actual receipts. */
import {afterEach,expect,it,vi} from 'vitest';
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
function setup(responses: string[] = []){
 let calls=0;
 const gate=new FixedResponseGateProvider(responses,'claim-recovery');
 const presenter:PresenterGeneratorPort={provider:'claim-recovery',modelId:'claim-recovery',pin:{provider:'claim-recovery',model_id:'claim-recovery',prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION},async generatePresentationDraft(r){calls++;const payload=r.userPayload as {required_board_bindings?:Array<{binding_ref:string}>};return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:r.request_id,items:[{type:'tool_intent',tool:'geometry.annotate',args:{binding_ref:'VB-101',params:{form:'angle-arcs',lifetime:'teaching-scope'}}},{type:'tool_intent',tool:'geometry.emphasize',args:{binding_ref:'VB-101',params:{group:'given',mode:'steady'}}},{type:'speech',text:'我们先看题目给出的两个相等角。',basis_refs:['FN-03']},...(payload.required_board_bindings??[]).map(b=>({type:'tool_intent' as const,tool:'board.explain',args:{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}}}))]}};}};
 const app=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:new TutorTaskBindingResolver(root,()=>loaded),model:f6Model(gate,'claim-recovery'),presenter});
 const result=app().start({task_id:'goldenMinhangFold2020',student_id:'claim-recovery',client_instance_id:'CI-projection',client_request_id:`projection-context-${++serial}`,sessionIdAllocator:()=>`TS-9977990${serial}`});if(result.kind==='payload-drift')throw Error('drift');
 return {s:result.orchestrator,app,gate,calls:()=>calls};
}

import Database from 'better-sqlite3';
import {db} from '../../../db/database';
import {projectHttpSnapshotV1} from '../V7HttpSnapshotProjector';
import {consumeSnapshotProjection} from '../V7SnapshotProjectionContext';
afterEach(()=>vi.restoreAllMocks());
it('pending HTTP equals a fresh verified snapshot byte-for-byte; hit repeats no state/fold',()=>{
 const {s}=setup(),service=s.snapshot();
 const workspace=vi.spyOn(s,'workspaceFold'),state=vi.spyOn(s,'rebuildRuntimeState');
 const fast=projectHttpSnapshotV1({orchestrator:s,serviceSnapshot:service});
 expect(workspace).not.toHaveBeenCalled();expect(state).not.toHaveBeenCalled();
 const snapshot=vi.spyOn(s,'snapshot');const full=projectHttpSnapshotV1({orchestrator:s,serviceSnapshot:service});
 expect(snapshot).toHaveBeenCalledOnce();expect(workspace).not.toHaveBeenCalled();expect(state).not.toHaveBeenCalled();expect(JSON.stringify(fast)).toBe(JSON.stringify(full));
});
it('actual outcome survives legal await with zero repeated projection rebuilds',async()=>{
 const {s,app}=setup();await s.drivePendingGeneration();const p=s.snapshot().pending_presentation!;
 const result=await app().reportPresentationOutcome(s,{sequence_id:p.sequence_id,ordinal:p.ordinal,action_id:p.action_id,outcome:'presented',execution_owner:s.visualLifecycle!.presentation_execution_owner,expected_revision:s.revision,client_request_id:`projection-outcome-${++serial}`});
 const workspace=vi.spyOn(s,'workspaceFold'),state=vi.spyOn(s,'rebuildRuntimeState'),snapshot=vi.spyOn(s,'snapshot');
 expect(projectHttpSnapshotV1({orchestrator:s,serviceSnapshot:result.snapshot}).revision).toBe(result.revision);
 expect(snapshot).not.toHaveBeenCalled();expect(workspace).not.toHaveBeenCalled();expect(state).not.toHaveBeenCalled();
});
it('material is single-use and bound to source, object and codec',()=>{
 const {s,app}=setup();let a=s.snapshot();expect(consumeSnapshotProjection(a,app().restore(s.sessionId),s.eventSchema)).toBeUndefined();
 a=s.snapshot();expect(consumeSnapshotProjection(structuredClone(a),s,s.eventSchema)).toBeUndefined();expect(consumeSnapshotProjection(a,s,s.eventSchema)).toBeDefined();expect(consumeSnapshotProjection(a,s,s.eventSchema)).toBeUndefined();
 a=s.snapshot();expect(consumeSnapshotProjection(a,s,'v7')).toBeUndefined();
});
it('valid-shaped nested service mutation is rebuilt, never projected as truth',()=>{
 const {s}=setup(),service=s.snapshot(),expected=service.views.coachPanelView.current_tutor_turn;
 service.views.coachPanelView.current_tutor_turn='forged';
 const snapshot=vi.spyOn(s,'snapshot'),result=projectHttpSnapshotV1({orchestrator:s,serviceSnapshot:service});
 expect(snapshot).toHaveBeenCalledOnce();expect(result.views.coach_panel_view.current_tutor_turn).toBe(expected);
});
it('HTTP caller mutation does not poison subsequent projections',()=>{
 const {s}=setup(),a=projectHttpSnapshotV1({orchestrator:s}),expected=JSON.stringify(a);a.views.coach_panel_view.current_tutor_turn='caller mutation';
 expect(JSON.stringify(projectHttpSnapshotV1({orchestrator:s}))).toBe(expected);
});
it('same-connection write across await invalidates even without revision increment',async()=>{
 const {s}=setup(),service=s.snapshot();await Promise.resolve();db.prepare('UPDATE tutor_sessions SET student_id=student_id WHERE session_id=?').run(s.sessionId);
 const snapshot=vi.spyOn(s,'snapshot');projectHttpSnapshotV1({orchestrator:s,serviceSnapshot:service});expect(snapshot).toHaveBeenCalledOnce();
});
it('external same-revision corrupt event invalidates and fails full validation',()=>{
 const {s}=setup(),service=s.snapshot(),other=new Database(process.env.SQLITE_PATH!);
 const row=other.prepare('SELECT payload_json FROM tutor_session_events WHERE session_id=? AND sequence=1').get(s.sessionId) as {payload_json:string};
 try{other.prepare("UPDATE tutor_session_events SET payload_json='{}' WHERE session_id=? AND sequence=1").run(s.sessionId);expect(()=>projectHttpSnapshotV1({orchestrator:s,serviceSnapshot:service})).toThrow();}
 finally{other.prepare('UPDATE tutor_session_events SET payload_json=? WHERE session_id=? AND sequence=1').run(row.payload_json,s.sessionId);other.close();}
});
it('catalog pin mutation cannot consume prior material',()=>{
 const {s}=setup(),service=s.snapshot(),catalog=s.sessionCatalog,previous=catalog.initialInteractionMode;
 try{catalog.initialInteractionMode=previous==='locked'?'free':'locked';expect(consumeSnapshotProjection(service,s,s.eventSchema)).toBeUndefined();}finally{catalog.initialInteractionMode=previous;}
});
it('session and revision drift retain explicit rejection',()=>{
 const {s}=setup(),service=s.snapshot();expect(()=>projectHttpSnapshotV1({orchestrator:s,serviceSnapshot:{...service,session_id:'TS-9999'}})).toThrow(/session revision/);expect(()=>projectHttpSnapshotV1({orchestrator:s,serviceSnapshot:{...service,revision:0}})).toThrow(/session revision/);
});

it.each([false,true])('snapshot-window external write fails closed after bounded fresh retry (supplied=%s)',supplied=>{
 const {s}=setup(),service=s.snapshot(),other=new Database(process.env.SQLITE_PATH!);
 // Actual separate connection write after authoritative state rebuild but before
 // snapshot's workspace read/seal. Both initial and retry prefixes are unstable.
 const navigator=(s as unknown as {navigator:{rebuildState:()=>unknown}}).navigator;
 const original=navigator.rebuildState.bind(navigator);let writes=0;
 vi.spyOn(navigator,'rebuildState').mockImplementation(()=>{const state=original();other.prepare('UPDATE tutor_sessions SET student_id=? WHERE session_id=?').run(`external-${++writes}`,s.sessionId);return state;});
 if(supplied)other.prepare('UPDATE tutor_sessions SET student_id=? WHERE session_id=?').run('invalidate-existing',s.sessionId);
 try{expect(()=>projectHttpSnapshotV1({orchestrator:s,...(supplied?{serviceSnapshot:service}:{})})).toThrow(/stable snapshot projection prefix/);expect(writes).toBe(supplied?1:2);}
 finally{other.close();}
});

it('external validated Beat transition cannot mix new snapshot state with stale navigator lifecycle',async()=>{
 const f=setup([JSON.stringify({response_kind:'understanding_confirmation',verdict:'pass',matched_gate_id:'GT-01',reasoning_location:'unknown',grounding_refs:[]})]);
 await f.s.drivePendingGeneration();
 for(let n=0;n<20;n++){const p=f.s.snapshot().pending_presentation;if(!p)break;f.s.reportPresentationOutcome({sequence_id:p.sequence_id,ordinal:p.ordinal,action_id:p.action_id,outcome:'presented',execution_owner:f.s.visualLifecycle!.presentation_execution_owner,expected_revision:f.s.revision,client_request_id:`settle-${++serial}`});}
 const revision=f.s.revision,writer=f.app().restore(f.s.sessionId);
 const result=await writer.submitStudentInput({input:{kind:'control',command:'confirm'},execution_owner:writer.visualLifecycle!.presentation_execution_owner,client_request_id:`transition-${++serial}`},{expectedRevision:revision});
 expect(result.turn.decision?.to_beat_id).toBe('BT-02');
 // First create the suffix through the real validated application/CAS chain.
 // Rewind only this isolated test DB, then append that exact valid suffix from
 // another connection to model a concurrent process retaining an older wrapper.
 const delta=db.prepare('SELECT * FROM tutor_session_events WHERE session_id=? AND recorded_revision>? ORDER BY sequence').all(f.s.sessionId,revision) as Array<Record<string,unknown>>;
 db.prepare('DELETE FROM tutor_session_events WHERE session_id=? AND recorded_revision>?').run(f.s.sessionId,revision);db.prepare('UPDATE tutor_sessions SET revision=? WHERE session_id=?').run(revision,f.s.sessionId);
 const old=f.s.snapshot(),other=new Database(process.env.SQLITE_PATH!);
 try{other.transaction(()=>{for(const row of delta){const keys=Object.keys(row);other.prepare(`INSERT INTO tutor_session_events(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));}other.prepare('UPDATE tutor_sessions SET revision=? WHERE session_id=?').run(result.revision,f.s.sessionId);})();
  expect(consumeSnapshotProjection(old,f.s,f.s.eventSchema)).toBeUndefined();
  const refresh=vi.spyOn(f.s as unknown as {refreshWrappers:()=>void},'refreshWrappers');
  const fresh=f.s.snapshot(),material=consumeSnapshotProjection(fresh,f.s,f.s.eventSchema)!.material;
  expect(refresh).toHaveBeenCalledOnce();
  expect(fresh.revision).toBe(material.runtimeState.state_revision);
  expect(material.runtimeState.teaching_cursor).toMatchObject({beat_id:'BT-02'});
  expect(material.visualLifecycle?.visual_barrier).toEqual(material.runtimeState.visual_barrier);
  const http=projectHttpSnapshotV1({orchestrator:f.s});
  expect(http.visual_barrier).toEqual(material.runtimeState.visual_barrier);
  expect(http.active_action).toBeUndefined();expect(refresh).toHaveBeenCalledOnce();
 }finally{other.close();}
});
