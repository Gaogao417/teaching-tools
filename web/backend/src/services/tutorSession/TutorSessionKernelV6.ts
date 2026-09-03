/**
 * TutorSessionKernelV6（F7 Step 2 — V6 Session Kernel 在线侧入口）。
 *
 * 版本无关内核骨架（kernel/TutorSessionKernelCore.ts）的 v6 装配：
 * - session 行写 event_schema='v6'；V6 写入/恢复撞非 v6 会话（含 v5）→
 *   SESSION_VERSION_UNSUPPORTED（store/restore 两边界；UI 明示重新开始）；
 * - fold context（session-pinned capability registry）在 start/resume 解析一次
 *   缓存于实例（pin 不可变）；append 事务侧另行从已提交流重解析（store 边界
 *   自证，不信任调用方缓存）；
 * - V6 reducer 的跨事件门禁（intent causation / capability / 有序交付 /
 *   cursor 对账）经同一 reducer 在 append（整批回滚）与 rebuild（fail closed）
 *   双边界强制。
 *
 * registryProvider 由装配方注入：生产 = TutorTaskBindingResolver（golden
 * approved plan → catalog pin 对账 → registry）；测试 = 合成 registry。
 */
import type { PendingSessionEvent } from "./kernel/sessionKernelTypes";
import type { SessionStateDifference } from "./kernel/sessionKernelCodec";
import type { RebuildOptions } from "./kernel/RuntimeStateRebuilderCore";
import { TutorSessionKernelCore } from "./kernel/TutorSessionKernelCore";
import type { V6RegistryProvider } from "./RuntimeStateRebuilderV6";
import { makeV6SessionCodec } from "./RuntimeStateRebuilderV6";
import type { PendingV6Event, V5SessionStartedPayload } from "./TutorSessionEventV6";
import type { TutorRuntimeStateV6 } from "./TutorRuntimeStateReducerV6";

export interface StartTutorSessionV6Input {
  sessionId: string;
  studentId: string;
  /** canonical session_started payload（v6 复用 v5 payload 镜像；含全量 pin refs 与 initial_cursor）。 */
  sessionStarted: V5SessionStartedPayload;
  occurred_at: string;
  idempotency_key?: string;
}

export interface ResumeV6Options {
  /** 恢复方声明的期望 TP pin（artifact_id/version/content_hash 三元组对账）。 */
  expectedTutorPlanRef?: V5SessionStartedPayload["tutor_plan_ref"];
}

export class TutorSessionKernelV6 {
  private readonly core: TutorSessionKernelCore<TutorRuntimeStateV6, import("./TutorRuntimeStateReducerV6").V6FoldContext>;

  private constructor(
    core: TutorSessionKernelCore<TutorRuntimeStateV6, import("./TutorRuntimeStateReducerV6").V6FoldContext>,
  ) {
    this.core = core;
  }

  /** 启动 v6 会话（原子 pin + event_schema='v6' + session_started），起步 state 经 verified rebuild。 */
  static start(input: StartTutorSessionV6Input, registryProvider: V6RegistryProvider): TutorSessionKernelV6 {
    return new TutorSessionKernelV6(TutorSessionKernelCore.start(makeV6SessionCodec(registryProvider), input));
  }

  /**
   * 从既有会话恢复：verified rebuild（gap/corrupt/revision/pin fail closed）；
   * v5 会话行 → SESSION_VERSION_UNSUPPORTED（不迁移、不伪装）。
   */
  static resume(sessionId: string, registryProvider: V6RegistryProvider, options?: ResumeV6Options): TutorSessionKernelV6 {
    return new TutorSessionKernelV6(
      TutorSessionKernelCore.resume(makeV6SessionCodec(registryProvider), sessionId, options),
    );
  }

  get sessionId(): string {
    return this.core.sessionId;
  }

  get state(): TutorRuntimeStateV6 {
    return this.core.state;
  }

  get revision(): number {
    return this.core.revision;
  }

  /**
   * 追加一批事件并推进在线 state：store 事务（候选批纯折叠验证 + V6 跨事件
   * 门禁；拒绝 ⇒ 整批不落库）成功后读回提交行，经同一 reducer 折叠。
   */
  append(expectedRevision: number, events: PendingV6Event[]): {
    revision: number;
    appendedSequences: number[];
    state: TutorRuntimeStateV6;
  } {
    return this.core.append(expectedRevision, events as PendingSessionEvent[]);
  }

  /** 全量重建（启动/恢复/对账用；gap/corruption/hash fail closed）。 */
  rebuild(): TutorRuntimeStateV6 {
    return this.core.rebuild();
  }

  /** G2 对账入口：在线缓存 state vs 全量重建 state。 */
  assertReplayParity(): { equal: boolean; differences: SessionStateDifference[] } {
    const parity = this.core.assertReplayParity();
    return { equal: parity.equal, differences: parity.differences };
  }
}
