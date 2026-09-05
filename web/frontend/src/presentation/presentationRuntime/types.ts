/**
 * F7 Step 6：唯一 PresentationRuntime 的类型声明（PLAN §3 Step 6 / ADR-011
 * 决策 3/4）。
 *
 * PresentationRuntime 不保存教学状态——只持有当前执行句柄、去重键
 * （sequence_id + ordinal + action_id）与 outcome 幂等 token；恢复真源始终
 * 是服务端 SessionSnapshot。adapter 收到的是已过 canonical/runtime validator
 * 的 typed delivery（spec §4.7），不接收模型自由 JSON。
 */
import type { ValidatedSessionSnapshot } from "../../api/tutorRuntimeClient";

/** 快照 pending_presentation（canonical presentation_delivery/v1 全形状）。 */
export type PendingPresentationDelivery = NonNullable<ValidatedSessionSnapshot["pending_presentation"]>;

/** canonical presentation-outcome/v1 failure_class 封闭枚举。 */
export type PresentationFailureClass =
  | "validation_failure"
  | "capability_unsupported"
  | "illegal_target"
  | "stale_revision"
  | "truth_boundary_violation"
  | "provider_failure"
  | "timeout"
  | "internal_error";

export interface PresentationPresentRequest {
  delivery: PendingPresentationDelivery;
  snapshot: ValidatedSessionSnapshot;
  /** controller 发起的中断（InterruptCurrent / 服务端已推进丢弃旧执行）。 */
  abort: AbortSignal;
}

/**
 * adapter 执行结果。presented/interrupted/failed 进 outcome 上报；
 * blocked-by-autoplay 与 awaiting-real-signal 是 runtime 内部暂停态，
 * 绝不映射成 presented（ledger 增补 20 偏差 1/4）。
 */
export type PresentationAdapterResult =
  | { outcome: "presented" }
  | { outcome: "interrupted" }
  | { outcome: "failed"; failureClass: PresentationFailureClass; message?: string }
  | { outcome: "blocked-by-autoplay" }
  | { outcome: "awaiting-real-signal" };

/** capability adapter（spec §4.7 registry：Supports 按 kind+surface+capability 判定）。 */
export interface PresentationToolAdapter {
  supports(action: PendingPresentationDelivery["action"]): boolean;
  present(request: PresentationPresentRequest): Promise<PresentationAdapterResult>;
  /** autoplay 解除后的续播（仅 voice；等待同一份缓存的真实 ended）。
   *  abort 与 present 同语义：controller 打断/服务端已推进/销毁时停播。 */
  resume?(abort: AbortSignal): Promise<PresentationAdapterResult>;
  /** 纯回放（零上报）：核对 actionId + 缓存 + 播放互斥后回放缓存。 */
  canReplay?(actionId: string): boolean;
  replay?(actionId: string): void;
  /** 最近可回放的 voice actionId（UI replay 门控；无可回放目标时省略）。 */
  lastReplayableActionId?(): string | undefined;
}

/** UI/诊断投影（瞬时执行状态；服务端 snapshot 才是恢复真源）。 */
export type PresentationRuntimePhase =
  | { phase: "idle" }
  | { phase: "presenting"; kind: "voice" | "geometry" | "board"; actionId: string; interruptible: boolean }
  | { phase: "awaiting-gesture"; actionId: string }
  | { phase: "outcome-pending"; actionId: string }
  | {
      phase: "paused";
      reason: "real-signal-unavailable" | "failure";
      actionId?: string;
      failureClass?: PresentationFailureClass;
      message?: string;
    };

/** outcome 上报请求（幂等 token 的完整载荷；重试同 key 同 payload）。 */
export interface PendingPresentationOutcomeRequest {
  sessionId: string;
  actionId: string;
  sequenceId: string;
  ordinal: number;
  outcome: "presented" | "interrupted" | "failed";
  failureClass?: PresentationFailureClass;
  message?: string;
  expectedRevision: number;
  clientRequestId: string;
}

export interface PresentationRuntimePorts {
  reportOutcome(request: PendingPresentationOutcomeRequest): Promise<ValidatedSessionSnapshot>;
  /** outcome 响应快照经同一 adopt 门禁采用（epoch/revision/身份由 hook 把关；
   *  expectedSessionId 供 hook 拒绝跨会话迟到响应）。 */
  adoptOutcomeSnapshot(snapshot: ValidatedSessionSnapshot, expectedSessionId: string): boolean;
  /** 协议异常（如 presented-ack 后同键重投）：fail closed 通知。 */
  onProtocolAnomaly(message: string): void;
  /** outcome 传输/应用层失败的瞬时提示。 */
  onNotice(message: string): void;
  onStateChanged(state: PresentationRuntimePhase): void;
  /** 4xx（含 payload drift）等确定性失败判定；网络/5xx/协议解析为非确定性。 */
  isDefinitiveFailure(failure: unknown): boolean;
}
