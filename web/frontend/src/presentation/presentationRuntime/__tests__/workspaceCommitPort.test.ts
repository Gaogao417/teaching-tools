/**
 * F7 Step 6：workspaceCommitPort 行为锁定（ledger 增补 20 偏差 1）。
 * - 等待方绑定 (sessionId, minRevision)：旧会话的大 revision 不放行新会话；
 * - transitional 通知永不满足等待；real 通知同 session 且 revision ≥ 才放行；
 * - 缓冲的 real note 立即满足后续等待；reset 结算全部等待者为 aborted；
 * - 超时与 abort。
 */
import { describe, expect, it, vi } from "vitest";

import { createWorkspaceCommitPort } from "../workspaceCommitPort";

describe("workspaceCommitPort", () => {
  it("同 session 且 revision ≥ minRevision 的 real 通知放行等待者", async () => {
    const port = createWorkspaceCommitPort();
    const unregister = port.registerRealCommitSource();
    const wait = port.waitForCommit("TS-1", 8, { executionKey: "K1" });
    port.notifyRealCommitted({ executionKey: "K1", sessionId: "TS-1", revision: 7 });
    port.notifyRealCommitted({ executionKey: "K1", sessionId: "TS-1", revision: 8 });
    await expect(wait).resolves.toBe("committed");
    unregister();
  });

  it("旧会话的大 revision 不放行新会话的等待者", async () => {
    const port = createWorkspaceCommitPort();
    port.registerRealCommitSource();
    const wait = port.waitForCommit("TS-2", 3, { executionKey: "K1", timeoutMs: 20 });
    port.notifyRealCommitted({ executionKey: "K1", sessionId: "TS-1", revision: 99 });
    await expect(wait).resolves.toBe("timeout");
  });

  it("transitional 通知永不满足等待（只作诊断）", async () => {
    const port = createWorkspaceCommitPort();
    port.registerRealCommitSource();
    const wait = port.waitForCommit("TS-1", 5, { executionKey: "K1", timeoutMs: 20 });
    port.notifyTransitionalCommitted({ sessionId: "TS-1", revision: 50 });
    await expect(wait).resolves.toBe("timeout");
    expect(port.lastTransitionalNote()).toEqual({ sessionId: "TS-1", revision: 50 });
  });

  it("未注册真实信号源时 hasRealCommitSource=false；注册后为 true；注销归零", () => {
    const port = createWorkspaceCommitPort();
    expect(port.hasRealCommitSource()).toBe(false);
    const unregister = port.registerRealCommitSource();
    expect(port.hasRealCommitSource()).toBe(true);
    unregister();
    expect(port.hasRealCommitSource()).toBe(false);
  });

  it("缓冲的 real note 立即满足后续等待（无需新通知）", async () => {
    const port = createWorkspaceCommitPort();
    port.registerRealCommitSource();
    port.notifyRealCommitted({ executionKey: "K1", sessionId: "TS-1", revision: 12 });
    await expect(port.waitForCommit("TS-1", 12, { executionKey: "K1" })).resolves.toBe("committed");
    await expect(port.waitForCommit("TS-1", 13, { executionKey: "K1", timeoutMs: 10 })).resolves.toBe("timeout");
  });

  it("reset：等待者按 aborted 结算并清缓冲", async () => {
    const port = createWorkspaceCommitPort();
    port.registerRealCommitSource();
    const wait = port.waitForCommit("TS-1", 4, { executionKey: "K1" });
    port.reset();
    await expect(wait).resolves.toBe("aborted");
    expect(port.lastRealNote()).toBeUndefined();
  });

  it("abort signal 触发 aborted", async () => {
    const port = createWorkspaceCommitPort();
    port.registerRealCommitSource();
    const controller = new AbortController();
    const wait = port.waitForCommit("TS-1", 4, { executionKey: "K1", abort: controller.signal });
    controller.abort();
    await expect(wait).resolves.toBe("aborted");
  });

  it("超时返回 timeout", async () => {
    const port = createWorkspaceCommitPort();
    port.registerRealCommitSource();
    vi.useFakeTimers();
    try {
      const wait = port.waitForCommit("TS-1", 4, { executionKey: "K1", timeoutMs: 50 });
      vi.advanceTimersByTime(60);
      await expect(wait).resolves.toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("execution identity isolation", () => {
  it("old execution and view-only cache cannot satisfy recovery at the same revision", async () => {
    vi.useFakeTimers();
    try {
      const port = createWorkspaceCommitPort();
      for (const executionKey of ["K1", "view:TS-1@7"]) {
        port.notifyRealCommitted({ sessionId: "TS-1", revision: 7, executionKey });
        const wait = port.waitForCommit("TS-1", 7, { executionKey: "K2", timeoutMs: 10 });
        vi.advanceTimersByTime(11);
        await expect(wait).resolves.toBe("timeout");
      }
      const wait = port.waitForCommit("TS-1", 7, { executionKey: "K2" });
      port.notifyRealCommitted({ sessionId: "TS-1", revision: 7, executionKey: "K1" });
      port.notifyRealCommitted({ sessionId: "TS-1", revision: 7, executionKey: "K2" });
      await expect(wait).resolves.toBe("committed");
    } finally { vi.useRealTimers(); }
  });
  it("aborted execution cannot consume even its matching cached note", async () => {
    const port = createWorkspaceCommitPort();
    port.notifyRealCommitted({ sessionId: "TS-1", revision: 7, executionKey: "K1" });
    const abort = new AbortController(); abort.abort();
    await expect(port.waitForCommit("TS-1", 7, { executionKey: "K1", abort: abort.signal })).resolves.toBe("aborted");
  });
});
