/**
 * TutorSessionKernelV9（F7 RT4 — V9 Session Kernel 在线侧入口）。
 *
 * TutorSessionKernelV7 的 v9 后继（同一 kernel core 的 v9 codec 装配；不是
 * 第二套在线业务链——架构 §9.1）。差异只在事件/状态合同：
 * - session 行写 event_schema='v9'；v9 写入/恢复撞非 v9 会话 →
 *   SESSION_VERSION_UNSUPPORTED（store/restore 两边界）；
 * - state 收口 state/v4（presenter pin + generation_slot/requests）；
 * - 生成事件族经同一 append 事务批量落库（CAS revision + 整批回滚）。
 */
import type { PendingSessionEvent, SessionStartedPinLike } from "./kernel/sessionKernelTypes";
import type { SessionStateDifference } from "./kernel/sessionKernelCodec";
import type { RebuildOptions } from "./kernel/RuntimeStateRebuilderCore";
import { TutorSessionKernelCore } from "./kernel/TutorSessionKernelCore";
import type { V9RegistryProvider } from "./RuntimeStateRebuilderV9";
import { makeV9SessionCodec } from "./RuntimeStateRebuilderV9";
import type { PendingV9Event } from "./TutorSessionEventV9";
import type { TutorRuntimeStateV9 } from "./TutorRuntimeStateReducerV9";

export interface StartTutorSessionV9Input {
  sessionId: string;
  studentId: string;
  /** canonical v9 session_started payload（v7 全字段 + 可选 presenter_generation_pin；state/v4 必填——reducer fail closed）。 */
  sessionStarted: SessionStartedPinLike & Record<string, unknown>;
  occurred_at: string;
  idempotency_key?: string;
}

export interface ResumeV9Options {
  /** 恢复方声明的期望 TP pin（artifact_id/version/content_hash 三元组对账）。 */
  expectedTutorPlanRef?: { artifact_id: string; version: string; content_hash: string };
  /** 恢复方声明的期望 presenter pin（provider/model/版本对账；不符 fail closed）。 */
  expectedPresenterPin?: TutorRuntimeStateV9["pinned_plan"]["presenter_generation_pin"];
}

export class TutorSessionKernelV9 {
  private readonly core: TutorSessionKernelCore<TutorRuntimeStateV9, import("./TutorRuntimeStateReducerV9").V9FoldContext>;

  private constructor(core: TutorSessionKernelCore<TutorRuntimeStateV9, import("./TutorRuntimeStateReducerV9").V9FoldContext>) {
    this.core = core;
  }

  /** 启动 v9 会话（原子 pin + event_schema='v9' + session_started），起步 state 经 verified rebuild。 */
  static start(input: StartTutorSessionV9Input, registryProvider: V9RegistryProvider): TutorSessionKernelV9 {
    return new TutorSessionKernelV9(TutorSessionKernelCore.start(makeV9SessionCodec(registryProvider), input));
  }

  /** 恢复：verified rebuild（gap/corrupt/revision/pin fail closed）；非 v9 会话行 → SESSION_VERSION_UNSUPPORTED。 */
  static resume(sessionId: string, registryProvider: V9RegistryProvider, options?: ResumeV9Options): TutorSessionKernelV9 {
    const kernel = new TutorSessionKernelV9(
      TutorSessionKernelCore.resume(makeV9SessionCodec(registryProvider), sessionId, options),
    );
    if (options?.expectedPresenterPin) {
      const actual = kernel.state.pinned_plan.presenter_generation_pin;
      const expected = options.expectedPresenterPin;
      if (
        actual.provider !== expected.provider
        || actual.model_id !== expected.model_id
        || actual.prompt_version !== expected.prompt_version
        || actual.context_builder_version !== expected.context_builder_version
        || actual.tool_catalog_version !== expected.tool_catalog_version
      ) {
        throw new Error(
          `PRESENTER_PIN_MISMATCH: session ${sessionId} presenter pin ${JSON.stringify(actual)} differs from the resumed provider ${JSON.stringify(expected)} (fail closed; zero events appended)`,
        );
      }
    }
    return kernel;
  }

  get sessionId(): string {
    return this.core.sessionId;
  }

  get state(): TutorRuntimeStateV9 {
    return this.core.state;
  }

  get revision(): number {
    return this.core.revision;
  }

  /** 追加一批事件并推进在线 state（store 事务；拒绝 ⇒ 整批不落库）。 */
  append(expectedRevision: number, events: PendingV9Event[]): {
    revision: number;
    appendedSequences: number[];
    state: TutorRuntimeStateV9;
  } {
    return this.core.append(expectedRevision, events as PendingSessionEvent[]);
  }

  /** 全量重建（启动/恢复/对账用；gap/corruption/hash fail closed）。 */
  rebuild(): TutorRuntimeStateV9 {
    return this.core.rebuild();
  }

  /** G2 对账入口：在线缓存 state vs 全量重建 state。 */
  assertReplayParity(): { equal: boolean; differences: SessionStateDifference[] } {
    const parity = this.core.assertReplayParity();
    return { equal: parity.equal, differences: parity.differences };
  }
}
