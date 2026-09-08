import type {GenerationCompanion} from '../../tutorSession/GenerationCompanionStore';
/**
 * GenerationCoordinator（F7 RT4 — 异步生成生命周期引擎；生成生命周期执行规格）。
 *
 * 职责分工（规格 Ownership）：
 * - Orchestrator 依已提交教学决策**预约**生成（reserveGeneration：幂等
 *   source_request_id、CAS 预约事件、冻结上下文 digest）；
 * - 本协调器驱动**事务外**模型调用循环（driveGeneration）：每次调用前先以
 *   attempt_started 事件原子认领（ownership token：attempt/epoch；首次认领
 *   attempt 不变、epoch+1，重试/续跑新认领 = attempt+1/epoch+1 原子消耗预算；
 *   CAS 失败方本轮不得调用模型——并行认领最多一个有效 owner）；超时/传输失败/
 *   5xx ⇒ waiting_retry + retry_at（同 request、同冻结上下文、新 attempt/epoch）；
 *   预算耗尽 ⇒ failed(RETRY_EXHAUSTED)；schema/binding/权限失败 ⇒ 立即
 *   failed（不重试）；用户取消 ⇒ invalidated（正常控制结果）；
 * - 提交：编译候选经 kernel 单事件事务 planned(v4+generation) 落库——序列、
 *   provenance、板书正文原子提交，slot 同事件清回 idle；提交路径任何异常（CAS
 *   冲突/回执错误）先重读查证：已 committed ⇒ 返回既有结果（不重生成），仍持
 *   有效 epoch ⇒ 重交持有候选（不调模型），否则 superseded（迟到/取消零提交）；
 * - 恢复：committed 请求按幂等身份取回已提交序列（零模型调用）；pending
 *   请求按剩余预算续跑（崩溃后 attempt 消耗已登记，不重置计数）。
 *
 * 模型调用永远在 kernel append 事务之外；lease 不授予提交资格（epoch/CAS
 * 唯一裁决——本版进程内 worker，无外部队列依赖）。
 */
import { createHash, randomUUID } from "node:crypto";

import type { PendingV9Event, V9GenerationEventPayload } from "../../tutorSession/TutorSessionEventV9";
import type { TutorRuntimeStateV9 } from "../../tutorSession/TutorRuntimeStateReducerV9";
import type { CompiledPresentationCandidate } from "./IntentCompiler";
import { PresenterGenerationError } from "./GeneratorPort";
import { claimGenerationLease, renewGenerationLease, releaseGenerationLease, GENERATION_LEASE_MS, GENERATION_HEARTBEAT_MS } from "./GenerationLease";

/** 生成重试预算（规格 Interfaces：max_retries=2 ⇒ 3 次调用；30s 超时；1s/3s 退避；按请求冻结）。 */
export interface GenerationRetryPolicy {
  readonly policy_version: string;
  readonly max_attempts: number;
  readonly timeout_ms: number;
  readonly retry_delays_ms: number[];
}

export const DEFAULT_RETRY_POLICY: GenerationRetryPolicy = {
  policy_version: "retry-policy/v1-default",
  max_attempts: 3,
  timeout_ms: 30_000,
  retry_delays_ms: [1_000, 3_000],
};

/** kernel 访问面（Navigator/Orchestrator 提供真实 kernel；测试注入）。 */
export interface GenerationKernelAccess {
  readonly sessionId: string;
  readonly revision: number;
  readonly state: Pick<TutorRuntimeStateV9, "generation_slot" | "generation_requests" | "presentation_cursor" | "pinned_plan">;
  append(expectedRevision: number, events: PendingV9Event[],companion?:GenerationCompanion): { revision: number; appendedSequences: number[] };
}

/** 单次内容管线（RT2 上下文复算 + RT3 提示词/模型/编译/预演；由 Orchestrator 组装）。 */
export interface PresenterAttemptPipeline {
  buildAndRun(request: GenerationRequestView): Promise<{ readonly candidate: CompiledPresentationCandidate }>;
  /** Local advisory notification only after the owned retry transition commits. */
  onRetryScheduled?(request: GenerationRequestView, error: PresenterGenerationError): void;
}

/** 驱动循环读取的请求视图（GenerationRequestRecord 同构）。 */
export type GenerationRequestView = V9GenerationEventPayload;

export type GenerationCoordinatorErrorCode =
  | "SOURCE_REQUEST_CONFLICT"
  | "SLOT_BUSY"
  | "CURSOR_NOT_IDLE"
  | "PIN_MISMATCH"
  | "RESERVATION_CONFLICT";

export class GenerationCoordinatorError extends Error {
  constructor(readonly code: GenerationCoordinatorErrorCode, message: string) {
    super(message);
    this.name = "GenerationCoordinatorError";
  }
}

export interface ReserveGenerationInput {
  readonly sourceRequestId: string;
  readonly decisionId: string;
  readonly decisionSequence: number;
  readonly scope: V9GenerationEventPayload["scope"];
  readonly contextDigest: string;
  readonly context: V9GenerationEventPayload["context"];
  readonly inputText: string | null;
  readonly presenterPin: V9GenerationEventPayload["presenter_pin"];
  readonly policy?: GenerationRetryPolicy;
}

export type ReservationOutcome =
  | { readonly kind: "reserved"; readonly request: GenerationRequestView }
  | { readonly kind: "existing"; readonly request: GenerationRequestView };

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

const nowIso = (): string => new Date().toISOString();

/**
 * 预约（幂等）：同 source_request_id 同 payload → 返回既有任务（不重复调用
 * 模型）；异 payload → SOURCE_REQUEST_CONFLICT；slot 占用 → SLOT_BUSY；
 * cursor 非 idle → CURSOR_NOT_IDLE（pending slot ⇒ idle cursor）。
 */
export function reserveGeneration(access: GenerationKernelAccess, input: ReserveGenerationInput): ReservationOutcome {
  const existing = access.state.generation_requests.find((record) => record.source_request_id === input.sourceRequestId);
  if (existing) {
    const samePayload =
      existing.decision_id === input.decisionId
      && JSON.stringify(existing.scope) === JSON.stringify(input.scope)
      && existing.input_digest === sha256({ context: input.contextDigest, input: input.inputText })
      && existing.presenter_pin.provider === input.presenterPin.provider
      && existing.presenter_pin.model_id === input.presenterPin.model_id
      && existing.presenter_pin.prompt_version === input.presenterPin.prompt_version;
    if (!samePayload) {
      throw new GenerationCoordinatorError(
        "SOURCE_REQUEST_CONFLICT",
        `source_request_id ${input.sourceRequestId} already owns generation ${existing.request_id} with a different payload (idempotent identity; explicit refusal, no second model task)`,
      );
    }
    return { kind: "existing", request: existing as unknown as GenerationRequestView };
  }
  const pending = access.state.generation_slot.status === "pending" ? access.state.generation_slot.request_id : undefined;
  if (pending !== undefined) {
    throw new GenerationCoordinatorError(
      "SLOT_BUSY",
      `generation slot is held by pending request ${pending} (cancel or commit before reserving ${input.sourceRequestId})`,
    );
  }
  if (access.state.presentation_cursor.status !== "idle") {
    throw new GenerationCoordinatorError(
      "CURSOR_NOT_IDLE",
      `presentation cursor is ${access.state.presentation_cursor.status}; a generation request requires an idle delivery cursor`,
    );
  }
  const policy = input.policy ?? DEFAULT_RETRY_POLICY;
  const serial = String(access.state.generation_requests.length + 1).padStart(4, "0");
  const request: V9GenerationEventPayload = {
    request_id: `GR-${access.sessionId}-${serial}`,
    source_request_id: input.sourceRequestId,
    decision_id: input.decisionId,
    scope: input.scope,
    reservation_revision: access.revision,
    epoch: 1,
    attempt: 1,
    max_attempts: policy.max_attempts,
    retry_policy_version: policy.policy_version,
    timeout_ms: policy.timeout_ms,
    retry_delays_ms: [...policy.retry_delays_ms],
    context: input.context,
    input_digest: sha256({ context: input.contextDigest, input: input.inputText }),
    presenter_pin: input.presenterPin,
    status: "pending",
    phase: "running",
  };
  access.append(access.revision, [
    {
      event_type: "presentation_generation_requested",
      payload: request,
      occurred_at: nowIso(),
      causation_sequence: input.decisionSequence,
      idempotency_key: `gen:${access.sessionId}:${request.request_id}:requested`,
    },
  ]);
  return { kind: "reserved", request };
}

/** 取消（正常控制操作）：pending ⇒ invalidated(cancel_reason)；其余幂等 no-op。 */
export function cancelGeneration(
  access: GenerationKernelAccess,
  cancelReason: V9GenerationEventPayload["cancel_reason"],
  causationSequence: number,
): { readonly cancelled: boolean; readonly requestId?: string } {
  const slot = access.state.generation_slot;
  if (slot.status !== "pending") return { cancelled: false };
  const record = access.state.generation_requests.find((candidate) => candidate.request_id === slot.request_id);
  if (!record || record.status !== "pending") return { cancelled: false };
  const payload: V9GenerationEventPayload = { ...(record as unknown as V9GenerationEventPayload), status: "cancelled", cancel_reason: cancelReason };
  delete payload.phase;
  delete payload.retry_at;
  access.append(access.revision, [
    {
      event_type: "presentation_generation_invalidated",
      payload,
      occurred_at: nowIso(),
      causation_sequence: causationSequence,
      idempotency_key: `gen:${access.sessionId}:${record.request_id}:invalidated`,
    },
  ]);
  return { cancelled: true, requestId: record.request_id };
}

export interface DriveDeps {
  /** 生成事件的因果锚（预约所依已提交决策的 sequence；canonical 必填）。 */
  readonly causationSequence: number;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  /** CAS 冲突后的重读（真实 kernel：refresh 后重取 access）。 */
  readonly refresh?: () => GenerationKernelAccess;
  readonly signal?: AbortSignal;
  /** Injectable scheduling duration for deterministic expiry tests; production default 45s. */
  readonly leaseMs?: number;
}

export type DriveOutcome =
  | { readonly kind: "committed"; readonly sequence: CompiledPresentationCandidate }
  | { readonly kind: "failed"; readonly errorClass: NonNullable<V9GenerationEventPayload["error_class"]> }
  | { readonly kind: "superseded" };

/**
 * 驱动 pending 请求直至终态（committed/failed/superseded）。
 *
 * F7 P2-B（B2）认领门与提交查证（生成生命周期规格 :26/:38/:45/:52）：
 * - 调用模型前必须以 attempt_started 事件原子认领（ownership token：attempt/epoch；
 *   首次认领 attempt 不变、epoch+1；重试/失联续跑的新认领 = attempt+1/epoch+1，
 *   原子消耗预算）。CAS 失败方本轮不得调用模型——并行认领最多一个有效 owner；
 * - running 请求已被其他 worker 认领（epoch 已提升）⇒ 本驱动退让（superseded，
 *   零模型调用、不劫持在途调用的预算）。进程内单 worker 模型下这是可判定的
 *   「在途 owner 存在」唯一信号——事件词表冻结（26 类）无租约时钟字段，对
 *   running 孤儿（认领者已死）的自动接管因此不在此实现；显式恢复路径见
 *   Orchestrator.retryRecovery（生成失败后 retry_recovery 新任务新预算）；
 * - 提交（planned）路径任何异常（CAS 冲突/已确认回滚/回执错误注入）⇒ 先重读
 *   权威状态查证：已 committed ⇒ 返回既有结果（不重生成）；仍 pending 且 epoch
 *   仍属本 worker ⇒ 用持有候选重交（不调模型）；epoch 已推进/取消/失败 ⇒ superseded。
 */
export async function driveGeneration(
  initialAccess: GenerationKernelAccess,
  pipeline: PresenterAttemptPipeline,
  deps: DriveDeps,
): Promise<DriveOutcome> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? (async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  let access = initialAccess;

  type PendingRequestView = GenerationRequestView & { status: string; phase?: string; retry_at?: string; attempt: number; epoch: number; sequence_id?: string };
  const requestOf = (): PendingRequestView | undefined => {
    const slot = access.state.generation_slot;
    if (slot.status !== "pending") return undefined;
    return access.state.generation_requests.find((record) => record.request_id === slot.request_id) as unknown as PendingRequestView;
  };
  const recordOf = (requestId: string): PendingRequestView | undefined =>
    access.state.generation_requests.find((record) => record.request_id === requestId) as unknown as PendingRequestView | undefined;

  /** 认领/预算事件构造（attempt_started 快照；retry_at 不随认领携带）。 */
  const attemptStartedEvent = (request: PendingRequestView, attempt: number, epoch: number): PendingV9Event => {
    const payload: V9GenerationEventPayload = { ...(request as unknown as V9GenerationEventPayload), attempt, epoch, phase: "running" };
    delete payload.retry_at;
    return {
      event_type: "presentation_generation_attempt_started",
      payload,
      occurred_at: nowIso(),
      causation_sequence: deps.causationSequence,
      idempotency_key: `gen:${access.sessionId}:${request.request_id}:attempt:${attempt}:epoch:${epoch}`,
    };
  };

  const owner = randomUUID();
  let leaseRequestId: string | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const appendClaim = (events: PendingV9Event[]): boolean => {
    const payload = events[0].payload as V9GenerationEventPayload;
    try {
      const claimed = claimGenerationLease({ sessionId: access.sessionId,
        requestId: payload.request_id, owner, epoch: payload.epoch,
        now: now().getTime(), leaseMs: deps.leaseMs ?? GENERATION_LEASE_MS,
        commit: () => { access.append(access.revision, events); return true; },
      });
      if (claimed) {
        leaseRequestId = payload.request_id;
        if (!heartbeat) {
          heartbeat = setInterval(() => {
            try { if (leaseRequestId) renewGenerationLease(access.sessionId, leaseRequestId, owner, now().getTime()); }
            catch { /* Storage failure cannot grant ownership. Commit rechecks kernel CAS. */ }
          }, GENERATION_HEARTBEAT_MS);
          heartbeat.unref();
        }
      }
      return claimed;
    } catch (error) {
      access = deps.refresh?.() ?? access;
      // A concurrent winner is normal. Unchanged state means a storage/validation error.
      const current = recordOf(payload.request_id);
      if (current?.epoch === payload.epoch || current?.status !== "pending") return false;
      throw error;
    }
  };

  /**
   * 模型后事实转换（retry_scheduled/failed）提交：CAS 冲突/异常 ⇒ 重读查证后
   * 重交**同一转换**（不重调模型）；请求终态或 epoch 被推进 ⇒ superseded。
   * 重交仍失败（查证后仍属本 worker）⇒ 如实上抛。
   */
  const appendTransition = (events: PendingV9Event[], snapshot: PendingRequestView, owned: { attempt: number; epoch: number }): "appended" | "superseded" => {
    let failure: unknown;
    for (let round = 0; round < 2; round += 1) {
      try {
        access.append(access.revision, events);
        return "appended";
      } catch (error) {
        failure = error;
        access = deps.refresh?.() ?? access;
        const reread = recordOf(snapshot.request_id);
        if (!reread || reread.status !== "pending") return "superseded";
        if (reread.epoch !== owned.epoch || reread.attempt !== owned.attempt) return "superseded";
      }
    }
    throw failure;
  };

  /** 查证路径的 committed 视图：优先返回持有候选（id 相同=本 worker 的候选已入库）；他人先交的序列只回身份/成因摘要（交付层按 sequence_id 从 committed 流重读正文）。 */
  const withoutCompanion=(candidate:CompiledPresentationCandidate):CompiledPresentationCandidate=>{const {internalCompanion: _audit,...plan}=candidate;return plan;};
  const verifiedSequence = (record: PendingRequestView, candidate: CompiledPresentationCandidate): CompiledPresentationCandidate => {
    if (record.sequence_id !== undefined && record.sequence_id === candidate.sequence_id
      && record.epoch === candidate.generation?.epoch && record.attempt === candidate.generation?.attempt) return withoutCompanion(candidate);
    return {
      sequence_id: record.sequence_id ?? "",
      decision_id: record.decision_id,
      scope: record.scope,
      generation: {
        request_id: record.request_id,
        attempt: record.attempt,
        input_digest: record.input_digest,
        presenter_pin: record.presenter_pin,
        epoch: record.epoch,
      },
      actions: [],
    } as unknown as CompiledPresentationCandidate;
  };

  // 本驱动循环经 CAS attempt_started 认领到的 ownership token（attempt/epoch）。
  let owned: { attempt: number; epoch: number } | undefined;

  try {
  for (;;) {
    if (deps.signal?.aborted) {
      // 取消信号只中断等待；权威取消由 invalidated 事件落库（调用方）。
      const request = requestOf();
      if (!request || request.status !== "pending") return { kind: "superseded" };
    }
    const request = requestOf();
    if (!request) {
      // slot 非 pending：committed（已有人提交）或 failed/idle（已取消/失败）。
      return { kind: "superseded" };
    }
    if (request.status === "cancelled" || request.status === "committed" || request.status === "failed") {
      return { kind: "superseded" };
    }
    if (request.phase === "waiting_retry" && request.retry_at !== undefined) {
      const waitMs = Math.max(0, Date.parse(request.retry_at) - now().getTime());
      if (waitMs > 0) await sleep(waitMs);
      // 到点后新认领：attempt+1 / epoch+1（原子消耗预算；规格 :27——自动重试复用
      // 同一上下文和 request，但使用新 attempt/epoch）。
      const claim = { attempt: request.attempt + 1, epoch: request.epoch + 1 };
      if (appendClaim([attemptStartedEvent(request, claim.attempt, claim.epoch)])) owned = claim;
      else return { kind: "superseded" };
      continue;
    }
    // running：认领门（规格 :26/:38/:52）。
    if (owned !== undefined && (request.epoch !== owned.epoch || request.attempt !== owned.attempt)) {
      // 权威 epoch/attempt 已不属本 worker：被 fence（迟到 worker 零提交）。
      return { kind: "superseded" };
    }
    if (owned === undefined) {
      if (request.epoch === 1 && request.attempt === 1) {
        // 首次认领：requested 事件只登记预算基线（attempt=1/epoch=1）——本 worker
        // 以 attempt_started 提升 epoch 建立 ownership token；CAS 失败方本轮退出。
        const claim = { attempt: 1, epoch: 2 };
        if (appendClaim([attemptStartedEvent(request, claim.attempt, claim.epoch)])) owned = claim;
        else return { kind: "superseded" };
        continue;
      }
      // A released/expired owner may be replaced; the lost call remains consumed.
      if (request.attempt >= request.max_attempts) {
        const payload = { ...request, status: "failed", error_class: "RETRY_EXHAUSTED" } as V9GenerationEventPayload;
        delete payload.phase;
        delete payload.retry_at;
        const failed = { event_type: "presentation_generation_failed", payload, occurred_at: nowIso(),
          causation_sequence: deps.causationSequence, idempotency_key: `gen:${access.sessionId}:${request.request_id}:exhausted:${request.epoch}` } as PendingV9Event;
        if (!appendClaim([failed])) return { kind: "superseded" };
        return { kind: "failed", errorClass: "RETRY_EXHAUSTED" };
      }
      const claim = { attempt: request.attempt + 1, epoch: request.epoch + 1 };
      if (!appendClaim([attemptStartedEvent(request, claim.attempt, claim.epoch)])) return { kind: "superseded" };
      owned = claim;
      continue;
    }
    // —— 认领有效：事务外调用模型 ——
    const snapshot = request as unknown as V9GenerationEventPayload;
    let candidate: CompiledPresentationCandidate;
    try {
      const result = await pipeline.buildAndRun(snapshot);
      candidate = result.candidate;
    } catch (error) {
      if (!(error instanceof PresenterGenerationError)) throw error;
      const canRetry = error.retryable && snapshot.attempt < snapshot.max_attempts;
      if (canRetry) {
        const delayMs = snapshot.retry_delays_ms[snapshot.attempt - 1] ?? 0;
        const retryPayload: V9GenerationEventPayload = { ...snapshot, phase: "waiting_retry", retry_at: new Date(now().getTime() + delayMs).toISOString() };
        const appended = appendTransition([
          { event_type: "presentation_generation_retry_scheduled", payload: retryPayload, occurred_at: nowIso(), causation_sequence: deps.causationSequence, idempotency_key: `gen:${access.sessionId}:${snapshot.request_id}:retry:${snapshot.attempt}` },
        ], snapshot as PendingRequestView, owned);
        if (appended === "superseded") return { kind: "superseded" };
        pipeline.onRetryScheduled?.(snapshot,error);
        continue;
      }
      const errorClass = error.retryable && snapshot.attempt >= snapshot.max_attempts ? "RETRY_EXHAUSTED" : error.failureClass;
      const failedPayload: V9GenerationEventPayload = { ...snapshot, status: "failed", error_class: errorClass };
      delete failedPayload.phase;
      delete failedPayload.retry_at;
      const appended = appendTransition([
        { event_type: "presentation_generation_failed", payload: failedPayload, occurred_at: nowIso(), causation_sequence: deps.causationSequence, idempotency_key: `gen:${access.sessionId}:${snapshot.request_id}:failed:${snapshot.attempt}` },
      ], snapshot as PendingRequestView, owned);
      if (appended === "superseded") return { kind: "superseded" };
      return { kind: "failed", errorClass };
    }
    // —— 提交：planned(v4+generation)——序列+provenance+正文原子入库，slot 同事件清空。
    // 任何异常（CAS 冲突/回执错误注入）先重读查证再决定（不重生成；规格 :39/:40/:55）。
    const plannedPayload = {
      sequence_id: candidate.sequence_id,
      decision_id: candidate.decision_id,
      scope: candidate.scope,
      generation: candidate.generation,
      actions: candidate.actions,
      ...(candidate.explanation_fragments !== undefined ? { explanation_fragments: candidate.explanation_fragments } : {}),
      ...(candidate.existing_fragment_refs !== undefined ? { existing_fragment_refs: candidate.existing_fragment_refs } : {}),
    };
    const plannedEvent: PendingV9Event = {
      event_type: "presentation_sequence_planned",
      payload: plannedPayload,
      occurred_at: nowIso(),
      causation_sequence: deps.causationSequence,
      idempotency_key: `gen:${access.sessionId}:${snapshot.request_id}:planned:${candidate.sequence_id}`,
    };
    let submitFailure: unknown;
    let submitted = false;
    for (let round = 0; round < 2 && !submitted; round += 1) {
      try {
        access.append(access.revision, [plannedEvent],candidate.internalCompanion);
        submitted = true;
      } catch (error) {
        submitFailure = error;
        // refresh 自身抛出（存储不可达）⇒ 上抛原错误（存储不可达暂停，不重调模型）。
        access = deps.refresh?.() ?? access;
        const reread = recordOf(snapshot.request_id);
        if (reread && reread.status === "committed" && reread.sequence_id !== undefined) {
          // 已提交（回执丢失/他人先交同请求）：查证返回既有结果，不重生成。
          return { kind: "committed", sequence: verifiedSequence(reread, candidate) };
        }
        if (!reread || reread.status !== "pending") return { kind: "superseded" };
        if (reread.epoch !== owned.epoch || reread.attempt !== owned.attempt) return { kind: "superseded" };
        // 仍 pending 且 epoch 仍属本 worker：下一轮用持有候选重交（不调模型）。
      }
    }
    if (!submitted) throw submitFailure;
    return { kind: "committed", sequence: withoutCompanion(candidate) };
  }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (leaseRequestId) releaseGenerationLease(access.sessionId, leaseRequestId, owner);
  }
}
