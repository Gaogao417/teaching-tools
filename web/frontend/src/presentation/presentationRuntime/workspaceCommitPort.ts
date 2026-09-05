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
 * 通知携带 session+revision；等待方绑定 (sessionId, minRevision)——旧会话的
 * 大 revision 不放行新会话，会话切换 reset 时全部等待者按 aborted 结算。
 */
export interface WorkspaceCommitNote {
  sessionId: string;
  revision: number;
}

/**
 * F7 Step 7：生产呈现面（StudentWorkspaceViewSurface）接入 commitPort 的
 * 注入面——useTutorLearning 经 view-model 下发；真实信号源 = production
 * Canvas post-paint ∧ Board reveal 稳定的同 revision 双结算。
 */
export interface WorkspaceCommitSignal {
  registerRealCommitSource(): () => void;
  notifyRealCommitted(note: WorkspaceCommitNote): void;
}

export interface CommitWaitOptions {
  abort?: AbortSignal;
  timeoutMs?: number;
}

export type CommitWaitResult = "committed" | "aborted" | "timeout";

interface CommitWaiter {
  sessionId: string;
  minRevision: number;
  resolve: (result: CommitWaitResult) => void;
  timer?: number;
  onAbort?: () => void;
}

export interface WorkspaceCommitPort {
  /** 过渡呈现面的 commit 通知（诊断/开发；不满足 adapter）。 */
  notifyTransitionalCommitted(note: WorkspaceCommitNote): void;
  /** 注册真实完成信号源（Step 7 生产接线/测试注入）；返回注销函数。 */
  registerRealCommitSource(): () => void;
  /** 真实 commit 通知（同 session 且 revision ≥ 等待者的 minRevision 才放行）。 */
  notifyRealCommitted(note: WorkspaceCommitNote): void;
  /** 是否已有真实信号源（未注册时 workspace adapter 一律 awaiting-real-signal 暂停）。 */
  hasRealCommitSource(): boolean;
  waitForCommit(sessionId: string, minRevision: number, options?: CommitWaitOptions): Promise<CommitWaitResult>;
  /** 会话切换：清缓冲并把所有等待者结算为 aborted。 */
  reset(): void;
  lastTransitionalNote(): WorkspaceCommitNote | undefined;
  lastRealNote(): WorkspaceCommitNote | undefined;
}

const DEFAULT_COMMIT_TIMEOUT_MS = 10_000;

export function createWorkspaceCommitPort(): WorkspaceCommitPort {
  let realSourceCount = 0;
  let realNote: WorkspaceCommitNote | undefined;
  let transitionalNote: WorkspaceCommitNote | undefined;
  const waiters = new Set<CommitWaiter>();

  const settle = (waiter: CommitWaiter, result: CommitWaitResult): void => {
    waiters.delete(waiter);
    if (waiter.timer !== undefined) window.clearTimeout(waiter.timer);
    waiter.onAbort?.();
    waiter.resolve(result);
  };

  const notify = (note: WorkspaceCommitNote): void => {
    for (const waiter of [...waiters]) {
      if (waiter.sessionId === note.sessionId && note.revision >= waiter.minRevision) settle(waiter, "committed");
    }
  };

  return {
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
    waitForCommit(sessionId, minRevision, options = {}) {
      const buffered = realNote;
      if (buffered && buffered.sessionId === sessionId && buffered.revision >= minRevision) {
        return Promise.resolve("committed");
      }
      return new Promise<CommitWaitResult>((resolve) => {
        const waiter: CommitWaiter = { sessionId, minRevision, resolve };
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
