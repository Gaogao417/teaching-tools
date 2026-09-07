/** Draft v14 mechanical integration: real HTTP, production kernel/SQLite,
 * pinned catalog/compiler/reducer/projector and real recovery scanner. Scripted
 * Presenter is an explicit test input, not model-quality or renderer evidence. */
import express from 'express';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createVNextTutorRoutes } from '../vnextTutorRoutes';
import { TutorRuntimeApplicationV7 } from '../../../services/tutorOrchestration/TutorRuntimeApplicationV7';
import { TutorTaskBindingResolver } from '../../../services/tutorOrchestration/TutorTaskBindingResolver';
import { importVisualReviewCandidate } from '../../../services/planBuild/visual/ImportVisualReviewCandidate';
import { FixedResponseGateProvider } from '../../../services/tutorNavigator/ModelGateAdjudicatorV5';
import { f6Model } from '../../../services/tutorOrchestration/__tests__/f6Support';
import { createGenerationRecoveryScanner } from '../../../services/tutorOrchestration/presentationGeneration/GenerationRecoveryWorker';
import { VISUAL_PRESENTER_PROMPT_VERSION } from '../../../services/tutorOrchestration/presentationGeneration/PresenterPrompts';
import { VISUAL_TOOL_CATALOG_VERSION, VISUAL_CONTEXT_BUILDER_VERSION } from '../../../services/tutorOrchestration/presentationGeneration/VisualPresentationTools';
import type { PresenterGeneratorPort } from '../../../services/tutorOrchestration/presentationGeneration/GeneratorPort';
import { parseSessionSnapshotHttp, type SessionSnapshotHttpV1 } from '../../../../../shared/tutorHttpProfile';
import { db } from '../../../db/database';
const root='/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring';
const loaded=importVisualReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});
if(!loaded.ok)throw new Error(loaded.errors.join(';'));
const resolver=new TutorTaskBindingResolver(root,(_deps,id)=>id===loaded.imported.plan.artifact_id?loaded:{ok:false,errors:['outside isolated review']});
let calls=0;
const presenter:PresenterGeneratorPort={provider:'visual-http-test-only',modelId:'visual-http-test-only',
  pin:{provider:'visual-http-test-only',model_id:'visual-http-test-only',prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION},
  async generatePresentationDraft(request){calls++;
    const payload=request.userPayload as {required_board_bindings?:Array<{binding_ref:string}>};
    return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:request.request_id,items:[
      {type:'tool_intent',tool:'geometry.annotate',args:{binding_ref:'VB-101',params:{form:'angle-arcs',lifetime:'teaching-scope'}}},
      {type:'speech',text:'我们先看题目给出的两个相等角。',basis_refs:['FN-03']},
      ...(payload.required_board_bindings??[]).map(b=>({type:'tool_intent' as const,tool:'board.explain',args:{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}}})),
    ]}};
  }};
const model=f6Model(new FixedResponseGateProvider([],'visual-http-test'),'visual-http-test');
export const visualHttpApplication=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:resolver,model,presenter});
let server:import('node:http').Server,base='';
const scannerErrors:unknown[]=[];
const scanner=createGenerationRecoveryScanner(visualHttpApplication,error=>scannerErrors.push(error));
beforeAll(async()=>{const app=express();app.use(express.json());app.use('/api/vnext',createVNextTutorRoutes({applicationFactory:visualHttpApplication}));
  await new Promise<void>((done,reject)=>{server=app.listen(0,'127.0.0.1',()=>{base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/vnext`;done();});server.once("error",reject);});});
afterAll(async()=>{scanner.stop();if(server?.listening)await new Promise<void>((done,reject)=>server.close(e=>e?reject(e):done()));});
async function request(path:string,body?:unknown){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const json=await response.json();return {status:response.status,json};}
function snapshot(json:unknown):SessionSnapshotHttpV1 {const parsed=parseSessionSnapshotHttp(json);if(!parsed.ok)throw new Error(parsed.errors.join(';'));return parsed.snapshot;}
const events=(id:string)=>db.prepare('SELECT sequence,event_type,payload_json FROM tutor_session_events WHERE session_id=? ORDER BY sequence').all(id) as Array<{sequence:number;event_type:string;payload_json:string}>;
it('Draft v14 → real start → scanner visual action → held presented → barge cleanup → restore',async()=>{
  const started=await request('/tutor-sessions',{task_id:'goldenMinhangFold2020',student_id:'g2-http-student',client_instance_id:'visual-http-page-1',client_request_id:'visual-http-start-1'});
  expect(started.status,JSON.stringify(started.json)).toBe(201);let view=snapshot(started.json);const id=view.session_id;
  expect(view.presentation_execution_owner).toEqual({client_instance_id:'visual-http-page-1',epoch:1});
  await scanner.scanOnce();expect(scannerErrors.map(String)).toEqual([]);
  view=snapshot((await request(`/tutor-sessions/${id}`)).json);
  expect(calls).toBe(1);expect(view.pending_presentation?.action.workspace_action?.capability,JSON.stringify({view,events:events(id)})).toBe('geometry.visual.upsert');
  const pending=view.pending_presentation!;
  const outcome={expected_revision:view.revision,client_request_id:'visual-http-outcome-1',sequence_id:pending.sequence_id,ordinal:pending.ordinal,outcome:'presented',execution_owner:view.presentation_execution_owner,hold_for_control:{client_request_id:'visual-http-barge-1'}};
  const held=await request(`/tutor-sessions/${id}/presentation-actions/${pending.action_id}/outcomes`,outcome);
  expect(held.status,JSON.stringify(held.json)).toBe(200);view=snapshot(held.json);expect(view.visual_barrier?.status).toBe('awaiting-control');expect(view.pending_presentation).toBeUndefined();
  expect((await request(`/tutor-sessions/${id}/presentation-actions/${pending.action_id}/outcomes`,outcome)).json).toEqual(held.json);
  const cleanup=await request(`/tutor-sessions/${id}/student-inputs`,{expected_revision:view.revision,client_request_id:'visual-http-barge-1',execution_owner:view.presentation_execution_owner,input:{kind:'control',command:'barge_in'}});
  expect(cleanup.status,JSON.stringify(cleanup.json)).toBe(200);view=snapshot(cleanup.json);expect(view.visual_barrier?.status).toBe('awaiting-cleanup');expect(view.pending_presentation?.action.workspace_action?.capability,JSON.stringify({view,events:events(id)})).toBe('geometry.visual.reconcile');
  const cleaning=view.pending_presentation!;
  const settled=await request(`/tutor-sessions/${id}/presentation-actions/${cleaning.action_id}/outcomes`,{expected_revision:view.revision,client_request_id:'visual-http-cleanup-1',execution_owner:view.presentation_execution_owner,sequence_id:cleaning.sequence_id,ordinal:0,outcome:'presented'});
  expect(settled.status,JSON.stringify(settled.json)).toBe(200);view=snapshot(settled.json);expect(view.visual_barrier).toBeNull();
  const count=events(id).length;expect((await request(`/tutor-sessions/${id}`)).json).toEqual(settled.json);expect(events(id)).toHaveLength(count);
  expect(events(id).filter(e=>e.event_type==='presentation_action_outcome_recorded').map(e=>JSON.parse(e.payload_json).outcome)).toEqual(['presented','presented']);
});
it('H33 HTTP claim fences old input/outcome/ASR and old claim retry does not reacquire',async()=>{
  const start=await request('/tutor-sessions',{task_id:'goldenMinhangFold2020',student_id:'g2-owner-student',client_instance_id:'visual-http-owner-a',client_request_id:'visual-owner-start'});
  expect(start.status,JSON.stringify(start.json)).toBe(201);let view=snapshot(start.json),id=view.session_id;
  const original=view.presentation_execution_owner!;
  const claim={expected_revision:view.revision,client_request_id:'visual-claim-b',execution_owner:{client_instance_id:'visual-http-owner-b',epoch:800},input:{kind:'control',command:'claim_presentation'}};
  const claimed=await request(`/tutor-sessions/${id}/student-inputs`,claim);expect(claimed.status,JSON.stringify(claimed.json)).toBe(200);view=snapshot(claimed.json);expect(view.presentation_execution_owner?.epoch).toBe(2);
  const claimC=await request(`/tutor-sessions/${id}/student-inputs`,{...claim,expected_revision:view.revision,client_request_id:'visual-claim-c',execution_owner:{client_instance_id:'visual-http-owner-c',epoch:1}});
  expect(claimC.status,JSON.stringify(claimC.json)).toBe(200);view=snapshot(claimC.json);expect(view.presentation_execution_owner?.epoch).toBe(3);
  const before=events(id).length;
  const replay=await request(`/tutor-sessions/${id}/student-inputs`,claim);expect(replay.status,JSON.stringify(replay.json)).toBe(200);expect(snapshot(replay.json).presentation_execution_owner).toEqual(view.presentation_execution_owner);
  const stale=await request(`/tutor-sessions/${id}/student-inputs`,{expected_revision:view.revision,client_request_id:'stale-owner-control',execution_owner:original,input:{kind:'control',command:'continue'}});
  expect(stale.status).toBe(409);expect(stale.json.error.code).toBe('PRESENTATION_OWNER_STALE');expect(events(id)).toHaveLength(before);
  const missing=await request(`/tutor-sessions/${id}/student-inputs`,{expected_revision:view.revision,client_request_id:'missing-owner-control',input:{kind:'control',command:'continue'}});
  expect(missing.status).toBe(409);expect(events(id)).toHaveLength(before);
});
it('H35 real SQL scanner repairs session-start-only bootstrap and reserves once across repeated scans',async()=>{
  const template=await request('/tutor-sessions',{task_id:'goldenMinhangFold2020',student_id:'g2-bootstrap-source',client_instance_id:'visual-bootstrap-source',client_request_id:'visual-bootstrap-source'});
  expect(template.status,JSON.stringify(template.json)).toBe(201);
  const source=snapshot(template.json);const started=JSON.parse(events(source.session_id)[0].payload_json);
  const {TutorSessionKernelV10}=await import('../../../services/tutorSession/TutorSessionKernelV10');
  const id=`TS-${Date.now()}991`;
  TutorSessionKernelV10.start({sessionId:id,studentId:'g2-bootstrap-target',occurred_at:new Date().toISOString(),sessionStarted:{...started,presentation_execution_owner:{client_instance_id:'visual-bootstrap-target',epoch:1}}},resolver.v10RegistryProvider);
  const before=events(id).length;
  const restored=await request(`/tutor-sessions/${id}`);expect(restored.status,JSON.stringify(restored.json)).toBe(200);expect(events(id)).toHaveLength(before);
  const pendingClaim=await request(`/tutor-sessions/${id}/student-inputs`,{expected_revision:1,client_request_id:'bootstrap-claim-retry',execution_owner:{client_instance_id:'bootstrap-new-page',epoch:1},input:{kind:'control',command:'claim_presentation'}});
  expect(pendingClaim.status).toBe(409);expect(pendingClaim.json.error.code).toBe('VISUAL_BOOTSTRAP_REQUIRED');expect(events(id)).toHaveLength(1);
  await scanner.scanOnce();await scanner.scanOnce();expect(scannerErrors.map(String)).toEqual([]);
  expect(events(id).filter(e=>e.event_type==='policy_decision_made')).toHaveLength(1);
  expect(events(id).filter(e=>e.event_type==='presentation_generation_requested')).toHaveLength(1);
  const ready=snapshot((await request(`/tutor-sessions/${id}`)).json);expect(ready.pending_presentation,JSON.stringify({ready,events:events(id)})).toBeDefined();
});
it('H15/H18/H23 real HTTP cleanup failure retries frozen target; release DB fault never acknowledges',async()=>{
  const start=await request('/tutor-sessions',{task_id:'goldenMinhangFold2020',student_id:'g2-fault-student',client_instance_id:'visual-http-fault-a',client_request_id:'visual-fault-start'});
  expect(start.status,JSON.stringify(start.json)).toBe(201);let view=snapshot(start.json),id=view.session_id;
  const claim=await request(`/tutor-sessions/${id}/student-inputs`,{expected_revision:view.revision,client_request_id:'visual-fault-claim',execution_owner:{client_instance_id:'visual-http-fault-b',epoch:77},input:{kind:'control',command:'claim_presentation'}});
  expect(claim.status,JSON.stringify(claim.json)).toBe(200);view=snapshot(claim.json);
  const original=view.visual_barrier!;
  const failed=await request(`/tutor-sessions/${id}/presentation-actions/${view.pending_presentation!.action_id}/outcomes`,{expected_revision:view.revision,client_request_id:'visual-cleanup-failure',execution_owner:view.presentation_execution_owner,sequence_id:view.pending_presentation!.sequence_id,ordinal:0,outcome:'failed',failure_class:'internal_error',message:'test renderer refused cleanup'});
  expect(failed.status,JSON.stringify(failed.json)).toBe(200);view=snapshot(failed.json);expect(view.visual_barrier?.status).toBe('failed');
  const ordinary=await request(`/tutor-sessions/${id}/student-inputs`,{expected_revision:view.revision,client_request_id:'visual-ordinary-during-failed',execution_owner:view.presentation_execution_owner,input:{kind:'control',command:'continue'}});
  expect(ordinary.status).toBe(409);
  const retry=await request(`/tutor-sessions/${id}/student-inputs`,{expected_revision:view.revision,client_request_id:'visual-cleanup-retry',execution_owner:view.presentation_execution_owner,input:{kind:'control',command:'retry_recovery'}});
  expect(retry.status,JSON.stringify(retry.json)).toBe(200);view=snapshot(retry.json);
  expect(view.visual_barrier).toMatchObject({barrier_id:original.barrier_id,...('target_digest' in original?{target_digest:original.target_digest,target_event_sequence:original.target_event_sequence,target_visual_revision:original.target_visual_revision}:{})});
  expect(view.pending_presentation!.sequence_id).not.toBe('cleanup_sequence_id' in original?original.cleanup_sequence_id:'');
  const cleanup=view.pending_presentation!;
  const body={expected_revision:view.revision,client_request_id:'visual-cleanup-retry-outcome',execution_owner:view.presentation_execution_owner,sequence_id:cleanup.sequence_id,ordinal:0,outcome:'presented'};
  const count=events(id).length;
  db.exec("CREATE TRIGGER g2_release_fault BEFORE INSERT ON tutor_session_events WHEN NEW.event_type='visual_barrier_changed' AND json_extract(NEW.payload_json,'$.barrier') IS NULL BEGIN SELECT RAISE(ABORT,'g2 release fault'); END");
  try {const fault=await request(`/tutor-sessions/${id}/presentation-actions/${cleanup.action_id}/outcomes`,body);expect(fault.status).not.toBe(200);} finally {db.exec('DROP TRIGGER g2_release_fault');}
  expect(events(id)).toHaveLength(count);expect(snapshot((await request(`/tutor-sessions/${id}`)).json).visual_barrier?.status).toBe('awaiting-cleanup');
  const done=await request(`/tutor-sessions/${id}/presentation-actions/${cleanup.action_id}/outcomes`,body);expect(done.status,JSON.stringify(done.json)).toBe(200);expect(snapshot(done.json).visual_barrier).toBeNull();
  expect(events(id).filter(e=>e.event_type==='presentation_action_outcome_recorded').map(e=>JSON.parse(e.payload_json).outcome)).toEqual(['failed','presented']);
});
it.each(['failed','not-started'] as const)('H13/H23 HTTP %s delivery enters cleanup without invented outcome',async(mode)=>{
  const start=await request('/tutor-sessions',{task_id:'goldenMinhangFold2020',student_id:`g2-${mode}`,client_instance_id:`visual-${mode}`,client_request_id:`visual-start-${mode}`});
  expect(start.status,JSON.stringify(start.json)).toBe(201);let view=snapshot(start.json);const id=view.session_id;
  await scanner.scanOnce();view=snapshot((await request(`/tutor-sessions/${id}`)).json);const pending=view.pending_presentation!;expect(pending).toBeDefined();
  if(mode==='failed') {
    const failed=await request(`/tutor-sessions/${id}/presentation-actions/${pending.action_id}/outcomes`,{expected_revision:view.revision,client_request_id:`visual-${mode}-outcome`,execution_owner:view.presentation_execution_owner,sequence_id:pending.sequence_id,ordinal:pending.ordinal,outcome:'failed',failure_class:'internal_error'});
    expect(failed.status,JSON.stringify(failed.json)).toBe(200);view=snapshot(failed.json);
  }
  const control=await request(`/tutor-sessions/${id}/student-inputs`,{expected_revision:view.revision,client_request_id:`visual-${mode}-control`,execution_owner:view.presentation_execution_owner,input:{kind:'control',command:mode==='failed'?'retry_recovery':'barge_in',...(mode==='not-started'?{not_started_delivery:{sequence_id:pending.sequence_id,ordinal:pending.ordinal,action_id:pending.action_id}}:{})}});
  expect(control.status,JSON.stringify(control.json)).toBe(200);view=snapshot(control.json);
  expect(view.visual_barrier?.status).toBe('awaiting-cleanup');expect(view.visual_barrier?.cause).toBe(mode==='failed'?'recovery':'barge-in');
  expect(view.pending_presentation?.action.workspace_action?.capability).toBe('geometry.visual.reconcile');
  expect(events(id).filter(e=>e.event_type==='presentation_action_outcome_recorded').map(e=>JSON.parse(e.payload_json).outcome)).toEqual(mode==='failed'?['failed']:[]);
  if(mode==='not-started') {
    const count=events(id).filter(e=>e.event_type==='presentation_generation_requested').length;
    for(const page of ['replacement-a','replacement-b']) {
      const claimed=await request(`/tutor-sessions/${id}/student-inputs`,{expected_revision:view.revision,client_request_id:`${mode}-${page}`,execution_owner:{client_instance_id:page,epoch:999},input:{kind:'control',command:'claim_presentation'}});
      expect(claimed.status,JSON.stringify(claimed.json)).toBe(200);view=snapshot(claimed.json);
    }
    const cleanup=view.pending_presentation!;
    const settled=await request(`/tutor-sessions/${id}/presentation-actions/${cleanup.action_id}/outcomes`,{expected_revision:view.revision,client_request_id:'claimed-barge-cleanup',execution_owner:view.presentation_execution_owner,sequence_id:cleanup.sequence_id,ordinal:cleanup.ordinal,outcome:'presented'});
    expect(settled.status,JSON.stringify(settled.json)).toBe(200);expect(snapshot(settled.json).visual_barrier).toBeNull();
    await scanner.scanOnce();
    expect(events(id).filter(e=>e.event_type==='presentation_generation_requested')).toHaveLength(count);
    expect(snapshot((await request(`/tutor-sessions/${id}`)).json).pending_presentation).toBeUndefined();
  }
});

it('same-call service snapshot reuse equals fresh HTTP projection and skips its duplicate snapshot',async()=>{
  const {projectHttpSnapshotV1}=await import('../../../services/tutorOrchestration/V7HttpSnapshotProjector');
  const started=await request('/tutor-sessions',{task_id:'goldenMinhangFold2020',student_id:'g2-projection-reuse',client_instance_id:'projection-reuse',client_request_id:'projection-reuse-start'});
  expect(started.status,JSON.stringify(started.json)).toBe(201);
  const orchestrator=visualHttpApplication().restore(snapshot(started.json).session_id);
  const service=orchestrator.snapshot(orchestrator.question.stem);
  const spy=vi.spyOn(orchestrator,'snapshot');
  try {
    const reused=projectHttpSnapshotV1({orchestrator,serviceSnapshot:service});
    expect(spy).not.toHaveBeenCalled();
    const fresh=projectHttpSnapshotV1({orchestrator});
    expect(spy).toHaveBeenCalledTimes(1);expect(reused).toEqual(fresh);
    expect(()=>projectHttpSnapshotV1({orchestrator,serviceSnapshot:{...service,revision:service.revision-1}})).toThrow(/revision/);
  } finally {spy.mockRestore();}
});
