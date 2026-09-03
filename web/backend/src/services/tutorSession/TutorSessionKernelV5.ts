/**
 * TutorSessionKernelV5（F2 — 在线侧入口；Event / Revision / Replay 内核）。
 *
 * F7 Step 2：内核骨架已抽成版本无关 core（kernel/TutorSessionKernelCore.ts）；
 * 本类是 v5 codec 装配 + 组合委托——公开 API 与行为逐字保留（V5 消费者与测试
 * 零改动）。结构性保证（实现于 core）：
 * - kernel 从不直接构造 state：start 与 resume 都经 verified rebuild
 *   （verifyCommittedStreamV5：gap / corrupt / revision / pin fail closed）取得
 *   初始缓存 state；每次 append 后把「store 提交成功的 canonical 事件行」读回，
 *   经 applyV5Event（与 RuntimeStateRebuilderV5 完全相同的纯函数）推进缓存
 *   state——不存在折叠未经校验事件行的路径；
 * - append 失败（REVISION_CONFLICT / DUPLICATE_EVENT / 校验失败 / reducer
 *   折叠拒绝——store 事务内先纯折叠验证候选批，见 TutorSessionEventStoreV5）
 *   时整批回滚，缓存 state 不动（重复写不重复产生事实）；
 * - assertReplayParity 用 semantic comparator 对账缓存 state 与全量重建
 *   state（G2 核对入口；live 主链不依赖它，replay 只用于启动/恢复/对账）。
 *
 * 该模块不做教学决策（F5）、不执行动作（F3/F6），只提供事实内核。
 */
import type { V5ArtifactRefLike } from "./TutorSessionEventV5";
import { V5_SESSION_CODEC, type StartTutorSessionV5Input } from "./TutorSessionEventStoreV5";
import type { PendingV5Event } from "./TutorSessionEventV5";
import { TutorSessionKernelCore } from "./kernel/TutorSessionKernelCore";
import type { SessionStateDifference } from "./kernel/sessionKernelCodec";
import type { RebuildV5Options } from "./RuntimeStateRebuilderV5";
import type { TutorRuntimeStateV5 } from "./TutorRuntimeStateReducerV5";

export interface ResumeV5Options {
  /** 恢复方声明的期望 TP pin（artifact_id/version/content_hash 三元组对账）。 */
  expectedTutorPlanRef?: V5ArtifactRefLike;
}

export class TutorSessionKernelV5 {
  private readonly core: TutorSessionKernelCore<TutorRuntimeStateV5, undefined>;

  private constructor(core: TutorSessionKernelCore<TutorRuntimeStateV5, undefined>) {
    this.core = core;
  }

  /** 启动 v5 会话（原子 pin + session_started），起步 state 经 verified rebuild。 */
  static start(input: StartTutorSessionV5Input): TutorSessionKernelV5 {
    return new TutorSessionKernelV5(TutorSessionKernelCore.start(V5_SESSION_CODEC, input));
  }

  /**
   * 从既有会话恢复：与 rebuildTutorRuntimeStateV5 同一完整性入口
   * （gap / corrupt payload / revision / event_schema / pin 全部 fail closed，
   * 不得对未校验事件行直接折叠）。
   */
  static resume(sessionId: string, options?: ResumeV5Options): TutorSessionKernelV5 {
    return new TutorSessionKernelV5(TutorSessionKernelCore.resume(V5_SESSION_CODEC, sessionId, options));
  }

  get sessionId(): string {
    return this.core.sessionId;
  }

  get state(): TutorRuntimeStateV5 {
    return this.core.state;
  }

  get revision(): number {
    return this.core.revision;
  }

  /**
   * 追加一批事件并推进在线 state：store 事务（内含候选批纯折叠验证，reducer
   * 拒绝 ⇒ 整批不落库）成功后，把本批提交的 canonical 事件行读回，经同一
   * reducer 折叠（在线=逐批增量，重建=全量重放，同一函数）。
   */
  append(expectedRevision: number, events: PendingV5Event[]): {
    revision: number;
    appendedSequences: number[];
    state: TutorRuntimeStateV5;
  } {
    return this.core.append(expectedRevision, events);
  }

  /** 全量重建（启动/恢复/对账用；gap/corruption/hash fail closed）。 */
  rebuild(): TutorRuntimeStateV5 {
    return this.core.rebuild();
  }

  /** G2 对账入口：在线缓存 state vs 全量重建 state。 */
  assertReplayParity(): { equal: boolean; differences: SessionStateDifference[] } {
    return this.core.assertReplayParity();
  }
}
