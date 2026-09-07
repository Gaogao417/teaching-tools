/** C4 mechanical integration; models and candidate approval are synthetic, all runtime components real. */
import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {rmSync} from 'node:fs';
import {ensureSqlite} from '../../tutorSession/__tests__/support';
import {createSyntheticFollowAlongRoot} from '../../planBuild/__tests__/teachFollowAlongTestSupport';
import {f6Model, realCanonicalRoot} from './f6Support';
import {FixedResponseGateProvider} from '../../tutorNavigator/ModelGateAdjudicatorV5';
import {PRESENTER_PROMPT_VERSION, type PresenterUserPayload} from '../presentationGeneration/PresenterPrompts';
import type {PresenterGeneratorPort} from '../presentationGeneration/GeneratorPort';
import {evaluateGateEvidence} from '../../tutorNavigator/GateEvidenceEvaluatorV5';
const sqlite=ensureSqlite('teach-follow-along-C4');
const {TutorSessionOrchestratorV7}=require('../TutorSessionOrchestratorV7') as typeof import('../TutorSessionOrchestratorV7');
const candidate=createSyntheticFollowAlongRoot();
after(()=>{(require('../../../db/database') as typeof import('../../../db/database')).db.close();candidate.cleanup();for(const x of ['', '-wal','-shm'])rmSync(sqlite+x,{force:true});});
type Session=import('../TutorSessionOrchestratorV7').TutorSessionOrchestratorV7;
class Presenter implements PresenterGeneratorPort {
 readonly provider='scripted-follow-along'; readonly modelId='mechanical-only';
 readonly pin={provider:this.provider,model_id:this.modelId,prompt_version:PRESENTER_PROMPT_VERSION,context_builder_version:'presentation-context-builder/v1',tool_catalog_version:'presentation-tool-catalog/v1'};
 readonly payloads:PresenterUserPayload[]=[];
 async generatePresentationDraft(r:Parameters<PresenterGeneratorPort['generatePresentationDraft']>[0]) {
  const p=r.userPayload as PresenterUserPayload;this.payloads.push(p);assert.equal(p.completion_target,'follow_along');assert.ok(r.systemPrompt.includes('不把填数'));assert.equal(r.promptVersion,this.pin.prompt_version);
  const board=p.tools.find(t=>t.tool==='board.explain');
  const items: Array<{type:'speech';text:string;basis_refs:string[]}|{type:'tool_intent';tool:string;args:{binding_ref:string;params:Record<string,string>}}>=[{type:'speech',text:'我们一起看清这一步的关系。',basis_refs:[p.allowed_knowledge[0].ref]}];
  const geometry=p.tools.find(t=>t.tool==='geometry.construct');
  if(geometry?.bindings?.length) for(const b of geometry.bindings){
    assert.ok(b.allowed_template_ids?.length);items.push({type:'tool_intent',tool:geometry.tool,args:{binding_ref:b.binding_ref,params:{template_id:b.allowed_template_ids[0]}}});
  }
  else if(board?.binding_refs[0]) items.push({type:'tool_intent',tool:board.tool,args:{binding_ref:board.binding_refs[0],params:{note_kind:'explanation_text'}}});
  return {latencyMs:1,draft:{schema:'ai_teaching_presentation_draft/v2' as const,request_id:r.request_id,items}};
 }
}
let serial=0;
const response=(gate:string,kind='understanding_confirmation',verdict='pass',refs:string[]=[])=>JSON.stringify({response_kind:kind,matched_gate_id:gate,verdict,reasoning_location:kind==='understanding_confirmation'?'unknown':verdict==='fail'?'misaligned':'aligned',grounding_refs:refs});
function start(responses:string[],root=candidate.root,withPresenter=true){
 const provider=new FixedResponseGateProvider(responses,'C4-follow-along');const presenter=new Presenter();
 const session=TutorSessionOrchestratorV7.start({sessionId:`TS-97${Date.now()}${++serial}`,studentId:'C4-student',taskId:'goldenMinhangFold2020',canonicalRoot:root,model:f6Model(provider,'C4-follow-along'),...(withPresenter?{presenter}:{})});
 return {session,provider,presenter};
}
async function finish(s:Session){
 if(s.rebuildRuntimeState().generation_slot?.status==='pending'){const r=await s.drivePendingGeneration();assert.equal(r.kind,'committed',JSON.stringify(r));}
 for(let n=0;n<20;n++){const c=s.rebuildRuntimeState().presentation_cursor;if(c.status!=='awaiting_browser')return;s.reportPresentationOutcome({sequence_id:c.sequence_id,ordinal:c.ordinal,action_id:c.action_id,outcome:'presented',client_request_id:`receipt-${++serial}`});}throw new Error('presentation did not settle');
}
const say=(s:Session,text:string,id=`input-${++serial}`,channel:'mainline'|'assistance'='mainline')=>s.submitStudentInput({input:{kind:'utterance',channel,text},client_request_id:id},{expectedRevision:s.revision});
test('six Teach Beats finish through natural feedback, with replay and idempotency preserving evidence strength',async()=>{
 const {session:s,provider,presenter}=start([response('GT-01'),response('GT-02','restatement','pass',['FN-06']),...[3,4,5,6].map(n=>response(`GT-0${n}`))]);
 for(let i=1;i<=6;i++){
  assert.equal(s.rebuildRuntimeState().teaching_cursor.beat_id,`BT-0${i}`);await finish(s);assert.equal(s.rebuildRuntimeState().teaching_cursor.beat_id,`BT-0${i}`,'ended is not understanding');
  const text=i===2?'两组对应角相等，所以这两个三角形相似；这个关系我接上了':'这一步听懂了，继续';const id=`six-beat-${i}`;const channel=i===4?'assistance':'mainline';
  await say(s,text,id,channel);const count=s.events.length,calls=provider.callCount;await say(s,text,id,channel);assert.equal(s.events.length,count);assert.equal(provider.callCount,calls);
  const restored=TutorSessionOrchestratorV7.resume({sessionId:s.sessionId,canonicalRoot:candidate.root,model:f6Model(provider,'C4-follow-along'),presenter});assert.deepEqual(restored.rebuildRuntimeState(),s.rebuildRuntimeState());
 }
 assert.equal(s.rebuildRuntimeState().completed,true);assert.equal(provider.callCount,6);
 const intents=s.events.filter(e=>e.event_type==='student_intent_recorded');assert.equal(intents.length,6);assert.ok(intents.every(e=>(e.payload as {intent_kind:string}).intent_kind==='confirm'));
 const semantic=s.events.filter(e=>e.event_type==='semantic_interpretation_recorded').map(e=>(e.payload as {intent:string}).intent);assert.equal(semantic.filter(x=>x==='confirm:follow_along:self_reported').length,5);assert.equal(semantic.filter(x=>x==='confirm:follow_along:expressed').length,1);
 assert.equal(s.events.filter(e=>e.event_type==='student_workspace_command_recorded').length,0);
 assert.ok(s.events.some(e=>e.event_type==='presentation_sequence_planned' && JSON.stringify(e.payload).includes('geometry.construct')),'teacher geometry uses the actual compiler and Workspace chain');
 assert.ok(s.events.some(e=>e.event_type==='presentation_sequence_planned' && JSON.stringify(e.payload).includes('explanation_fragments')),'teacher board is committed through existing runtime');
 assert.equal(s.assertReplayParity().equal,true);
});
test('contradictory understanding statement requests repair without passing',async()=>{
 const {session:s}=start([response('GT-01','restatement','fail',['FN-01'])]);await finish(s);await say(s,'懂了，所以 AB 和 BC 都是4');assert.equal(s.rebuildRuntimeState().teaching_cursor.beat_id,'BT-01');assert.equal(s.events.filter(e=>e.event_type==='gate_evaluated'&&(e.payload as {satisfied:boolean}).satisfied).length,0);assert.equal((s.events.find(e=>e.event_type==='student_intent_recorded')?.payload as {intent_kind:string}).intent_kind,'request_scaffold');
});
test('continue control, ambiguity and stale revision cannot become understanding',async()=>{
 const {session:s,provider}=start([response('GT-01'),response('GT-01','mixed_or_ambiguous','unclear')]);await finish(s);const stale=s.revision;
 await s.submitStudentInput({input:{kind:'control',command:'continue'},client_request_id:'continue-only'},{});assert.equal(s.rebuildRuntimeState().teaching_cursor.beat_id,'BT-01');await say(s,'随便吧');assert.equal(s.rebuildRuntimeState().teaching_cursor.beat_id,'BT-01');
 const calls=provider.callCount,count=s.events.length;const r=await s.submitStudentInput({input:{kind:'utterance',channel:'mainline',text:'刚才那个懂了'},client_request_id:'stale-confirm'},{expectedRevision:stale});assert.ok(r.turn.failure);assert.equal(provider.callCount,calls);assert.ok(s.events.slice(count).every(e=>e.event_type!=='student_input_recorded' && e.event_type!=='gate_evaluated'));
});
test('unmarked practice does not accept self-report as a correct answer',async()=>{
 const {session:s}=start([response('GT-02')],realCanonicalRoot(),false);await finish(s);await s.submitStudentInput({input:{kind:'control',command:'confirm'},client_request_id:'legacy-orientation'},{});assert.equal(s.rebuildRuntimeState().teaching_cursor.beat_id,'BT-02');await finish(s);await say(s,'听懂了，继续');assert.equal(s.rebuildRuntimeState().teaching_cursor.beat_id,'BT-02');assert.equal(s.rebuildRuntimeState().completed,false);
});
test('follow-along evaluator rejects bare control, wrong gate, mismatched anchor and timeout',()=>{
 const {session:s}=start([]);const beat=s.plan.mainline.beats.get('BT-01')!;const base={confirmation_sequences:[10],workspace_outcomes:[],narration_completed:false};
 for(const changes of [{},{model_assessment:{verdict:'pass' as const,matched_gate_id:'GT-02',evidence_sequence:10}},{model_assessment:{verdict:'pass' as const,matched_gate_id:'GT-01',evidence_sequence:9}},{model_assessment:{verdict:'pass' as const,matched_gate_id:'GT-01',evidence_sequence:10},timeout_attempted_as_evidence:true}])assert.equal(evaluateGateEvidence(s.plan,beat,{...base,...changes}).satisfied,false);
});

test('Teach self-report protocol cannot be started as an assessment',()=>{
 const provider=new FixedResponseGateProvider([]);
 assert.throws(()=>TutorSessionOrchestratorV7.start({sessionId:`TS-98${Date.now()}`,studentId:'C4-assessment',taskId:'goldenMinhangFold2020',canonicalRoot:candidate.root,model:f6Model(provider,'C4-assessment'),assessment:true}),/follow_along is a Teach protocol/);
 assert.equal(provider.callCount,0);
});

test('a bounded repair accepts one natural confirmation and returns to the existing mainline anchor',async()=>{
 const {session:s,provider}=start([response('GT-01','question','not_applicable',['FN-01']),response('GT-01')]);
 await finish(s);const opened=await say(s,'翻折后 AE 为什么等于 AC？');
 assert.equal(opened.turn.decision?.decision_kind,'open_inquiry');
 const branch=s.plan.branches.get('PR-SMV-002')!;assert.equal(branch.beat_order.length,1,'repair must not force four confirmations');
 await finish(s);const returned=await say(s,'这个补讲听懂了，翻折保持对应长度');
 assert.equal(returned.turn.decision?.decision_kind,'return_to_mainline');
 assert.equal(s.rebuildRuntimeState().inquiry_cursor,null);assert.equal(s.rebuildRuntimeState().teaching_cursor.beat_id,'BT-01');
 assert.equal(provider.callCount,2);assert.equal(s.assertReplayParity().equal,true);
});
