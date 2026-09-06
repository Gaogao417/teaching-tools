/**
 * F7 Step 6：唯一 PresentationRuntime controller（PLAN §3 Step 6；spec §4.7
 * 执行流程；ADR-011 决策 3/5）。
 *
 * 职责：消费 SessionSnapshot 的唯一 pending action（queue head），按
 * sequence/ordinal 串行路由 capability adapter，经 outcome port 上报真实
 * 结果，响应快照重新进入同一 adopt 流程。禁止：第二队列、修改 Tutor/
 * Workspace 事实、把 dispatch 当 presented。
 *
 * 不保存教学状态——只持有当前执行句柄、去重键（sequence_id+ordinal+
 * action_id，绑 session）与 outcome 幂等 token（ledger 增补 20 偏差 3）：
 * - 同一有效 delivery 单次执行（StrictMode 双 adopt 忽略）；
 * - adapter 完成后 outcomePending 保存完整请求——重试同 key 同 payload，
 *   不重新呈现；4xx 与 200-内 turn 非 committed 为确定性失败释放；
 *   网络/5xx 保留 token，等下一次同键 adopt 重发；
 * - 服务端已推进（换键/无 pending）→ abort 陈旧执行、丢弃迟到结果、不上报；
 * - presented-ack 后同键重投 = 协议异常 fail closed；interrupted-ack 后同键
 *   重投 = 服务端重投策略，允许重新执行；failed-ack 后维持暂停（恢复只经
 *   retry_recovery 新 sequence）。
 */
import type { ValidatedSessionSnapshot } from "../../api/tutorRuntimeClient";
import type { CapabilityRegistry } from "./capabilityRegistry";
import type {
  PendingPresentationDelivery,
  PendingPresentationOutcomeRequest,
  PresentationAdapterResult,
  PresentationFailureClass,
  PresentationRuntimePhase,
  PresentationRuntimePorts,
  PresentationToolAdapter,
} from "./types";

/** 去重键（绑 session：跨会话同名键视为不同交付）。 */
export function presentationKeyOf(delivery: PendingPresentationDelivery): string {
  return `${delivery.session_id}:${delivery.sequence_id}:${delivery.ordinal}:${delivery.action_id}`;
}

function keyOfRequest(request: PendingPresentationOutcomeRequest): string {
  return `${request.sessionId}:${request.sequenceId}:${request.ordinal}:${request.actionId}`;
}

function deterministicOutcomeRequestId(request: Omit<PendingPresentationOutcomeRequest, "clientRequestId">): string {
  return `pres-outcome:${request.sessionId}:${request.sequenceId}:${request.ordinal}:${request.actionId}:${request.outcome}`;
}

interface Execution {
  readonly id: number;
  readonly key: string;
  readonly delivery: PendingPresentationDelivery;
  readonly snapshot: ValidatedSessionSnapshot;
  readonly adapter: PresentationToolAdapter;
  abort: AbortController;
}

type RuntimeState =
  | { kind: "idle" }
  | { kind: "executing"; execution: Execution }
  | { kind: "awaiting-gesture"; execution: Execution }
  | { kind: "awaiting-real-signal"; execution: Execution }
  | { kind: "outcome-pending"; key: string; request: PendingPresentationOutcomeRequest }
  | { kind: "paused-failure"; key: string; failureClass: PresentationFailureClass; message?: string };

interface AckedOutcome {
  key: string;
  outcome: "presented" | "interrupted" | "failed";
}

export class PresentationRuntimeController {
  private state: RuntimeState = { kind: "idle" };
  private acked: AckedOutcome | undefined;
  private disposed = false;
  private execSerial = 0;
  /** 会话代数：adopt 观察到 session 变化时递增；dispatch 响应据此判迟到。 */
  private epoch = 0;
  private currentSessionId: string | undefined;
  private outcomeInFlight = false;
  /** 在途请求身份（区分「同一请求已在途」与「新 token 被挡」）。 */
  private inFlightRequest: PendingPresentationOutcomeRequest | undefined;
  /** 当前 token 曾被在途请求挡下、尚未发出过——旧请求结束后补发（二次复验
   *  P1-4）。网络失败保留的 token 不置此标记：不自动循环重试。 */
  private outcomeDispatchQueued = false;

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly adapters: readonly PresentationToolAdapter[],
    private readonly ports: PresentationRuntimePorts,
  ) {
    // 构造期不 publish（hook 在渲染期创建实例；onStateChanged 只在真实转移时触发）。
  }

  /** 快照 adopt（唯一入口；hook 在每次新快照对象上调用）。 */
  adopt(snapshot: ValidatedSessionSnapshot): void {
    if (this.disposed) return;
    const pending = snapshot.pending_presentation;
    // 会话作用域按**每份** snapshot 更新（二次复验 P1-5）：切到无 pending 的
    // 新会话同样推进 epoch——旧会话在途 outcome 响应随即失配被丢弃，不能把
    // 采用面拉回旧会话。
    const sessionScope = pending?.session_id ?? snapshot.session_id;
    if (sessionScope !== this.currentSessionId) {
      this.currentSessionId = sessionScope;
      this.epoch += 1;
      this.acked = undefined;
    }
    if (pending === undefined) {
      // 服务端已推进（无 pending）：丢弃陈旧执行（不上报迟到结果），并释放
      // 挂起的 outcome token（其在途响应由 epoch 守卫丢弃）。
      this.discardExecution();
      this.clearOutcomePending();
      this.setState({ kind: "idle" });
      return;
    }
    const key = presentationKeyOf(pending);
    if (this.state.kind === "outcome-pending") {
      if (this.state.key === key) {
        // 结果未知/待重试：同 key 同 payload 重发，不重新呈现。
        void this.dispatchOutcome(this.state.request);
        return;
      }
      // 换键：服务端已推进——释放旧 token，转而执行新交付。
      this.clearOutcomePending();
      this.execute(pending, snapshot);
      return;
    }
    if (this.state.kind === "executing" || this.state.kind === "awaiting-gesture" || this.state.kind === "awaiting-real-signal") {
      if (this.state.execution.key === key) return; // 同一有效 delivery：单次执行（StrictMode）
      this.discardExecution();
      this.execute(pending, snapshot);
      return;
    }
    if (this.state.kind === "paused-failure") {
      if (this.state.key === key) return; // failed-ack：维持暂停，仅新 sequence 恢复
      this.execute(pending, snapshot);
      return;
    }
    // idle：acked 重投规则。
    const acked = this.acked;
    if (acked !== undefined && acked.key === key) {
      if (acked.outcome !== "interrupted") {
        // presented-ack 同键重投 = 协议异常；failed-ack 同键重投 = 仍处暂停。
        if (acked.outcome === "presented") {
          this.ports.onProtocolAnomaly(`服务端重新交付了已确认 presented 的动作（${key}）——fail closed，不重复呈现`);
        }
        this.state = {
          kind: "paused-failure",
          key,
          failureClass: "internal_error",
          message: acked.outcome === "presented" ? "redelivery of a presented action" : "redelivery of a failed action (retry_recovery expected)",
        };
        this.publish();
        return;
      }
      // interrupted-ack：服务端重投策略 → 允许重新执行。
    }
    this.execute(pending, snapshot);
  }

  /** 当前是否可打断（executing voice 且 interruptible；或 awaiting-gesture）。 */
  canInterrupt(): boolean {
    if (this.state.kind === "awaiting-gesture") return true;
    if (this.state.kind !== "executing") return false;
    const { delivery } = this.state.execution;
    return delivery.action.kind === "voice" && delivery.action.voice_action?.interruptible !== false;
  }

  /** InterruptCurrent：abort 当前 adapter → interrupted 上报（barge-in 第 1/2 步，
   *  control.barge_in 自动提交属 Step 8）。 */
  interruptCurrent(): void {
    if (this.disposed) return;
    if (this.state.kind === "executing") {
      this.state.execution.abort.abort();
      return;
    }
    if (this.state.kind === "awaiting-gesture") {
      const { delivery } = this.state.execution;
      this.discardExecution();
      this.report(delivery, "interrupted");
    }
  }

  /** autoplay 解锁（用户手势）后的续播。 */
  async resumeAfterGesture(): Promise<void> {
    if (this.disposed || this.state.kind !== "awaiting-gesture") return;
    const execution = this.state.execution;
    if (execution.adapter.resume === undefined) return;
    execution.abort = new AbortController();
    this.state = { kind: "executing", execution };
    this.publish();
    const result = await execution.adapter.resume(execution.abort.signal);
    this.handleAdapterResult(execution, result);
  }

  /** F7 Step 7 返工（复验 P1-2）：真实完成信号源**后于** adapter 暂停接入的
   *  恢复路径——presentation surface 挂载注册信号源时通知本 runtime；处于
   *  awaiting-real-signal 的执行以原 delivery+snapshot 重新执行（workspace
   *  adapter 无副作用，重入安全）。非该状态时为 no-op。 */
  retryAwaitingRealSignal(): void {
    if (this.disposed || this.state.kind !== "awaiting-real-signal") return;
    const execution = this.state.execution;
    execution.abort = new AbortController();
    this.state = { kind: "executing", execution };
    this.publish();
    void execution.adapter.present({ delivery: execution.delivery, snapshot: execution.snapshot, abort: execution.abort.signal })
      .then((result) => this.handleAdapterResult(execution, result))
      .catch((failure: unknown) => {
        this.handleAdapterResult(execution, {
          outcome: "failed",
          failureClass: "internal_error",
          message: `presentation adapter threw: ${failure instanceof Error ? failure.message : String(failure)}`,
        });
      });
  }

  /** 纯回放（零上报）：actionId + 缓存 + 播放互斥由 voice adapter 核对。 */
  replayVoice(actionId: string): boolean {
    if (this.disposed) return false;
    const voice = this.adapters.find((adapter) => adapter.canReplay?.(actionId) === true);
    return voice?.replay?.(actionId) ?? false;
  }

  /** 最近可回放的 voice actionId（UI replay 门控；无目标时 undefined）。 */
  replayTarget(): string | undefined {
    for (const adapter of this.adapters) {
      const target = adapter.lastReplayableActionId?.();
      if (target !== undefined) return target;
    }
    return undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch += 1;
    if (this.state.kind === "executing" || this.state.kind === "awaiting-gesture" || this.state.kind === "awaiting-real-signal") {
      this.state.execution.abort.abort();
    }
    this.state = { kind: "idle" };
  }

  // --------------------------------------------------------------------- //

  private execute(pending: PendingPresentationDelivery, snapshot: ValidatedSessionSnapshot): void {
    const adapter = this.registry.resolve(pending.action);
    if (adapter === undefined) {
      // spec §4.7：unknown capability fail closed——上报 capability_unsupported
      // 并暂停（服务端 cursor 停留当前 action，不自动重试）。
      const key = this.registry.describe(pending.action) ?? `kind=${pending.action.kind}`;
      this.report(pending, "failed", "capability_unsupported", `no presentation adapter supports ${key}`);
      return;
    }
    const execution: Execution = {
      id: ++this.execSerial,
      key: presentationKeyOf(pending),
      delivery: pending,
      snapshot,
      adapter,
      abort: new AbortController(),
    };
    this.state = { kind: "executing", execution };
    this.publish();
    void execution.adapter.present({ delivery: pending, snapshot, abort: execution.abort.signal })
      .then((result) => this.handleAdapterResult(execution, result))
      .catch((failure: unknown) => {
        this.handleAdapterResult(execution, {
          outcome: "failed",
          failureClass: "internal_error",
          message: `presentation adapter threw: ${failure instanceof Error ? failure.message : String(failure)}`,
        });
      });
  }

  private handleAdapterResult(execution: Execution, result: PresentationAdapterResult): void {
    if (this.disposed) return;
    const current = this.state;
    const isCurrentExecution = (current.kind === "executing" || current.kind === "awaiting-gesture" || current.kind === "awaiting-real-signal")
      && current.execution.id === execution.id;
    if (!isCurrentExecution) return; // 陈旧执行（服务端已推进/已丢弃）：迟到结果不上报
    switch (result.outcome) {
      case "presented":
        this.report(execution.delivery, "presented");
        return;
      case "interrupted":
        this.report(execution.delivery, "interrupted");
        return;
      case "failed":
        this.report(execution.delivery, "failed", result.failureClass, result.message);
        return;
      case "blocked-by-autoplay":
        this.state = { kind: "awaiting-gesture", execution };
        this.publish();
        return;
      case "awaiting-real-signal":
        this.state = { kind: "awaiting-real-signal", execution };
        this.publish();
        return;
    }
  }

  private report(
    delivery: PendingPresentationDelivery,
    outcome: "presented" | "interrupted" | "failed",
    failureClass?: PresentationFailureClass,
    message?: string,
  ): void {
    const base = {
      sessionId: delivery.session_id,
      actionId: delivery.action_id,
      sequenceId: delivery.sequence_id,
      ordinal: delivery.ordinal,
      outcome,
      ...(failureClass !== undefined ? { failureClass } : {}),
      ...(message !== undefined ? { message } : {}),
      expectedRevision: delivery.session_revision,
    };
    const request: PendingPresentationOutcomeRequest = { ...base, clientRequestId: deterministicOutcomeRequestId(base) };
    this.state = { kind: "outcome-pending", key: presentationKeyOf(delivery), request };
    this.publish();
    void this.dispatchOutcome(request);
  }

  private async dispatchOutcome(request: PendingPresentationOutcomeRequest): Promise<void> {
    if (this.disposed) return;
    if (this.outcomeInFlight) {
      // 另一请求在途：只有「不同身份的新 token」记待补发（同一请求重入不
      // 重复发送）；补发仅发生在旧请求结束（finally），网络失败不自动重试。
      if (this.inFlightRequest !== request
        && this.state.kind === "outcome-pending"
        && this.state.request === request) {
        this.outcomeDispatchQueued = true;
      }
      return;
    }
    this.outcomeInFlight = true;
    this.inFlightRequest = request;
    const epoch = this.epoch;
    /** 请求身份守卫（复验 P1-2）：只有当本请求仍是当前挂起的 outcome token
     *  时，其响应/异常才允许触碰状态——adopt 换键/释放后到达的旧响应不得
     *  清掉正在执行的新动作。 */
    const isLiveOutcome = (): boolean => this.state.kind === "outcome-pending" && this.state.request === request;
    try {
      const snapshot = await this.ports.reportOutcome(request);
      if (this.disposed || epoch !== this.epoch) return; // 迟到响应：保持 token，由新代数重驱动
      const turn = snapshot.turn;
      if (turn !== undefined && turn.status !== "committed") {
        // 应用层确定性失败（200 内 revision-conflict 等）：释放 token，不盲重试。
        if (isLiveOutcome()) {
          this.ports.onNotice(`呈现回执未被接受（${turn.status}），服务端已推进；请重新同步。`);
          this.clearOutcomePending();
          this.setState({ kind: "idle" });
        }
        return;
      }
      // 200 committed：服务端已接受该 outcome——acked 按服务端真源记录
      //（与本地采用门禁是否放行无关）；本地采用仍走同一 hook 门禁。
      void this.ports.adoptOutcomeSnapshot(snapshot, request.sessionId);
      this.acked = { key: keyOfRequest(request), outcome: request.outcome };
      if (!isLiveOutcome()) return; // token 已被换键释放：不改写当前执行状态
      this.clearOutcomePending();
      if (request.outcome === "failed") {
        this.setState({
          kind: "paused-failure",
          key: keyOfRequest(request),
          failureClass: request.failureClass ?? "internal_error",
          ...(request.message !== undefined ? { message: request.message } : {}),
        });
      } else {
        this.setState({ kind: "idle" });
      }
      return;
    } catch (failure) {
      if (this.disposed || epoch !== this.epoch) return;
      if (this.ports.isDefinitiveFailure(failure)) {
        if (isLiveOutcome()) {
          this.ports.onNotice(`呈现回执被拒绝（${failure instanceof Error ? failure.message : String(failure)}）；已停止重试。`);
          this.clearOutcomePending();
          this.setState({ kind: "idle" });
        }
        return;
      }
      // 网络/5xx：保留完整请求，同 key 同 payload 待重发（restore 重同步后）。
      if (isLiveOutcome()) {
        this.ports.onNotice("呈现回执网络失败；重新同步后将用同一幂等键重试。");
        this.publish();
      }
    } finally {
      this.outcomeInFlight = false;
      this.inFlightRequest = undefined;
      // 补发被挡下的当前 token（只补发从未成功发出的请求；请求身份以当下
      // state 为准——期间再换键则自然发最新 token）。
      if (this.outcomeDispatchQueued && !this.disposed) {
        this.outcomeDispatchQueued = false;
        const current = this.state.kind === "outcome-pending" ? this.state.request : undefined;
        if (current !== undefined) void this.dispatchOutcome(current);
      }
    }
  }

  private clearOutcomePending(): void {
    if (this.state.kind === "outcome-pending") this.state = { kind: "idle" };
  }

  private discardExecution(): void {
    if (this.state.kind === "executing" || this.state.kind === "awaiting-gesture" || this.state.kind === "awaiting-real-signal") {
      this.state.execution.abort.abort();
      this.state = { kind: "idle" };
    }
  }

  private setState(next: RuntimeState): void {
    this.state = next;
    this.publish();
  }

  private publish(): void {
    this.ports.onStateChanged(this.publicPhase());
  }

  private publicPhase(): PresentationRuntimePhase {
    switch (this.state.kind) {
      case "idle":
        return { phase: "idle" };
      case "executing": {
        const { delivery } = this.state.execution;
        return {
          phase: "presenting",
          kind: delivery.action.kind === "voice"
            ? "voice"
            : delivery.action.workspace_action?.surface === "solution_board" ? "board" : "geometry",
          actionId: delivery.action_id,
          interruptible: delivery.action.kind === "voice" && delivery.action.voice_action?.interruptible !== false,
        };
      }
      case "awaiting-gesture":
        return { phase: "awaiting-gesture", actionId: this.state.execution.delivery.action_id };
      case "awaiting-real-signal":
        return { phase: "paused", reason: "real-signal-unavailable", actionId: this.state.execution.delivery.action_id };
      case "outcome-pending":
        return { phase: "outcome-pending", actionId: this.state.request.actionId };
      case "paused-failure":
        return {
          phase: "paused",
          reason: "failure",
          failureClass: this.state.failureClass,
          ...(this.state.message !== undefined ? { message: this.state.message } : {}),
        };
    }
  }
}
