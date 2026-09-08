import {describe,it,expect,vi} from 'vitest';
import {reportOutcomeWithVoiceAuthority} from '../createTutorPresentationRuntime';
import {snapshot,owner} from './visualRuntimeTestSupport';
import type {TutorRuntimeClient} from '../../../api/tutorRuntimeClient';
import type {PendingPresentationOutcomeRequest} from '../types';
const request={sessionId:snapshot(3).session_id,actionId:'WSA-test',sequenceId:'PS-0001',ordinal:0,outcome:'presented',clientRequestId:'req-test',expectedRevision:3,executionOwner:owner} as PendingPresentationOutcomeRequest;
function client(ack=snapshot(4,'voice'),fresh=snapshot(5)){return {reportPresentationOutcome:vi.fn(async()=>ack),restore:vi.fn(async()=>fresh)};}
describe('ACK voice admission fresh authority',()=>{
 it('adopts fresh changed owner instead of old ACK voice',async()=>{const fresh=structuredClone(snapshot(5));fresh.presentation_execution_owner={client_instance_id:'page-B',epoch:2};const c=client(undefined,fresh);expect(await reportOutcomeWithVoiceAuthority(c as unknown as TutorRuntimeClient,request)).toBe(fresh);expect(c.restore).toHaveBeenCalledExactlyOnceWith(request.sessionId);});
 it('same owner voice checks once after ACK',async()=>{const c=client();await reportOutcomeWithVoiceAuthority(c as unknown as TutorRuntimeClient,request);expect(c.reportPresentationOutcome.mock.invocationCallOrder[0]).toBeLessThan(c.restore.mock.invocationCallOrder[0]);expect(c.restore).toHaveBeenCalledOnce();});
 it('workspace-only continuation adds zero GET',async()=>{const ack=snapshot(4,'cleanup');const c=client(ack);expect(await reportOutcomeWithVoiceAuthority(c as unknown as TutorRuntimeClient,request)).toBe(ack);expect(c.restore).not.toHaveBeenCalled();});
 it('fresh read failure does not release old voice',async()=>{const c=client();c.restore.mockRejectedValue(new Error('offline'));await expect(reportOutcomeWithVoiceAuthority(c as unknown as TutorRuntimeClient,request)).rejects.toThrow('offline');});
 it('older or wrong-session fresh snapshot cannot release old voice',async()=>{for(const fresh of [snapshot(3),{...snapshot(5),session_id:'TS-99000000'}]){const c=client(undefined,fresh as never);await expect(reportOutcomeWithVoiceAuthority(c as unknown as TutorRuntimeClient,request)).rejects.toThrow('authority snapshot');}});
});

it('failed authority GET retries identical acknowledged outcome without replaying completed action',async()=>{
 const {PresentationRuntimeController}=await import('../PresentationRuntimeController');const {createCapabilityRegistry}=await import('../capabilityRegistry');
 const present=vi.fn(async()=>({outcome:'presented' as const}));const adapter={supports:()=>true,present};const ack=snapshot(4,'voice'),fresh=snapshot(5);const c=client(ack,fresh);c.restore.mockRejectedValueOnce(new Error('GET offline'));
 const states:unknown[]=[];const controller=new PresentationRuntimeController(createCapabilityRegistry([adapter]),[adapter],{clientInstanceId:owner.client_instance_id,reportOutcome:r=>reportOutcomeWithVoiceAuthority(c as unknown as TutorRuntimeClient,r),adoptOutcomeSnapshot:s=>{controller.adopt(s);return true;},onNotice:()=>{},onProtocolAnomaly:()=>{},onStateChanged:s=>states.push(s),isDefinitiveFailure:()=>false});
 try{controller.adopt(snapshot(3,'voice'));await vi.waitFor(()=>expect(states).toContainEqual(expect.objectContaining({phase:'outcome-pending',networkFailed:true})));expect(present).toHaveBeenCalledOnce();await controller.retryPendingOutcome();expect(c.reportPresentationOutcome).toHaveBeenCalledTimes(2);expect(c.reportPresentationOutcome.mock.calls[0]).toEqual(c.reportPresentationOutcome.mock.calls[1]);expect(present).toHaveBeenCalledOnce();expect(c.restore).toHaveBeenCalledTimes(2);}finally{controller.dispose();}
});
