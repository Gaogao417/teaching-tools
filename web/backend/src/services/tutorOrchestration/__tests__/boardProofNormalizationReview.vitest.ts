/** Independent proof/cutoff regressions. Synthetic model ports, real compiler and
 * orchestrator generation pipeline; no paid calls or canonical modifications. */
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { compilePresentationIntents, type IntentCompilerInput } from '../presentationGeneration/IntentCompiler';
import { toolSpecById } from '../presentationGeneration/PresentationToolCatalog';
import { PRESENTER_PROMPT_VERSION } from '../presentationGeneration/PresenterPrompts';
import { importReviewCandidate } from '../../planBuild/c1/ImportReviewCandidate';
import { TutorTaskBindingResolver } from '../TutorTaskBindingResolver';
import { TutorSessionOrchestratorV7 } from '../TutorSessionOrchestratorV7';
import { initialWorkspaceFold, applyWorkspaceV5Event } from '../../tutorSession/WorkspaceRuntimeReducerV5';

const sessionId='TS-99300001';
const pin={provider:'proof-test-only',model_id:'proof-test-only',prompt_version:PRESENTER_PROMPT_VERSION,context_builder_version:'presentation-context-builder/v1',tool_catalog_version:'presentation-tool-catalog/v1'};
const statements=['$a=b$','$b=c$','$a=c$','$a+d=c+d$'];
function input():IntentCompilerInput {
 const facts=new Map(statements.map((statement,index)=>{const id=`FN-0${index+1}`;return [id,{fact_id:id,statement,role:index<2?'given':'derived',reveals_answer:false}];}));
 const inferences=new Map([
  ['IF-01',{inference_id:'IF-01',premises:['FN-01','FN-02'],conclusion:'FN-03',derivation:'由等量关系的传递性。'}],
  ['IF-02',{inference_id:'IF-02',premises:['FN-03'],conclusion:'FN-04',derivation:'等式两边同时加上同一个数。'}],
 ]);
 const binding={binding_id:'VB-01',binding_kind:'explanation',purpose:'证明顺序测试',presentation_resource:'RES1',basis_refs:{fact_ids:['FN-04','FN-02','FN-03','FN-01'],inference_ids:['IF-02','IF-01']}};
 return {sessionId,sequenceSerial:1,decisionId:`TD-${sessionId}-0001`,scope:{kind:'approved',protocol_id:'PR-SMV-001',beat_id:'BT-01'},request:{request_id:`GR-${sessionId}-0001`,attempt:1,epoch:1,input_digest:`sha256:${'a'.repeat(64)}`,presenter_pin:pin},
  draft:{schema:'ai_teaching_presentation_draft/v2',request_id:`GR-${sessionId}-0001`,items:[{type:'speech',text:'我们按顺序推导。',basis_refs:['FN-01']},{type:'tool_intent',tool:'board.explain',args:{binding_ref:'VB-01',params:{note_kind:'relation_note'}}}]},
  context:{context:{plan_ref:{artifact_id:'TP-SMV-009',version:'v13',content_hash:`sha256:${'a'.repeat(64)}`},graph_ref:{artifact_id:'RG-SMV-001',version:'v3',content_hash:`sha256:${'b'.repeat(64)}`},selected_fact_ids:[...facts.keys()],selected_inference_ids:[...inferences.keys()],resource_ids:['RES1'],event_cutoff:4,workspace_revision:0},digest:`sha256:${'a'.repeat(64)}`,basis:[],truncated_inference_ids:[],truncated_group_refs:[],context_truncated:false,budget:{facts:4,inferences:2,approx_chars:100}},
  visibleTools:[{spec:toolSpecById('board.explain')!,bindings:[binding as never]}],resources:new Map(),graph:{facts: facts as never,inferences:inferences as never},approvedConstructions:[],revealAuthorized:()=>false};
}
const fragment=(i:IntentCompilerInput)=>compilePresentationIntents(i).explanation_fragments?.[0];

describe('approved proof topology, provenance and fail-closed boundaries',()=>{
 it('orders dependency before consumer despite reversed binding order, retaining all basis refs without showing IDs',()=>{
  const f=fragment(input())!;
  expect(f.content).toBe(['∵ $a=b$','∵ $b=c$','由等量关系的传递性。','∴ $a=c$','','等式两边同时加上同一个数。','∴ $a+d=c+d$'].join('\n'));
  expect(f.content).not.toMatch(/(?:FN|IF)-\d+/);
  expect(f.basis_refs).toEqual(['FN-04','FN-02','FN-03','FN-01','IF-02','IF-01']);
 });
 it('deduplicates the same proof within one compiled sequence and across presented history while preserving speech',()=>{
  const i=input();i.draft.items.push(i.draft.items[1]);
  const compiled=compilePresentationIntents(i);expect(compiled.explanation_fragments).toHaveLength(1);
  const repeated=compilePresentationIntents({...input(),alreadyPresentedBoardContent:[compiled.explanation_fragments![0].content]});
  expect(repeated.explanation_fragments??[]).toEqual([]);expect(repeated.actions.map(a=>a.kind)).toEqual(['voice']);
 });
 it('omits only already presented premise lines and still supplies the new inference and conclusion',()=>{
  const f=fragment({...input(),alreadyPresentedBoardContent:['∵ $a=b$\n∵ $b=c$']})!;
  expect(f.content).not.toContain('∵ $a=b$');expect(f.content).not.toContain('∵ $b=c$');
  expect(f.content).toContain('由等量关系的传递性。\n∴ $a=c$');
 });
 it.each(['out_of_binding','missing_from_graph'])('unknown conclusion %s is rejected even when the graph otherwise permits it',kind=>{
  const i=input();if(kind==='out_of_binding')(i.visibleTools[0].bindings[0] as any).basis_refs.fact_ids=['FN-01','FN-02','FN-04'];else (i.graph.facts as Map<string,unknown>).delete('FN-03');
  expect(()=>compilePresentationIntents(i)).toThrow(/conclusion|bound.*fact|source/i);
 });
 it('cycles are rejected instead of recursing or emitting partial proof',()=>{
  const i=input();(i.graph.inferences.get('IF-01') as any).premises=['FN-04'];
  expect(()=>compilePresentationIntents(i)).toThrow(/cyclic/i);
 });
 it('mentioning a goal in free prose is not evidence that its derivation was already shown',()=>{
  const f=fragment({...input(),alreadyPresentedBoardContent:['接下来要证明：$a=c$，这一步目前尚未建立。']})!;
  expect(f.content).toContain('由等量关系的传递性。\n∴ $a=c$');
 });
 it('free explanation_text within the same segment cannot suppress a formal derivation even with forged canonical-looking lines',()=>{
  const i=input();const proof=fragment(input())!.content;
  i.draft.items.splice(0,2,{type:'speech',text:proof,basis_refs:['FN-01']},{type:'tool_intent',tool:'board.explain',args:{binding_ref:'VB-01',params:{note_kind:'explanation_text'}}},{type:'tool_intent',tool:'board.explain',args:{binding_ref:'VB-01',params:{note_kind:'relation_note'}}});
  const compiled=compilePresentationIntents(i);
  expect(compiled.explanation_fragments).toHaveLength(2);
  expect(compiled.explanation_fragments![1].kind).toBe('relation_note');
  expect(compiled.explanation_fragments![1].content).toContain('由等量关系的传递性。');
 });
 it('unknown inference cannot silently become an already-presented no-op',()=>{
  const i=input();(i.visibleTools[0].bindings[0] as any).basis_refs.inference_ids=['IF-99'];
  expect(()=>compilePresentationIntents(i)).toThrow(/inference|source|bound/i);
 });
 it('missing premise cannot be omitted while its conclusion is emitted as proved',()=>{
  const i=input();(i.graph.facts as Map<string,unknown>).delete('FN-02');
  expect(()=>compilePresentationIntents(i)).toThrow(/premise|source|fact/i);
 });
});

const root='/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring';
const review=importReviewCandidate({canonicalRoot:root,candidateDirectory:resolve('src/services/planBuild/review/c1-teach-follow-along/candidate-v13-r3')});
if(!review.ok)throw Error(review.errors.join(';'));
const binding=new TutorTaskBindingResolver(root,()=>review).resolveForStart('goldenMinhangFold2020');
const beat=binding.plan.mainline.beats.get('BT-01')!;
const factIds=beat.graph_fact_refs;
const displayed=factIds.map(id=>`∵ ${binding.imported.graph.facts.find(f=>f.fact_id===id)!.statement}`).join('\n');
function history(outcome?:string,revision=4,kind="approved_math_note"){return [
 {sequence:1,state_revision:2,event_type:'presentation_sequence_planned',payload:{sequence_id:'PS-OLD',actions:[{ordinal:0,kind:'workspace',workspace_action:{action_id:'WSA-OLD',capability:'board.explain',command_payload:'EF-OLD'}}],explanation_fragments:[{fragment_id:'EF-OLD',content:displayed,kind}]}},
 {sequence:2,state_revision:3,event_type:'presentation_action_delivered',payload:{sequence_id:'PS-OLD',ordinal:0,action_id:'WSA-OLD',kind:'workspace'}},
 ...(outcome?[{sequence:3,state_revision:revision,event_type:'presentation_action_outcome_recorded',payload:{sequence_id:'PS-OLD',ordinal:0,action_id:'WSA-OLD',kind:'workspace',outcome}}]:[]),
 ];}
async function runFrozen(events:any[],cutoff=4){
 const session:any=Object.create(TutorSessionOrchestratorV7.prototype);
 const initial=initialWorkspaceFold(sessionId,binding.golden.catalog,undefined,{task_id:binding.taskId,protocol_refs:[{artifact_id:beat.protocol_id}],initial_cursor:{protocol_id:beat.protocol_id,beat_id:beat.beat_id}});
 const fold=applyWorkspaceV5Event(initial,{sequence:1,event_type:'policy_decision_made',payload:{decision_id:`TD-${sessionId}-0002`,protocol_id:beat.protocol_id,beat_id:beat.beat_id}} as never,binding.golden.catalog);
 Object.assign(session,{sessionId,binding,catalog:binding.golden.catalog,sessionMode:'teaching',navigator:{currentBeat:beat},countPlanned:()=>0,rebuildWorkspace:()=>fold,
  presenterGenerator:{async generatePresentationDraft(r:any){return {draft:{schema:'ai_teaching_presentation_draft/v2',request_id:r.request_id,items:[{type:'speech',text:'我们继续看这些已知条件。',basis_refs:[factIds[0]]},{type:'tool_intent',tool:'board.explain',args:{binding_ref:'VB-06',params:{note_kind:'approved_math_note'}}}]},latencyMs:1};}}});
 Object.defineProperty(session,'events',{get:()=>events});
 return session.buildAndRunGeneration({request_id:`GR-${sessionId}-0002`,attempt:1,epoch:1,decision_id:`TD-${sessionId}-0002`,scope:{kind:'approved',protocol_id:beat.protocol_id,beat_id:beat.beat_id},input_digest:`sha256:${'a'.repeat(64)}`,presenter_pin:pin,timeout_ms:100,
 context:{plan_ref:binding.plan.tutor_plan_ref,graph_ref:binding.plan.solution_graph_ref,selected_fact_ids:factIds,selected_inference_ids:beat.inference_refs,resource_ids:beat.resource_ids,event_cutoff:cutoff,workspace_revision:0}});
}
describe('orchestrator reconstructs board deduplication only from presented receipts at frozen cutoff',()=>{
 it.each([undefined,'interrupted','failed'])('planned/delivered or %s outcome cannot suppress the board',async outcome=>{
  const result=await runFrozen(history(outcome));expect(result.explanation_fragments).toHaveLength(1);
 });
 it('a presented explanation_text with canonical-looking lines is excluded from cross-request proof deduplication',async()=>{
  const result=await runFrozen(history('presented',4,'explanation_text'));expect(result.explanation_fragments).toHaveLength(1);
 });
 it('presented within cutoff suppresses the repeated board while leaving speech',async()=>{
  const result=await runFrozen(history('presented'));expect(result.explanation_fragments??[]).toHaveLength(0);expect(result.actions.map((a:any)=>a.kind)).toEqual(['voice']);
 });
 it('presented after cutoff cannot change the same request replay, but a later request may use it',async()=>{
  const before=await runFrozen(history());const after=await runFrozen(history('presented',5));
  expect(after).toEqual(before);expect(after.explanation_fragments).toHaveLength(1);
  const later=await runFrozen(history('presented',5),5);expect(later.explanation_fragments??[]).toHaveLength(0);
 });
});
