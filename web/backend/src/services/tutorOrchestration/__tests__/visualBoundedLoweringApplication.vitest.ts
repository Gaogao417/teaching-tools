/** H06: recorded real draft, scripted replies only; real pinned visual importer/kernel/preflight. */
import {describe,it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {TutorRuntimeApplicationV7} from '../TutorRuntimeApplicationV7';
import {TutorTaskBindingResolver} from '../TutorTaskBindingResolver';
import {importVisualReviewCandidate} from '../../planBuild/visual/ImportVisualReviewCandidate';
import {FixedResponseGateProvider} from '../../tutorNavigator/ModelGateAdjudicatorV5';
import {f6Model,realCanonicalRoot} from './f6Support';
import {VISUAL_PRESENTER_PROMPT_VERSION} from '../presentationGeneration/PresenterPrompts';
import {VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION} from '../presentationGeneration/VisualPresentationTools';
import type {PresenterGeneratorPort,PresentationDraftV2} from '../presentationGeneration/GeneratorPort';
import {VisualObligationQualityError} from '../presentationGeneration/IntentCompiler';
import * as preflightModule from '../presentationGeneration/SequencePreflight';
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
async function setup(reply:(call:number,payload:any)=>Promise<PresentationDraftV2['items']>|PresentationDraftV2['items'],targetBeat=3,promptVersion=VISUAL_PRESENTER_PROMPT_VERSION){
 const feedbacks:unknown[]=[];
 const seen:Array<{request_id:string;payload:unknown}>=[];
 const gate=new FixedResponseGateProvider([1,2,3].map(n=>JSON.stringify({response_kind:'understanding_confirmation',matched_gate_id:`GT-0${n}`,verdict:'pass',reasoning_location:'unknown',grounding_refs:[]})),'visual-quality');
 const presenter:PresenterGeneratorPort={provider:'visual-quality-test',modelId:'visual-quality-test',pin:{provider:'visual-quality-test',model_id:'visual-quality-test',prompt_version:promptVersion,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION},async generatePresentationDraft(r){
  const p=r.userPayload as any;let items:PresentationDraftV2['items'];
  if(targetBeat===4 ? p.required_board_bindings?.some((x:any)=>x.binding_ref==='VB-09') : p.visual.requirements.some((x:any)=>x.binding_ref===(targetBeat===1?'VB-101':targetBeat===3?'VB-105':'VB-104'))){seen.push({request_id:r.request_id,payload:structuredClone((({repair_feedback,...base})=>base)(p))});feedbacks.push(structuredClone(p.repair_feedback));items=await reply(seen.length,p);}
  else items=legalItems(p);
  return {draft:{schema:'ai_teaching_presentation_draft/v2',request_id:r.request_id,items},latencyMs:0};}};
 const app=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:new TutorTaskBindingResolver(root,()=>loaded),model:f6Model(gate,'visual-quality'),presenter});
 const started=app().start({task_id:'goldenMinhangFold2020',student_id:'quality-test',client_instance_id:'CI-quality-test',client_request_id:`lowering-start-${++serial}`,sessionIdAllocator:()=>`TS-997715${String(serial).padStart(4,'0')}`});if(started.kind==='payload-drift')throw Error('drift');const s=started.orchestrator;
 for(let beat=1;beat<targetBeat;beat++){await settle(s);await s.submitStudentInput({input:{kind:'utterance',channel:'mainline',text:'这一步关系我听懂了。'},execution_owner:s.visualLifecycle!.presentation_execution_owner,client_request_id:`quality-confirm-${++serial}`},{expectedRevision:s.revision});await settle(s,false);}
 expect(s.rebuildRuntimeState().teaching_cursor.beat_id).toBe(`BT-0${targetBeat}`);expect(seen).toHaveLength(0);
 const diagnostics:unknown[]=[];
 const engine=s as unknown as {buildAndRunGeneration(request:unknown,feedback?:unknown):Promise<unknown>};const build=engine.buildAndRunGeneration.bind(s);
 engine.buildAndRunGeneration=async (request,feedback)=>{try{return await build(request,feedback);}catch(error){if(error instanceof VisualObligationQualityError)diagnostics.push(structuredClone(error.issues));throw error;}};
 return {s,app,seen,feedbacks,diagnostics,before:s.events.length};
}
type Session=ReturnType<TutorRuntimeApplicationV7['restore']>;
async function settle(s:Session,generate=true){for(let n=0;n<80;n++){if(s.hasPendingGeneration()){if(!generate)return;expect((await s.drivePendingGeneration()).kind).toBe('committed');}const c=s.rebuildRuntimeState().presentation_cursor;if(c.status!=='awaiting_browser')return;s.reportPresentationOutcome({sequence_id:c.sequence_id,ordinal:c.ordinal,action_id:c.action_id,outcome:'presented',execution_owner:s.visualLifecycle!.presentation_execution_owner,expected_revision:s.revision,client_request_id:`quality-outcome-${++serial}`});}throw Error('settle exceeded');}
const absent=(events:any[])=>expect(events.filter(e=>['presentation_sequence_planned','presentation_action_applied','presentation_action_delivered','gate_evaluated'].includes(e.event_type))).toEqual([]);


import {db} from '../../../db/database';
import {V14_VISUAL_PRESENTER_PROMPT_VERSION} from '../presentationGeneration/PresenterPrompts';
import {verifyGenerationCompanions} from '../../tutorSession/GenerationCompanionStore';
const recorded=JSON.parse(readFileSync(resolve('src/services/tutorOrchestration/presentationGeneration/__tests__/fixtures/v13Bt02AdjacentVisual.json'),'utf8')).items as PresentationDraftV2['items'];
it('real v13 recorded first draft lowers once, commits immutable companion, resumes without model and exposes no audit in result',async()=>{
 const f=await setup(()=>structuredClone(recorded),2);const out=await f.s.drivePendingGeneration();expect(out.kind).toBe('committed');expect(f.seen).toHaveLength(1);
 const planned=f.s.events.slice(f.before).find(e=>e.event_type==='presentation_sequence_planned')!.payload as any;
 const row=db.prepare('SELECT * FROM tutor_generation_companions WHERE session_id=? AND sequence_id=?').get(f.s.sessionId,planned.sequence_id) as any;const audit=JSON.parse(row.companion_json);
 expect(audit.original_draft.items).toEqual(recorded);expect(audit.moves).toEqual([{speech_original_index:7,visual_original_indices:[8,9],reason:'adjacent-unique-visual-block'}]);expect(audit.item_action_mapping[9]).toEqual({original_item_index:7,final_item_index:9,action_ordinals:[9]});expect(planned.actions[9].kind).toBe('voice');expect(JSON.stringify(out)).not.toContain('original_draft');expect(JSON.stringify(f.s.events)).not.toContain('source_indices');
 const resumed=f.app().restore(f.s.sessionId);expect(resumed.events).toEqual(f.s.events);expect(f.seen).toHaveLength(1);f.s.rebuildRuntimeState();
});
it('old v14 pin retains rejection and never normalizes recorded draft',async()=>{const f=await setup(()=>structuredClone(recorded),2,V14_VISUAL_PRESENTER_PROMPT_VERSION);expect((await f.s.drivePendingGeneration()).kind).toBe('failed');expect(f.seen).toHaveLength(3);expect(f.s.events.slice(f.before).some(e=>e.event_type==='presentation_sequence_planned')).toBe(false);});
it('invalid generic similarity focus wins before lowering and gets no automatic retry',async()=>{const bad=structuredClone(recorded);delete bad[9].args!.params!.pair_index;const f=await setup(()=>bad,2);expect((await f.s.drivePendingGeneration()).kind).toBe('failed');expect(f.seen).toHaveLength(1);expect(f.s.events.slice(f.before).some(e=>e.event_type==='presentation_sequence_planned')).toBe(false);});
it('companion insertion failure rolls planned batch back before online cache advances',async()=>{
 const f=await setup(()=>structuredClone(recorded),2);let before:any;const kernel=(f.s as any).navigator.kernel as any;const append=kernel.append.bind(kernel);vi.spyOn(kernel,'append').mockImplementation((revision:any,events:any,companion:any)=>{if(events.some((e:any)=>e.event_type==='presentation_sequence_planned'))before={revision:f.s.revision,events:structuredClone(f.s.events),state:structuredClone(kernel.state)};return append(revision,events,companion);});
 db.exec(`CREATE TRIGGER reject_lowering_companion BEFORE INSERT ON tutor_generation_companions WHEN NEW.session_id='${f.s.sessionId}' BEGIN SELECT RAISE(ABORT,'TEST_COMPANION_INSERT_FAILURE'); END`);
 try{await expect(f.s.drivePendingGeneration()).rejects.toThrow('TEST_COMPANION_INSERT_FAILURE');expect(f.s.revision).toBe(before.revision);expect(f.s.events).toEqual(before.events);expect(kernel.state).toEqual(before.state);expect(f.seen).toHaveLength(1);expect(f.s.events.slice(f.before).some(e=>e.event_type==='presentation_sequence_planned')).toBe(false);}finally{db.exec('DROP TRIGGER reject_lowering_companion');}
});
it('missing committed companion fails restart instead of regenerating or silently reconstructing audit',async()=>{const f=await setup(()=>structuredClone(recorded),2);await f.s.drivePendingGeneration();const rows=db.prepare('SELECT sequence_id FROM tutor_generation_companions WHERE session_id=? ORDER BY planned_event_sequence DESC').all(f.s.sessionId) as any[];db.prepare('DELETE FROM tutor_generation_companions WHERE session_id=? AND sequence_id=?').run(f.s.sessionId,rows[0].sequence_id);expect(()=>f.app().restore(f.s.sessionId)).toThrow('GENERATION_COMPANION_CORRUPT');expect(f.seen).toHaveLength(1);});
it('lost commit acknowledgement verifies existing companion and does not regenerate',async()=>{const f=await setup(()=>structuredClone(recorded),2);const kernel=(f.s as any).navigator.kernel,append=kernel.append.bind(kernel);let injected=false;vi.spyOn(kernel,'append').mockImplementation((r:any,events:any,audit:any)=>{const out=append(r,events,audit);if(!injected&&events.some((e:any)=>e.event_type==='presentation_sequence_planned')){injected=true;throw Error('TEST_LOST_ACK');}return out;});expect((await f.s.drivePendingGeneration()).kind).toBe('committed');expect(injected).toBe(true);expect(f.seen).toHaveLength(1);expect(f.s.events.slice(f.before).filter(e=>e.event_type==='presentation_sequence_planned')).toHaveLength(1);f.s.rebuildRuntimeState();});
it.each(['final_actions_digest','planned_event_sequence'])('reopen rejects corrupted companion %s',async field=>{const f=await setup(()=>structuredClone(recorded),2);await f.s.drivePendingGeneration();const row=db.prepare('SELECT * FROM tutor_generation_companions WHERE session_id=? ORDER BY planned_event_sequence DESC LIMIT 1').get(f.s.sessionId) as any;db.prepare('DELETE FROM tutor_generation_companions WHERE session_id=? AND sequence_id=?').run(f.s.sessionId,row.sequence_id);if(field==='final_actions_digest'){const body=JSON.parse(row.companion_json);body.final_actions_digest='corrupt';row.companion_json=JSON.stringify(body);}else row.planned_event_sequence=1;const names=Object.keys(row);db.prepare(`INSERT INTO tutor_generation_companions(${names.join(',')}) VALUES(${names.map(()=>'?').join(',')})`).run(...names.map(n=>row[n]));expect(()=>f.app().restore(f.s.sessionId)).toThrow('GENERATION_COMPANION_CORRUPT');expect(f.seen).toHaveLength(1);});

import {visualHash} from '../../tutorSession/WorkspaceVisualReducer';
function rewriteAudit(sessionId:string,edit:(body:any)=>void){const row=db.prepare('SELECT * FROM tutor_generation_companions WHERE session_id=? ORDER BY planned_event_sequence DESC LIMIT 1').get(sessionId) as any;const body=JSON.parse(row.companion_json);edit(body);body.original_digest=visualHash(body.original_draft);body.lowered_digest=visualHash(body.lowered_draft);row.companion_json=JSON.stringify(body);db.prepare('DELETE FROM tutor_generation_companions WHERE session_id=? AND sequence_id=?').run(sessionId,row.sequence_id);const names=Object.keys(row);db.prepare(`INSERT INTO tutor_generation_companions(${names.join(',')}) VALUES(${names.map(()=>'?').join(',')})`).run(...names.map(n=>row[n]));}
it.each(['speech','focus','annotation'])('rehashed raw and lowered %s cannot disagree with committed action',async kind=>{const f=await setup(()=>structuredClone(recorded),2);await f.s.drivePendingGeneration();const before=structuredClone(f.s.events);rewriteAudit(f.s.sessionId,body=>{for(const draft of [body.original_draft,body.lowered_draft]){const item=draft.items.find((i:any)=>kind==='speech'?i.type==='speech':i.tool===(kind==='focus'?'geometry.emphasize':'geometry.annotate'));if(kind==='speech')item.text='另一段未曾提交的正文。';else if(kind==='focus')item.args.params.mode='steady';else item.args.params.lifetime='presentation-group';}});expect(()=>f.app().restore(f.s.sessionId)).toThrow('GENERATION_COMPANION_CORRUPT');expect(f.s.events).toEqual(before);expect(f.seen).toHaveLength(1);});
it('duplicate approved board item has zero actions and exact later item mapping survives new kernel',async()=>{const draft=structuredClone(recorded);const j=draft.findIndex(i=>i.tool==='board.explain');expect(j).toBeGreaterThan(-1);draft.splice(j+1,0,structuredClone(draft[j]));const f=await setup(()=>draft,2);expect((await f.s.drivePendingGeneration()).kind).toBe('committed');const row=db.prepare('SELECT companion_json FROM tutor_generation_companions WHERE session_id=? ORDER BY planned_event_sequence DESC LIMIT 1').get(f.s.sessionId) as any;const b=JSON.parse(row.companion_json);const omitted=b.item_action_mapping.filter((m:any)=>!m.action_ordinals.length);expect(omitted).toHaveLength(1);expect(b.lowered_draft.items[omitted[0].final_item_index].tool).toBe('board.explain');expect(b.item_action_mapping.at(-1).action_ordinals[0]).toBe(b.lowered_draft.items.length-2);expect(f.app().restore(f.s.sessionId).events).toEqual(f.s.events);expect(f.seen).toHaveLength(1);});
it('cancel after successful lowering but before submission prevents teaching planned and companion',async()=>{const f=await setup(()=>structuredClone(recorded),2);const engine=f.s as any,build=engine.buildAndRunGeneration.bind(engine);let release!:()=>void,ready!:()=>void;const waiting=new Promise<void>(r=>ready=r),barrier=new Promise<void>(r=>release=r);engine.buildAndRunGeneration=async(...args:any[])=>{const c=await build(...args);expect(c.internalCompanion.moves).toHaveLength(1);ready();await barrier;return c;};const drive=f.s.drivePendingGeneration();await waiting;await f.s.submitStudentInput({input:{kind:'control',command:'barge_in'},execution_owner:f.s.visualLifecycle!.presentation_execution_owner,client_request_id:'cancel-lowered'},{expectedRevision:f.s.revision});const cut=f.s.events.length;release();expect((await drive).kind).toBe('superseded');expect(f.s.events.slice(cut).filter(e=>e.event_type==='presentation_sequence_planned')).toEqual([]);expect(db.prepare('SELECT 1 FROM tutor_generation_companions WHERE session_id=? AND request_id=?').get(f.s.sessionId,f.seen[0].request_id)).toBeUndefined();expect(f.seen).toHaveLength(1);});
it.each(['ambiguous','boundary','multiple-focus','missing-pair','missing-board'])('whole candidate %s remains rejected with no teaching side effects',async kind=>{const draft=structuredClone(recorded);if(kind==='ambiguous')draft[7].basis_refs=['FN-05','IF-01'];if(kind==='boundary')draft.splice(8,0,{type:'speech',text:'先停一下。',basis_refs:[]});if(kind==='multiple-focus')draft.splice(10,0,structuredClone(draft[9]));if(kind==='missing-pair'){const index=draft.findIndex(i=>i.tool==='geometry.emphasize'&&i.args?.params?.pair_index===2);draft.splice(index,1);}if(kind==='missing-board')for(let j=draft.length-1;j>=0;j--)if(draft[j].tool==='board.explain')draft.splice(j,1);const f=await setup(()=>draft,2);expect((await f.s.drivePendingGeneration()).kind).toBe('failed');expect(f.s.events.slice(f.before).filter(e=>['presentation_sequence_planned','presentation_action_applied','presentation_action_delivered','gate_evaluated'].includes(e.event_type))).toEqual([]);expect(db.prepare('SELECT 1 FROM tutor_generation_companions WHERE session_id=? AND request_id=?').get(f.s.sessionId,f.seen[0].request_id)).toBeUndefined();expect(f.seen.length).toBeLessThanOrEqual(3);expect(f.s.rebuildRuntimeState().teaching_cursor.beat_id).toBe('BT-02');});
it('v14 recorded speech/focus mismatch with no later legal block stays rejected without borrowing history',async()=>{const draft=structuredClone(recorded);draft[9].args!.binding_ref='VB-103';delete draft[9].args!.params!.pair_index;const f=await setup(()=>draft,2);expect((await f.s.drivePendingGeneration()).kind).toBe('failed');expect(f.seen).toHaveLength(3);expect(f.s.events.slice(f.before).filter(e=>['presentation_sequence_planned','presentation_action_applied','presentation_action_delivered','gate_evaluated'].includes(e.event_type))).toEqual([]);expect(db.prepare('SELECT 1 FROM tutor_generation_companions WHERE session_id=? AND request_id=?').get(f.s.sessionId,f.seen[0].request_id)).toBeUndefined();expect((f.diagnostics as any[]).flat().some((x:any)=>x.binding_ref==='VB-104'&&(x.code==='missing-pair'||x.code==='missing-focus'||x.code==='late-visual'))).toBe(true);expect(f.s.rebuildRuntimeState().teaching_cursor.beat_id).toBe('BT-02');},30000);
it('whole draft with two independent movable candidates preserves original order and still fails whole-segment validation',async()=>{const draft=structuredClone(recorded);draft.splice(10,0,{...structuredClone(draft[2]),text:'我们再看一次第一对角。'},structuredClone(draft[0]),structuredClone(draft[1]));const f=await setup(()=>draft,2);expect((await f.s.drivePendingGeneration()).kind).toBe('failed');expect(f.seen).toHaveLength(3);expect(f.s.events.slice(f.before).filter(e=>e.event_type==='presentation_sequence_planned')).toEqual([]);expect(db.prepare('SELECT 1 FROM tutor_generation_companions WHERE session_id=? AND request_id=?').get(f.s.sessionId,f.seen[0].request_id)).toBeUndefined();const flat=(f.diagnostics as any[]).flat();expect(flat.some((x:any)=>x.draft_item_index===7&&(x.code==='late-visual'||x.code==='missing-focus'))).toBe(true);expect(flat.some((x:any)=>x.draft_item_index===10&&(x.code==='late-visual'||x.code==='missing-focus'))).toBe(true);expect(f.s.rebuildRuntimeState().teaching_cursor.beat_id).toBe('BT-02');},30000);

// T-10: rehash both source copies, retaining committed Actions.
it.each(['speech-refs','visual-group','board-content','board-binding'])('rehashed %s source is rejected against unchanged Actions',async kind=>{
 const f=await setup(()=>structuredClone(recorded),2);expect((await f.s.drivePendingGeneration()).kind).toBe('committed');const before=structuredClone(f.s.events);
 rewriteAudit(f.s.sessionId,body=>{for(const draft of [body.original_draft,body.lowered_draft]){
  if(kind==='speech-refs')draft.items.find((i:any)=>i.type==='speech').basis_refs=['FN-06'];
  if(kind==='visual-group')draft.items.find((i:any)=>i.tool==='geometry.emphasize').args.params.group='other';
  if(kind==='board-content')draft.items.find((i:any)=>i.tool==='board.explain').args.params.note_kind='explanation_text';
  if(kind==='board-binding')draft.items.find((i:any)=>i.tool==='board.explain').args.binding_ref='VB-06';
 }});
 expect(()=>f.app().restore(f.s.sessionId)).toThrow(/GENERATION_COMPANION_CORRUPT: source\/action/);
 expect(f.s.events).toEqual(before);expect(f.seen).toHaveLength(1);
 expect(db.prepare('SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id=?').get(f.s.sessionId)).toEqual({n:before.length});
});
it('rehashed construct target is rejected against unchanged Actions',async()=>{
 const f=await setup((_call,p)=>[
  ...p.tools.find((t:any)=>t.tool==='geometry.construct').bindings.map((b:any)=>({type:'tool_intent' as const,tool:'geometry.construct',args:{binding_ref:b.binding_ref,params:{template_id:b.allowed_template_ids[0]}}})),...legalItems(p),
 ],4);
 expect((await f.s.drivePendingGeneration()).kind).toBe('committed');const before=structuredClone(f.s.events);
 rewriteAudit(f.s.sessionId,body=>{for(const draft of [body.original_draft,body.lowered_draft]){const constructs=draft.items.filter((i:any)=>i.tool==='geometry.construct');expect(constructs.length).toBeGreaterThan(1);constructs[0].args.params.template_id=constructs[1].args.params.template_id;}});
 expect(()=>f.app().restore(f.s.sessionId)).toThrow(/GENERATION_COMPANION_CORRUPT: source\/action construct target/);
 expect(f.s.events).toEqual(before);expect(f.seen).toHaveLength(1);
},30000);
// T-13 uses the actual application/kernel/SQLite path, no replacement verifier.
it.each([false,true])('v15 first generation without companion cannot commit (forged refs=%s)',async forgedRefs=>{
 const f=await setup(()=>structuredClone(recorded),2);const engine=f.s as any,append=engine.appendViaKernel.bind(engine);let injected=false;let before:any;
 vi.spyOn(engine,'appendViaKernel').mockImplementation((revision:any,events:any,companion:any)=>{
  if(!events.some((e:any)=>e.event_type==='presentation_sequence_planned'))return append(revision,events,companion);
  injected=true;before={revision:f.s.revision,events:structuredClone(f.s.events),state:structuredClone(engine.navigator.kernel.state)};
  const forged=structuredClone(events);const plan=forged.find((e:any)=>e.event_type==='presentation_sequence_planned');
  if(forgedRefs){const fragment=plan.payload.explanation_fragments[0];
   plan.payload.existing_fragment_refs=[{fragment_id:fragment.fragment_id,source_sequence_id:'PS-0001',content_hash:visualHash(fragment)}];
   delete plan.payload.explanation_fragments;}
  return append(revision,forged,undefined);
 });
 await expect(f.s.drivePendingGeneration()).rejects.toThrow(forgedRefs?/missing or corrupt existing fragment/:/v15 original generation requires companion/);expect(injected).toBe(true);
 expect(f.s.revision).toBe(before.revision);expect(f.s.events).toEqual(before.events);expect(engine.navigator.kernel.state).toEqual(before.state);
 expect(f.s.events.slice(f.before).filter(e=>e.event_type==='presentation_sequence_planned')).toEqual([]);
 expect(db.prepare('SELECT 1 FROM tutor_generation_companions WHERE session_id=? AND request_id=?').get(f.s.sessionId,f.seen[0].request_id)).toBeUndefined();expect(f.seen).toHaveLength(1);
});
it('v15 failed board permits actual V10 cleanup recovery without a second companion or generation',async()=>{
 const f=await setup(()=>structuredClone(recorded),2);expect((await f.s.drivePendingGeneration()).kind).toBe('committed');
 const originalPlan=f.s.events.filter(e=>e.event_type==='presentation_sequence_planned').at(-1)!.payload as any;
 for(let n=0;n<30;n++){
  const c=f.s.rebuildRuntimeState().presentation_cursor;if(c.status!=='awaiting_browser')throw Error('expected delivery');const action=originalPlan.actions[c.ordinal];const failed=action.workspace_action?.capability==='board.explain';
  f.s.reportPresentationOutcome({...c,outcome:failed?'failed':'presented',...(failed?{failure_class:'internal_error' as const,message:'injected board error'}:{}),execution_owner:f.s.visualLifecycle!.presentation_execution_owner,expected_revision:f.s.revision,client_request_id:`v15-recovery-${++serial}`});if(failed)break;
 }
 expect(f.s.rebuildRuntimeState().presentation_cursor.status).toBe('failed');
 const beforeCount=(db.prepare('SELECT COUNT(*) AS n FROM tutor_generation_companions WHERE session_id=?').get(f.s.sessionId) as any).n;
 const resumed=f.app().restore(f.s.sessionId);
 await resumed.submitStudentInput({input:{kind:'control',command:'retry_recovery'},execution_owner:resumed.visualLifecycle!.presentation_execution_owner,client_request_id:`v15-retry-${++serial}`},{expectedRevision:resumed.revision});await settle(resumed,false);
 const replacement=resumed.events.filter(e=>e.event_type==='presentation_sequence_planned').map(e=>e.payload as any).find(p=>p.sequence_id!==originalPlan.sequence_id&&p.purpose==='visual-reconcile');
 expect(replacement).toBeDefined();expect(replacement.generation).toBeUndefined();expect(resumed.visualLifecycle!.visual_barrier).toBeNull();
 expect((db.prepare('SELECT COUNT(*) AS n FROM tutor_generation_companions WHERE session_id=?').get(f.s.sessionId) as any).n).toBe(beforeCount);
 expect(f.app().restore(f.s.sessionId).events).toEqual(resumed.events);expect(f.seen).toHaveLength(1);
},30000);
