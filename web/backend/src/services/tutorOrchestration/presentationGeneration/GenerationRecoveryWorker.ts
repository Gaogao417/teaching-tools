/** Restart recovery is a server scheduler, never a side effect of GET/restore.
 * Kernel reconstruction is authoritative; SQL only enumerates candidate sessions.
 *
 * F7 P3（A5 pending 轮询）：mutation 路由不再阻塞驱动模型——预约后经
 * GenerationWakeChannel 通知本 worker 即时接管（新建 pending 与崩溃恢复走同一条
 * 扫描/认领路径；认领 CAS/epoch 规则不变——coordinator 唯一裁决）。扫描中到达
 * 的通知排队到本轮结束后补扫一次，避免预约落在本轮 SQL 快照之后被漏驱动；
 * 周期间隔（10s）仍兜底无通知来源的 pending（如进程刚启动时的存量）。
 */
import { db } from "../../../db/database";
import type { TutorRuntimeApplicationV7 } from "../TutorRuntimeApplicationV7";

const RECOVERY_CONCURRENCY = 4;

/** 预约→驱动通知通道：路由侧 notify（fire-and-forget），worker 侧 subscribe。 */
export interface GenerationWakeChannel {
  notify(): void;
  subscribe(listener: () => void): () => void;
}

export function createGenerationWakeChannel(): GenerationWakeChannel {
  const listeners = new Set<() => void>();
  return {
    notify: (): void => {
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The scheduler and tests share the real SQL scan and bounded session dispatch. */
export function createGenerationRecoveryScanner(
  factory: () => TutorRuntimeApplicationV7,
  onError: (error: unknown) => void,
): { scanOnce: () => Promise<void>; wake: () => void; stop: () => void } {
  let stopped = false;
  let scanning = false;
  let wakeQueued = false;
  const scanOnce = async (): Promise<void> => {
    if (stopped || scanning) return;
    scanning = true;
    try {
      const rows = db.prepare(
        "SELECT session_id FROM tutor_sessions WHERE event_schema IN ('v9','v10') AND completed_at IS NULL",
      ).all() as { session_id: string }[];
      const application = factory();
      for (let i = 0; i < rows.length && !stopped; i += RECOVERY_CONCURRENCY) {
        await Promise.all(rows.slice(i, i + RECOVERY_CONCURRENCY).map(async (row) => {
          try {
            const session = application.restore(row.session_id);
            // Durable continuation is a write-side recovery operation, never a GET effect.
            if (session.eventSchema === "v10") session.recoverVisualContinuation();
            if (session.hasPendingGeneration()) await application.drivePendingGeneration(session);
          } catch (error) {
            onError(error);
          }
        }));
      }
    } catch (error) {
      onError(error);
    } finally {
      scanning = false;
      if (!stopped && wakeQueued) {
        wakeQueued = false;
        void scanOnce();
      }
    }
  };
  /** 预约通知：空闲即扫（微任务延后——路由侧调用零同步 DB/restore 开销）；
   * 扫描中排队补扫。 */
  const wake = (): void => {
    if (stopped) return;
    if (scanning) {
      wakeQueued = true;
      return;
    }
    void Promise.resolve().then(() => scanOnce());
  };
  return { scanOnce, wake, stop: () => { stopped = true; } };
}

export interface GenerationRecoveryWorkerHandle {
  stop(): void;
  /** 预约通知入口（新建 pending 即时驱动；见 createGenerationWakeChannel）。 */
  wake(): void;
}

export function startGenerationRecoveryWorker(
  factory: () => TutorRuntimeApplicationV7,
  onError: (error: unknown) => void,
): GenerationRecoveryWorkerHandle {
  const scanner = createGenerationRecoveryScanner(factory, onError);
  const timer = setInterval(() => void scanner.scanOnce(), 10_000);
  timer.unref();
  void scanner.scanOnce();
  return {
    stop: () => { scanner.stop(); clearInterval(timer); },
    wake: scanner.wake,
  };
}
