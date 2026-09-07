/** Real SQL/kernel/application/HTTP regression; model ports are explicit test doubles. */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { importReviewCandidate } from '../../planBuild/c1/ImportReviewCandidate';
import { TutorTaskBindingResolver } from '../TutorTaskBindingResolver';
import { TutorRuntimeApplicationV7 } from '../TutorRuntimeApplicationV7';
import { FixedResponseGateProvider } from '../../tutorNavigator/ModelGateAdjudicatorV5';
import { f6Model } from './f6Support';
import { TOOL_INVOCATION_PRESENTER_PROMPT_VERSION as PRESENTER_PROMPT_VERSION } from '../presentationGeneration/PresenterPrompts';
import { PresenterGenerationError, type PresenterGeneratorPort } from '../presentationGeneration/GeneratorPort';
import { createApp } from '../../../app';

const root = '/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring';
const review = importReviewCandidate({canonicalRoot: root, candidateDirectory: resolve('src/services/planBuild/review/c1-teach-follow-along/candidate-v13-r3')});
if (!review.ok) throw Error(review.errors.join(';'));
const resolver = new TutorTaskBindingResolver(root, () => review);
let serial = 0;
const servers: Server[] = [];
afterAll(async () => { for (const s of servers) await new Promise<void>((done, reject) => {s.close(e => e ? reject(e) : done());s.closeAllConnections();});vi.unstubAllEnvs(); });
function setup(responses: string[] = []) {
 const gate = new FixedResponseGateProvider(responses, 'delivery-gap-test');
 let fail = false;
 const presenter: PresenterGeneratorPort = {
  provider:'delivery-gap-test',modelId:'delivery-gap-test',
  pin:{provider:'delivery-gap-test',model_id:'delivery-gap-test',prompt_version:PRESENTER_PROMPT_VERSION,context_builder_version:'presentation-context-builder/v1',tool_catalog_version:'presentation-tool-catalog/v1'},
  async generatePresentationDraft(r) {
   if (fail) throw new PresenterGenerationError('draft_invalid','injected terminal failure',false);
   const ref = (r.userPayload as {allowed_knowledge:Array<{ref:string}>}).allowed_knowledge[0].ref;
   return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:r.request_id,items:[{type:'speech',text:'我们看清题目的已知条件。',basis_refs:[ref]}]}};
  },
 };
 const app = () => TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:resolver,model:f6Model(gate,'delivery-gap-test'),presenter});
 const start = app().start({task_id:'goldenMinhangFold2020',student_id:'delivery-gap-test',client_request_id:`gap-start-${++serial}`,sessionIdAllocator:()=>`TS-998880${String(serial).padStart(4,'0')}`});
 if(start.kind==='payload-drift')throw Error('unexpected drift');
 return {app,session:start.orchestrator,gate,fail:()=>{fail=true;}};
}
type Session = ReturnType<typeof setup>['session'];
const input = (id='gap-question') => ({input:{kind:'utterance' as const,channel:'assistance' as const,text:'我还不明白，请解释题目的关系。'},client_request_id:id});
function settle(s: Session, outcome:'presented'|'interrupted'|'failed'='presented') {
 const c=s.rebuildRuntimeState().presentation_cursor;
 if(c.status!=='awaiting_browser')throw Error('expected pending delivery');
 s.reportPresentationOutcome({sequence_id:c.sequence_id,ordinal:c.ordinal,action_id:c.action_id,outcome,...(outcome==='failed'?{failure_class:'provider_failure',message:'voice playback ended in media error'}:{}),client_request_id:`settle-${s.sessionId}-${s.revision}`});
}
async function gap() {
 const f=setup();await f.session.drivePendingGeneration();settle(f.session);
 // Crash after real Navigator commits, before any presentation reservation.
 const fault=vi.spyOn(f.session as any,'presentAfterDecision').mockImplementationOnce(()=>{throw Error('injected commit/reserve crash');});
 await expect(f.session.submitStudentInput(input())).rejects.toThrow('injected commit/reserve crash');fault.mockRestore();
 expect(f.session.events.at(-1)?.event_type).toBe('policy_decision_made');
 return f;
}

describe('delivery admission and missing generation recovery',()=>{
 it.each(['utterance','confirm','continue','retry_recovery'] as const)('rejects %s before raw, revision failure, model or any mutation',async kind=>{
  const f=setup();await f.session.drivePendingGeneration();const before=f.session.events;const calls=f.gate.callCount;
  const request=kind==='utterance'?input():{input:{kind:'control' as const,command:kind},client_request_id:`blocked-${kind}`};
  await expect(f.session.submitStudentInput(request,{expectedRevision:0})).rejects.toMatchObject({code:'PRESENTATION_AWAITING_BROWSER'});
  expect(f.session.events).toEqual(before);expect(f.gate.callCount).toBe(calls);
 });
 it('explicit barge_in still closes delivery with interrupted and superseded facts',async()=>{
  const f=setup();await f.session.drivePendingGeneration();
  await f.session.submitStudentInput({input:{kind:'control',command:'barge_in'},client_request_id:'explicit-barge'});
  expect(f.session.events.some(e=>e.event_type==='presentation_sequence_superseded')).toBe(true);
  expect(f.session.rebuildRuntimeState().presentation_cursor.status).toBe('idle');
 });
 it('restored same-ID retry reserves once without repeating raw, interpretation, gate or decision',async()=>{
  const f=await gap();const before=f.session.events;const calls=f.gate.callCount;
  const restored=f.app().restore(f.session.sessionId);
  await restored.submitStudentInput(input(),{expectedRevision:0});
  expect(restored.events.slice(before.length).map(e=>e.event_type)).toEqual(['presentation_generation_requested']);
  expect(f.gate.callCount).toBe(calls);
  const pending=restored.events;await f.app().restore(restored.sessionId).submitStudentInput(input(),{expectedRevision:0});
  expect(f.app().restore(restored.sessionId).events).toEqual(pending);
  expect((await restored.drivePendingGeneration()).kind).toBe('committed');
  const delivered=restored.events;await restored.submitStudentInput(input());expect(restored.events).toEqual(delivered);
  expect(restored.assertReplayParity().equal).toBe(true);
 });
 it('payload drift is rejected before compensation',async()=>{
  const f=await gap();const before=f.session.events;
  await expect(f.app().restore(f.session.sessionId).submitStudentInput({...input(),input:{...input().input,text:'changed'}})).rejects.toMatchObject({code:'REQUEST_PAYLOAD_DRIFT'});
  expect(f.app().restore(f.session.sessionId).events).toEqual(before);
 });
 it('never revives an older gap after a newer student turn',async()=>{
  const f=await gap();await f.session.submitStudentInput(input('newer'));
  const before=f.session.events;await f.session.submitStudentInput(input());expect(f.session.events).toEqual(before);
 });
 it('failed generation replay does not create a budget; retry_recovery remains the explicit path',async()=>{
  const f=await gap();await f.session.submitStudentInput(input());f.fail();
  expect((await f.session.drivePendingGeneration()).kind).toBe('failed');
  const before=f.session.events;await f.session.submitStudentInput(input());expect(f.session.events).toEqual(before);
  await f.session.submitStudentInput({input:{kind:'control',command:'retry_recovery'},client_request_id:'explicit-generation-recovery'});
  expect(f.session.hasPendingGeneration()).toBe(true);
  expect(f.session.events.filter(e=>String(e.event_type)==='presentation_generation_requested')).toHaveLength(3);
 });
 it('cancelled generation replay never creates another budget',async()=>{
  const f=await gap();await f.session.submitStudentInput(input());
  await f.session.submitStudentInput({input:{kind:'control',command:'barge_in'},client_request_id:'cancel-recovered'});
  const before=f.session.events;await f.session.submitStudentInput(input());expect(f.session.events).toEqual(before);
 });
 it('legacy already-committed decision recovers through HTTP outcome then original input, with exact pins and no new Gate',async()=>{
  const f=setup();await f.session.drivePendingGeneration();
  // Reproduce the old orchestrator admission bug using the real Navigator/kernel.
  await (f.session as any).navigator.submitStudentInput(input());
  const before=f.session.events;const calls=f.gate.callCount;
  await expect(f.app().restore(f.session.sessionId).submitStudentInput(input())).rejects.toMatchObject({code:'PRESENTATION_AWAITING_BROWSER'});
  expect(f.app().restore(f.session.sessionId).events).toEqual(before);
  vi.stubEnv('TUTOR_VNEXT_ROOT',root);
  const server=createApp({vnext:{applicationFactory:f.app}}).listen(0,'127.0.0.1');servers.push(server);
  await new Promise<void>(done=>server.once('listening',done));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/vnext/tutor-sessions/${f.session.sessionId}`;
  const c=f.session.rebuildRuntimeState().presentation_cursor;if(c.status!=='awaiting_browser')throw Error('pending');
  const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const settled=await post(`/presentation-actions/${c.action_id}/outcomes`,{sequence_id:c.sequence_id,ordinal:c.ordinal,outcome:'interrupted',expected_revision:f.session.revision,client_request_id:'legacy-interrupt'});
  expect(settled.status).toBe(200);
  const replay=await post('/student-inputs',{...input(),expected_revision:(await settled.json() as any).revision});
  expect(replay.status).toBe(200);
  // F7 P3（A5）：mutation 路由不再阻塞驱动——replay 预约后立即回包
  // generation=pending；此处显式驱动等价于后台 recovery worker 的接管路径。
  expect((await replay.json() as any).generation).toMatchObject({status:'pending'});
  await f.app().restore(f.session.sessionId).drivePendingGeneration();
  const repaired=f.app().restore(f.session.sessionId);
  expect(repaired.events[0]).toEqual(before[0]);expect(f.gate.callCount).toBe(calls);
  expect(repaired.events.filter(e=>e.event_type==='policy_decision_made')).toEqual(before.filter(e=>e.event_type==='policy_decision_made'));
  expect(repaired.events.filter(e=>String(e.event_type)==='presentation_generation_requested')).toHaveLength(2);
  expect(repaired.rebuildRuntimeState().presentation_cursor.status).toBe('awaiting_browser');
  const stable=repaired.events;expect((await post('/student-inputs',{...input(),expected_revision:1})).status).toBe(200);
  expect(f.app().restore(f.session.sessionId).events).toEqual(stable);
 });
 it.each(['failed','interrupted','presented'] as const)('restored status projects actual %s delivery outcome without invented student failure',async outcome=>{
  const f=setup();await f.session.drivePendingGeneration();settle(f.session,outcome);
  const restored=f.app().restore(f.session.sessionId);const before=restored.events;
  const status=restored.snapshot().views.status;
  if(outcome==='failed') {
   const event=before.find(e=>e.event_type==='presentation_action_outcome_recorded')!;
   expect(status.last_failure).toMatchObject({category:'presentation_action_failure',event_type:event.event_type,sequence:event.sequence,failure_class:'provider_failure',message:'voice playback ended in media error'});
   await restored.submitStudentInput({input:{kind:'control',command:'retry_recovery'},client_request_id:'failed-delivery-recover'});
   expect(restored.hasPendingGeneration()).toBe(true);
  } else expect(status.last_failure).toBeUndefined();
 });
 it('completed retry_recovery replays as a read while its new delivery awaits the browser',async()=>{
  const f=setup();await f.session.drivePendingGeneration();settle(f.session,'failed');
  const request={input:{kind:'control' as const,command:'retry_recovery' as const},client_request_id:'lost-recovery-response'};
  await f.session.submitStudentInput(request);await f.session.drivePendingGeneration();
  const before=f.session.events;
  await f.app().restore(f.session.sessionId).submitStudentInput(request,{expectedRevision:0});
  expect(f.app().restore(f.session.sessionId).events).toEqual(before);
 });
 it('retry_recovery resumes a crash after superseding the failed sequence without another supersede or decision',async()=>{
  const f=setup();await f.session.drivePendingGeneration();settle(f.session,'failed');
  const request={input:{kind:'control' as const,command:'retry_recovery' as const},client_request_id:'recovery-reserve-crash'};
  const fault=vi.spyOn(f.session,'presentCurrentBeat').mockImplementationOnce(()=>{throw Error('after supersede');});
  await expect(f.session.submitStudentInput(request)).rejects.toThrow('after supersede');fault.mockRestore();
  const before=f.session.events;expect(before.at(-1)?.event_type).toBe('presentation_sequence_superseded');
  const restored=f.app().restore(f.session.sessionId);await restored.submitStudentInput(request,{expectedRevision:0});
  expect(restored.events.slice(before.length).map(e=>e.event_type)).toEqual(['presentation_generation_requested']);
 });
 it('a retry that originally resumed pending generation cannot later recycle its failed budget',async()=>{
  const f=setup();const request={input:{kind:'control' as const,command:'retry_recovery' as const},client_request_id:'resume-pending-budget'};
  await f.session.submitStudentInput(request);f.fail();await f.session.drivePendingGeneration();
  const before=f.session.events;await f.app().restore(f.session.sessionId).submitStudentInput(request,{expectedRevision:0});
  expect(f.app().restore(f.session.sessionId).events).toEqual(before);
 });
 it.each(['before_execution','after_execution'] as const)('transition recovery at %s never repeats the passed gate or an existing execution anchor',async stage=>{
  const f=setup([JSON.stringify({response_kind:'understanding_confirmation',matched_gate_id:'GT-01',verdict:'pass',reasoning_location:'unknown',grounding_refs:[]})]);
  await f.session.drivePendingGeneration();settle(f.session);
  const request={input:{kind:'utterance' as const,channel:'mainline' as const,text:'这一步听懂了，继续。'},client_request_id:`transition-crash-${stage}`};
  const method=stage==='before_execution'?'presentAfterDecision':'reserveGenerationForDecision';
  const fault=vi.spyOn(f.session as any,method).mockImplementationOnce(()=>{throw Error('transition commit gap');});
  await expect(f.session.submitStudentInput(request)).rejects.toThrow('transition commit gap');fault.mockRestore();
  const before=f.session.events;expect(f.session.rebuildRuntimeState().teaching_cursor.beat_id).toBe('BT-02');
  const restored=f.app().restore(f.session.sessionId);await restored.submitStudentInput(request);
  const delta=restored.events.slice(before.length);
  expect(delta.map(e=>e.event_type)).toEqual(stage==='before_execution'?['policy_decision_made','presentation_generation_requested']:['presentation_generation_requested']);
  expect(restored.events.filter(e=>e.event_type==='gate_evaluated')).toEqual(before.filter(e=>e.event_type==='gate_evaluated'));
  expect(f.gate.callCount).toBe(1);expect((await restored.drivePendingGeneration()).kind).toBe('committed');
 });
 it('actual HTTP returns 409 with zero events for unsettled delivery',async()=>{
  const f=setup();await f.session.drivePendingGeneration();const before=f.session.events;
  vi.stubEnv('TUTOR_VNEXT_ROOT',root);
  const server=createApp({vnext:{applicationFactory:f.app}}).listen(0,'127.0.0.1');servers.push(server);
  await new Promise<void>(done=>server.once('listening',done));
  const res=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/api/vnext/tutor-sessions/${f.session.sessionId}/student-inputs`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input(),expected_revision:1})});
  expect(res.status).toBe(409);expect((await res.json() as any).error.code).toBe('PRESENTATION_AWAITING_BROWSER');
  expect(f.app().restore(f.session.sessionId).events).toEqual(before);
 });
});
