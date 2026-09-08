import { tutorRuntimeStateV5Schema, tutorSessionEventV10Schema } from '../../../../shared/canonical';
import { makeV9SessionCodec } from './RuntimeStateRebuilderV9';
import { applyV10Event, foldCommittedV10Events, initialStateFromSessionStartedV10, validateVisualBatchEnd, type TutorRuntimeStateV10, type V10FoldContext } from './TutorRuntimeStateReducerV10';
import type { SessionKernelCodec } from './kernel/sessionKernelCodec';
import { readSessionEvents } from './kernel/TutorSessionStoreCore';
import { rebuildSessionState, verifyCommittedStream, type RebuildOptions } from './kernel/RuntimeStateRebuilderCore';
export type V10RegistryProvider = (payload: Record<string,unknown>) => V10FoldContext;
export function makeV10SessionCodec(provider: V10RegistryProvider): SessionKernelCodec<TutorRuntimeStateV10,V10FoldContext> {
  const base=makeV9SessionCodec(provider);
  return {...base,eventSchemaColumn:'v10',eventSchemaConst:'ai_teaching_tutor_session_event/v10',
    causationRequired:new Set([...base.causationRequired,'visual_barrier_changed','workspace_visual_owners_invalidated','presentation_execution_claimed']),
    eventEnvelopeSchema:tutorSessionEventV10Schema,stateSchema:tutorRuntimeStateV5Schema,
    applyEvent:applyV10Event,foldCommitted:foldCommittedV10Events,initialStateFromSessionStarted:initialStateFromSessionStartedV10,
    resolveFoldContext:provider,validateBatchEnd:validateVisualBatchEnd,
    compareStates:(left,right)=>base.compareStates(left as never,right as never)};
}
export function readTutorSessionEventsV10(sessionId:string,provider:V10RegistryProvider) { return readSessionEvents(makeV10SessionCodec(provider),sessionId); }
export function createV10Rebuilder(provider:V10RegistryProvider) {
  const codec=makeV10SessionCodec(provider);
  return {
    verifyCommittedStreamV10:(sessionId:string,options?:RebuildOptions)=>verifyCommittedStream(codec,sessionId,options),
    rebuildTutorRuntimeStateV10:(sessionId:string,options?:RebuildOptions)=>rebuildSessionState(codec,sessionId,options),
  };
}
