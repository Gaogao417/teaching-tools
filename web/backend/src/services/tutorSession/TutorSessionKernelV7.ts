/**
 * TutorSessionKernelV7（F7 Step 4 — V7 Session Kernel 在线侧入口）。
 *
 * 版本无关内核骨架（kernel/TutorSessionKernelCore.ts）的 v7 装配：
 * - session 行写 event_schema='v7'；v7 写入/恢复撞非 v7 会话（含 v5/v6）→
 *   SESSION_VERSION_UNSUPPORTED（store/restore 两边界；新生产 start/restore
 *   只走 v7——V6 reader 原样保留，不承担新生产写入）；
 * - fold context（session-pinned capability registry）在 start/resume 解析一次
 *   缓存于实例（pin 不可变）；append 事务侧另行从已提交流重解析（store 边界
 *   自证，不信任调用方缓存）；
 * - V7 reducer 的跨事件门禁（intent causation / command-recorded causation /
 *   capability / 有序交付 / cursor 对账 / session_mode）经同一 reducer 在
 *   append（整批回滚）与 rebuild（fail closed）双边界强制。
 *
 * registryProvider 由装配方注入：生产 = TutorTaskBindingResolver（golden
 * approved plan → catalog pin 对账 → registry）；测试 = 合成 registry。
 */
import type { PendingSessionEvent } from "./kernel/sessionKernelTypes";
import type { SessionStateDifference } from "./kernel/sessionKernelCodec";
import type { RebuildOptions } from "./kernel/RuntimeStateRebuilderCore";
import { TutorSessionKernelCore } from "./kernel/TutorSessionKernelCore";
import type { V7RegistryProvider } from "./RuntimeStateRebuilderV7";
import { makeV7SessionCodec } from "./RuntimeStateRebuilderV7";
import type { PendingV7Event, V7SessionStartedPayload } from "./TutorSessionEventV7";
import type { TutorRuntimeStateV7 } from "./TutorRuntimeStateReducerV7";

export interface StartTutorSessionV7Input {
  sessionId: string;
  studentId: string;
  /** canonical v7 session_started payload（v5/v6 全字段 + 必填 session_mode；含全量 pin refs 与 initial_cursor）。 */
  sessionStarted: V7SessionStartedPayload;
  occurred_at: string;
  idempotency_key?: string;
}

export interface ResumeV7Options {
  /** 恢复方声明的期望 TP pin（artifact_id/version/content_hash 三元组对账）。 */
  expectedTutorPlanRef?: V7SessionStartedPayload["tutor_plan_ref"];
}

export class TutorSessionKernelV7 {
  private readonly core: TutorSessionKernelCore<TutorRuntimeStateV7, import("./TutorRuntimeStateReducerV7").V7FoldContext>;

  private constructor(
    core: TutorSessionKernelCore<TutorRuntimeStateV7, import("./TutorRuntimeStateReducerV7").V7FoldContext>,
  ) {
    this.core = core;
  }

  /** 启动 v7 会话（原子 pin + event_schema='v7' + session_started），起步 state 经 verified rebuild。 */
  static start(input: StartTutorSessionV7Input, registryProvider: V7RegistryProvider): TutorSessionKernelV7 {
    return new TutorSessionKernelV7(TutorSessionKernelCore.start(makeV7SessionCodec(registryProvider), input));
  }

  /**
   * 从既有会话恢复：verified rebuild（gap/corrupt/revision/pin fail closed）；
   * v5/v6 会话行 → SESSION_VERSION_UNSUPPORTED（不迁移、不伪装；v6 reader
   * 保留给历史测试/诊断/内部审计）。
   */
  static resume(sessionId: string, registryProvider: V7RegistryProvider, options?: ResumeV7Options): TutorSessionKernelV7 {
    return new TutorSessionKernelV7(
      TutorSessionKernelCore.resume(makeV7SessionCodec(registryProvider), sessionId, options),
    );
  }

  get sessionId(): string {
    return this.core.sessionId;
  }

  get state(): TutorRuntimeStateV7 {
    return this.core.state;
  }

  get revision(): number {
    return this.core.revision;
  }

  /**
   * 追加一批事件并推进在线 state：store 事务（候选批纯折叠验证 + V7 跨事件
   * 门禁；拒绝 ⇒ 整批不落库）成功后读回提交行，经同一 reducer 折叠。
   */
  append(expectedRevision: number, events: PendingV7Event[]): {
    revision: number;
    appendedSequences: number[];
    state: TutorRuntimeStateV7;
  } {
    return this.core.append(expectedRevision, events as PendingSessionEvent[]);
  }

  /** 全量重建（启动/恢复/对账用；gap/corruption/hash fail closed）。 */
  rebuild(): TutorRuntimeStateV7 {
    return this.core.rebuild();
  }

  /** G2 对账入口：在线缓存 state vs 全量重建 state。 */
  assertReplayParity(): { equal: boolean; differences: SessionStateDifference[] } {
    const parity = this.core.assertReplayParity();
    return { equal: parity.equal, differences: parity.differences };
  }
}
