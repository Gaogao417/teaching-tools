import type { z } from 'zod';
import { geometryVisualCommandSchema, presentationPlanV5Schema, tutorRuntimeStateV5Schema, visualBarrierSchema, visualExecutionOwnerSchema, type VisualBarrier, type VisualExecutionOwner, type VisualView, type VisualInvalidation } from '../../../../shared/canonical';
import { applyV9Event, initialStateFromSessionStartedV9, type V9FoldContext } from './TutorRuntimeStateReducerV9';
import { adoptV7Lineage } from './TutorRuntimeStateReducerV7';
import type { StoredSessionEvent } from './kernel/sessionKernelTypes';
import { stableVisualJson } from './WorkspaceVisualReducer';

export type TutorRuntimeStateV10 = z.infer<typeof tutorRuntimeStateV5Schema>;
/** Production composition must rebuild through the same pinned Workspace reducer.
 * No view or invalidation payload supplied by a browser is accepted here. */
export interface V10FoldContext extends V9FoldContext {
  readonly visual: {
    readonly catalogHash: string;
    resolveInquiryEntryBeat?(protocolId:string):string;
    projectAt(events: readonly StoredSessionEvent[]): VisualView;
    prepareInvalidation?(events: readonly StoredSessionEvent[], reason: VisualInvalidation["reason"]): {invalidation:VisualInvalidation;target:VisualView;workspaceRevision:number};
    validateInvalidation(events: readonly StoredSessionEvent[], event: StoredSessionEvent): void;
    validateGenerationCompanion?(body:import('./GenerationCompanionStore').GenerationCompanion,payload:any,history:readonly {sequence:number;event_type:string;payload:any;state_revision?:number}[]):void;
    validateTeachingAction?(events: readonly StoredSessionEvent[], event: StoredSessionEvent): void;
  };
}
export class VisualLifecycleError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'VisualLifecycleError'; }
}
function fail(code: string, message: string): never { throw new VisualLifecycleError(code, message); }
const equal = (a: unknown, b: unknown) => stableVisualJson(a) === stableVisualJson(b);
const histories = new WeakMap<object, readonly StoredSessionEvent[]>();
export function visualSessionHistory(state: TutorRuntimeStateV10): readonly StoredSessionEvent[] {
  const history = histories.get(state);
  if (!history) return fail('VISUAL_LINEAGE_MISSING', 'state must originate from the V10 codec');
  return history;
}
/** Reconstruct visits from the committed decision lineage. Counter never moves
 * backwards; Inquiry return restores the saved anchor visit. */
export function visualScopeEpochs(events:readonly StoredSessionEvent[], resolveInquiryEntryBeat?:(protocolId:string)=>string):{counter:number;current:number;anchor:number|null} {
  let counter=0,current=0,anchor:number|null=null;
  let inquiryProtocol:string|undefined,inquiryBeat:string|undefined;
  for(const event of events) {
    if(event.event_type!=="policy_decision_made") continue;
    const d=event.payload,kind=d.decision_kind;
    if(kind==="open_inquiry"||kind==="open_scaffold") {
      if(anchor===null)anchor=current;current=++counter;
      inquiryProtocol=(d.inquiry as {inquiry_protocol_id?:string}|undefined)?.inquiry_protocol_id;
      inquiryBeat=inquiryProtocol ? resolveInquiryEntryBeat?.(inquiryProtocol) : undefined;
    } else if(kind==="continue_inquiry" && inquiryProtocol) {
      if(!inquiryBeat) fail('VISUAL_INQUIRY_ENTRY_MISSING','pinned inquiry entry is required to reconstruct visits');
      if(d.protocol_id!==inquiryProtocol) fail('VISUAL_INQUIRY_PROTOCOL_MISMATCH','continued inquiry must name its active protocol');
      const target=String(d.to_beat_id??d.beat_id);
      if(target!==inquiryBeat) {current=++counter;inquiryBeat=target;}
    } else if(kind==="return_to_mainline") {
      if(anchor!==null)current=anchor;anchor=null;inquiryProtocol=undefined;inquiryBeat=undefined;
    } else if(kind==="transition_beat"||kind==="revisit_beat"||kind==="execute_beat"&&counter===0) {
      current=++counter;anchor=null;inquiryProtocol=undefined;inquiryBeat=undefined;
    }
  }
  return {counter,current,anchor};
}
export function assertVisualExecutionOwner(state: TutorRuntimeStateV10, owner: unknown): void {
  const parsed = visualExecutionOwnerSchema.safeParse(owner);
  if (!parsed.success || !equal(parsed.data, state.presentation_execution_owner)) fail('PRESENTATION_OWNER_STALE', 'presentation execution owner is stale');
}
export function initialStateFromSessionStartedV10(event: StoredSessionEvent): TutorRuntimeStateV10 {
  const owner = visualExecutionOwnerSchema.parse(event.payload.presentation_execution_owner);
  if (owner.epoch !== 1) fail('PRESENTATION_OWNER_STALE', 'initial execution epoch must be 1');
  const base = initialStateFromSessionStartedV9(event as never);
  const state = adoptV7Lineage({ ...base, schema: 'ai_teaching_tutor_runtime_state/v5' as const,
    scope_epoch: 0, presentation_execution_owner: owner, visual_barrier: null }, base);
  histories.set(state, []);
  return state;
}
function causeOf(history: readonly StoredSessionEvent[], event: StoredSessionEvent): StoredSessionEvent {
  const cause = history.find(e => e.sequence === event.causation_sequence);
  if (!cause) return fail('CAUSATION_REF_INVALID', 'visual causation must reference an earlier event');
  return cause;
}
function freezeTarget(barrier: Exclude<VisualBarrier, {status:'awaiting-control'}>): unknown {
  return [barrier.target_event_sequence, barrier.catalog_hash, barrier.target_visual_revision, barrier.target_digest];
}
function validateBarrierChange(state: TutorRuntimeStateV10, history: readonly StoredSessionEvent[], event: StoredSessionEvent, context: V10FoldContext): VisualBarrier | null {
  const previous = state.visual_barrier;
  if (event.payload.previous_barrier_id !== (previous?.barrier_id ?? null)) fail('VISUAL_BARRIER_CONFLICT', 'previous barrier identity does not match');
  const barrier = event.payload.barrier === null ? null : visualBarrierSchema.parse(event.payload.barrier);
  const cause = causeOf(history, event);
  if (!barrier) {
    if (!previous || previous.status !== 'awaiting-cleanup' || cause.event_type !== 'presentation_action_outcome_recorded'
      || cause.payload.outcome !== 'presented' || cause.payload.sequence_id !== previous.cleanup_sequence_id)
      fail('VISUAL_RELEASE_WITHOUT_RECEIPT', 'barrier release requires its actual cleanup presented');
    return null;
  }
  assertVisualExecutionOwner(state, barrier.execution_owner);
  if (barrier.status === 'awaiting-control') {
    if (previous || cause.event_type !== 'presentation_action_outcome_recorded') fail('VISUAL_HOLD_INVALID', 'hold requires actual outcome and no existing barrier');
    return barrier;
  }
  if (barrier.status === 'failed') {
    if (!previous || previous.status !== 'awaiting-cleanup' || !equal({...previous,status:'failed'}, barrier)
      || cause.event_type !== 'presentation_action_outcome_recorded' || cause.payload.outcome === 'presented'
      || cause.payload.sequence_id !== previous.cleanup_sequence_id) fail('VISUAL_BARRIER_CONFLICT', 'failed barrier requires actual unsuccessful cleanup');
    return barrier;
  }
  if (previous && previous.status !== 'awaiting-control' && previous.barrier_id === barrier.barrier_id) {
    if (previous.status !== 'failed' || !equal(freezeTarget(previous), freezeTarget(barrier))
      || previous.cleanup_sequence_id === barrier.cleanup_sequence_id || previous.cause !== barrier.cause
      || previous.control_request_id !== barrier.control_request_id) fail('VISUAL_TARGET_DRIFT', 'retry changes only cleanup identity and status');
  } else {
    if (previous && previous.barrier_id !== barrier.barrier_id && barrier.supersedes_barrier_id !== previous.barrier_id)
      fail('VISUAL_BARRIER_CONFLICT', 'replacement must name superseded barrier');
    if (cause.event_type !== 'workspace_visual_owners_invalidated' || barrier.target_event_sequence !== cause.sequence)
      fail('VISUAL_TARGET_DRIFT', 'cleanup target must freeze its invalidation event boundary');
    if (barrier.catalog_hash !== context.visual.catalogHash) fail('VISUAL_TARGET_DRIFT', 'cleanup catalog is not session pinned');
    const view = context.visual.projectAt(history.filter(e => e.sequence <= barrier.target_event_sequence));
    if (view.visual_revision !== barrier.target_visual_revision || view.digest !== barrier.target_digest)
      fail('VISUAL_TARGET_DRIFT', 'cleanup target differs from the exact safe projection');
  }
  return barrier;
}
export function applyV10Event(state: TutorRuntimeStateV10, event: StoredSessionEvent, context: V10FoldContext): TutorRuntimeStateV10 {
  const history = visualSessionHistory(state);
  const barrier = state.visual_barrier;
  let next: TutorRuntimeStateV10;
  if(barrier) {
    const lifecycle=new Set(['visual_barrier_changed','presentation_execution_claimed','workspace_visual_owners_invalidated','presentation_sequence_superseded','presentation_generation_invalidated']);
    const cleanup=new Set(['presentation_sequence_planned','presentation_action_validated','presentation_action_applied','presentation_action_delivered','presentation_action_outcome_recorded']);
    if(event.event_type==='student_input_recorded') {
      const input=event.payload.input as {kind?:string;command?:string}|undefined;
      const matched=input?.kind==='control' && (barrier.status==='awaiting-control' && input.command==='barge_in' && event.payload.client_request_id===barrier.control_request_id
        || barrier.status==='failed' && input.command==='retry_recovery');
      if(!matched) fail('VISUAL_BARRIER_ACTIVE','only the exact held control or failed cleanup retry is admitted');
    } else if(!lifecycle.has(event.event_type) && !(barrier.status==='awaiting-cleanup' && cleanup.has(event.event_type))) {
      fail('VISUAL_BARRIER_ACTIVE',`${event.event_type} is not authorized during cleanup`);
    }
  }
  if (event.event_type === 'visual_barrier_changed') {
    next = adoptV7Lineage({...state, state_revision:event.state_revision, visual_barrier:validateBarrierChange(state,history,event,context)},state);
  } else if (event.event_type === 'presentation_execution_claimed') {
    const owner = visualExecutionOwnerSchema.parse(event.payload.execution_owner);
    if (!equal(event.payload.previous_owner,state.presentation_execution_owner) || owner.epoch !== state.presentation_execution_owner.epoch + 1)
      fail('PRESENTATION_OWNER_STALE', 'claim must allocate exactly the next server epoch');
    if (history.some(e => e.event_type === event.event_type && e.payload.client_request_id === event.payload.client_request_id))
      fail('VISUAL_CLAIM_DUPLICATE', 'committed claim retries must return their snapshot without reacquiring');
    if (!history.some(e => e.event_type === 'policy_decision_made')) fail('VISUAL_BOOTSTRAP_REQUIRED', 'claim requires a real initial decision');
    causeOf(history,event);
    next = adoptV7Lineage({...state,state_revision:event.state_revision,presentation_execution_owner:owner},state);
  } else if (event.event_type === 'workspace_visual_owners_invalidated') {
    causeOf(history,event);
    context.visual.validateInvalidation(history,event);
    next = adoptV7Lineage({...state,state_revision:event.state_revision,workspace_revision:Number(event.payload.resulting_workspace_revision)},state);
  } else {
    if (barrier && ['presentation_generation_requested','presentation_generation_attempt_started','presentation_generation_retry_scheduled','student_workspace_command_recorded','action_outcome_recorded'].includes(event.event_type))
      fail('VISUAL_BARRIER_ACTIVE', `${event.event_type} cannot cross a visual barrier`);
    if (event.event_type === 'presentation_sequence_planned') {
      const plan = presentationPlanV5Schema.parse({...event.payload,schema:'ai_teaching_presentation_plan/v5',session_id:event.session_id});
      if (state.presentation_cursor.status !== 'idle') fail('VISUAL_CURSOR_BUSY','terminate the previous cursor before planning');
      if (plan.purpose === 'visual-reconcile') {
        if (!barrier || barrier.status !== 'awaiting-cleanup' || plan.sequence_id !== barrier.cleanup_sequence_id)
          fail('VISUAL_RECONCILE_UNAUTHORIZED','system cleanup requires its exact active barrier');
        const action = plan.actions[0].workspace_action!;
        const command = geometryVisualCommandSchema.parse(JSON.parse(action.command_payload ?? ''));
        if (command.op !== 'reconcile' || command.barrier_id !== barrier.barrier_id || command.target_digest !== barrier.target_digest || command.target_visual_revision !== barrier.target_visual_revision)
          fail('VISUAL_TARGET_DRIFT','reconcile command differs from frozen target');
        const barrierEvent = causeOf(history,event);
        if (barrierEvent.event_type !== 'visual_barrier_changed' || !equal(barrierEvent.payload.barrier,barrier)) fail('VISUAL_RECONCILE_UNAUTHORIZED','cleanup plan must be caused by its barrier');
        const decision = history.find(e => e.event_type === 'policy_decision_made' && e.payload.decision_id === plan.decision_id);
        if (!decision || decision.sequence >= barrier.target_event_sequence) fail('VISUAL_RECONCILE_UNAUTHORIZED','cleanup requires a real preceding decision');
        const original=history.find(e=>e.event_type==='presentation_sequence_planned' && e.payload.purpose==='visual-reconcile'
          && (e.payload.actions as Array<{workspace_action?:{command_payload?:string}}>).some(a=>{try{return JSON.parse(a.workspace_action?.command_payload??'null')?.barrier_id===barrier.barrier_id;}catch{return false;}}));
        if(original && (original.payload.decision_id!==plan.decision_id || !equal(original.payload.scope,plan.scope))) fail('VISUAL_TARGET_DRIFT','retry must preserve the original cleanup decision and scope');
        const sourcePlan=history.find(e=>e.event_type==='presentation_sequence_planned' && e.payload.decision_id===plan.decision_id && e.payload.purpose==='teaching');
        const expectedScope=sourcePlan?.payload.scope??{kind:'approved',protocol_id:decision.payload.protocol_id,beat_id:decision.payload.beat_id};
        if(!equal(plan.scope,expectedScope)) fail('VISUAL_RECONCILE_UNAUTHORIZED','cleanup scope must match the real source decision');
      } else if (barrier) fail('VISUAL_BARRIER_ACTIVE','teaching plan cannot cross cleanup');
    }
    if (barrier && ['presentation_action_validated','presentation_action_applied','presentation_action_delivered','presentation_action_outcome_recorded'].includes(event.event_type)
      && (barrier.status !== 'awaiting-cleanup' || event.payload.sequence_id !== barrier.cleanup_sequence_id))
      fail('VISUAL_BARRIER_ACTIVE','only the exact cleanup action may execute');
    if(event.event_type==='presentation_sequence_superseded' && ['superseded-before-start','execution-revoked'].includes(String(event.payload.reason))) {
      const cause=causeOf(history,event);
      if(event.payload.reason==='execution-revoked') {
        if(cause.event_type!=='presentation_execution_claimed' || !equal(cause.payload.execution_owner,state.presentation_execution_owner)) fail('VISUAL_REVOCATION_UNAUTHORIZED','execution revocation requires the current claim');
      } else {
        const input=cause.payload.input as {kind?:string;command?:string;not_started_delivery?:{sequence_id:string;ordinal:number;action_id:string}}|undefined;
        const delivery=input?.not_started_delivery;
        if(cause.event_type!=='student_input_recorded'||input?.kind!=='control'||input.command!=='barge_in'||!delivery
          ||delivery.sequence_id!==event.payload.sequence_id||delivery.ordinal!==event.payload.pending_ordinal||delivery.action_id!==event.payload.pending_action_id)
          fail('VISUAL_REVOCATION_UNAUTHORIZED','not-started cancellation requires its exact control declaration');
      }
    }
    if (event.event_type === 'presentation_sequence_superseded' && state.presentation_cursor.status === 'awaiting_browser') {
      if (!['superseded-before-start','execution-revoked'].includes(String(event.payload.reason))) fail('VISUAL_ACTUAL_OUTCOME_REQUIRED','control cannot forge interrupted');
      const cursor = state.presentation_cursor;
      if (event.payload.sequence_id !== cursor.sequence_id || event.payload.pending_ordinal !== cursor.ordinal || event.payload.pending_action_id !== cursor.action_id)
        fail('PRESENTATION_CURSOR_MISMATCH','revocation must name the exact pending delivery');
    }
    context.visual.validateTeachingAction?.(history,event);
    next = applyV9Event(state as never,event as never,context) as unknown as TutorRuntimeStateV10;
    if (event.event_type === 'policy_decision_made') next.scope_epoch=visualScopeEpochs([...history,event],context.visual.resolveInquiryEntryBeat).counter;
  }
  histories.set(next,[...history,event]);
  return next;
}
/** Runs under SQLite's write transaction, and at each committed revision on replay. */
export function validateVisualBatchEnd(before: TutorRuntimeStateV10, events: readonly StoredSessionEvent[], after: TutorRuntimeStateV10): void {
  const has = (type:string) => events.some(e=>e.event_type===type);
  const changedScope = (after.scope_epoch !== before.scope_epoch && before.scope_epoch > 0) || before.teaching_cursor.beat_id !== after.teaching_cursor.beat_id || before.teaching_cursor.protocol_id !== after.teaching_cursor.protocol_id
    || !equal(before.inquiry_cursor,after.inquiry_cursor) || before.completed !== after.completed;
  const changedOwner = !equal(before.presentation_execution_owner,after.presentation_execution_owner);
  if ((changedScope || changedOwner || has('workspace_visual_owners_invalidated')) && (!has('workspace_visual_owners_invalidated') || !has('visual_barrier_changed') || after.visual_barrier?.status !== 'awaiting-cleanup'))
    fail('VISUAL_BATCH_INCOMPLETE','scope/owner transition requires invalidation and cleanup in one CAS');
  const barrier = after.visual_barrier;
  if (barrier?.status === 'awaiting-cleanup') {
    const cursor = after.presentation_cursor;
    if (cursor.status !== 'awaiting_browser' || cursor.sequence_id !== barrier.cleanup_sequence_id || cursor.ordinal !== 0)
      fail('VISUAL_BATCH_INCOMPLETE','awaiting-cleanup requires the unique cleanup cursor');
    if (after.generation_slot.status === 'pending') fail('VISUAL_BATCH_INCOMPLETE','invalidate old generation before cleanup');
  }
  if (barrier?.status === 'failed' && (after.presentation_cursor.status !== 'failed' && after.presentation_cursor.status !== 'idle'))
    fail('VISUAL_BATCH_INCOMPLETE','failed cleanup cannot leave a live delivery');
  const cleanupIds = new Set([before.visual_barrier,after.visual_barrier].flatMap(b=>b && b.status!=='awaiting-control'?[b.cleanup_sequence_id]:[]));
  const outcomes = events.filter(e=>e.event_type==='presentation_action_outcome_recorded' && cleanupIds.has(String(e.payload.sequence_id)));
  if (outcomes.some(e=>e.payload.outcome==='presented') && after.visual_barrier !== null) fail('VISUAL_BATCH_INCOMPLETE','cleanup presented and release must share a CAS');
  if (outcomes.some(e=>e.payload.outcome!=='presented') && after.visual_barrier?.status !== 'failed') fail('VISUAL_BATCH_INCOMPLETE','unsuccessful cleanup must persist failed barrier');
  if (events.some(e=>e.event_type==='presentation_action_delivered'&&cleanupIds.has(String(e.payload.sequence_id)))
    && events.some(e=>e.event_type==='presentation_action_delivered'&&!cleanupIds.has(String(e.payload.sequence_id)))) fail('VISUAL_BATCH_INCOMPLETE','ordinary delivery and cleanup cannot share a batch');
  if(barrier?.status==='awaiting-control' && events.some(e=>['presentation_action_delivered','presentation_action_applied','presentation_sequence_planned'].includes(e.event_type)))
    fail('VISUAL_BATCH_INCOMPLETE','hold batch cannot apply or deliver the next ordinary action');
  tutorRuntimeStateV5Schema.parse(after);
}
export function foldCommittedV10Events(events: readonly StoredSessionEvent[], context: V10FoldContext): TutorRuntimeStateV10 {
  if (!events.length) return fail('MISSING_SESSION_START','empty stream');
  let state = initialStateFromSessionStartedV10(events[0]);
  let batch: StoredSessionEvent[] = [], before = state;
  for (const event of events) {
    if (batch.length && batch[0].state_revision !== event.state_revision) { validateVisualBatchEnd(before,batch,state); before=state; batch=[]; }
    state=applyV10Event(state,event,context); batch.push(event);
  }
  validateVisualBatchEnd(before,batch,state);
  return state;
}
