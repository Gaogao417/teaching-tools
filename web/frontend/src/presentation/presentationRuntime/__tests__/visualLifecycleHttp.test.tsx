/** Scripted loopback HTTP faults, real client/decoder/controller/hook. No providers. */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpTutorRuntimeClient, TutorRuntimeHttpError } from "../../../api/tutorRuntimeClient";
import { useTutorLearning } from "../../../action-runtime/tutor/useTutorLearning";
import { RUNTIME_SESSION_ID, RUNTIME_TASK_ID, validFromRaw } from "../../../action-runtime/tutor/__tests__/runtimeSnapshotFixture";
import type { TaskId } from "../../../../../shared/contracts";
import { presentationClientInstanceId } from "../PresentationExecutionOwner";
import { PresentationRuntimeController } from "../PresentationRuntimeController";
import { createCapabilityRegistry } from "../capabilityRegistry";
import type { PresentationAdapterResult, PresentationRuntimePorts, PresentationToolAdapter } from "../types";
import { owner, snapshot, barrier } from "./visualRuntimeTestSupport";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Request = { path: string; body: Record<string, any> };
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function server(handle: (request: Request, send: (body: unknown) => void, drop: () => void) => void) {
 const requests: Request[] = [];
 const node = http.createServer((request, response) => {
  const chunks: Buffer[]=[]; request.on("data", c=>chunks.push(c)); request.on("end",()=>{
   const recorded={path:request.url!,body:chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{}}; requests.push(recorded);
   handle(recorded,body=>{response.writeHead(200,{"content-type":"application/json"});response.end(JSON.stringify(body));},()=>response.socket?.destroy());
  });
 });
 await new Promise<void>((resolve,reject)=>{node.once("error",reject);node.listen(0,"127.0.0.1",resolve);});
 cleanups.push(()=>new Promise<void>(resolve=>{node.closeAllConnections();node.close(()=>resolve());}));
 return {requests,client:new HttpTutorRuntimeClient(`http://127.0.0.1:${(node.address() as AddressInfo).port}`)};
}
function runtime(client: HttpTutorRuntimeClient, adapter: PresentationToolAdapter) {
 let controller!: PresentationRuntimeController;
 const notices=vi.fn();
 const ports: PresentationRuntimePorts={clientInstanceId:owner.client_instance_id,
  reportOutcome:r=>client.reportPresentationOutcome(r.sessionId,r.actionId,{sequenceId:r.sequenceId,ordinal:r.ordinal,outcome:r.outcome,failureClass:r.failureClass,message:r.message,clientRequestId:r.clientRequestId,expectedRevision:r.expectedRevision,executionOwner:r.executionOwner,holdForControl:r.holdForControl}),
  adoptOutcomeSnapshot:s=>{controller.adopt(s);return true;},onNotice:notices,onProtocolAnomaly:notices,onStateChanged:vi.fn(),isDefinitiveFailure:e=>e instanceof TutorRuntimeHttpError&&e.status<500};
 controller=new PresentationRuntimeController(createCapabilityRegistry([adapter]),[adapter],ports);cleanups.push(()=>controller.dispose());return {controller,notices};
}
describe("H11–15 visual lifecycle over real HTTP",()=>{
 it("natural ended already sent without hold: preserves wire payload and cancels returned not-started delivery",async()=>{
  let release!: (body:unknown)=>void;
  const h=await server((r,send)=>{if(r.path.endsWith("/outcomes"))release=send;else send(snapshot(23));});
  let ended!: (r:PresentationAdapterResult)=>void;const present=vi.fn(()=>new Promise<PresentationAdapterResult>(r=>ended=r));
  const {controller}=runtime(h.client,{supports:a=>a.kind==="voice",present});controller.adopt(snapshot(20,"voice"));ended({outcome:"presented"});
  await vi.waitFor(()=>expect(h.requests).toHaveLength(1));const original=structuredClone(h.requests[0].body);
  controller.holdForControl("control-1");
  const next=JSON.parse(JSON.stringify(snapshot(21,"voice")));next.pending_presentation.ordinal=1;release(validFromRaw(next));
  await vi.waitFor(()=>expect(controller.notStartedDelivery()).toBeDefined());
  await h.client.submitStudentInput(RUNTIME_SESSION_ID,{kind:"control",command:"barge_in",not_started_delivery:controller.notStartedDelivery()},21,"control-1",owner);
  expect(h.requests[0].body).toEqual(original);expect(original.hold_for_control).toBeUndefined();expect(original.outcome).toBe("presented");
  expect(h.requests[1].body.input.not_started_delivery.ordinal).toBe(1);expect(present).toHaveBeenCalledTimes(1);
 });
 it.each(["presented", "interrupted"] as const)("hold attached before %s outcome survives dropped acknowledgement byte-for-byte",async outcome=>{
  let calls=0;
  const controlBarrier={status:"awaiting-control" as const,barrier_id:"barrier",cause:"barge-in" as const,execution_owner:owner,control_request_id:"control-1"};
  const h=await server((_r,send,drop)=>{if(++calls===1)drop();else send(snapshot(21,undefined,controlBarrier));});
  let settle!: (result: PresentationAdapterResult) => void;
  const present=vi.fn(({abort})=>new Promise<PresentationAdapterResult>(r=>{settle=r;abort.addEventListener("abort",()=>r({outcome:"interrupted"}),{once:true});}));
  const {controller}=runtime(h.client,{supports:a=>a.kind==="voice",present});controller.adopt(snapshot(20,"voice"));controller.holdForControl("control-1");
  if(outcome==="presented")settle({outcome:"presented"});
  await controller.interruptCurrentSettled();await vi.waitFor(()=>expect(h.requests).toHaveLength(1));
  controller.adopt(snapshot(20,"voice"));await vi.waitFor(()=>expect(h.requests).toHaveLength(2));
  expect(h.requests[1].body).toEqual(h.requests[0].body);expect(h.requests[0].body.hold_for_control).toEqual({client_request_id:"control-1"});expect(h.requests[0].body.outcome).toBe(outcome);expect(present).toHaveBeenCalledTimes(1);
 });
 it("200 noncommitted outcome does not release interrupt handshake",async()=>{
  const failed=JSON.parse(JSON.stringify(snapshot(21)));
  failed.turn={status:"revision-conflict",failure:{category:"presentation",failure_class:"STALE_REVISION",retryable:true}};
  validFromRaw(failed); // This negative must be a legal 200, not a decoder failure.
  const h=await server((_r,send)=>send(failed));
  const {controller}=runtime(h.client,{supports:a=>a.kind==="voice",present:({abort})=>new Promise(r=>abort.addEventListener("abort",()=>r({outcome:"interrupted"}),{once:true}))});
  controller.adopt(snapshot(20,"voice"));controller.holdForControl("control-1");
  expect(await controller.interruptCurrentSettled()).toEqual({status:"failed"});expect(h.requests).toHaveLength(1);
 });
});

function pageSnapshot(revision: number, kind?: "cleanup", failed = false) {
 const raw = JSON.parse(JSON.stringify(snapshot(revision, kind, kind || failed ? {...barrier,status:failed?"failed":"awaiting-cleanup"} : undefined)));
 const pageOwner={client_instance_id:presentationClientInstanceId(),epoch:1};
 raw.presentation_execution_owner=pageOwner;
 if(raw.pending_presentation)raw.pending_presentation.execution_owner=pageOwner;
 if(raw.visual_barrier)raw.visual_barrier.execution_owner=pageOwner;
 return validFromRaw(raw);
}
it.each(["control-rejected", "cleanup-failed"])("hook microphone remains closed through real HTTP %s", async failure => {
 let retrying=false;
 const h=await server((request,send)=>{
  if(request.path.endsWith("/student-inputs")) {
   if(failure==="control-rejected") {
    const response=JSON.parse(JSON.stringify(pageSnapshot(21)));
    response.turn={status:"revision-conflict",failure:{category:"presentation",failure_class:"STALE_REVISION",retryable:true}};
    send(validFromRaw(response));
   } else {
    retrying=request.body.input.command==="retry_recovery";
    const target=JSON.parse(JSON.stringify(pageSnapshot(retrying?23:21,"cleanup")));
    if(retrying){target.pending_presentation.sequence_id="PS-0100";target.visual_barrier.cleanup_sequence_id="PS-0100";}
    send(validFromRaw(target));
   }
  } else if(request.path.endsWith("/outcomes")) send(retrying?pageSnapshot(24):pageSnapshot(22,undefined,true));
  else send(pageSnapshot(20));
 });
 let tutor!: ReturnType<typeof useTutorLearning>;
 const element=document.createElement("div");document.body.append(element);const root=createRoot(element);
 function Probe(){tutor=useTutorLearning({taskId:RUNTIME_TASK_ID as TaskId,studentId:"offline-test",runtimeClient:h.client});return null;}
 await act(async()=>{root.render(<Probe/>);});
 cleanups.push(async()=>{await act(async()=>root.unmount());element.remove();});
 await act(async()=>{await tutor.restore(RUNTIME_SESSION_ID);});
 const surface=tutor.workspaceSurface;
 if(surface.source!=="canonical"||!surface.commitSignal?.visualRenderer)throw new Error("missing real runtime port");
 const port=surface.commitSignal.visualRenderer;
 port.attach({render:async(_view,execution)=>{
  if(execution.operation==="removed"&&!retrying)throw new Error("scripted actual cleanup failure");
  const {abort:_a,pulseIds:_p,...receipt}=execution;return receipt;
 },suppress:vi.fn()});
 await act(async()=>{surface.commitSignal!.notifyRealSourceActive();await new Promise(r=>setTimeout(r,20));});
 const safeView=pageSnapshot(20).views.student_workspace_view;
 if(safeView.schema!=="ai_teaching_student_workspace_view/v3")throw new Error("expected visual view");
 expect(port.isReady(safeView.canvas.visual)).toBe(true);
 let allowed: boolean|undefined;
 await act(async()=>{void tutor.prepareRecordingStart().then(result=>allowed=result);await new Promise(r=>setTimeout(r,30));});
 for(let i=0;i<20&&allowed===undefined;i++)await act(async()=>{await new Promise(r=>setTimeout(r,20));});
 expect(allowed).toBe(false);
 if(failure==="cleanup-failed"){
  expect(tutor.runtimeVisualBarrier?.status).toBe("failed");
  expect(h.requests.find(r=>r.path.endsWith("/outcomes"))?.body.outcome).toBe("failed");
  expect(tutor.lockRecordingChannel("assistance")).toBeUndefined();
 }
 expect(h.requests.filter(r=>r.path.endsWith("/student-inputs"))).toHaveLength(1);
 expect(h.requests.some(r=>r.path.endsWith("/asr"))).toBe(false);
 if(failure==="cleanup-failed") {
  let settled=false;
  await act(async()=>{void tutor.submitControl("retry_recovery").then(()=>settled=true);await new Promise(r=>setTimeout(r,30));});
  for(let i=0;i<20&&!settled;i++)await act(async()=>{await new Promise(r=>setTimeout(r,20));});
  expect(settled).toBe(true);expect(tutor.runtimeVisualBarrier).toBeNull();
  expect(h.requests.filter(r=>r.path.endsWith("/outcomes")).map(r=>r.body.outcome)).toEqual(["failed","presented"]);
  expect(port.isReady(safeView.canvas.visual)).toBe(true);
 }
});

it("H33 real HTTP: B claims while A cleanup 200 is delayed, with no prior B observation in A", async () => {
 let authority=pageSnapshot(20);
 let releaseCleanup!: (value: unknown)=>void;
 const h=await server((request,send)=>{
  if(request.path.endsWith("/student-inputs"))send(pageSnapshot(21,"cleanup"));
  else if(request.path.endsWith("/outcomes"))releaseCleanup=send;
  else send(authority);
 });
 let tutor!: ReturnType<typeof useTutorLearning>;
 const element=document.createElement("div");document.body.append(element);const root=createRoot(element);
 function Probe(){tutor=useTutorLearning({taskId:RUNTIME_TASK_ID as TaskId,studentId:"offline-owner",runtimeClient:h.client});return null;}
 await act(async()=>root.render(<Probe/>));
 cleanups.push(async()=>{await act(async()=>root.unmount());element.remove();});
 await act(async()=>{await tutor.restore(RUNTIME_SESSION_ID);});
 const surface=tutor.workspaceSurface;
 if(surface.source!=="canonical"||!surface.commitSignal?.visualRenderer)throw new Error("visual surface missing");
 surface.commitSignal.visualRenderer.attach({render:async(_v,{abort:_a,pulseIds:_p,...receipt})=>receipt,suppress:vi.fn()});
 await act(async()=>{surface.commitSignal!.notifyRealSourceActive();await new Promise(r=>setTimeout(r,20));});
 let allowed: boolean|undefined;
 await act(async()=>{void tutor.prepareRecordingStart().then(value=>allowed=value);await new Promise(r=>setTimeout(r,30));});
 for(let i=0;i<20&&!releaseCleanup;i++)await act(async()=>{await new Promise(r=>setTimeout(r,20));});
 expect(releaseCleanup).toBeTypeOf("function");expect(allowed).toBeUndefined();
 const newer=JSON.parse(JSON.stringify(pageSnapshot(23)));newer.presentation_execution_owner={client_instance_id:"page-other-owner",epoch:2};authority=validFromRaw(newer);
 expect(tutor.runtimeOwnerRequired).toBe(false); // No manually injected B snapshot.
 await act(async()=>{releaseCleanup(pageSnapshot(22));await new Promise(r=>setTimeout(r,30));});
 for(let i=0;i<20&&allowed===undefined;i++)await act(async()=>{await new Promise(r=>setTimeout(r,20));});
 expect(allowed).toBe(false);expect(tutor.runtimeOwnerRequired).toBe(true);
 expect(tutor.lockRecordingChannel("assistance")).toBeUndefined();
 expect(h.requests.filter(r=>!r.path.endsWith("/student-inputs")&&!r.path.endsWith("/outcomes"))).toHaveLength(2);
 expect(h.requests.some(r=>r.path.endsWith("/asr"))).toBe(false);
});
