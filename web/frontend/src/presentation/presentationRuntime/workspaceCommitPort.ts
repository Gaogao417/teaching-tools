/**
 * F7 Step 6：Workspace 呈现 commit 端口（ledger 增补 20 偏差 1）。
 *
 * 两类信号源：
 * - transitional：fe-prep 过渡呈现面（文字列表）render 后的 rAF 通知——
 *   只作诊断/开发观测，**永不满足 adapter 的完成等待**；
 * - real：真实完成信号（Step 7 接入：production GeometryCanvas 的真实
 *   commit、Solution Board reveal 动画完成）。测试经 notifyRealCommitted
 *   注入同一通道证明 adapter 状态机，不作为生产验收证据。
 *
 * 通知携带 executionKey+session+revision；等待方绑定相同执行身份和最小 revision——旧会话的
 * 大 revision 不放行新会话，会话切换 reset 时全部等待者按 aborted 结算。
 */
import { createVisualCommitPort, type VisualCommitPort } from "./visualCommitPort";
import { createVisualRendererPort, type VisualRendererPort } from "./visualRendererPort";

export interface WorkspaceCommitNote {
  /** 身份必须匹配；同 revision 的其他执行不能作为完成证据。 */
  executionKey: string;
  sessionId: string;
  revision: number;
}

/**
 * F7 Step 7：生产呈现面（StudentWorkspaceViewSurface）接入 commitPort 的
 * 注入面——useTutorLearning 经 view-model 下发。真实信号源 = production
 * Canvas 渲染通道完成 ∧ Board reveal 稳定的同 revision 双结算。
 *
 * `notifyRealSourceActive`（返工 P1-2）：呈现面注册信号源后调用——PresentationRuntime
 * 对处于 awaiting-real-signal 的执行发起重试（「先暂停、surface 后挂载」的
 * 恢复路径；注册计数本身不唤醒等待者）。
 */
export interface WorkspaceCommitSignal {
  visualRenderer?: VisualRendererPort;
  registerRealCommitSource(): () => void;
  notifyRealCommitted(note: WorkspaceCommitNote): void;
  notifyRealSourceActive(): void;
}

export interface CommitWaitOptions {
  executionKey: string;
  abort?: AbortSignal;
  timeoutMs?: number;
}

export type CommitWaitResult = "committed" | "aborted" | "timeout";

interface CommitWaiter {
  executionKey: string;
  sessionId: string;
  minRevision: number;
  resolve: (result: CommitWaitResult) => void;
  timer?: number;
  onAbort?: () => void;
}

export interface WorkspaceCommitPort {
  /** Exact operation-specific visual receipts; generic Board commits never satisfy these. */
  readonly visual: VisualCommitPort;
  readonly visualRenderer: VisualRendererPort;
  /** 过渡呈现面的 commit 通知（诊断/开发；不满足 adapter）。 */
  notifyTransitionalCommitted(note: Omit<WorkspaceCommitNote, "executionKey">): void;
  /** 注册真实完成信号源（Step 7 生产接线/测试注入）；返回注销函数。 */
  registerRealCommitSource(): () => void;
  /** 真实 commit 通知（同执行身份、同 session 且 revision ≥ 等待者的 minRevision 才放行）。 */
  notifyRealCommitted(note: WorkspaceCommitNote): void;
  /** 是否已有真实信号源（未注册时 workspace adapter 一律 awaiting-real-signal 暂停）。 */
  hasRealCommitSource(): boolean;
  waitForCommit(sessionId: string, minRevision: number, options: CommitWaitOptions): Promise<CommitWaitResult>;
  /** 会话切换：清缓冲并把所有等待者结算为 aborted。 */
  reset(): void;
  lastTransitionalNote(): Omit<WorkspaceCommitNote, "executionKey"> | undefined;
  lastRealNote(): WorkspaceCommitNote | undefined;
}

const DEFAULT_COMMIT_TIMEOUT_MS = 10_000;

export function createWorkspaceCommitPort(): WorkspaceCommitPort {
  const visual = createVisualCommitPort();
  const visualRenderer = createVisualRendererPort(visual);
  let realSourceCount = 0;
  let realNote: WorkspaceCommitNote | undefined;
  let transitionalNote: Omit<WorkspaceCommitNote, "executionKey"> | undefined;
  const waiters = new Set<CommitWaiter>();

  const settle = (waiter: CommitWaiter, result: CommitWaitResult): void => {
    waiters.delete(waiter);
    if (waiter.timer !== undefined) window.clearTimeout(waiter.timer);
    waiter.onAbort?.();
    waiter.resolve(result);
  };

  const notify = (note: WorkspaceCommitNote): void => {
    for (const waiter of [...waiters]) {
      if (waiter.executionKey === note.executionKey && waiter.sessionId === note.sessionId && note.revision >= waiter.minRevision) settle(waiter, "committed");
    }
  };

  return {
    visual,
    visualRenderer,
    notifyTransitionalCommitted(note) {
      transitionalNote = note;
    },
    registerRealCommitSource() {
      realSourceCount += 1;
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        realSourceCount = Math.max(0, realSourceCount - 1);
      };
    },
    notifyRealCommitted(note) {
      realNote = note;
      notify(note);
    },
    hasRealCommitSource() {
      return realSourceCount > 0;
    },
    waitForCommit(sessionId, minRevision, options) {
      if (options.abort?.aborted) return Promise.resolve("aborted");
      const buffered = realNote;
      if (buffered && buffered.executionKey === options.executionKey && buffered.sessionId === sessionId && buffered.revision >= minRevision) {
        return Promise.resolve("committed");
      }
      return new Promise<CommitWaitResult>((resolve) => {
        const waiter: CommitWaiter = { executionKey: options.executionKey, sessionId, minRevision, resolve };
        waiter.timer = window.setTimeout(() => settle(waiter, "timeout"), options.timeoutMs ?? DEFAULT_COMMIT_TIMEOUT_MS);
        if (options.abort) {
          if (options.abort.aborted) {
            settle(waiter, "aborted");
            return;
          }
          waiter.onAbort = () => options.abort?.removeEventListener("abort", onAbortSignal);
          const onAbortSignal = () => settle(waiter, "aborted");
          options.abort.addEventListener("abort", onAbortSignal);
        }
        waiters.add(waiter);
      });
    },
    reset() {
      visualRenderer.reset();
      visual.reset();
      realNote = undefined;
      transitionalNote = undefined;
      for (const waiter of [...waiters]) settle(waiter, "aborted");
    },
    lastTransitionalNote() {
      return transitionalNote;
    },
    lastRealNote() {
      return realNote;
    },
  };
}
