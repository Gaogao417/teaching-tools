/**
 * F7 Step 6：PresentationRuntimeController 状态机测试（ledger 增补 20 偏差 3）。
 *
 * 锁定：去重键单次执行（StrictMode）、outcomePending 完整请求同 key 同
 * payload 重试不重新呈现、服务端已推进丢弃迟到结果、presented/interrupted/
 * failed 三类 ack 的同键重投规则、200-内 turn 非 committed 释放、4xx 释放、
 * unknown capability fail closed、autoplay 手势恢复、awaiting-real-signal 暂停、
 * replay 零上报。
 */
import { describe, expect, it, vi } from "vitest";

import { PresentationRuntimeController } from "../PresentationRuntimeController";
import { createCapabilityRegistry } from "../capabilityRegistry";
import type {
  PendingPresentationOutcomeRequest,
  PresentationAdapterResult,
  PresentationPresentRequest,
  PresentationRuntimePorts,
  PresentationToolAdapter,
} from "../types";
import type { ValidatedSessionSnapshot } from "../../../api/tutorRuntimeClient";
import {
  pendingBoardPresentation,
  pendingGeometryPresentation,
  pendingVoicePresentation,
  runtimeSnapshotRaw,
  validFromRaw,
} from "../../../action-runtime/tutor/__tests__/runtimeSnapshotFixture";

interface FakeAdapter {
  adapter: PresentationToolAdapter;
  presentCalls: PresentationPresentRequest[];
  resumeCalls: number;
  replayCalls: string[];
  canReplayIds: Set<string>;
  lastReplayable?: string;
  nextResult: PresentationAdapterResult | undefined;
  supportsKind: (action: PresentationPresentRequest["delivery"]["action"]) => boolean;
  /** 每次 present 一个新 deferred（单发 gate 会把第二次执行误判为已结算）。 */
  resolvePresent: (index: number, result: PresentationAdapterResult) => void;
}

function fakeAdapter(supportsKind: FakeAdapter["supportsKind"] = (action) => action.kind === "voice"): FakeAdapter {
  const gates: Array<{ promise: Promise<PresentationAdapterResult>; resolve: (result: PresentationAdapterResult) => void }> = [];
  const fake: FakeAdapter = {
    presentCalls: [],
    resumeCalls: 0,
    replayCalls: [],
    canReplayIds: new Set<string>(),
    supportsKind,
    nextResult: undefined,
    resolvePresent: (index, result) => { gates[index]?.resolve(result); },
    adapter: {
      supports: (action) => supportsKind(action),
      present: (request) => {
        fake.presentCalls.push(request);
        if (fake.nextResult !== undefined) return Promise.resolve(fake.nextResult);
        let resolve!: (result: PresentationAdapterResult) => void;
        const promise = new Promise<PresentationAdapterResult>((settle) => { resolve = settle; });
        gates.push({ promise, resolve });
        return promise;
      },
      resume: () => {
        fake.resumeCalls += 1;
        return Promise.resolve(fake.nextResult ?? { outcome: "presented" });
      },
      canReplay: (actionId) => fake.canReplayIds.has(actionId),
      replay: (actionId) => {
        if (!fake.canReplayIds.has(actionId)) return false;
        fake.replayCalls.push(actionId);
        return true;
      },
      lastReplayableActionId: () => fake.lastReplayable,
    },
  };
  return fake;
}

interface PortsHarness {
  ports: PresentationRuntimePorts;
  requests: PendingPresentationOutcomeRequest[];
  responses: Array<ValidatedSessionSnapshot | Error>;
  notices: string[];
  anomalies: string[];
  states: string[];
  /** 记录 adoptOutcomeSnapshot 收到的 expectedSessionId 序列。 */
  adoptResults: string[];
}

function fakePorts(): PortsHarness {
  const harness: PortsHarness = {
    requests: [],
    responses: [],
    notices: [],
    anomalies: [],
    states: [],
    adoptResults: [],
    ports: {
      reportOutcome: (request) => {
        harness.requests.push(request);
        const response = harness.responses.shift();
        if (response instanceof Error) return Promise.reject(response);
        return Promise.resolve(response ?? validFromRaw(runtimeSnapshotRaw({ revision: 99 })));
      },
      adoptOutcomeSnapshot: (snapshot, expectedSessionId) => {
        harness.adoptResults.push(expectedSessionId);
        void snapshot;
        return true;
      },
      onProtocolAnomaly: (message) => { harness.anomalies.push(message); },
      onNotice: (message) => { harness.notices.push(message); },
      onStateChanged: (state) => { harness.states.push(state.phase); },
      isDefinitiveFailure: (failure) => failure instanceof Error && failure.message.startsWith("definitive"),
    },
  };
  return harness;
}

function snapshotWithVoicePending(revision = 12): ValidatedSessionSnapshot {
  return validFromRaw(runtimeSnapshotRaw({ pendingPresentation: true, revision }));
}

function snapshotWithGeometryPending(revision = 20, workspaceRevision = 7): ValidatedSessionSnapshot {
  return validFromRaw(runtimeSnapshotRaw({
    pendingPresentation: pendingGeometryPresentation(revision, workspaceRevision),
    canvasElements: [{ element_id: "seg-CO", kind: "segment" }],
    revision,
    workspaceRevision,
  }));
}

function snapshotWithBoardPending(revision = 22, workspaceRevision = 8): ValidatedSessionSnapshot {
  return validFromRaw(runtimeSnapshotRaw({
    pendingPresentation: pendingBoardPresentation(revision, workspaceRevision),
    boardEntries: [{ entry_id: "BE-301", kind: "derivation", content: "△DAO∽△DBA" }],
    revision,
    workspaceRevision,
  }));
}

function snapshotWithoutPending(revision = 30): ValidatedSessionSnapshot {
  return validFromRaw(runtimeSnapshotRaw({ revision }));
}

function makeController(fakes: FakeAdapter[], harness: PortsHarness): PresentationRuntimeController {
  return new PresentationRuntimeController(createCapabilityRegistry(fakes.map((fake) => fake.adapter)), fakes.map((fake) => fake.adapter), harness.ports);
}

const DEFINITIVE = () => Object.assign(new Error("definitive 409"), { status: 409 });
const NETWORK = () => new Error("network down");

describe("PresentationRuntimeController（queue head / 去重 / outcome 幂等）", () => {
  it("队首经 matching adapter 执行：presented → outcome 请求字段精确（确定性幂等键 + expected_revision=delivery.session_revision）→ acked", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    const controller = makeController([voice], harness);
    const snapshot = snapshotWithVoicePending(12);
    controller.adopt(snapshot);
    expect(voice.presentCalls).toHaveLength(1);
    expect(voice.presentCalls[0]!.delivery).toBe(snapshot.pending_presentation);
    voice.resolvePresent(0, { outcome: "presented" });
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
    const request = harness.requests[0]!;
    expect(request).toMatchObject({
      sessionId: "TS-99000801",
      actionId: "VA-bt01-narrate",
      sequenceId: "PS-0001",
      ordinal: 0,
      outcome: "presented",
      expectedRevision: 12,
    });
    expect(request.clientRequestId).toBe("pres-outcome:TS-99000801:PS-0001:0:VA-bt01-narrate:presented");
    await vi.waitFor(() => expect(harness.states).toContain("outcome-pending"));
    await vi.waitFor(() => expect(harness.states[harness.states.length - 1]).toBe("idle"));
  });

  it("StrictMode/重复 adopt 同一快照对象：单次执行（去重键 + 对象身份由 hook 守卫，controller 层为同键单次执行）", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    const controller = makeController([voice], harness);
    const snapshot = snapshotWithVoicePending();
    controller.adopt(snapshot);
    controller.adopt(snapshot);
    controller.adopt(snapshot);
    expect(voice.presentCalls).toHaveLength(1);
  });

  it("adapter 完成但 outcome 网络失败：保留完整请求；同键 adopt 重发同 clientRequestId 同 payload，不重新呈现", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    harness.responses.push(NETWORK());
    const controller = makeController([voice], harness);
    controller.adopt(snapshotWithVoicePending());
    voice.resolvePresent(0, { outcome: "presented" });
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
    await vi.waitFor(() => expect(harness.notices).toHaveLength(1));
    // 服务端经 restore 重投同一交付（新快照对象、同键）。
    controller.adopt(snapshotWithVoicePending());
    await vi.waitFor(() => expect(harness.requests).toHaveLength(2));
    expect(voice.presentCalls).toHaveLength(1); // 不重新呈现
    expect(harness.requests[1]).toEqual(harness.requests[0]);
  });

  it("4xx 确定性失败：释放 token + 提示；无新鲜重投不重试；服务端新鲜重投按新交付重新执行", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    harness.responses.push(DEFINITIVE());
    const controller = makeController([voice], harness);
    controller.adopt(snapshotWithVoicePending());
    voice.resolvePresent(0, { outcome: "presented" });
    await vi.waitFor(() => expect(harness.notices).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.requests).toHaveLength(1); // 已释放：无自动重试
    // 服务端新鲜重投（restore 后同键交付）= 新的服务端授权 → 重新执行/重报。
    controller.adopt(snapshotWithVoicePending());
    expect(voice.presentCalls).toHaveLength(2);
    voice.resolvePresent(1, { outcome: "presented" });
    await vi.waitFor(() => expect(harness.requests).toHaveLength(2));
  });

  it("HTTP 200 但快照 turn 非 committed（应用层确定性失败）：释放 + 提示，不盲重试", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    harness.responses.push(validFromRaw(runtimeSnapshotRaw({
      revision: 13,
      turn: { status: "revision-conflict", failure: { category: "presentation", failure_class: "STALE_REVISION", retryable: true } },
    })));
    const controller = makeController([voice], harness);
    controller.adopt(snapshotWithVoicePending(12));
    voice.resolvePresent(0, { outcome: "presented" });
    await vi.waitFor(() => expect(harness.notices).toHaveLength(1));
    expect(harness.notices[0]).toContain("revision-conflict");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.requests).toHaveLength(1); // 不盲重试
    expect(harness.adoptResults).toHaveLength(0); // 未采用（服务端已推进）
  });

  it("服务端已推进（无 pending）：abort 陈旧执行，迟到 presented 不上报", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    const controller = makeController([voice], harness);
    controller.adopt(snapshotWithVoicePending());
    expect(voice.presentCalls).toHaveLength(1);
    controller.adopt(snapshotWithoutPending());
    expect(voice.presentCalls[0]!.abort.aborted).toBe(true);
    voice.resolvePresent(0, { outcome: "presented" }); // 迟到结果
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.requests).toHaveLength(0);
  });

  it("换键（服务端推进到下一动作）：旧执行 abort，新交付立即执行", async () => {
    const voice = fakeAdapter((action) => action.kind === "voice");
    const geometry = fakeAdapter((action) => action.kind === "workspace" && action.workspace_action?.capability === "geometry.construct");
    const harness = fakePorts();
    const controller = makeController([voice, geometry], harness);
    controller.adopt(snapshotWithVoicePending());
    controller.adopt(snapshotWithGeometryPending());
    expect(voice.presentCalls[0]!.abort.aborted).toBe(true);
    expect(geometry.presentCalls).toHaveLength(1);
  });

  it("unknown capability：上报 failed(capability_unsupported)；acked 后同键重投维持暂停", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    const controller = makeController([voice], harness);
    controller.adopt(snapshotWithBoardPending()); // 无 board adapter 注册
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
    expect(harness.requests[0]).toMatchObject({ outcome: "failed", failureClass: "capability_unsupported", actionId: "WSA-bt03-reveal" });
    await vi.waitFor(() => expect(harness.states[harness.states.length - 1]).toBe("paused"));
    controller.adopt(snapshotWithBoardPending());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.requests).toHaveLength(1); // 维持暂停，不自动重试
  });

  it("interrupted-ack 后同键重投 = 服务端重投策略：允许重新执行", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    const controller = makeController([voice], harness);
    controller.adopt(snapshotWithVoicePending());
    controller.interruptCurrent();
    expect(voice.presentCalls[0]!.abort.aborted).toBe(true);
    voice.resolvePresent(0, { outcome: "interrupted" });
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
    expect(harness.requests[0]).toMatchObject({ outcome: "interrupted" });
    await vi.waitFor(() => expect(harness.states[harness.states.length - 1]).toBe("idle"));
    controller.adopt(snapshotWithVoicePending());
    expect(voice.presentCalls).toHaveLength(2);
  });

  it("presented-ack 后同键重投 = 协议异常：fail closed，不重复呈现", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    const controller = makeController([voice], harness);
    controller.adopt(snapshotWithVoicePending());
    voice.resolvePresent(0, { outcome: "presented" });
    await vi.waitFor(() => expect(harness.states[harness.states.length - 1]).toBe("idle"));
    controller.adopt(snapshotWithVoicePending());
    expect(harness.anomalies).toHaveLength(1);
    expect(voice.presentCalls).toHaveLength(1);
    expect(harness.states[harness.states.length - 1]).toBe("paused");
  });

  it("blocked-by-autoplay：暂停等手势；resumeAfterGesture → adapter.resume → presented 上报", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    const controller = makeController([voice], harness);
    controller.adopt(snapshotWithVoicePending());
    voice.resolvePresent(0, { outcome: "blocked-by-autoplay" });
    await vi.waitFor(() => expect(harness.states[harness.states.length - 1]).toBe("awaiting-gesture"));
    expect(harness.requests).toHaveLength(0);
    voice.nextResult = { outcome: "presented" };
    await controller.resumeAfterGesture();
    expect(voice.resumeCalls).toBe(1);
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
    expect(harness.requests[0]).toMatchObject({ outcome: "presented" });
  });

  it("awaiting-real-signal（真实完成信号源未接）：暂停且零上报", async () => {
    const geometry = fakeAdapter((action) => action.kind === "workspace" && action.workspace_action?.capability === "geometry.construct");
    const harness = fakePorts();
    const controller = makeController([geometry], harness);
    controller.adopt(snapshotWithGeometryPending());
    geometry.resolvePresent(0, { outcome: "awaiting-real-signal" });
    await vi.waitFor(() => expect(harness.states[harness.states.length - 1]).toBe("paused"));
    expect(harness.requests).toHaveLength(0);
  });

  it("replayVoice：经 voice adapter 核对后回放，零上报；不匹配 actionId 拒绝", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    const controller = makeController([voice], harness);
    voice.canReplayIds.add("VA-bt01-narrate");
    voice.lastReplayable = "VA-bt01-narrate";
    expect(controller.replayTarget()).toBe("VA-bt01-narrate");
    expect(controller.replayVoice("VA-bt01-narrate")).toBe(true);
    expect(controller.replayVoice("VA-other")).toBe(false);
    expect(voice.replayCalls).toEqual(["VA-bt01-narrate"]);
    expect(harness.requests).toHaveLength(0);
  });

  it("会话切换：迟到 outcome 响应不采用（epoch 守卫）", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    let releaseResponse: (snapshot: ValidatedSessionSnapshot) => void = () => undefined;
    harness.ports.reportOutcome = (request) => {
      harness.requests.push(request);
      return new Promise((resolve) => { releaseResponse = resolve; });
    };
    const controller = makeController([voice], harness);
    controller.adopt(snapshotWithVoicePending());
    voice.resolvePresent(0, { outcome: "presented" });
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
    // 换会话（restore 到新 session 的快照，pending session_id 不同）。
    const otherSessionRaw = JSON.parse(JSON.stringify(runtimeSnapshotRaw({ pendingPresentation: true, revision: 5 }))) as {
      session_id: string;
      views: { student_workspace_view: { session_id: string }; coach_panel_view: { session_id: string }; status: { session_id: string } };
      pending_presentation: { session_id: string };
    };
    for (const target of [
      otherSessionRaw,
      otherSessionRaw.views.student_workspace_view,
      otherSessionRaw.views.coach_panel_view,
      otherSessionRaw.views.status,
      otherSessionRaw.pending_presentation,
    ]) {
      target.session_id = "TS-99000999";
    }
    controller.adopt(validFromRaw(otherSessionRaw));
    releaseResponse(validFromRaw(runtimeSnapshotRaw({ revision: 13 })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.adoptResults).toHaveLength(0); // 迟到响应被丢弃
  });

  it("REVIEW 回归：旧 outcome 响应不得清掉正在执行的新动作（请求身份守卫）", async () => {
    const voice = fakeAdapter((action) => action.kind === "voice");
    const geometry = fakeAdapter((action) => action.kind === "workspace" && action.workspace_action?.capability === "geometry.construct");
    const harness = fakePorts();
    let releaseResponse: (snapshot: ValidatedSessionSnapshot) => void = () => undefined;
    harness.ports.reportOutcome = (request) => {
      harness.requests.push(request);
      return new Promise((resolve) => { releaseResponse = resolve; });
    };
    const controller = makeController([voice, geometry], harness);
    controller.adopt(snapshotWithVoicePending());
    voice.resolvePresent(0, { outcome: "presented" });
    await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
    // 服务端推进：同会话换键交付 B；A 的 outcome 响应尚未返回。
    controller.adopt(snapshotWithGeometryPending());
    await vi.waitFor(() => expect(geometry.presentCalls).toHaveLength(1));
    expect(harness.states[harness.states.length - 1]).toBe("presenting");
    // 旧响应（200 committed）到达——不得把 executing B 清成 idle。
    releaseResponse(validFromRaw(runtimeSnapshotRaw({ revision: 99 })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.states[harness.states.length - 1]).toBe("presenting");
    expect(harness.requests).toHaveLength(1); // 旧响应不触发重试
    // B 正常完成仍可上报（未被旧响应废掉）。
    geometry.resolvePresent(0, { outcome: "presented" });
    await vi.waitFor(() => expect(harness.requests).toHaveLength(2));
    expect(harness.requests[1]).toMatchObject({ actionId: "WSA-bt03-construct-0", outcome: "presented" });
    controller.dispose();
  });

  it("REVIEW 回归：旧 outcome 响应 200+turn 冲突/确定性失败同样不得触碰新执行", async () => {
    const voice = fakeAdapter((action) => action.kind === "voice");
    const geometry = fakeAdapter((action) => action.kind === "workspace" && action.workspace_action?.capability === "geometry.construct");
    const harness = fakePorts();
    const pendingReleases: Array<(value: ValidatedSessionSnapshot | Error) => void> = [];
    harness.ports.reportOutcome = (request) => {
      harness.requests.push(request);
      return new Promise((resolve, reject) => { pendingReleases.push((value) => (value instanceof Error ? reject(value) : resolve(value))); });
    };
    const controller = makeController([voice, geometry], harness);
    controller.adopt(snapshotWithVoicePending());
    voice.resolvePresent(0, { outcome: "failed", failureClass: "provider_failure", message: "x" });
    await vi.waitFor(() => expect(pendingReleases).toHaveLength(1));
    controller.adopt(snapshotWithGeometryPending());
    await vi.waitFor(() => expect(geometry.presentCalls).toHaveLength(1));
    // 旧 failed outcome 以 200+turn revision-conflict 返回。
    pendingReleases[0]!(validFromRaw(runtimeSnapshotRaw({
      revision: 99,
      turn: { status: "revision-conflict", failure: { category: "presentation", failure_class: "STALE_REVISION", retryable: true } },
    })));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.states[harness.states.length - 1]).toBe("presenting");
    expect(harness.notices).toHaveLength(0); // 陈旧请求的冲突不产生噪音提示
    controller.dispose();
  });

  it("dispose：abort 执行中 adapter，迟到结果不上报", async () => {
    const voice = fakeAdapter();
    const harness = fakePorts();
    const controller = makeController([voice], harness);
    controller.adopt(snapshotWithVoicePending());
    controller.dispose();
    expect(voice.presentCalls[0]!.abort.aborted).toBe(true);
    voice.resolvePresent(0, { outcome: "presented" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.requests).toHaveLength(0);
  });
});
