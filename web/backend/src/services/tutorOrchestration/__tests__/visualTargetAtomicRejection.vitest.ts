/** H01: test-only corrupted candidate input to real preflight/application/SQLite.
 * Scripted model and synthetic setup outcomes; never browser/provider evidence. */
import {afterEach,expect,it,vi} from 'vitest';
import {resolve} from 'node:path';
import {db} from '../../../db/database';
import {TutorRuntimeApplicationV7} from '../TutorRuntimeApplicationV7';
import {TutorTaskBindingResolver} from '../TutorTaskBindingResolver';
import {importVisualReviewCandidate} from '../../planBuild/visual/ImportVisualReviewCandidate';
import {FixedResponseGateProvider} from '../../tutorNavigator/ModelGateAdjudicatorV5';
import {f6Model,realCanonicalRoot} from './f6Support';
import {VISUAL_PRESENTER_PROMPT_VERSION} from '../presentationGeneration/PresenterPrompts';
import {VISUAL_CONTEXT_BUILDER_VERSION,VISUAL_TOOL_CATALOG_VERSION} from '../presentationGeneration/VisualPresentationTools';
import type {PresenterGeneratorPort,PresentationDraftV2} from '../presentationGeneration/GeneratorPort';
import * as compiler from '../presentationGeneration/IntentCompiler';
import {SequencePreflightError} from '../presentationGeneration/SequencePreflight';
const root=realCanonicalRoot();
const loaded=importVisualReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/geometry-visual/candidate-v14')});
if(!loaded.ok)throw Error(loaded.errors.join(';'));
let serial=0;
type Session=ReturnType<TutorRuntimeApplicationV7['restore']>;
afterEach(()=>vi.restoreAllMocks());
async function settle(s:Session,generate=true){for(let n=0;n<80;n++){
 if(s.hasPendingGeneration()){if(!generate)return;expect((await s.drivePendingGeneration()).kind).toBe('committed');}
 const c=s.rebuildRuntimeState().presentation_cursor;if(c.status!=='awaiting_browser')return;
 s.reportPresentationOutcome({sequence_id:c.sequence_id,ordinal:c.ordinal,action_id:c.action_id,outcome:'presented',execution_owner:s.visualLifecycle!.presentation_execution_owner,expected_revision:s.revision,client_request_id:`h01-setup-${++serial}`});
}throw Error('setup settle limit');}
const rows=(sid:string)=>db.prepare('SELECT sequence,event_type,payload_json FROM tutor_session_events WHERE session_id=? ORDER BY sequence').all(sid) as Array<{sequence:number;event_type:string;payload_json:string}>;
it.each(['reversed-similarity-order','forged-pair-targets'] as const)('H01 %s: actual preflight rejects the complete candidate with zero planned or Workspace writes',async fault=>{
 let calls=0;
 const presenter:PresenterGeneratorPort={provider:'h01-scripted',modelId:'h01-scripted',pin:{provider:'h01-scripted',model_id:'h01-scripted',prompt_version:VISUAL_PRESENTER_PROMPT_VERSION,context_builder_version:VISUAL_CONTEXT_BUILDER_VERSION,tool_catalog_version:VISUAL_TOOL_CATALOG_VERSION},async generatePresentationDraft(r){
  calls++;const p=r.userPayload as any,items:PresentationDraftV2['items']=[];
  for(const req of p.visual.requirements){for(const form of req.forms)items.push({type:'tool_intent',tool:'geometry.annotate',args:{binding_ref:req.binding_ref,params:{form,lifetime:'teaching-scope',group:'h01'}}});for(const pair_index of req.required_pair_indices)items.push({type:'tool_intent',tool:'geometry.emphasize',args:{binding_ref:req.binding_ref,params:{group:'h01',pair_index,mode:'pulse'}}});}
  items.push({type:'speech',text:'看当前批准关系。',basis_refs:[p.allowed_knowledge[0].ref]});
  for(const b of p.required_board_bindings??[])items.push({type:'tool_intent',tool:'board.explain',args:{binding_ref:b.binding_ref,params:{note_kind:'approved_math_note'}}});
  return {latencyMs:0,draft:{schema:'ai_teaching_presentation_draft/v2',request_id:r.request_id,items}};
 }};
 const gate=new FixedResponseGateProvider([JSON.stringify({response_kind:'understanding_confirmation',matched_gate_id:'GT-01',verdict:'pass',reasoning_location:'unknown',grounding_refs:[]})],'h01');
 const app=()=>TutorRuntimeApplicationV7.create({canonicalRoot:root,bindingResolver:new TutorTaskBindingResolver(root,()=>loaded),model:f6Model(gate,'h01'),presenter});
 const start=app().start({task_id:'goldenMinhangFold2020',student_id:'h01',client_instance_id:'CI-h01-atomic',client_request_id:`h01-start-${++serial}`,sessionIdAllocator:()=>`TS-997790${String(serial).padStart(3,'0')}`});if(start.kind==='payload-drift')throw Error('drift');const s=start.orchestrator;
 await settle(s);await s.submitStudentInput({input:{kind:'utterance',channel:'mainline',text:'这一步我理解了。'},execution_owner:s.visualLifecycle!.presentation_execution_owner,client_request_id:`h01-confirm-${++serial}`},{expectedRevision:s.revision});await settle(s,false);
 expect(s.rebuildRuntimeState().teaching_cursor.beat_id).toBe('BT-02');expect(s.hasPendingGeneration()).toBe(true);
 const beforeRows=rows(s.sessionId),beforeWorkspace=structuredClone(s.workspaceFold().state),beforeVisual=structuredClone(s.snapshot().views.studentWorkspaceView),beforeCalls=calls;
 let injected=0;const realCompile=compiler.compilePresentationIntentsForPreflight;
 vi.spyOn(compiler,'compilePresentationIntentsForPreflight').mockImplementation(input=>{
  const result=realCompile(input);expect(result.visualCoverageIssues).toEqual([]);
  const plan=structuredClone(result.plan);const action=plan.actions.find(a=>a.workspace_action?.capability==='geometry.visual.focus');expect(action).toBeDefined();
  const workspace=action!.workspace_action!,command=JSON.parse(workspace.command_payload!);expect(command.binding_ref).toBe('VB-104');
  if(fault==='reversed-similarity-order'){expect(command.resolved_targets.triangles.right).toEqual(['C','B','A']);command.resolved_targets.triangles.right.reverse();}
  else {expect(command.resolved_targets.paired_sides).toHaveLength(2);command.resolved_targets.paired_sides[1].endpoints=['A','D'];}
  workspace.command_payload=JSON.stringify(command);injected++;return {...result,plan};
 });
 const errors:SequencePreflightError[]=[];const engine=s as unknown as {buildAndRunGeneration(r:unknown):Promise<unknown>},realBuild=engine.buildAndRunGeneration.bind(s);
 engine.buildAndRunGeneration=async r=>{try{return await realBuild(r);}catch(e){if(e instanceof SequencePreflightError)errors.push(e);throw e;}};
 expect(await s.drivePendingGeneration()).toMatchObject({kind:'failed',errorClass:'preflight_failed'});expect(injected).toBe(1);expect(calls-beforeCalls).toBe(1);expect(errors).toHaveLength(1);expect(errors[0].reason).toContain('VB-104');
 const delta=rows(s.sessionId).slice(beforeRows.length);
 expect(delta.filter(e=>['presentation_sequence_planned','presentation_action_validated','presentation_action_applied','presentation_action_delivered','presentation_action_outcome_recorded','gate_evaluated','student_input_recorded','workspace_visual_owners_invalidated'].includes(e.event_type))).toEqual([]);
 expect(delta.filter(e=>e.event_type==='presentation_generation_retry_scheduled')).toEqual([]);expect(delta.filter(e=>e.event_type==='presentation_generation_failed')).toHaveLength(1);
 expect(s.workspaceFold().state).toEqual(beforeWorkspace);expect(s.snapshot().views.studentWorkspaceView).toEqual(beforeVisual);
 const restored=app().restore(s.sessionId);expect(restored.workspaceFold().state).toEqual(beforeWorkspace);expect(restored.snapshot().views.studentWorkspaceView).toEqual(beforeVisual);expect(restored.assertReplayParity()).toMatchObject({equal:true});
});
