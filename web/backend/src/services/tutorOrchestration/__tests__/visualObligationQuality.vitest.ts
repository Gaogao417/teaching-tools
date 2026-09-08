/** H06: recorded real draft, scripted replies only; real pinned visual importer/kernel/preflight. */
import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {TutorRuntimeApplicationV7} from '../TutorRuntimeApplicationV7';
import {TutorTaskBindingResolver} from '../TutorTaskBindingResolver';
import {importVisualReviewCandidate} from '../../planBuild/visual/ImportVisualReviewCandidate';
import {FixedResponseGateProvider} from '../../tutorNavigator/ModelGateAdjudicatorV5';
import {f6Model,realCanonicalRoot} from './f6Support';
import {VISUAL_PRESENTER_PROMPT_VERSION,V14_VISUAL_PRESENTER_PROMPT_VERSION} from '../presentationGeneration/PresenterPrompts';
import {VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION} from '../presentationGeneration/VisualPresentationTools';
import type {PresenterGeneratorPort,PresentationDraftV2} from '../presentationGeneration/GeneratorPort';
import {VisualObligationQualityError} from '../presentationGeneration/IntentCompiler';
import * as preflightModule from '../presentationGeneration/SequencePreflight';
import {db} from '../../../db/database';
const original=JSON.parse(readFileSync(resolve('src/services/tutorOrchestration/__tests__/fixtures/realBt03MissingRatio.json'),'utf8')).items as PresentationDraftV2['items'];
const annotate=(binding_ref:string,form:string)=>({type:'tool_intent' as const,tool:'geometry.annotate',args:{binding_ref,params:{form,lifetime:'teaching-scope',group:'seg'}}});
// The recorded input remains immutable. The scripted corrected response now
// also repairs the real indirect-reference order/focus defect exposed by v10.
const fixed=()=>{
 const speech=(index:number,binding:string)=>{const item=structuredClone(original[index]);if(item.type!=='speech')throw Error('fixture speech missing');return {...item,basis_refs:[...(item.basis_refs??[]),binding]};};
 const show=(binding:string,form:string):PresentationDraftV2['items']=>[annotate(binding,form),{type:'tool_intent',tool:'geometry.emphasize',args:{binding_ref:binding,params:{group:'seg',mode:'steady'}}}];
 return [...show('VB-105','ratio-label'),speech(0,'VB-105'),speech(1,'VB-105'),structuredClone(original[2]),...show('VB-106','length-label'),speech(3,'VB-106'),...show('VB-107','length-label'),speech(5,'VB-107'),...show('VB-108','length-label'),speech(7,'VB-108'),{type:'speech' as const,text:'这一步你跟上了吗？',basis_refs:[]}];
};
const root=realCanonicalRoot();const loaded=importVisualReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});if(!loaded.ok)throw Error(loaded.errors.join(';'));
let serial=0;
function legalItems(p:any){const items:PresentationDraftV2['items']=[];for(const req of p.visual.requirements){for(const form of req.forms)items.push(annotate(req.binding_ref,form));for(const pair of req.required_pair_indices)items.push({type:'tool_intent',tool:'geometry.emphasize',args:{binding_ref:req.binding_ref,params:{group:'seg',pair_index:pair,mode:'pulse'}}});}items.push({type:'speech',text:'我们依据当前批准关系看这一步。',basis_refs:[p.allowed_knowledge[0].ref]});for(const b of p.required_board_bindings??[])items.push({type:'tool_intent',tool:'board.explain',args:{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}}});return items;}
afterEach(()=>vi.restoreAllMocks());
async function setup(reply:(call:number,payload:any)=>Promise<PresentationDraftV2['items']>|PresentationDraftV2['items'],targetBeat=3,promptVersion:string=VISUAL_PRESENTER_PROMPT_VERSION){
 const seen:Array<{request_id:string;payload:unknown}>=[];
 const gate=new FixedResponseGateProvider([1,2].map(n=>JSON.stringify({response_kind:'understanding_confirmation',matched_gate_id:`GT-0${n}`,verdict:'pass',reasoning_location:'unknown',grounding_refs:[]})),'visual-quality');
 const presenter:PresenterGeneratorPort={provider:'visual-quality-test',modelId:'visual-quality-test',pin:{provider:'visual-quality-test',model_id:'visual-quality-test',prompt_version:promptVersion,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION},async generatePresentationDraft(r){
  const p=r.userPayload as any;let items:PresentationDraftV2['items'];
  if(p.visual.requirements.some((x:any)=>x.binding_ref===(targetBeat===3?'VB-105':'VB-104'))){seen.push({request_id:r.request_id,payload:structuredClone((({repair_feedback,...base})=>base)(p))});items=await reply(seen.length,p);}
  else items=legalItems(p);
  return {draft:{schema:'ai_teaching_presentation_draft/v2',request_id:r.request_id,items},latencyMs:0};}};
 const app=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:new TutorTaskBindingResolver(root,()=>loaded),model:f6Model(gate,'visual-quality'),presenter});
 const started=app().start({task_id:'goldenMinhangFold2020',student_id:'quality-test',client_instance_id:'CI-quality-test',client_request_id:`quality-start-${++serial}`,sessionIdAllocator:()=>`TS-99776${String(serial).padStart(4,'0')}`});if(started.kind==='payload-drift')throw Error('drift');const s=started.orchestrator;
 for(let beat=1;beat<targetBeat;beat++){await settle(s);await s.submitStudentInput({input:{kind:'utterance',channel:'mainline',text:'这一步关系我听懂了。'},execution_owner:s.visualLifecycle!.presentation_execution_owner,client_request_id:`quality-confirm-${++serial}`},{expectedRevision:s.revision});await settle(s,false);}
 expect(s.rebuildRuntimeState().teaching_cursor.beat_id).toBe(`BT-0${targetBeat}`);expect(seen).toHaveLength(0);
 const diagnostics:unknown[]=[];
 const engine=s as unknown as {buildAndRunGeneration(request:unknown,feedback?:unknown):Promise<unknown>};const build=engine.buildAndRunGeneration.bind(s);
 engine.buildAndRunGeneration=async (request,feedback)=>{try{return await build(request,feedback);}catch(error){if(error instanceof VisualObligationQualityError)diagnostics.push(structuredClone(error.issues));throw error;}};
 return {s,app,seen,diagnostics,before:s.events.length};
}
type Session=ReturnType<TutorRuntimeApplicationV7['restore']>;
async function settle(s:Session,generate=true){for(let n=0;n<80;n++){if(s.hasPendingGeneration()){if(!generate)return;expect((await s.drivePendingGeneration()).kind).toBe('committed');}const c=s.rebuildRuntimeState().presentation_cursor;if(c.status!=='awaiting_browser')return;s.reportPresentationOutcome({sequence_id:c.sequence_id,ordinal:c.ordinal,action_id:c.action_id,outcome:'presented',execution_owner:s.visualLifecycle!.presentation_execution_owner,expected_revision:s.revision,client_request_id:`quality-outcome-${++serial}`});}throw Error('settle exceeded');}
const absent=(events:any[])=>expect(events.filter(e=>['presentation_sequence_planned','presentation_action_applied','presentation_action_delivered','gate_evaluated'].includes(e.event_type))).toEqual([]);
describe('H06 visual obligation bounded repair',()=>{
 it('recorded ten-item missing VB105 retries with the same frozen input and commits only the corrected model candidate',async()=>{
  const f=await setup(n=>n===1?structuredClone(original):fixed());const out=await f.s.drivePendingGeneration();expect(out.kind).toBe('committed');expect(f.seen).toHaveLength(2);expect(f.seen[1]).toEqual(f.seen[0]);expect(f.diagnostics).toHaveLength(1);expect(f.diagnostics[0]).toEqual(expect.arrayContaining([{binding_ref:'VB-105',code:'missing-form',form:'ratio-label'},{binding_ref:'VB-105',code:'missing-focus',speech_ordinal:0,draft_item_index:0}]));
  const delta=f.s.events.slice(f.before);expect(delta.filter(e=>String(e.event_type)==='presentation_generation_retry_scheduled')).toHaveLength(1);expect(delta.filter(e=>e.event_type==='presentation_sequence_planned')).toHaveLength(1);
  const attempts=delta.filter(e=>String(e.event_type)==='presentation_generation_attempt_started').map(e=>e.payload as any);expect(attempts.map(a=>a.attempt)).toEqual([1,2]);expect(attempts[1].epoch).toBeGreaterThan(attempts[0].epoch);expect(attempts[1].context).toEqual(attempts[0].context);expect(attempts[1].input_digest).toBe(attempts[0].input_digest);
  const eventCount=f.s.events.length;const restored=f.app().restore(f.s.sessionId);expect(restored.events).toHaveLength(eventCount);expect(f.seen).toHaveLength(2);expect(restored.assertReplayParity().equal).toBe(true);
 },15000);

 it('late visual introduction stays a bounded quality repair under the v14 pin (no lowering)',async()=>{
  const f=await setup(n=>{const items=fixed();if(n===1)items.unshift({type:'speech',text:'这里先看比例标注。',basis_refs:['VB-105']});return items;},3,V14_VISUAL_PRESENTER_PROMPT_VERSION);
  expect((await f.s.drivePendingGeneration()).kind).toBe('committed');expect(f.seen).toHaveLength(2);expect(f.seen[1]).toEqual(f.seen[0]);
  expect(f.s.events.filter(e=>String(e.event_type)==='presentation_generation_retry_scheduled')).toHaveLength(1);
 },15000);
 it('v15 bounded lowering repairs adjacent late visual in one model call without quality retry',async()=>{
  const f=await setup(()=>{const items=fixed();items.unshift({type:'speech',text:'这里先看比例标注。',basis_refs:['VB-105']});return items;});
  expect((await f.s.drivePendingGeneration()).kind).toBe('committed');expect(f.seen).toHaveLength(1);
  expect(f.s.events.slice(f.before).filter(e=>String(e.event_type)==='presentation_generation_retry_scheduled')).toEqual([]);
  const row=db.prepare('SELECT companion_json FROM tutor_generation_companions WHERE session_id=? ORDER BY planned_event_sequence DESC LIMIT 1').get(f.s.sessionId) as any;
  expect(JSON.parse(row.companion_json).moves).toEqual([{speech_original_index:0,visual_original_indices:[1,2],reason:'adjacent-unique-visual-block'}]);
 },15000);
 it.each(['missing-pair','missing-pulse'] as const)('%s uses the same bounded quality path',async fault=>{
  const f=await setup((n,p)=>{const items=legalItems(p);if(n!==1)return items;return items.filter(item=>!(fault==='missing-pair'&&item.type==='tool_intent'&&item.tool==='geometry.emphasize'&&item.args?.params?.pair_index===2)).map(item=>fault==='missing-pulse'&&item.type==='tool_intent'&&item.tool==='geometry.emphasize'?{...item,args:{...item.args,params:{...item.args?.params,mode:'steady'}}}:item);},2);
  expect((await f.s.drivePendingGeneration()).kind).toBe('committed');expect(f.seen).toHaveLength(2);expect(f.seen[1]).toEqual(f.seen[0]);
 },15000);
 it('three omitted candidates exhaust the original budget without partial commit or reset on restore',async()=>{
  const f=await setup(()=>structuredClone(original));expect(await f.s.drivePendingGeneration()).toMatchObject({kind:'failed',errorClass:'RETRY_EXHAUSTED'});expect(f.seen).toHaveLength(3);absent(f.s.events.slice(f.before));const restored=f.app().restore(f.s.sessionId);expect(await restored.drivePendingGeneration()).toMatchObject({kind:'superseded'});expect(f.seen).toHaveLength(3);
 },15000);
 it.each(['basis','binding','params','permission','dependency'] as const)('missing form plus illegal %s remains one terminal call',async fault=>{
  const f=await setup(()=>{const items=structuredClone(original);if(fault==='basis')items.push({type:'speech',text:'非法依据',basis_refs:['FN-999']});if(fault==='binding')items.push(annotate('VB-999','length-label'));if(fault==='params')items.push(annotate('VB-106','triangle-outline'));return items;});
  if(fault==='permission'||fault==='dependency'){const real=preflightModule.preflightPresentationSequence;vi.spyOn(preflightModule,'preflightPresentationSequence').mockImplementation(args=>{if(args.plan.generation?.request_id!==f.seen[0]?.request_id)return real(args);const fold=structuredClone(args.fold);if(fault==='permission')fold.state.geometry.interaction_mode='locked';else {const plan=structuredClone(args.plan);const board=plan.explanation_fragments?.[0];if(board)board.basis_refs=['line-unconstructed'];return real({...args,fold,plan});}return real({...args,fold});});}
  const out=await f.s.drivePendingGeneration();expect(out.kind).toBe('failed');expect(f.seen).toHaveLength(1);expect(f.diagnostics).toEqual([]);expect(f.s.events.slice(f.before).some(e=>String(e.event_type)==='presentation_generation_retry_scheduled')).toBe(false);absent(f.s.events.slice(f.before));
 },15000);
 it('cancel while the repair call is in flight fences its late corrected candidate',async()=>{
  let release!:()=>void,entered!:()=>void;const hold=new Promise<void>(r=>release=r),called=new Promise<void>(r=>entered=r);
  const f=await setup(async n=>{if(n===1)return structuredClone(original);entered();await hold;return fixed();});const drive=f.s.drivePendingGeneration();await called;
  await f.s.submitStudentInput({input:{kind:'control',command:'barge_in'},execution_owner:f.s.visualLifecycle!.presentation_execution_owner,client_request_id:`quality-cancel-${++serial}`},{expectedRevision:f.s.revision});const count=f.s.events.length;release();expect(await drive).toMatchObject({kind:'superseded'});expect(f.s.events).toHaveLength(count);expect(f.seen).toHaveLength(2);expect(f.s.events.slice(f.before).filter(e=>e.event_type==='presentation_sequence_planned').every(e=>(e.payload as any).purpose==='visual-reconcile')).toBe(true);
 },15000);
});
