/**
 * GenerationCoordinator（F7 RT4 — 异步生成生命周期引擎；生成生命周期执行规格）。
 *
 * 职责分工（规格 Ownership）：
 * - Orchestrator 依已提交教学决策**预约**生成（reserveGeneration：幂等
 *   source_request_id、CAS 预约事件、冻结上下文 digest）；
 * - 本协调器驱动**事务外**模型调用循环（driveGeneration）：每次调用前原子
 *   登记 attempt 消耗 + 新 epoch（attempt_started）；超时/传输失败/5xx ⇒
 *   waiting_retry + retry_at（同 request、同冻结上下文、新 attempt/epoch）；
 *   预算耗尽 ⇒ failed(RETRY_EXHAUSTED)；schema/binding/权限失败 ⇒ 立即
 *   failed（不重试）；用户取消 ⇒ invalidated（正常控制结果）；
 * - 提交：编译候选经 kernel 单事件事务 planned(v4+generation) 落库——序列、
 *   provenance、板书正文原子提交，slot 同事件清回 idle；CAS/fencing 失败
 *   （迟到 epoch、取消先胜、revision 变化）⇒ 零提交静默退出；
 * - 恢复：committed 请求按幂等身份取回已提交序列（零模型调用）；pending
 *   请求按剩余预算续跑（崩溃后 attempt 消耗已登记，不重置计数）。
 *
 * 模型调用永远在 kernel append 事务之外；lease 不授予提交资格（epoch/CAS
 * 唯一裁决——本版进程内 worker，无外部队列依赖）。
 */
import { createHash } from "node:crypto";

import type { PendingV9Event, V9GenerationEventPayload } from "../../tutorSession/TutorSessionEventV9";
import { TutorSessionEventStoreV9Error } from "../../tutorSession/TutorSessionEventV9";
import type { TutorRuntimeStateV9 } from "../../tutorSession/TutorRuntimeStateReducerV9";
import type { CompiledPresentationPlanV4 } from "./IntentCompiler";
import { PresenterGenerationError } from "./GeneratorPort";

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
  append(expectedRevision: number, events: PendingV9Event[]): { revision: number; appendedSequences: number[] };
}

/** 单次内容管线（RT2 上下文复算 + RT3 提示词/模型/编译/预演；由 Orchestrator 组装）。 */
export interface PresenterAttemptPipeline {
  buildAndRun(request: GenerationRequestView): Promise<{ readonly candidate: CompiledPresentationPlanV4 }>;
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

function isRevisionConflict(error: unknown): boolean {
  return error instanceof TutorSessionEventStoreV9Error && error.code === "REVISION_CONFLICT";
}

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
}

export type DriveOutcome =
  | { readonly kind: "committed"; readonly sequence: CompiledPresentationPlanV4 }
  | { readonly kind: "failed"; readonly errorClass: NonNullable<V9GenerationEventPayload["error_class"]> }
  | { readonly kind: "superseded" };

/**
 * 驱动 pending 请求直至终态（committed/failed/superseded）。
 * 模型调用在 append 事务外；每次调用前原子登记 attempt/epoch；CAS 失败重读
 * 权威状态后按请求终态决定续跑或退出（迟到 worker 零提交）。
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

  type PendingRequestView = GenerationRequestView & { status: string; phase?: string; retry_at?: string; attempt: number; epoch: number };
  const requestOf = (): PendingRequestView | undefined => {
    const slot = access.state.generation_slot;
    if (slot.status !== "pending") return undefined;
    return access.state.generation_requests.find((record) => record.request_id === slot.request_id) as unknown as PendingRequestView;
  };

  const appendCas = (events: PendingV9Event[]): boolean => {
    try {
      access.append(access.revision, events);
      return true;
    } catch (error) {
      if (!isRevisionConflict(error)) throw error;
      access = deps.refresh?.() ?? access;
      return false;
    }
  };

  for (;;) {
    if (deps.signal?.aborted) {
      // 取消信号只中断等待；权威取消由 invalidated 事件落库（调用方）。
      const request = requestOf();
      if (!request || request.status !== "pending") return { kind: "superseded" };
    }
    const request = requestOf();
    if (!request) {
      // slot 非 pending：committed（已有人提交）或 failed/idle（已取消/失败）。
      const last = access.state.generation_requests[access.state.generation_requests.length - 1];
      if (last?.status === "committed") return { kind: "superseded" };
      return { kind: "superseded" };
    }
    if (request.status === "cancelled" || request.status === "committed" || request.status === "failed") {
      return { kind: "superseded" };
    }
    if (request.phase === "waiting_retry" && request.retry_at !== undefined) {
      const waitMs = Math.max(0, Date.parse(request.retry_at) - now().getTime());
      if (waitMs > 0) await sleep(waitMs);
      // 到点后先以新 attempt 登记（attempt+1 / epoch+1——原子消耗预算）。
      const nextAttempt = request.attempt + 1;
      const started: V9GenerationEventPayload = {
        ...(request as unknown as V9GenerationEventPayload),
        attempt: nextAttempt,
        epoch: nextAttempt,
        phase: "running",
      };
      delete started.retry_at;
      if (!appendCas([
        { event_type: "presentation_generation_attempt_started", payload: started, occurred_at: nowIso(), causation_sequence: deps.causationSequence, idempotency_key: `gen:${access.sessionId}:${request.request_id}:attempt:${nextAttempt}` },
      ])) {
        continue;
      }
      continue;
    }
    // running：确认当前 attempt 已登记（requested 事件自带 attempt=1；重读后
    // 恢复的 running 请求也已登记）——直接调用模型（事务外）。
    const snapshot = request as unknown as V9GenerationEventPayload;
    let candidate: CompiledPresentationPlanV4;
    try {
      const result = await pipeline.buildAndRun(snapshot);
      candidate = result.candidate;
    } catch (error) {
      if (error instanceof PresenterGenerationError) {
        const canRetry = error.retryable && snapshot.attempt < snapshot.max_attempts;
        if (canRetry) {
          const delayMs = snapshot.retry_delays_ms[snapshot.attempt - 1] ?? 0;
          const retryPayload: V9GenerationEventPayload = { ...snapshot, phase: "waiting_retry", retry_at: new Date(now().getTime() + delayMs).toISOString() };
          if (!appendCas([
            { event_type: "presentation_generation_retry_scheduled", payload: retryPayload, occurred_at: nowIso(), causation_sequence: deps.causationSequence, idempotency_key: `gen:${access.sessionId}:${snapshot.request_id}:retry:${snapshot.attempt}` },
          ])) {
            continue;
          }
          continue;
        }
        const errorClass = error.retryable && snapshot.attempt >= snapshot.max_attempts ? "RETRY_EXHAUSTED" : error.failureClass;
        const failedPayload: V9GenerationEventPayload = { ...snapshot, status: "failed", error_class: errorClass };
        delete failedPayload.phase;
        delete failedPayload.retry_at;
        if (!appendCas([
          { event_type: "presentation_generation_failed", payload: failedPayload, occurred_at: nowIso(), causation_sequence: deps.causationSequence, idempotency_key: `gen:${access.sessionId}:${snapshot.request_id}:failed:${snapshot.attempt}` },
        ])) {
          continue;
        }
        return { kind: "failed", errorClass };
      }
      throw error;
    }
    // 提交：planned(v4+generation)——序列+provenance+正文原子入库，slot 同事件清空。
    const plannedPayload = {
      sequence_id: candidate.sequence_id,
      decision_id: candidate.decision_id,
      scope: candidate.scope,
      generation: candidate.generation,
      actions: candidate.actions,
      ...(candidate.explanation_fragments !== undefined ? { explanation_fragments: candidate.explanation_fragments } : {}),
      ...(candidate.existing_fragment_refs !== undefined ? { existing_fragment_refs: candidate.existing_fragment_refs } : {}),
    };
    if (!appendCas([
      { event_type: "presentation_sequence_planned", payload: plannedPayload, occurred_at: nowIso(), causation_sequence: deps.causationSequence, idempotency_key: `gen:${access.sessionId}:${snapshot.request_id}:planned:${candidate.sequence_id}` },
    ])) {
      // CAS 失败：重读后由循环顶部的终态判定收口（迟到/被取消零提交）。
      const reread = requestOf();
      if (reread && reread.status === "pending") continue;
      return { kind: "superseded" };
    }
    return { kind: "committed", sequence: candidate };
  }
}
