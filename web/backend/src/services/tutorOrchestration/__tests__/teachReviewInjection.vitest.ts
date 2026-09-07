/** Review composition regression: actual Draft files/importer + SQL/runtime/HTTP.
 * Model ports are explicit test doubles; no paid API or real asset writes. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { importReviewCandidate } from '../../planBuild/c1/ImportReviewCandidate';
import { importApprovedPlanV5 } from '../../planBuild/v5/ImportApprovedPlanV5';
import { TutorTaskBindingResolver } from '../TutorTaskBindingResolver';
import { TutorRuntimeApplicationV7 } from '../TutorRuntimeApplicationV7';
import { FixedResponseGateProvider } from '../../tutorNavigator/ModelGateAdjudicatorV5';
import { f6Model } from './f6Support';
import { PRESENTER_PROMPT_VERSION } from '../presentationGeneration/PresenterPrompts';
import type { PresenterGeneratorPort } from '../presentationGeneration/GeneratorPort';
import { createGenerationRecoveryScanner } from '../presentationGeneration/GenerationRecoveryWorker';
import { createApp } from '../../../app';
import { db } from '../../../db/database';

const canonicalRoot = resolve('/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring');
const candidateDirectory = resolve('src/services/planBuild/review/c1-teach-follow-along/candidate-v13-r3');
const loaded = importReviewCandidate({canonicalRoot,candidateDirectory});
if (!loaded.ok) throw new Error(loaded.errors.join('; '));
const imported = loaded.imported;
const resolver = new TutorTaskBindingResolver(canonicalRoot, (_deps,id) => id === imported.plan.artifact_id ? loaded : {ok:false,errors:['outside review candidate']});
const gate = new FixedResponseGateProvider([], 'review-injection-test');
const model = f6Model(gate,'review-injection-test');
const presenterCalls: string[] = [];
const presenter: PresenterGeneratorPort = {
 provider:'review-test-only',modelId:'review-test-only',
 pin:{provider:'review-test-only',model_id:'review-test-only',prompt_version:PRESENTER_PROMPT_VERSION,context_builder_version:'presentation-context-builder/v1',tool_catalog_version:'presentation-tool-catalog/v1'},
 async generatePresentationDraft(request) {
  presenterCalls.push(request.request_id);
  const refs = (request.userPayload as {allowed_knowledge:Array<{ref:string}>}).allowed_knowledge;
  return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:request.request_id,items:[{type:'speech',text:'我们一起看清题目中已经给出的关系。',basis_refs:[refs[0].ref]},...((request.userPayload as any).required_board_bindings??[]).map((b:any)=>({type:'tool_intent',tool:'board.explain',args:{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}}}))]}};
 },
};
const app = () => TutorRuntimeApplicationV7.create({canonicalRoot,bindingResolver:resolver,model,presenter});
let serial = 0;
const request = () => ({task_id:'goldenMinhangFold2020',student_id:'review-test',client_request_id:`review-injection-${++serial}`,sessionIdAllocator:()=>`TS-991000${String(serial).padStart(4,'0')}`});
function start(application = app()) {
 const input=request();const result=application.start(input);
 if(result.kind==='payload-drift')throw new Error('unexpected drift');
 return {input,session:result.orchestrator};
}
const count = () => (db.prepare('SELECT count(*) AS n FROM tutor_session_events').get() as {n:number}).n;
const files=['TP-SMV-009.v13.draft.json','PR-SMV-001.v11.draft.json','PR-SMV-002.v10.draft.json','review-manifest.json'];
const originals=files.map(f=>readFileSync(join(candidateDirectory,f),'utf8'));
const draftRoot=mkdtempSync(join(tmpdir(),'review-draft-reject-'));
const servers:Server[]=[];
beforeAll(()=>{
 const dir=join(draftRoot,'tutor-plan',imported.plan.artifact_id);mkdirSync(dir,{recursive:true});
 writeFileSync(join(dir,`${imported.plan.version}.json`),JSON.stringify(imported.plan));
 writeFileSync(join(dir,'registry.yaml'),`artifact_id: ${imported.plan.artifact_id}\ncurrent_version: ${imported.plan.version}\nversions:\n- version: ${imported.plan.version}\n  status: Draft\n  content_hash: ${imported.plan.content_hash}\n`);
});
afterAll(async()=>{
 for(const server of servers) await new Promise<void>((done,error)=>{server.close(e=>e?error(e):done());server.closeAllConnections();});
 vi.unstubAllEnvs();
 expect(files.map(f=>readFileSync(join(candidateDirectory,f),'utf8'))).toEqual(originals);
 rmSync(draftRoot,{recursive:true,force:true});
});
async function serve(injected:boolean) {
 vi.stubEnv('TUTOR_VNEXT_ROOT',draftRoot);vi.stubEnv('TUTOR_VNEXT_GENERATION','0');vi.stubEnv('TUTOR_VNEXT_SCRIPTED_GATE','1');
 const server=createApp(injected?{vnext:{applicationFactory:app}}:{}).listen(0,'127.0.0.1');servers.push(server);
 await new Promise<void>((done,error)=>{server.once('listening',done);server.once('error',error);});
 return `http://127.0.0.1:${(server.address() as {port:number}).port}/api/vnext/tutor-sessions`;
}

describe('explicit Draft review injection stays isolated from production',()=>{
 it('keeps actual TP/PR Draft status, approval absence and file pins through the review importer',()=>{
  expect(loaded.reviewContext).toBe('draft-local-review');
  for(const artifact of [imported.plan,...imported.protocols.values()]) {
   expect(artifact.status).toBe('Draft');expect(Object.hasOwn(artifact,'approval')).toBe(false);
  }
  expect(resolver.resolveForStart('goldenMinhangFold2020').plan.tutor_plan_ref).toEqual({artifact_id:imported.plan.artifact_id,version:imported.plan.version,content_hash:imported.plan.content_hash});
 });
 it('default importer/resolver/application reject a registry pointing at the real Draft, with zero persisted events',()=>{
  const result=importApprovedPlanV5({canonicalRoot:draftRoot},'TP-SMV-009');
  expect(result.ok).toBe(false);if(!result.ok)expect(result.errors.join(';')).toMatch(/status=Draft.*Approved/);
  expect(()=>new TutorTaskBindingResolver(draftRoot).resolveForStart('goldenMinhangFold2020')).toThrow(/status=Draft/);
  const before=count();
  expect(()=>TutorRuntimeApplicationV7.create({canonicalRoot:draftRoot,model}).start(request())).toThrow(/status=Draft/);
  expect(count()).toBe(before);
 });
 it('start, fresh application restore and idempotent start preserve exact Draft TP/PR/model/presenter pins without generation on restore',()=>{
  const {input,session}=start();const before=count();const calls=presenterCalls.length;
  const restored=app().restore(session.sessionId);
  const replay=app().start(input);expect(replay.kind).toBe('existing');
  expect(restored.events[0].payload).toEqual(session.events[0].payload);
  const payload=restored.events[0].payload as any;
  expect(payload.tutor_plan_ref).toEqual({artifact_id:imported.plan.artifact_id,version:imported.plan.version,content_hash:imported.plan.content_hash});
  expect(payload.protocol_refs).toEqual(expect.arrayContaining([...imported.protocols.values()].map(p=>({artifact_id:p.protocol_id,version:p.version,content_hash:p.content_hash}))));
  expect(payload.protocol_refs).toHaveLength(imported.protocols.size);
  expect(payload.model_gate_pin).toEqual(model.pin);
  expect(restored.rebuildRuntimeState()).toEqual(session.rebuildRuntimeState());
  expect(restored.plan.mainline.version).toBe(imported.protocols.get('PR-SMV-001')!.version);
  expect(count()).toBe(before);expect(presenterCalls).toHaveLength(calls);expect(gate.callCount).toBe(0);
 });
 it('default production restore cannot silently retarget Draft session to current Approved plan',()=>{
  const {session}=start();const before=count();
  expect(()=>TutorRuntimeApplicationV7.create({canonicalRoot,model,presenter}).restore(session.sessionId)).toThrow(/tutor_plan_ref|pin/i);
  expect(count()).toBe(before);
 });
 it('review resolver with a different plan pin fails restore instead of rewriting saved pins',()=>{
  const {session}=start();const before=count();
  const changed={...imported,plan:{...imported.plan,content_hash:`sha256:${'e'.repeat(64)}`}};
  const changedResolver=new TutorTaskBindingResolver(canonicalRoot,()=>({ok:true,imported:changed}));
  expect(()=>TutorRuntimeApplicationV7.create({canonicalRoot,bindingResolver:changedResolver,model,presenter}).restore(session.sessionId)).toThrow(/tutor_plan_ref|pin/i);
  expect(count()).toBe(before);
 });
 it('SQL recovery scanner restores Draft sessions via its injected factory, retaining their pins',async()=>{
  const {session}=start();const beforePayload=structuredClone(session.events[0].payload);const errors:unknown[]=[];
  const factory=vi.fn(app);const scanner=createGenerationRecoveryScanner(factory,e=>errors.push(e));
  try { await scanner.scanOnce(); } finally {scanner.stop();}
  expect(factory).toHaveBeenCalledTimes(1);expect(errors).toEqual([]);
  const restored=app().restore(session.sessionId);
  expect(restored.hasPendingGeneration()).toBe(false);expect(restored.events[0].payload).toEqual(beforePayload);
  expect((restored.rebuildRuntimeState() as any).generation_requests[0].status).toBe('committed');
  expect(presenterCalls.length).toBeGreaterThan(0);
 });
 it('default app/routes reject Draft; explicit injected app routes start and GET restore it without falling back to env root',async()=>{
  const production=await serve(false);const before=count();
  const input={task_id:'goldenMinhangFold2020',student_id:'review-http',client_request_id:'review-http-default'};
  const rejected=await fetch(production,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  expect(rejected.status).toBeGreaterThanOrEqual(400);expect(count()).toBe(before);
  const review=await serve(true);
  const started=await fetch(review,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,client_request_id:'review-http-injected'})});
  const body=await started.json() as any;expect(started.status,JSON.stringify(body)).toBe(201);
  const eventCount=count();const calls=presenterCalls.length;
  const get=await fetch(`${review}/${body.session_id}`);expect(get.status).toBe(200);
  expect(await get.json()).toEqual(body);expect(count()).toBe(eventCount);expect(presenterCalls).toHaveLength(calls);
  expect((app().restore(body.session_id).events[0].payload as any).tutor_plan_ref.content_hash).toBe(imported.plan.content_hash);
 });
});
