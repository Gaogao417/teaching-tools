/**
 * F7 Step 6：Geometry/Board adapter 行为锁定（ledger 增补 20 偏差 1/2）。
 * - 真实信号源未注册 → awaiting-real-signal 暂停（生产链 Step 7 前不上报）；
 * - 注册后：target 数据级对账（缺失 → illegal_target；target_highlight 未高亮 →
 *   illegal_target）+ waitForCommit(sessionId, workspace_revision) → presented；
 * - commit 超时 → failed(timeout)；abort → interrupted；
 * - transitional 通知不构成完成证据。
 */
import { describe, expect, it } from "vitest";

import { createBoardExplainPresentationAdapter, createBoardPresentationAdapter, createGeometryEmphasizePresentationAdapter, createGeometryPresentationAdapter } from "../adapters/workspaceSurfaceAdapters";
import { createWorkspaceCommitPort } from "../workspaceCommitPort";
import { presentationKeyOf } from "../types";
import type { PendingPresentationDelivery } from "../types";
import {
  pendingBoardExplainPresentation,
  pendingBoardPresentation,
  pendingGeometryEmphasizePresentation,
  pendingGeometryPresentation,
  runtimeSnapshotRaw,
  validFromRaw,
} from "../../../action-runtime/tutor/__tests__/runtimeSnapshotFixture";
import type { ValidatedSessionSnapshot } from "../../../api/tutorRuntimeClient";

function geometryContext(highlighted = false) {
  const commitPort = createWorkspaceCommitPort();
  const adapter = createGeometryPresentationAdapter({ commitPort });
  const snapshot: ValidatedSessionSnapshot = validFromRaw(runtimeSnapshotRaw({
    pendingPresentation: pendingGeometryPresentation(20, 7),
    canvasElements: [{ element_id: "seg-CO", kind: "segment", ...(highlighted ? { highlighted: true } : {}) }],
    revision: 20,
    workspaceRevision: 7,
  }));
  return { commitPort, adapter, snapshot, delivery: snapshot.pending_presentation as PendingPresentationDelivery };
}

function boardContext(entries: { entry_id: string; kind: string; content: string; state?: string }[], targets?: string[]) {
  const commitPort = createWorkspaceCommitPort();
  const adapter = createBoardPresentationAdapter({ commitPort });
  const snapshot: ValidatedSessionSnapshot = validFromRaw(runtimeSnapshotRaw({
    pendingPresentation: pendingBoardPresentation(22, 8, targets ?? entries.map((entry) => entry.entry_id)),
    boardEntries: entries,
    revision: 22,
    workspaceRevision: 8,
  }));
  return { commitPort, adapter, snapshot, delivery: snapshot.pending_presentation as PendingPresentationDelivery };
}

/** F7 P2：board.explain（view/v2 fragments——EF- 已 applied 投影）。 */
function boardExplainContext(fragmentId: string, withFragment: boolean) {
  const commitPort = createWorkspaceCommitPort();
  const adapter = createBoardExplainPresentationAdapter({ commitPort });
  const snapshot: ValidatedSessionSnapshot = validFromRaw(runtimeSnapshotRaw({
    pendingPresentation: pendingBoardExplainPresentation(24, 9, fragmentId),
    boardEntries: [{ entry_id: "BE-301", kind: "derivation", content: "△DAO∽△DBA" }],
    viewFragments: withFragment
      ? [{ fragment_id: fragmentId, kind: "explanation_text", content: "把当前批准步骤拆细，逐项检查依据。", basis_refs: ["RES1"], attach_to_entry: "BE-301" }]
      : [],
    revision: 24,
    workspaceRevision: 9,
  }));
  return { commitPort, adapter, snapshot, delivery: snapshot.pending_presentation as PendingPresentationDelivery };
}

describe("workspace surface adapters（真实完成信号源语义）", () => {
  it("真实信号源未注册：awaiting-real-signal 暂停（不上报 presented）", async () => {
    const { adapter, snapshot, delivery } = geometryContext();
    const result = await adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    expect(result).toEqual({ outcome: "awaiting-real-signal" });
  });

  it("geometry：注册后 target 在 view 且同 revision real commit → presented", async () => {
    const { commitPort, adapter, snapshot, delivery } = geometryContext();
    const unregister = commitPort.registerRealCommitSource();
    const abort = new AbortController();
    const wait = adapter.present({ delivery, snapshot, abort: abort.signal });
    commitPort.notifyRealCommitted({ executionKey: presentationKeyOf(delivery), sessionId: delivery.session_id, revision: delivery.workspace_revision! });
    await expect(wait).resolves.toEqual({ outcome: "presented" });
    unregister();
  });

  it("geometry：transitional 通知不构成完成证据（等待保持悬挂，非完成）", async () => {
    const { commitPort, adapter, snapshot, delivery } = geometryContext();
    const unregister = commitPort.registerRealCommitSource();
    const abort = new AbortController();
    const presented = adapter.present({ delivery, snapshot, abort: abort.signal });
    commitPort.notifyTransitionalCommitted({ sessionId: delivery.session_id, revision: 99 });
    const pending = await Promise.race([presented, new Promise((resolve) => setTimeout(() => resolve("still-pending"), 20))]);
    expect(pending).toBe("still-pending");
    abort.abort();
    await expect(presented).resolves.toEqual({ outcome: "interrupted" });
    unregister();
  });

  it("geometry：commit 等待超时 → failed(timeout)", async () => {
    const commitPort = createWorkspaceCommitPort();
    const adapter = createGeometryPresentationAdapter({ commitPort, waitTimeoutMs: 15 });
    const { snapshot } = geometryContext();
    const delivery = snapshot.pending_presentation as PendingPresentationDelivery;
    commitPort.registerRealCommitSource();
    await expect(adapter.present({ delivery, snapshot, abort: new AbortController().signal }))
      .resolves.toMatchObject({ outcome: "failed", failureClass: "timeout" });
  });

  it("geometry：reveal_scope=target_highlight 的 target 未高亮 → failed(illegal_target)", async () => {
    const commitPort = createWorkspaceCommitPort();
    const adapter = createGeometryPresentationAdapter({ commitPort });
    commitPort.registerRealCommitSource();
    const raw = runtimeSnapshotRaw({
      pendingPresentation: {
        ...pendingGeometryPresentation(20, 7),
        action: {
          kind: "workspace",
          workspace_action: {
            ...((pendingGeometryPresentation(20, 7).action as { workspace_action: Record<string, unknown> }).workspace_action),
            target_ids: ["seg-CO"],
            reveal_scope: "target_highlight",
          },
        },
      },
      canvasElements: [{ element_id: "seg-CO", kind: "segment" }],
      revision: 20,
      workspaceRevision: 7,
    });
    const snapshot = validFromRaw(raw);
    const delivery = snapshot.pending_presentation as PendingPresentationDelivery;
    const result = await adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    expect(result).toMatchObject({ outcome: "failed", failureClass: "illegal_target" });
  });

  it("board：target 条目缺失于 view → failed(illegal_target)", async () => {
    const { commitPort, adapter, snapshot, delivery } = boardContext([], ["BE-301"]);
    commitPort.registerRealCommitSource();
    const result = await adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    expect(result).toMatchObject({ outcome: "failed", failureClass: "illegal_target" });
  });

  it("board：条目在 view + real commit → presented", async () => {
    const { commitPort, adapter, snapshot, delivery } = boardContext([{ entry_id: "BE-301", kind: "derivation", content: "△DAO∽△DBA" }]);
    const unregister = commitPort.registerRealCommitSource();
    const wait = adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    commitPort.notifyRealCommitted({ executionKey: presentationKeyOf(delivery), sessionId: delivery.session_id, revision: delivery.workspace_revision! });
    await expect(wait).resolves.toEqual({ outcome: "presented" });
    unregister();
  });

  it("abort（服务端已推进/controller 打断）→ interrupted", async () => {
    const { commitPort, adapter, snapshot, delivery } = geometryContext();
    const unregister = commitPort.registerRealCommitSource();
    const abort = new AbortController();
    const wait = adapter.present({ delivery, snapshot, abort: abort.signal });
    abort.abort();
    await expect(wait).resolves.toEqual({ outcome: "interrupted" });
    unregister();
  });

  it("supports：三元组判定（geometry.construct / board.reveal-entry 命中，其余拒绝）", () => {
    const geometry = createGeometryPresentationAdapter({ commitPort: createWorkspaceCommitPort() });
    const board = createBoardPresentationAdapter({ commitPort: createWorkspaceCommitPort() });
    expect(geometry.supports({ kind: "workspace", workspace_action: { surface: "geometry", capability: "geometry.construct" } } as never)).toBe(true);
    expect(geometry.supports({ kind: "workspace", workspace_action: { surface: "geometry", capability: "similarity.foreground-segment" } } as never)).toBe(false);
    expect(board.supports({ kind: "workspace", workspace_action: { surface: "solution_board", capability: "board.reveal-entry" } } as never)).toBe(true);
    expect(board.supports({ kind: "workspace", workspace_action: { surface: "solution_board", capability: "board.activate-entry" } } as never)).toBe(false);
    expect(geometry.supports({ kind: "voice" } as never)).toBe(false);
  });
});

/** F7 P3（A' 轨 T2）：geometry.emphasize（highlight 语义；reveal_scope=
 *  target_highlight）。highlighted 位 = 服务端 view 投影。 */
function geometryEmphasizeContext(highlighted: boolean, targets: string[] = ["seg-CO"]) {
  const commitPort = createWorkspaceCommitPort();
  const adapter = createGeometryEmphasizePresentationAdapter({ commitPort });
  const snapshot: ValidatedSessionSnapshot = validFromRaw(runtimeSnapshotRaw({
    pendingPresentation: pendingGeometryEmphasizePresentation(26, 10, targets),
    canvasElements: targets.map((target) => ({ element_id: target, kind: "segment", ...(highlighted ? { highlighted: true } : {}) })),
    revision: 26,
    workspaceRevision: 10,
  }));
  return { commitPort, adapter, snapshot, delivery: snapshot.pending_presentation as PendingPresentationDelivery };
}

describe("F7 P3 geometry.emphasize adapter（既有实体高亮；目录冻结形状）", () => {
  it("真实信号源未注册 → awaiting-real-signal 暂停（不上报 presented）", async () => {
    const { adapter, snapshot, delivery } = geometryEmphasizeContext(true);
    const result = await adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    expect(result).toEqual({ outcome: "awaiting-real-signal" });
  });

  it("target 在 view 且 highlighted=true + 同执行真实 commit → presented（realize→完成信号链）", async () => {
    const { commitPort, adapter, snapshot, delivery } = geometryEmphasizeContext(true);
    const unregister = commitPort.registerRealCommitSource();
    const wait = adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    commitPort.notifyRealCommitted({ executionKey: presentationKeyOf(delivery), sessionId: delivery.session_id, revision: delivery.workspace_revision! });
    await expect(wait).resolves.toEqual({ outcome: "presented" });
    unregister();
  });

  it("reveal_scope=target_highlight 但 target 未高亮 → failed(illegal_target)（服务端投影缺失不误报 presented）", async () => {
    const { commitPort, adapter, snapshot, delivery } = geometryEmphasizeContext(false);
    commitPort.registerRealCommitSource();
    const result = await adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    expect(result).toMatchObject({ outcome: "failed", failureClass: "illegal_target" });
  });

  it("target 不存在于 canvas view → failed(illegal_target)", async () => {
    const commitPort = createWorkspaceCommitPort();
    const adapter = createGeometryEmphasizePresentationAdapter({ commitPort });
    commitPort.registerRealCommitSource();
    const snapshot: ValidatedSessionSnapshot = validFromRaw(runtimeSnapshotRaw({
      pendingPresentation: pendingGeometryEmphasizePresentation(26, 10, ["seg-UNKNOWN"]),
      canvasElements: [{ element_id: "seg-CO", kind: "segment", highlighted: true }],
      revision: 26,
      workspaceRevision: 10,
    }));
    const delivery = snapshot.pending_presentation as PendingPresentationDelivery;
    await expect(adapter.present({ delivery, snapshot, abort: new AbortController().signal }))
      .resolves.toMatchObject({ outcome: "failed", failureClass: "illegal_target" });
  });

  it("空 target_ids（无高亮目标）→ failed(illegal_target) fail closed", async () => {
    const commitPort = createWorkspaceCommitPort();
    const adapter = createGeometryEmphasizePresentationAdapter({ commitPort });
    commitPort.registerRealCommitSource();
    const snapshot: ValidatedSessionSnapshot = validFromRaw(runtimeSnapshotRaw({
      pendingPresentation: pendingGeometryEmphasizePresentation(26, 10, []),
      canvasElements: [{ element_id: "seg-CO", kind: "segment", highlighted: true }],
      revision: 26,
      workspaceRevision: 10,
    }));
    const delivery = snapshot.pending_presentation as PendingPresentationDelivery;
    await expect(adapter.present({ delivery, snapshot, abort: new AbortController().signal }))
      .resolves.toMatchObject({ outcome: "failed", failureClass: "illegal_target" });
  });

  it("abort（服务端已推进/controller 打断）→ interrupted", async () => {
    const { commitPort, adapter, snapshot, delivery } = geometryEmphasizeContext(true);
    const unregister = commitPort.registerRealCommitSource();
    const abort = new AbortController();
    const wait = adapter.present({ delivery, snapshot, abort: abort.signal });
    abort.abort();
    await expect(wait).resolves.toEqual({ outcome: "interrupted" });
    unregister();
  });

  it("supports：geometry:geometry.emphasize 三元组命中；construct/foreground-segment 不被吃", () => {
    const emphasize = createGeometryEmphasizePresentationAdapter({ commitPort: createWorkspaceCommitPort() });
    const construct = createGeometryPresentationAdapter({ commitPort: createWorkspaceCommitPort() });
    expect(emphasize.supports({ kind: "workspace", workspace_action: { surface: "geometry", capability: "geometry.emphasize" } } as never)).toBe(true);
    expect(emphasize.supports({ kind: "workspace", workspace_action: { surface: "solution_board", capability: "geometry.emphasize" } } as never)).toBe(false);
    expect(construct.supports({ kind: "workspace", workspace_action: { surface: "geometry", capability: "geometry.emphasize" } } as never)).toBe(false);
    expect(emphasize.supports({ kind: "voice" } as never)).toBe(false);
  });
});

describe("F7 P2 board.explain adapter（动态板书 EF- 内容链）", () => {
  it("EF 引用未解析到 view/v2 fragment（planned-only/未 applied）→ failed(illegal_target)", async () => {
    const { commitPort, adapter, snapshot, delivery } = boardExplainContext("EF-TS4242-0001", false);
    commitPort.registerRealCommitSource();
    const result = await adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    expect(result).toMatchObject({ outcome: "failed", failureClass: "illegal_target" });
  });

  it("EF 已 applied（view/v2 fragments 含该片段）+ 真实 commit → presented", async () => {
    const { commitPort, adapter, snapshot, delivery } = boardExplainContext("EF-TS4242-0001", true);
    const unregister = commitPort.registerRealCommitSource();
    const wait = adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    commitPort.notifyRealCommitted({ executionKey: presentationKeyOf(delivery), sessionId: delivery.session_id, revision: delivery.workspace_revision! });
    await expect(wait).resolves.toEqual({ outcome: "presented" });
    unregister();
  });

  it("真实信号源未注册 → awaiting-real-signal（保存≠可见阶段不误报）", async () => {
    const { adapter, snapshot, delivery } = boardExplainContext("EF-TS4242-0001", true);
    const result = await adapter.present({ delivery, snapshot, abort: new AbortController().signal });
    expect(result).toEqual({ outcome: "awaiting-real-signal" });
  });

  it("abort → interrupted（服务端已推进/controller 打断）", async () => {
    const { commitPort, adapter, snapshot, delivery } = boardExplainContext("EF-TS4242-0001", true);
    const unregister = commitPort.registerRealCommitSource();
    const abort = new AbortController();
    const wait = adapter.present({ delivery, snapshot, abort: abort.signal });
    abort.abort();
    await expect(wait).resolves.toEqual({ outcome: "interrupted" });
    unregister();
  });

  it("supports：board.explain 三元组命中；reveal-entry 不吃 explain", () => {
    const explain = createBoardExplainPresentationAdapter({ commitPort: createWorkspaceCommitPort() });
    const reveal = createBoardPresentationAdapter({ commitPort: createWorkspaceCommitPort() });
    expect(explain.supports({ kind: "workspace", workspace_action: { surface: "solution_board", capability: "board.explain" } } as never)).toBe(true);
    expect(reveal.supports({ kind: "workspace", workspace_action: { surface: "solution_board", capability: "board.explain" } } as never)).toBe(false);
    expect(explain.supports({ kind: "workspace", workspace_action: { surface: "solution_board", capability: "board.reveal-entry" } } as never)).toBe(false);
  });
});
