/**
 * TutorSessionKernelV5（F2 — 在线侧入口；Event / Revision / Replay 内核）。
 *
 * 在线 state 与 rebuilt state 使用同一领域 reducer 的结构性保证：
 * - kernel 从不直接构造 state：start 与 resume 都经 rebuildTutorRuntimeStateV5
 *   （verifyCommittedStreamV5：gap / corrupt / revision / pin fail closed）取得
 *   初始缓存 state；每次 append 后把「store 提交成功的 canonical 事件行」读回，
 *   经 applyV5Event（与 RuntimeStateRebuilderV5 完全相同的纯函数）推进缓存
 *   state——不存在折叠未经校验事件行的路径（2026-08-29 复验修复 #1：resume
 *   曾直接 readTutorSessionEventsV5 + fold，断裂/损坏流可被静默重建）；
 * - append 失败（REVISION_CONFLICT / DUPLICATE_EVENT / 校验失败 / reducer
 *   折叠拒绝——store 事务内先纯折叠验证候选批，见 TutorSessionEventStoreV5）
 *   时整批回滚，缓存 state 不动（重复写不重复产生事实）；
 * - assertReplayParity 用 semantic comparator 对账缓存 state 与全量重建
 *   state（G2 核对入口；live 主链不依赖它，replay 只用于启动/恢复/对账，
 *   09 架构 §10.2）。
 *
 * 该模块不做教学决策（F5）、不执行动作（F3/F6），只提供事实内核。
 */
import {
  TutorSessionEventStoreV5Error,
  type PendingV5Event,
  type V5ArtifactRefLike,
} from "./TutorSessionEventV5";
import {
  appendTutorSessionEventsV5,
  readTutorSessionEventsV5,
  startTutorSessionV5,
  tutorSessionRevisionV5,
  type StartTutorSessionV5Input,
} from "./TutorSessionEventStoreV5";
import { applyV5Event, type TutorRuntimeStateV5 } from "./TutorRuntimeStateReducerV5";
import { rebuildTutorRuntimeStateV5 } from "./RuntimeStateRebuilderV5";
import { compareTutorRuntimeStatesSemantically } from "./RuntimeStateSemanticComparatorV5";

export interface ResumeV5Options {
  /** 恢复方声明的期望 TP pin（artifact_id/version/content_hash 三元组对账）。 */
  expectedTutorPlanRef?: V5ArtifactRefLike;
}

export class TutorSessionKernelV5 {
  readonly sessionId: string;
  private currentState: TutorRuntimeStateV5;

  private constructor(sessionId: string, verifiedInitialState: TutorRuntimeStateV5) {
    this.sessionId = sessionId;
    this.currentState = verifiedInitialState;
  }

  /** 启动 v5 会话（原子 pin + session_started），起步 state 经 verified rebuild。 */
  static start(input: StartTutorSessionV5Input): TutorSessionKernelV5 {
    startTutorSessionV5(input);
    return new TutorSessionKernelV5(input.sessionId, rebuildTutorRuntimeStateV5(input.sessionId));
  }

  /**
   * 从既有会话恢复：与 rebuildTutorRuntimeStateV5 同一完整性入口
   * （gap / corrupt payload / revision / event_schema / pin 全部 fail closed，
   * 不得对未校验事件行直接折叠）。
   */
  static resume(sessionId: string, options?: ResumeV5Options): TutorSessionKernelV5 {
    return new TutorSessionKernelV5(sessionId, rebuildTutorRuntimeStateV5(sessionId, options));
  }

  get state(): TutorRuntimeStateV5 {
    return this.currentState;
  }

  get revision(): number {
    return tutorSessionRevisionV5(this.sessionId);
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
    const result = appendTutorSessionEventsV5(this.sessionId, expectedRevision, events);
    const committed = readTutorSessionEventsV5(this.sessionId);
    const batch = committed.filter((event) => result.appendedSequences.includes(event.sequence));
    if (batch.length !== result.appendedSequences.length) {
      throw new TutorSessionEventStoreV5Error(
        "VALIDATION_FAILED",
        `append reported sequences ${result.appendedSequences.join(",")} but read-back mismatch`,
      );
    }
    for (const event of batch) {
      this.currentState = applyV5Event(this.currentState, event);
    }
    return { revision: result.revision, appendedSequences: result.appendedSequences, state: this.currentState };
  }

  /** 全量重建（启动/恢复/对账用；gap/corruption/hash fail closed）。 */
  rebuild(): TutorRuntimeStateV5 {
    return rebuildTutorRuntimeStateV5(this.sessionId);
  }

  /** G2 对账入口：在线缓存 state vs 全量重建 state。 */
  assertReplayParity(): { equal: boolean; differences: ReturnType<typeof compareTutorRuntimeStatesSemantically>["differences"] } {
    const comparison = compareTutorRuntimeStatesSemantically(this.currentState, this.rebuild());
    return { equal: comparison.equal, differences: comparison.differences };
  }
}
