import { describe, expect, it } from 'vitest';
import { projectDialogueTurns, projectUnifiedViews } from '../UnifiedViewProjectionV5';
import { TutorTaskBindingResolver } from '../TutorTaskBindingResolver';
import { initialWorkspaceFold } from '../../tutorSession/WorkspaceRuntimeReducerV5';
const sessionId='TS-178879933587103';
const ev=(sequence:number,event_type:string,payload:Record<string,unknown>,causation_sequence?:number)=>({sequence,event_type,payload,causation_sequence});
const raw=(n:number,text:string,id=`input-${n}`,channel='mainline')=>ev(n,'student_input_recorded',{input:{kind:'utterance',channel,text},client_request_id:id});
const misconception='我理解了，相似就是两个三角形的对应边都相等，对吗？';

describe('raw student dialogue is independent of interpretation and Gate',()=>{
 it('reproduces live input44 + unclear45 + execute46 with no intent, including unified coach view',()=>{
  const events=[raw(44,misconception),ev(45,'semantic_interpretation_recorded',{intent:'unclear'},44),ev(46,'policy_decision_made',{decision_kind:'execute_beat'},44)];
  const turns=projectDialogueTurns(sessionId,events);
  expect(turns).toEqual([{turn_id:`DT-${sessionId}-0044`,role:'student',content:misconception}]);
  const binding=new TutorTaskBindingResolver('/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring').resolveForStart('goldenMinhangFold2020');
  const workspace=initialWorkspaceFold(sessionId,binding.golden.catalog);
  const view=projectUnifiedViews({sessionId,sessionRevision:46,events:events as never,plan:binding.plan,catalog:binding.golden.catalog,factEntryIds:binding.golden.factEntryIds,resources:binding.imported.plan.resources,workspaceState:workspace.state,
   tutorState:{schema:'ai_teaching_tutor_runtime_state/v1',session_id:sessionId,state_revision:46,pinned_plan:{},teaching_cursor:{protocol_id:binding.plan.mainline.protocol_id,beat_id:'BT-01',phase:'awaiting_evidence'},inquiry_cursor:null,workspace_revision:workspace.state.revision,completed:false} as never});
  expect(view.coachPanelView.transcript).toEqual(turns);
 });
 it.each(['pass','unclear','fail','timeout','open_inquiry'])('shows original utterance under %s and ignores derived paraphrase/recheck duplicates',outcome=>{
  const input=raw(1,'  我没听懂，请再讲一次。  ');
  const events=[input,ev(2,'semantic_interpretation_recorded',{intent:outcome},1),ev(3,'student_intent_recorded',{intent_kind:'confirm',text:'派生文本不能替换原话',client_request_id:'input-1'},1),ev(4,'semantic_interpretation_recorded',{intent:'confirm:follow_along:expressed:return:PR-SMV-001:BT-01:GT-01'},1),ev(5,'student_intent_recorded',{intent_kind:'confirm',text:'另一条派生文本'},1)];
  expect(projectDialogueTurns(sessionId,events)).toEqual(projectDialogueTurns(sessionId,[input]));
 });
 it('preserves interleaved event order, both channels and identical text from separate input identities',()=>{
  const events=[raw(1,'没听懂'),ev(2,'voice_action_issued',{text:'我们换个方式讲。'}),raw(3,'没听懂','input-3','assistance'),ev(4,'presentation_sequence_planned',{sequence_id:'PS-01',actions:[{ordinal:0,kind:'voice',voice_action:{text:'先看对应角。'}}]}),ev(5,'presentation_action_delivered',{sequence_id:'PS-01',ordinal:0,kind:'voice'}),raw(6,'现在明白了')];
  expect(projectDialogueTurns(sessionId,[...events].reverse()).map(t=>[t.role,t.content])).toEqual([['student','没听懂'],['tutor','我们换个方式讲。'],['student','没听懂'],['tutor','先看对应角。'],['student','现在明白了']]);
 });
 it('deduplicates raw retries by sequence/request ID, and links intent by request ID when causation is absent',()=>{
  const input=raw(1,'懂了','request-a');
  expect(projectDialogueTurns(sessionId,[input,input,raw(2,'懂了','request-a'),ev(3,'student_intent_recorded',{text:'懂了',client_request_id:'request-a'})])).toHaveLength(1);
 });
 it.each(['confirm','continue','return_to_mainline'])('control.%s never fabricates an utterance from intent text',command=>{
  const events=[ev(1,'student_input_recorded',{input:{kind:'control',command},client_request_id:'control-a'}),ev(2,'student_intent_recorded',{text:'学生已理解',intent_kind:command,client_request_id:'control-a'},1),ev(3,'student_intent_recorded',{text:'重复派生'},1)];
  expect(projectDialogueTurns(sessionId,events)).toEqual([]);
 });
 it('retains old intent-only transcripts and never renders private semantic reasoning',()=>{
  const events=[ev(1,'student_intent_recorded',{text:'历史学生原话',intent_kind:'submit_answer'}),ev(2,'semantic_interpretation_recorded',{text:'私有推理',brief_reason:'内部判断'}),ev(3,'student_input_recorded',{input:{kind:'utterance',text:''}})];
  expect(projectDialogueTurns(sessionId,events)).toEqual([{turn_id:`DT-${sessionId}-0001`,role:'student',content:'历史学生原话'}]);
 });
});
