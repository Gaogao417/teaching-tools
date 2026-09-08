import {verifyGenerationCompanions,type GenerationCompanion} from '../GenerationCompanionStore';
/**
 * TutorSessionKernel core（F7 Step 2 — 版本无关在线内核）。
 *
 * 从 TutorSessionKernelV5 抽出的在线侧入口（Event / Revision / Replay 内核），
 * 按 codec 注入。在线 state 与 rebuilt state 使用同一领域 reducer 的结构性保证：
 * - kernel 从不直接构造 state：start 与 resume 都经 verified rebuild
 *   （gap / corrupt / revision / pin fail closed）取得初始缓存 state；每次
 *   append 后把「store 提交成功的 canonical 事件行」读回，经同一 applyEvent
 *   推进缓存 state——不存在折叠未经校验事件行的路径；
 * - append 失败（REVISION_CONFLICT / DUPLICATE_EVENT / 校验失败 / reducer
 *   折叠拒绝——store 事务内先纯折叠验证候选批）时整批回滚，缓存 state 不动
 *   （重复写不重复产生事实）；
 * - assertReplayParity 用 codec 语义比较对账缓存 state 与全量重建 state
 *   （G2 核对入口；live 主链不依赖它，replay 只用于启动/恢复/对账）。
 *
 * fold context 在 start/resume 时从 session_started pin 解析一次并缓存于实例
 * （pin 不可变）；append 事务侧另行从已提交流重解析（store 边界自证）。
 *
 * 该模块不做教学决策（F5）、不执行动作（F3/F6），只提供事实内核。
 */
import type { SessionKernelCodec, SessionStateDifference } from "./sessionKernelCodec";
import type { PendingSessionEvent } from "./sessionKernelTypes";
import {
  appendSessionEvents,
  readSessionEvents,
  sessionRevision,
  startSession,
  type StartSessionInput,
} from "./TutorSessionStoreCore";
import {
  rebuildSessionState,
  verifyCommittedStream,
  type RebuildOptions,
} from "./RuntimeStateRebuilderCore";

export class TutorSessionKernelCore<S, C> {
  readonly sessionId: string;
  private readonly codec: SessionKernelCodec<S, C>;
  private readonly foldContext: C;
  private currentState: S;

  private constructor(codec: SessionKernelCodec<S, C>, sessionId: string, verifiedInitialState: S, foldContext: C) {
    this.codec = codec;
    this.sessionId = sessionId;
    this.currentState = verifiedInitialState;
    this.foldContext = foldContext;
  }

  /**
   * 启动会话（原子 pin + session_started），起步 state 经 verified rebuild。
   *
   * fold context（V6 = session-pinned binding/registry/catalog pin 对账）在
   * **持久化之前**解析（F7 Step 2 返工 P0-1）：解析抛错 ⇒ 零事件、零会话行——
   * 「pin/绑定失败必须零事件、零状态」门禁不得依赖 start 后的 resume 兜底
   * （那会留下已提交的 session_started 而接口返回失败）。pin 不可变，start
   * 前置解析与 resume/append 侧重解析结果一致。
   */
  static start<S, C>(codec: SessionKernelCodec<S, C>, input: StartSessionInput): TutorSessionKernelCore<S, C> {
    codec.resolveFoldContext(input.sessionStarted as unknown as Record<string, unknown>);
    startSession(codec, input);
    return TutorSessionKernelCore.resume(codec, input.sessionId);
  }

  /**
   * 从既有会话恢复：与 rebuildSessionState 同一完整性入口
   * （gap / corrupt payload / revision / event_schema / pin 全部 fail closed，
   * 不得对未校验事件行直接折叠），并缓存 fold context（pin 不可变）。
   */
  static resume<S, C>(codec: SessionKernelCodec<S, C>, sessionId: string, options?: RebuildOptions): TutorSessionKernelCore<S, C> {
    const stream = verifyCommittedStream(codec, sessionId, options);
    const foldContext = codec.resolveFoldContext(stream.sessionStartedPayload);
    const state = codec.foldCommitted(stream.events, foldContext);
    const canonical = codec.stateSchema.safeParse(state);
    if (!canonical.success) {
      throw codec.makeIntegrityError(
        "CORRUPT_EVENT",
        `rebuilt state fails canonical state validation: ${canonical.error.issues
          .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
          .join("; ")}`,
        stream.events[stream.events.length - 1]?.sequence,
      );
    }
    verifyGenerationCompanions(sessionId,foldContext as import('../GenerationCompanionStore').CompanionValidationContext);
    return new TutorSessionKernelCore(codec, sessionId, state, foldContext);
  }

  get state(): S {
    return this.currentState;
  }

  get revision(): number {
    return sessionRevision(this.codec, this.sessionId);
  }

  /**
   * 追加一批事件并推进在线 state：store 事务（内含候选批纯折叠验证，reducer
   * 拒绝 ⇒ 整批不落库）成功后，把本批提交的 canonical 事件行读回，经同一
   * reducer 折叠（在线=逐批增量，重建=全量重放，同一函数）。
   */
  append(expectedRevision: number, events: PendingSessionEvent[], companion?:GenerationCompanion): {
    revision: number;
    appendedSequences: number[];
    state: S;
  } {
    const result = appendSessionEvents(this.codec, this.sessionId, expectedRevision, events,companion);
    const committed = readSessionEvents(this.codec, this.sessionId);
    const batch = committed.filter((event) => result.appendedSequences.includes(event.sequence));
    if (batch.length !== result.appendedSequences.length) {
      throw this.codec.makeStoreError(
        "VALIDATION_FAILED",
        `append reported sequences ${result.appendedSequences.join(",")} but read-back mismatch`,
      );
    }
    for (const event of batch) {
      this.currentState = this.codec.applyEvent(this.currentState, event, this.foldContext);
    }
    return { revision: result.revision, appendedSequences: result.appendedSequences, state: this.currentState };
  }

  /** 全量重建（启动/恢复/对账用；gap/corruption/hash fail closed）。 */
  rebuild(): S {
    verifyGenerationCompanions(this.sessionId,this.foldContext as import('../GenerationCompanionStore').CompanionValidationContext);
    return rebuildSessionState(this.codec, this.sessionId);
  }

  /** G2 对账入口：在线缓存 state vs 全量重建 state。 */
  assertReplayParity(): { equal: boolean; differences: SessionStateDifference[] } {
    const comparison = this.codec.compareStates(this.currentState, this.rebuild());
    return { equal: comparison.equal, differences: comparison.differences };
  }
}
