import { describe, expect, it, vi } from "vitest";
import { validFromRaw } from "../../../action-runtime/tutor/__tests__/runtimeSnapshotFixture";
import { createWorkspaceCommitPort } from "../workspaceCommitPort";
import { createGeometryVisualPresentationAdapter } from "../adapters/geometryVisualPresentationAdapter";
import { createCapabilityRegistry } from "../capabilityRegistry";
import { PresentationRuntimeController } from "../PresentationRuntimeController";
import type { PresentationRuntimePorts, PresentationToolAdapter, PresentationAdapterResult } from "../types";
import { owner, snapshot, barrier } from "./visualRuntimeTestSupport";
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
describe("single cursor visual lifecycle", () => {
  it("allows exact cleanup during local control hold, waits for real renderer receipt", async () => {
    const commits = createWorkspaceCommitPort();
    let complete!: () => void;
    const rendered = new Promise<void>(resolve => complete=resolve);
    commits.visualRenderer.attach({ render: async (_view, execution) => { await rendered; const { abort: _a, pulseIds: _p, ...receipt } = execution; return receipt; }, suppress: vi.fn() });
    const adapter = createGeometryVisualPresentationAdapter(commits);
    const report = vi.fn<PresentationRuntimePorts["reportOutcome"]>(async () => snapshot(22));
    const ports: PresentationRuntimePorts = { clientInstanceId:owner.client_instance_id, reportOutcome:report, adoptOutcomeSnapshot:()=>true, onProtocolAnomaly:vi.fn(),onNotice:vi.fn(),onStateChanged:vi.fn(),isDefinitiveFailure:()=>false };
    const controller = new PresentationRuntimeController(createCapabilityRegistry([adapter]), [adapter], ports);
    controller.holdForControl("control-1"); controller.adopt(snapshot(21,"cleanup",barrier));
    await flush(); expect(report).not.toHaveBeenCalled();
    complete(); await flush();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({outcome:"presented",executionOwner:owner});
    expect(report.mock.calls[0][0]).not.toHaveProperty("holdForControl");
    controller.dispose();
  });
  it("natural ended in-flight payload stays unchanged; returned next delivery remains not-started", async () => {
    let end!: (value: PresentationAdapterResult) => void;
    const present = vi.fn(() => new Promise<PresentationAdapterResult>(resolve => end=resolve));
    const adapter: PresentationToolAdapter = { supports:a=>a.kind==="voice",present };
    let respond!: (value: ReturnType<typeof snapshot>) => void;
    const report = vi.fn<PresentationRuntimePorts["reportOutcome"]>(() => new Promise<ReturnType<typeof snapshot>>(resolve => respond=resolve));
    let controller!: PresentationRuntimeController;
    const ports: PresentationRuntimePorts = {clientInstanceId:owner.client_instance_id,reportOutcome:report,adoptOutcomeSnapshot:s=>{controller.adopt(s);return true;},onProtocolAnomaly:vi.fn(),onNotice:vi.fn(),onStateChanged:vi.fn(),isDefinitiveFailure:()=>false};
    controller=new PresentationRuntimeController(createCapabilityRegistry([adapter]),[adapter],ports);
    controller.adopt(snapshot(20,"voice")); await flush(); end({outcome:"presented"}); await flush();
    const request = structuredClone(report.mock.calls[0][0]);
    controller.holdForControl("control-1");
    const nextRaw = JSON.parse(JSON.stringify(snapshot(21,"voice")));nextRaw.pending_presentation.ordinal=1;
    respond(validFromRaw(nextRaw)); await flush();
    expect(report.mock.calls[0][0]).toEqual(request);
    expect(request).not.toHaveProperty("holdForControl");
    expect(present).toHaveBeenCalledTimes(1);
    expect(controller.notStartedDelivery()).toMatchObject({sequence_id:"PS-0001",ordinal:1});
    controller.dispose();
  });
});

it("cleared barrier under local hold permits static baseline recovery but never ordinary delivery",async()=>{
 let ready=false,finish!:()=>void;
 const present=vi.fn(async()=>({outcome:"presented" as const}));
 const adapter:PresentationToolAdapter={supports:a=>a.kind==="voice",present};
 const prepare=vi.fn(async()=>{await new Promise<void>(r=>finish=r);ready=true;return true;});
 const report=vi.fn(async()=>snapshot(22));
 const controller=new PresentationRuntimeController(createCapabilityRegistry([adapter]),[adapter],{clientInstanceId:owner.client_instance_id,visualSnapshotReady:()=>ready,prepareVisualSnapshot:prepare,reportOutcome:report,adoptOutcomeSnapshot:()=>true,onProtocolAnomaly:vi.fn(),onNotice:vi.fn(),onStateChanged:vi.fn(),isDefinitiveFailure:()=>false});
 controller.holdForControl("control-1");controller.adopt(snapshot(21));await flush();
 expect(prepare).toHaveBeenCalledTimes(1);expect(present).not.toHaveBeenCalled();expect(report).not.toHaveBeenCalled();
 finish();await flush();expect(ready).toBe(true);expect(present).not.toHaveBeenCalled();expect(report).not.toHaveBeenCalled();
 controller.adopt(snapshot(22,"voice"));await flush();expect(present).not.toHaveBeenCalled();
 controller.releaseControlHold("control-1");await flush();expect(present).toHaveBeenCalledTimes(1);controller.dispose();
});

it.each(["voice","visual"] as const)("H13 held unstarted %s delivery cannot render through static baseline preparation",async(kind)=>{
 const raw=JSON.parse(JSON.stringify(snapshot(21,"cleanup",barrier)));
 raw.visual_barrier=null;
 raw.pending_presentation.action.workspace_action.capability="geometry.visual.focus";
 raw.pending_presentation.action.workspace_action.command_payload=JSON.stringify({schema:"ai_teaching_geometry_visual_command/v1",op:"focus",group_id:"held-group",binding_ref:"VB-101",mode:"pulse",resolved_targets:{entity_ids:["pt-A"]},owner:{scope:{kind:"approved",protocol_id:"PR-SMV-001",beat_id:"BT-01"},scope_epoch:1,part_ref:"1"}});
 const held=kind==="voice"?snapshot(21,"voice"):validFromRaw(raw);
 const prepare=vi.fn(async()=>true),present=vi.fn(async()=>({outcome:"presented" as const})),report=vi.fn(async()=>snapshot(22));
 const adapter:PresentationToolAdapter={supports:()=>true,present};
 const controller=new PresentationRuntimeController(createCapabilityRegistry([adapter]),[adapter],{clientInstanceId:owner.client_instance_id,visualSnapshotReady:()=>false,prepareVisualSnapshot:prepare,reportOutcome:report,adoptOutcomeSnapshot:()=>true,onProtocolAnomaly:vi.fn(),onNotice:vi.fn(),onStateChanged:vi.fn(),isDefinitiveFailure:()=>false});
 controller.holdForControl("control-1");controller.adopt(held);await flush();
 expect(prepare).not.toHaveBeenCalled();expect(present).not.toHaveBeenCalled();expect(report).not.toHaveBeenCalled();
 expect(controller.notStartedDelivery()?.action_id).toBe(held.pending_presentation!.action_id);controller.dispose();
});
