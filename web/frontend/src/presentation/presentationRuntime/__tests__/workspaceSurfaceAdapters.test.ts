/**
 * F7 Step 6：Geometry/Board adapter 行为锁定（ledger 增补 20 偏差 1/2）。
 * - 真实信号源未注册 → awaiting-real-signal 暂停（生产链 Step 7 前不上报）；
 * - 注册后：target 数据级对账（缺失 → illegal_target；target_highlight 未高亮 →
 *   illegal_target）+ waitForCommit(sessionId, workspace_revision) → presented；
 * - commit 超时 → failed(timeout)；abort → interrupted；
 * - transitional 通知不构成完成证据。
 */
import { describe, expect, it } from "vitest";

import { createBoardPresentationAdapter, createGeometryPresentationAdapter } from "../adapters/workspaceSurfaceAdapters";
import { createWorkspaceCommitPort } from "../workspaceCommitPort";
import type { PendingPresentationDelivery } from "../types";
import {
  pendingBoardPresentation,
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
    commitPort.notifyRealCommitted({ sessionId: delivery.session_id, revision: delivery.workspace_revision! });
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
    commitPort.notifyRealCommitted({ sessionId: delivery.session_id, revision: delivery.workspace_revision! });
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
