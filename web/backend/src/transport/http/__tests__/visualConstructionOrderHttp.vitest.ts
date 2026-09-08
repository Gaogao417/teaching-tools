/** H03 order boundary: real HTTP/kernel/SQLite; synthetic setup outcomes, no browser/provider/TTS claim. */
import express from 'express';
import {resolve} from 'node:path';
import {beforeAll,afterAll,afterEach,it,expect} from 'vitest';
import {createVNextTutorRoutes} from '../vnextTutorRoutes';
import {TutorRuntimeApplicationV7} from '../../../services/tutorOrchestration/TutorRuntimeApplicationV7';
import {TutorTaskBindingResolver} from '../../../services/tutorOrchestration/TutorTaskBindingResolver';
import {importVisualReviewCandidate} from '../../../services/planBuild/visual/ImportVisualReviewCandidate';
import {f6Model} from '../../../services/tutorOrchestration/__tests__/f6Support';
import {createGenerationRecoveryScanner} from '../../../services/tutorOrchestration/presentationGeneration/GenerationRecoveryWorker';
import {VISUAL_PRESENTER_PROMPT_VERSION,PREVIOUS_VISUAL_PRESENTER_PROMPT_VERSION,LEGACY_VISUAL_PRESENTER_PROMPT_VERSION} from '../../../services/tutorOrchestration/presentationGeneration/PresenterPrompts';
import {VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION} from '../../../services/tutorOrchestration/presentationGeneration/VisualPresentationTools';
import type {PresenterGeneratorPort} from '../../../services/tutorOrchestration/presentationGeneration/GeneratorPort';
import {parseSessionSnapshotHttp,type SessionSnapshotHttpV1} from '../../../../../shared/tutorHttpProfile';
import {db} from '../../../db/database';
const root='/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring';
const loaded=importVisualReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});
if(!loaded.ok)throw Error(loaded.errors.join(';'));
const resolver=new TutorTaskBindingResolver(root,()=>loaded);
const requests:Array<{id:string;payload:any}>=[];
let beforeConstruction=false;
const itemOrders:Array<{legal:any[];actual:any[];futureBinding:string}>=[];
let promptVersion=VISUAL_PRESENTER_PROMPT_VERSION;
const presenter:PresenterGeneratorPort={provider:'local-recovery-test',modelId:'local-recovery-test',get pin(){return {provider:'local-recovery-test',model_id:'local-recovery-test',prompt_version:promptVersion,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION};},async generatePresentationDraft(request){
 const payload=request.userPayload as any;requests.push({id:request.request_id,payload});
 const items:any[]=[];
 const tool=(tool:string,binding_ref:string|undefined,params:unknown)=>items.push({type:'tool_intent',tool,args:{...(binding_ref?{binding_ref}:{}),params}});
 const requirements=payload.visual.requirements as any[],bindings=payload.visual.bindings as any[];
 const needed=new Set<string>(requirements.flatMap(r=>bindings.find(b=>b.binding_id===r.binding_ref)?.required_constructions??[]));
 for(const id of needed){const b=payload.tools.find((t:any)=>t.tool==='geometry.construct')?.bindings.find((b:any)=>b.binding_ref===id);if(b){tool('geometry.construct',id,{template_id:b.allowed_template_ids[0]});}}
 items.push({type:'speech',text:'请观察图形。',basis_refs:[payload.allowed_knowledge[0].ref]});
 for(const [index,r] of requirements.entries()){
  for(const form of r.forms)if(form!=='paired-sides')tool('geometry.annotate',r.binding_ref,{form,lifetime:'teaching-scope'});
  for(const pair_index of r.required_pair_indices)tool('geometry.emphasize',r.binding_ref,{group:`pairs${index}`,mode:'pulse',pair_index});
  if(r.required_pair_indices.length)tool('geometry.clear-visual',undefined,{group:`pairs${index}`});
 }
 for(const b of payload.required_board_bindings??[])tool('board.explain',b.binding_ref,{note_kind:'approved_math_note'});
 const speechIndex=items.findIndex(item=>item.type==='speech');const speech=items.splice(speechIndex,1)[0];items.unshift(speech);
 const futureBinding=bindings.find(b=>b.required_constructions?.includes('VB-01'))?.binding_id;
 if(futureBinding){
  const legal=structuredClone(items);const visualIndex=items.findIndex(item=>item.type==='tool_intent'&&item.tool!=='geometry.construct'&&item.args.binding_ref===futureBinding);
  expect(visualIndex).toBeGreaterThan(items.findIndex(item=>item.tool==='geometry.construct'&&item.args.binding_ref==='VB-01'));
  if(beforeConstruction){const visual=items.splice(visualIndex,1)[0];items.splice(1,0,visual);}
  expect(items.map(item=>JSON.stringify(item)).sort()).toEqual(legal.map(item=>JSON.stringify(item)).sort());
  itemOrders.push({legal,actual:structuredClone(items),futureBinding});
 }
 return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:request.request_id,items}};
}};
const gate={name:'local-recovery-test',async adjudicate(json:string){const c=JSON.parse(json);return JSON.stringify({response_kind:'understanding_confirmation',matched_gate_id:c.eligible_gates[0]?.gate_id,verdict:'pass',reasoning_location:'unknown',grounding_refs:[]});}};
const factory=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:resolver,presenter,model:f6Model(gate,'local-recovery-test')});
const errors:unknown[]=[];const scanner=createGenerationRecoveryScanner(factory,e=>errors.push(e));
let base='',serial=0,server:import('node:http').Server;
beforeAll(async()=>{const app=express();app.use(express.json());app.use('/api/vnext',createVNextTutorRoutes({applicationFactory:factory}));await new Promise<void>(done=>{server=app.listen(0,'127.0.0.1',()=>{base=`http://127.0.0.1:${(server.address() as any).port}/api/vnext`;done();});});});
// Each pin has its own fixture lifecycle. Do not ask a v6-only test provider
// to restore a previous test's v5 session: production correctly rejects that.
afterEach(()=>{db.prepare('DELETE FROM tutor_sessions').run();errors.length=0;requests.length=0;itemOrders.length=0;});
afterAll(async()=>{scanner.stop();await new Promise<void>(done=>server.close(()=>done()));});
async function call(path:string,body?:unknown){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const json=await r.json();expect(r.status,JSON.stringify(json)).toBe(body&&path==='/tutor-sessions'?201:200);const parsed=parseSessionSnapshotHttp(json);if(!parsed.ok)throw Error(parsed.errors.join(';'));return parsed.snapshot;}
const events=(id:string)=>db.prepare('SELECT event_type,payload_json FROM tutor_session_events WHERE session_id=? ORDER BY sequence').all(id) as Array<{event_type:string;payload_json:string}>;
const get=(v:SessionSnapshotHttpV1)=>call(`/tutor-sessions/${v.session_id}`);
const input=(v:SessionSnapshotHttpV1,input:unknown,owner=v.presentation_execution_owner)=>call(`/tutor-sessions/${v.session_id}/student-inputs`,{expected_revision:v.revision,client_request_id:`recovery-${++serial}`,execution_owner:owner,input});
const outcome=(v:SessionSnapshotHttpV1,failed=false)=>{const p=v.pending_presentation!;return call(`/tutor-sessions/${v.session_id}/presentation-actions/${p.action_id}/outcomes`,{expected_revision:v.revision,client_request_id:`recovery-${++serial}`,execution_owner:v.presentation_execution_owner,sequence_id:p.sequence_id,ordinal:p.ordinal,outcome:failed?'failed':'presented',...(failed?{failure_class:'provider_failure',message:'local injected media failure'}:{})});};
async function reachBeforeGeneration(){
 let v=await call('/tutor-sessions',{task_id:'goldenMinhangFold2020',student_id:`recovery-${++serial}`,client_instance_id:'recovery-page-a',client_request_id:`start-${serial}`});
 for(let i=0;i<100;i++){
  const mainline=v.views.coach_panel_view.mainline;
  if(v.generation?.status==='pending'&&'beat_id' in mainline&&mainline.beat_id==='BT-04')return v;
  await scanner.scanOnce();v=await get(v);
  if(v.pending_presentation)v=await outcome(v);
  else v=await input(v,v.views.participation.kind==='confirm_input'?{kind:'control',command:'confirm'}:{kind:'utterance',channel:'mainline',text:'听懂了，继续'});
 }
 throw Error('BT04 pending generation not reached');
}

const hasO=(v:SessionSnapshotHttpV1)=>v.views.student_workspace_view.canvas.elements.some(e=>e.element_id==='pt-O'&&e.visible);
it.each([true,false])('H03 visual before construction=%s: future O follows real applied boundary',async illegal=>{
 beforeConstruction=illegal;promptVersion=VISUAL_PRESENTER_PROMPT_VERSION;
 let v=await reachBeforeGeneration();expect(hasO(v)).toBe(false);expect(v.pending_presentation).toBeUndefined();
 const before=events(v.session_id).length,calls=requests.length;
 await scanner.scanOnce();v=await get(v);expect(requests.length-calls).toBe(1);expect(itemOrders).toHaveLength(1);
 let delta=events(v.session_id).slice(before);
 if(illegal){
  expect(v.generation!.status).toBe('failed');expect(hasO(v)).toBe(false);
  expect(delta.filter(e=>['presentation_sequence_planned','presentation_action_applied','presentation_action_delivered','presentation_action_outcome_recorded','gate_evaluated'].includes(e.event_type))).toEqual([]);
  expect(delta.filter(e=>e.event_type==='presentation_generation_failed').map(e=>JSON.parse(e.payload_json))).toMatchObject([{error_class:'draft_invalid'}]);
  expect(delta.filter(e=>e.event_type==='presentation_generation_retry_scheduled')).toEqual([]);
  await scanner.scanOnce();expect(requests.length-calls).toBe(1);expect(hasO(await get(v))).toBe(false);return;
 }
 expect(v.generation!.status).toBe('idle');expect(v.pending_presentation?.action.kind).toBe('voice');expect(hasO(v)).toBe(false);
 const plans=delta.filter(e=>e.event_type==='presentation_sequence_planned').map(e=>JSON.parse(e.payload_json));expect(plans).toHaveLength(1);
 const plan=plans[0],construct=plan.actions.find((a:any)=>a.workspace_action?.capability==='geometry.construct'&&JSON.parse(a.workspace_action.command_payload).outputPointId==='pt-O');expect(construct).toBeDefined();expect(construct.ordinal).toBeGreaterThan(v.pending_presentation!.ordinal);
 expect(delta.filter(e=>e.event_type==='presentation_action_applied').map(e=>JSON.parse(e.payload_json).action_id)).not.toContain(construct.workspace_action.action_id);
 // Service-only acknowledgement advances the real kernel; not browser evidence.
 v=await outcome(v);expect(v.pending_presentation?.action_id).toBe(construct.workspace_action.action_id);expect(hasO(v)).toBe(true);
 delta=events(v.session_id).slice(before);
 expect(delta.filter(e=>e.event_type==='presentation_action_applied'&&JSON.parse(e.payload_json).action_id===construct.workspace_action.action_id)).toHaveLength(1);
 expect(delta.filter(e=>e.event_type==='presentation_action_outcome_recorded'&&JSON.parse(e.payload_json).action_id===construct.workspace_action.action_id)).toEqual([]);
 let laterVisual=false;
 for(let n=0;v.pending_presentation&&n<45;n++){if(v.pending_presentation.action.workspace_action?.capability.startsWith('geometry.visual.'))laterVisual=true;v=await outcome(v);}
 expect(v.pending_presentation).toBeUndefined();expect(laterVisual).toBe(true);expect(hasO(v)).toBe(true);expect(errors).toEqual([]);expect(requests.length-calls).toBe(1);
 delta=events(v.session_id).slice(before);expect(delta.filter(e=>e.event_type==='presentation_generation_failed'||e.event_type==='runtime_failure')).toEqual([]);
 expect(factory().restore(v.session_id).assertReplayParity()).toMatchObject({equal:true});
},90000);
