import type { VisualBarrier, VisualInvalidation, VisualView } from '../../../../shared/canonical';
import { presentationPlanV5Schema } from '../../../../shared/canonical';
import type { PendingSessionEvent, StoredSessionEvent } from '../tutorSession/kernel/sessionKernelTypes';
import { VisualLifecycleError, type TutorRuntimeStateV10 } from '../tutorSession/TutorRuntimeStateReducerV10';

type CleanupBarrier = Exclude<VisualBarrier,{status:'awaiting-control'}>;
export interface VisualTransitionInput {
  state:TutorRuntimeStateV10;
  history:readonly StoredSessionEvent[];
  prefix:readonly PendingSessionEvent[];
  cause:VisualBarrier['cause'];
  controlRequestId?:string;
  invalidation:VisualInvalidation;
  target:VisualView;
  catalogHash:string;
  occurredAt:string;
}
/** Pure event planner. Allocation follows the current stream's sequence, and the
 * actual append remains the caller's one revision CAS. */
export function planVisualTransition(input:VisualTransitionInput): PendingSessionEvent[] {
  const {state,history}=input;
  const invalidationSequence=(history.at(-1)?.sequence??0)+input.prefix.length+1;
  const barrierId=`${state.session_id}/event/${invalidationSequence}`;
  const barrier:CleanupBarrier={barrier_id:barrierId,cause:input.cause,status:'awaiting-cleanup',
    execution_owner:state.presentation_execution_owner,cleanup_sequence_id:`PS-${invalidationSequence.toString().padStart(4,'0')}`,
    target_event_sequence:invalidationSequence,catalog_hash:input.catalogHash,target_visual_revision:input.target.visual_revision,target_digest:input.target.digest,
    ...(input.controlRequestId?{control_request_id:input.controlRequestId}:{}),
    ...(state.visual_barrier?{supersedes_barrier_id:state.visual_barrier.barrier_id}:{})};
  return [...input.prefix,{event_type:'workspace_visual_owners_invalidated',payload:input.invalidation,occurred_at:input.occurredAt,
    causation_sequence:invalidationSequence-1},...planCleanupDelivery({...state,workspace_revision:input.invalidation.resulting_workspace_revision},history,barrier,invalidationSequence,input.occurredAt)];
}
export function planCleanupDelivery(state:TutorRuntimeStateV10,history:readonly StoredSessionEvent[],barrier:CleanupBarrier,causeSequence:number,at:string):PendingSessionEvent[] {
  const originalCleanup=history.find(e=>e.event_type==='presentation_sequence_planned' && e.payload.purpose==='visual-reconcile'
    && ((e.payload.actions as Array<{workspace_action?:{command_payload?:string}}>)??[]).some(a=>{
      try{return JSON.parse(a.workspace_action?.command_payload??'null')?.barrier_id===barrier.barrier_id;}catch{return false;}
    }));
  const decision=originalCleanup ? history.find(e=>e.event_type==='policy_decision_made'&&e.payload.decision_id===originalCleanup.payload.decision_id)
    : [...history].reverse().find(e=>e.event_type==='policy_decision_made');
  if(!decision) throw new VisualLifecycleError('VISUAL_BOOTSTRAP_REQUIRED','cleanup requires a real committed decision');
  const previousPlan=[...history].reverse().find(e=>e.event_type==='presentation_sequence_planned'&&e.payload.decision_id===decision.payload.decision_id);
  const scope=originalCleanup?.payload.scope??previousPlan?.payload.scope??{kind:'approved',protocol_id:decision.payload.protocol_id,beat_id:decision.payload.beat_id};
  const actionId=`WSA-${state.session_id}-${barrier.cleanup_sequence_id.slice(3)}-R0`;
  const action={action_id:actionId,
    decision_id:decision.payload.decision_id,surface:'geometry',capability:'geometry.visual.reconcile',origin:'tutor',reveal_scope:'none',presentation_only:true,
    command_payload:JSON.stringify({schema:'ai_teaching_geometry_visual_command/v1',op:'reconcile',barrier_id:barrier.barrier_id,target_visual_revision:barrier.target_visual_revision,target_digest:barrier.target_digest})};
  const plan=presentationPlanV5Schema.parse({schema:'ai_teaching_presentation_plan/v5',session_id:state.session_id,sequence_id:barrier.cleanup_sequence_id,
    decision_id:decision.payload.decision_id,scope,purpose:'visual-reconcile',actions:[{ordinal:0,kind:'workspace',workspace_action:action}]});
  const {schema,session_id,...payload}=plan;
  const firstSequence=causeSequence+1;
  const ref={sequence_id:barrier.cleanup_sequence_id,ordinal:0,action_id:actionId,kind:'workspace'};
  return [
    {event_type:'visual_barrier_changed',payload:{previous_barrier_id:state.visual_barrier?.barrier_id??null,barrier},occurred_at:at,causation_sequence:causeSequence},
    {event_type:'presentation_sequence_planned',payload,occurred_at:at,causation_sequence:firstSequence},
    {event_type:'presentation_action_validated',payload:ref,occurred_at:at,causation_sequence:firstSequence+1},
    {event_type:'presentation_action_applied',payload:{...ref,resulting_workspace_revision:state.workspace_revision},occurred_at:at,causation_sequence:firstSequence+1},
    {event_type:'presentation_action_delivered',payload:ref,occurred_at:at,causation_sequence:firstSequence+1},
  ];
}
