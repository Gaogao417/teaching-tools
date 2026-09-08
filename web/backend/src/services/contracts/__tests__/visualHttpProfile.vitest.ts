import { describe,it,expect } from 'vitest';
import { parseSessionSnapshotHttp, studentInputRequestHttpV1Schema, presentationOutcomeRequestHttpV1Schema, type SessionSnapshotHttpV1 } from '../../../../../shared/tutorHttpProfile';
const owner={client_instance_id:'browser-visual-0001',epoch:1};
const digest='sha256:'+'a'.repeat(64);
function snapshot():SessionSnapshotHttpV1 {
 return {profile:'f7-tutor-runtime-http/v1',session_id:'TS-424242',task_id:'goldenMinhangFold2020',revision:12,completed:false,assessment:false,
 question:{artifact_id:'QT-SMV-001',question_type:'fill_blank',stem:'如图'},presentation_execution_owner:owner,visual_barrier:null,
 views:{student_workspace_view:{schema:'ai_teaching_student_workspace_view/v3',session_id:'TS-424242',revision:3,canvas:{elements:[],interaction_enabled:false,visual:{visual_revision:2,annotations:[],focus:null,digest}},solution_board:{mode:'building',groups:[]},participation:{kind:'listen_only'}},
 coach_panel_view:{schema:'ai_teaching_coach_panel_view/v1',session_id:'TS-424242',revision:12,mainline:{kind:'presenting',beat_id:'BT-01'},inquiry:{kind:'no_inquiry'},teaching_context:{beat_id:'BT-01'},assistance_available:true,replay_available:true,transcript:[]},participation:{schema:'ai_teaching_mainline_participation/v1',kind:'listen_only'},status:{session_id:'TS-424242',session_revision:12,workspace_revision:3,completed:false}},render:{workspace_revision:3,geometry:null}};
}
function cleanup():SessionSnapshotHttpV1 {
 const x=snapshot();x.visual_barrier={barrier_id:'TS-424242/event/10',cause:'barge-in',status:'awaiting-cleanup',execution_owner:owner,cleanup_sequence_id:'PS-424242',target_event_sequence:10,catalog_hash:'sha256:'+'b'.repeat(64),target_visual_revision:2,target_digest:digest};
 x.pending_presentation={schema:'ai_teaching_presentation_delivery/v2',session_id:x.session_id,sequence_id:'PS-424242',ordinal:0,action_id:'WSA-visual-cleanup',session_revision:12,workspace_revision:3,execution_owner:owner,action:{kind:'workspace',workspace_action:{action_id:'WSA-visual-cleanup',decision_id:'TD-visual-cleanup',surface:'geometry',capability:'geometry.visual.reconcile',origin:'tutor',reveal_scope:'none',presentation_only:true,command_payload:JSON.stringify({schema:'ai_teaching_geometry_visual_command/v1',op:'reconcile',barrier_id:x.visual_barrier.barrier_id,target_visual_revision:2,target_digest:digest})}}};return x;
}
describe('visual HTTP composition: owner and frozen cleanup target',()=>{
 it('accepts complete idle and cleanup snapshots',()=>{expect(parseSessionSnapshotHttp(snapshot()).ok).toBe(true);expect(parseSessionSnapshotHttp(cleanup()).ok).toBe(true);});
 it.each(['presentation_execution_owner','visual_barrier'] as const)('rejects partial successor: %s missing',key=>{const x=snapshot();delete x[key];expect(parseSessionSnapshotHttp(x).ok).toBe(false);});
 it('rejects another owner receipt even at matching revision',()=>{const x=cleanup();if(x.pending_presentation?.schema==='ai_teaching_presentation_delivery/v2')x.pending_presentation.execution_owner={...owner,epoch:2};expect(parseSessionSnapshotHttp(x).ok).toBe(false);});
 it('rejects missing cleanup delivery',()=>{const x=cleanup();delete x.pending_presentation;expect(parseSessionSnapshotHttp(x).ok).toBe(false);});
 it('rejects ordinary action behind cleanup barrier',()=>{const x=cleanup();x.pending_presentation!.action.workspace_action!.capability='geometry.construct';expect(parseSessionSnapshotHttp(x).ok).toBe(false);});
 it('rejects latest view replacing frozen cleanup target',()=>{const x=cleanup();if(x.views.student_workspace_view.schema==='ai_teaching_student_workspace_view/v3')x.views.student_workspace_view.canvas.visual.digest='sha256:'+'c'.repeat(64);expect(parseSessionSnapshotHttp(x).ok).toBe(false);});
 it('rejects failed barrier delivering an action',()=>{const x=cleanup();if(x.visual_barrier&&x.visual_barrier.status==='awaiting-cleanup')x.visual_barrier.status='failed';expect(parseSessionSnapshotHttp(x).ok).toBe(false);});
 it('hold does not relax actual outcome failure fields',()=>{const base={sequence_id:'PS-424242',ordinal:0,outcome:'presented',execution_owner:owner,hold_for_control:{client_request_id:'control-visual-0001'},client_request_id:'outcome-visual-0001',expected_revision:12};expect(presentationOutcomeRequestHttpV1Schema.safeParse(base).success).toBe(true);expect(presentationOutcomeRequestHttpV1Schema.safeParse({...base,outcome:'failed'}).success).toBe(false);});
 it('claim is explicit; not-started cancellation is only valid on barge_in',()=>{const base={execution_owner:owner,client_request_id:'control-visual-0001',expected_revision:12,input:{kind:'control',command:'claim_presentation'}};expect(studentInputRequestHttpV1Schema.safeParse(base).success).toBe(true);expect(studentInputRequestHttpV1Schema.safeParse({...base,input:{...base.input,not_started_delivery:{sequence_id:'PS-424242',ordinal:0,action_id:'VA-visual-0001'}}}).success).toBe(false);});
});
