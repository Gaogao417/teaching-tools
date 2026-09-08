import type { z } from 'zod';
import { studentInputV2Schema, type VisualBarrier } from '../../../../shared/canonical';
import type { PendingSessionEvent, StoredSessionEvent } from '../tutorSession/kernel/sessionKernelTypes';
import { assertVisualExecutionOwner, VisualLifecycleError, type TutorRuntimeStateV10, type V10FoldContext } from '../tutorSession/TutorRuntimeStateReducerV10';
import { visualHash, stableVisualJson } from '../tutorSession/WorkspaceVisualReducer';
import { planCleanupDelivery, planVisualTransition } from './VisualTransitionPlanner';
export type VisualStudentInput = z.infer<typeof studentInputV2Schema>;
export interface VisualLifecycleKernel {
  readonly state:TutorRuntimeStateV10;
  readonly revision:number;
  append(revision:number,events:PendingSessionEvent[]):unknown;
}
export function prospectiveVisualEvents(state:TutorRuntimeStateV10,history:readonly StoredSessionEvent[],pending:readonly PendingSessionEvent[]):StoredSessionEvent[] {
  const last=history.at(-1)?.sequence??0;
  return [...history,...pending.map((e,i)=>({...e,schema:'ai_teaching_tutor_session_event/v10',session_id:state.session_id,
    sequence:last+i+1,state_revision:state.state_revision+1,idempotency_key:e.idempotency_key??`${state.session_id}:${last+i+1}`,payload:e.payload as Record<string,unknown>}))];
}
export function visualTransitionBatch(state:TutorRuntimeStateV10,history:readonly StoredSessionEvent[],prefix:PendingSessionEvent[],cause:VisualBarrier['cause'],context:V10FoldContext,at:string,requestId?:string):PendingSessionEvent[] {
  const prepare=context.visual.prepareInvalidation;
  if(!prepare) throw new VisualLifecycleError('VISUAL_CONTEXT_UNAVAILABLE','pinned visual invalidation resolver is unavailable');
  const target=prepare(prospectiveVisualEvents(state,history,prefix),cause);
  return planVisualTransition({state,history,prefix,cause,controlRequestId:requestId,invalidation:target.invalidation,target:target.target,catalogHash:context.visual.catalogHash,occurredAt:at});
}
/** No teaching policy or model call. Only control/recovery lifecycle facts. */
export function commitVisualControl(args:{kernel:VisualLifecycleKernel;history:readonly StoredSessionEvent[];context:V10FoldContext;input:VisualStudentInput;expectedRevision:number}):{inputSequence:number;replayed:boolean} {
  const {kernel,history,input,context}=args, state=kernel.state;
  const command=input.input.command, claim=command==='claim_presentation';
  const requestHash=visualHash({input:input.input,client_instance_id:input.execution_owner.client_instance_id});
  if(!claim) assertVisualExecutionOwner(state,input.execution_owner);
  const prior=history.find(e=>['presentation_execution_claimed','student_input_recorded'].includes(e.event_type)&&e.payload.client_request_id===input.client_request_id);
  if(prior) {
    if(prior.event_type!==(claim?'presentation_execution_claimed':'student_input_recorded') || (claim?prior.payload.request_hash!==requestHash:stableVisualJson(prior.payload.input)!==stableVisualJson(input.input))) throw new VisualLifecycleError('REQUEST_PAYLOAD_DRIFT','control retry payload changed');
    return {inputSequence:prior.sequence,replayed:true};
  }
  if(args.expectedRevision!==kernel.revision) throw new VisualLifecycleError('REVISION_CONFLICT','expected revision is stale');
  const barrier=state.visual_barrier;
  if(!claim && barrier && !(barrier.status==='awaiting-control'&&command==='barge_in'&&barrier.control_request_id===input.client_request_id)
    && !(barrier.status==='failed'&&command==='retry_recovery')) throw new VisualLifecycleError('VISUAL_BARRIER_ACTIVE','control does not match the persistent barrier');
  const at=new Date().toISOString(), first=(history.at(-1)?.sequence??0)+1;
  const prefix:PendingSessionEvent[]=[];
  let nextState=state;
  if(claim) {
    if(!history.some(e=>e.event_type==='policy_decision_made')) throw new VisualLifecycleError('VISUAL_BOOTSTRAP_REQUIRED','initialize the real first decision before retrying this claim');
    const execution_owner={client_instance_id:input.execution_owner.client_instance_id,epoch:state.presentation_execution_owner.epoch+1};
    prefix.push({event_type:'presentation_execution_claimed',payload:{previous_owner:state.presentation_execution_owner,execution_owner,client_request_id:input.client_request_id,request_hash:requestHash},occurred_at:at,causation_sequence:first-1});
    nextState={...state,presentation_execution_owner:execution_owner};
  } else prefix.push({event_type:'student_input_recorded',payload:{client_request_id:input.client_request_id,input:input.input},occurred_at:at});
  const cursor=state.presentation_cursor;
  if(cursor.status!=='idle') {
    const unstarted=input.input.not_started_delivery;
    if(cursor.status==='awaiting_browser'&&!claim && (command!=='barge_in'||!unstarted||unstarted.sequence_id!==cursor.sequence_id||unstarted.ordinal!==cursor.ordinal||unstarted.action_id!==cursor.action_id))
      throw new VisualLifecycleError('VISUAL_ACTUAL_OUTCOME_REQUIRED','pending execution requires its actual outcome or exact not-started identity');
    prefix.push({event_type:'presentation_sequence_superseded',payload:{sequence_id:cursor.sequence_id,pending_ordinal:cursor.ordinal,pending_action_id:cursor.action_id,
      reason:claim?'execution-revoked':cursor.status==='awaiting_browser'?'superseded-before-start':'retry_recovery'},occurred_at:at,causation_sequence:first});
  } else if(input.input.not_started_delivery) throw new VisualLifecycleError('PRESENTATION_CURSOR_MISMATCH','not-started identity has no pending delivery');
  if(cursor.status==='idle') {
    const previous=[...history].reverse().find(e=>e.event_type==='presentation_sequence_planned');
    if(previous && !history.some(e=>e.event_type==='presentation_sequence_superseded'&&e.payload.sequence_id===previous.payload.sequence_id))
      prefix.push({event_type:'presentation_sequence_superseded',payload:{sequence_id:previous.payload.sequence_id,reason:claim?'execution-revoked':'interrupted'},occurred_at:at,causation_sequence:first});
  }
  if(state.generation_slot.status==='pending') {
    const record=state.generation_requests.find(r=>r.request_id===(state.generation_slot as {request_id:string}).request_id)!;
    const {phase,retry_at,...rest}=record;
    prefix.push({event_type:'presentation_generation_invalidated',payload:{...rest,status:'cancelled',cancel_reason:'cancelled'},occurred_at:at,causation_sequence:first});
  }
  let batch:PendingSessionEvent[];
  if(!claim&&barrier?.status==='failed'&&command==='retry_recovery') {
    const retry={...barrier,status:'awaiting-cleanup' as const,cleanup_sequence_id:`PS-${(first+prefix.length).toString().padStart(4,'0')}`};
    batch=[...prefix,...planCleanupDelivery(state,history,retry,first+prefix.length-1,at)];
  } else batch=visualTransitionBatch(nextState,history,prefix,claim?'claim':command==='retry_recovery'?'recovery':'barge-in',context,at,input.client_request_id);
  kernel.append(args.expectedRevision,batch);
  return {inputSequence:first,replayed:false};
}
