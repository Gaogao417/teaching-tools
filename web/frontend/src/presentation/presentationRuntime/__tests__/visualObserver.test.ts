import { describe,it,expect,vi } from 'vitest';
import { PresentationRuntimeController } from '../PresentationRuntimeController';
import { createCapabilityRegistry } from '../capabilityRegistry';
import { validFromRaw } from '../../../action-runtime/tutor/__tests__/runtimeSnapshotFixture';
import { snapshot,barrier,owner } from './visualRuntimeTestSupport';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup(clientInstanceId='observer-page'){
 let generation=1;
 let ready=false;const prepare=vi.fn(async(_snapshot:ReturnType<typeof snapshot>,_abort:AbortSignal)=>{ready=true;return true;});
 const report=vi.fn(),present=vi.fn();const adapter={supports:()=>true,present};
 const controller=new PresentationRuntimeController(createCapabilityRegistry([adapter]),[adapter],{clientInstanceId,visualSurfaceGeneration:()=>generation,visualSnapshotReady:()=>ready,prepareVisualSnapshot:prepare,reportOutcome:report,adoptOutcomeSnapshot:()=>true,onProtocolAnomaly:vi.fn(),onNotice:vi.fn(),onStateChanged:vi.fn(),isDefinitiveFailure:()=>false});
 return {controller,prepare,report,present,replaceSurface:()=>generation++};
}
describe('non-owner static visual restore',()=>{
 it('installs idle baseline without execution or outcome',async()=>{const t=setup();t.controller.adopt(snapshot(21));await flush();expect(t.prepare).toHaveBeenCalledOnce();expect(t.report).not.toHaveBeenCalled();expect(t.present).not.toHaveBeenCalled();t.controller.dispose();});
 it.each(['voice','cleanup'] as const)('never installs pending %s projected effects',async kind=>{const t=setup();t.controller.adopt(snapshot(21,kind,kind==='cleanup'?barrier:undefined));await flush();expect(t.prepare).not.toHaveBeenCalled();expect(t.report).not.toHaveBeenCalled();t.controller.dispose();});
});

function varied(revision:number, mutate:(raw:any)=>void){const raw=JSON.parse(JSON.stringify(snapshot(revision)));mutate(raw);return validFromRaw(raw);}
it.each(['pending','failed'])('observer blocks %s generation',async status=>{
 const t=setup();const s=varied(21,r=>{r.generation={status,request_id:'GR-TS4242-0001',attempt:1,max_attempts:3,...(status==='pending'?{phase:'running'}:{error_class:'RETRY_EXHAUSTED'})};r.scope={kind:'approved',protocol_id:'PR-SMV-001',beat_id:'BT-04'};});
 t.controller.adopt(s);await flush();expect(t.prepare).not.toHaveBeenCalled();expect(t.report).not.toHaveBeenCalled();t.controller.dispose();
});
it('observer blocks failed projected state',async()=>{const t=setup();t.controller.adopt(varied(21,r=>{r.views.status.last_failure={category:'presentation',failure_class:'internal_error'};}));await flush();expect(t.prepare).not.toHaveBeenCalled();t.controller.dispose();});
it.each(['pending','owner','session','legacy','dispose'])('invalidates old asynchronous prepare on %s',async kind=>{
 const t=setup();let finish!:(value:boolean)=>void;let abort!:AbortSignal;
 t.prepare.mockImplementationOnce(async(_s,signal)=>{abort=signal;return new Promise<boolean>(resolve=>finish=resolve);});
 t.controller.adopt(snapshot(21));await flush();expect(t.prepare).toHaveBeenCalledOnce();
 if(kind==='dispose')t.controller.dispose();
 else if(kind==='pending')t.controller.adopt(snapshot(22,'voice'));
 else t.controller.adopt(varied(22,r=>{
  if(kind==='owner')r.presentation_execution_owner={client_instance_id:'another-observer',epoch:2};
  if(kind==='session'){r.session_id='TS-99000802';r.views.status.session_id=r.session_id;r.views.student_workspace_view.session_id=r.session_id;r.views.coach_panel_view.session_id=r.session_id;}
  if(kind==='legacy'){delete r.presentation_execution_owner;delete r.visual_barrier;r.views.student_workspace_view.schema='ai_teaching_student_workspace_view/v2';delete r.views.student_workspace_view.canvas.visual;}
 }));
 expect(abort.aborted).toBe(true);finish(true);await flush();expect(t.report).not.toHaveBeenCalled();expect(t.present).not.toHaveBeenCalled();t.controller.dispose();
});
it('ignores lower revision without aborting current baseline',async()=>{
 const t=setup();let abort!:AbortSignal;t.prepare.mockImplementationOnce(async(_s,signal)=>{abort=signal;return new Promise<boolean>(()=>{});});
 t.controller.adopt(snapshot(22));t.controller.adopt(snapshot(21,'voice'));await flush();expect(abort.aborted).toBe(false);expect(t.prepare).toHaveBeenCalledOnce();expect(t.report).not.toHaveBeenCalled();t.controller.dispose();
});
it('new real source restarts a pending baseline before its old receipt settles',async()=>{
 const t=setup();let finish!:(value:boolean)=>void;let oldAbort!:AbortSignal;
 t.prepare.mockImplementationOnce(async(_s,signal)=>{oldAbort=signal;return new Promise<boolean>(resolve=>finish=resolve);});
 t.controller.adopt(snapshot(21));await flush();
 t.replaceSurface();t.controller.retryAwaitingRealSignal();await flush();
 expect(oldAbort.aborted).toBe(true);expect(t.prepare).toHaveBeenCalledTimes(2);
 finish(true);await flush();expect(t.report).not.toHaveBeenCalled();expect(t.present).not.toHaveBeenCalled();t.controller.dispose();
});
it('same surface duplicate readiness notification does not cancel baseline',async()=>{
 const t=setup();let abort!:AbortSignal;t.prepare.mockImplementationOnce(async(_s,signal)=>{abort=signal;return new Promise<boolean>(()=>{});});
 t.controller.adopt(snapshot(21));await flush();t.controller.retryAwaitingRealSignal();await flush();
 expect(abort.aborted).toBe(false);expect(t.prepare).toHaveBeenCalledOnce();t.controller.dispose();
});
it('real action identity still rejects changed renderer payload',async()=>{
 const {VisualEffectRegistry}=await import('../../../geometry/react/VisualEffectRegistry');
 const host=document.createElement('div');document.body.append(host);
 const renderer=new VisualEffectRegistry(host,{surfaceGeneration:1,reducedMotion:()=>true});
 const execution={sessionId:'s',executionKey:'real-action',visualRevision:1,targetDigest:'digest',surfaceGeneration:1,operation:'installed' as const,abort:new AbortController().signal};
 const scene={width:300,height:300,glyphs:[{id:'ab',ownerKeys:['main'],color:'blue',description:'AB',kind:'path' as const,points:[{x:30,y:40},{x:200,y:40}]}]};
 try{await renderer.install(scene,execution);await expect(renderer.install({...scene,glyphs:scene.glyphs.map(g=>({...g,color:'red'}))},execution)).rejects.toMatchObject({kind:'identity'});}finally{renderer.dispose();host.remove();}
});

it('owner pending voice executes once after replacement baseline truly finishes',async()=>{
 const t=setup(owner.client_instance_id);let finishOld!:(value:boolean)=>void;
 t.prepare.mockImplementationOnce(async()=>new Promise<boolean>(resolve=>finishOld=resolve));
 t.present.mockResolvedValue({outcome:'awaiting-real-signal'});
 t.controller.adopt(snapshot(21,'voice'));await flush();expect(t.present).not.toHaveBeenCalled();
 t.replaceSurface();t.controller.retryAwaitingRealSignal();await flush();
 expect(t.prepare).toHaveBeenCalledTimes(2);expect(t.present).toHaveBeenCalledOnce();
 finishOld(true);await flush();expect(t.present).toHaveBeenCalledOnce();expect(t.report).not.toHaveBeenCalled();t.controller.dispose();
});
