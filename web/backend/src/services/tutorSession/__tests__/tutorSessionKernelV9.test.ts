/**
 * F7 RT4 门禁测试（node 链）：TutorSessionKernelV9 + 生成事件族 reducer。
 *
 * 合成 registry（不依赖真实 plan 导入）；SQLITE_PATH 经 ensureSqlite。覆盖
 * （生成生命周期执行规格 Acceptance tests 的 kernel 侧）：
 * 1. v9 start/resume 往返（presenter pin 必填；event_schema='v9'；state/v4）；
 *    v7 会话行 → SESSION_VERSION_UNSUPPORTED（半升级组合显式拒绝）；
 *    session_started 缺 presenter pin → 初始态 fail closed；
 * 2. 预约→调用→提交：requested(attempt=1/epoch=1) → attempt_started(1/epoch=2) →
 *    planned(v4, generation) ⇒ request committed(sequence_id) + slot 原子回 idle
 *    （同一事件收口）；rebuild 幂等（零模型参与的纯重放）；
 * 3. 超时自动重试：attempt_started(1) → retry_scheduled(1, waiting_retry,
 *    retry_at) → attempt_started(2/epoch=3) → planned(attempt=2) 提交；
 * 4. 预算耗尽：retry 后 attempt_started(2) → failed(RETRY_EXHAUSTED,
 *    attempt=max) ⇒ slot=failed；attempt<max 时 RETRY_EXHAUSTED 被拒；
 * 5. 取消：pending → invalidated(cancel_reason) ⇒ request cancelled + slot idle；
 * 6. CAS/fencing 负例：迟到 epoch/attempt 的 planned 零提交；重复 request_id；
 *    重复 source_request_id；slot pending 期间二次预约；cursor 非 idle 时预约；
 *    slot pending 期间无 generation 的 planned；终态 request 上的迟到事件；
 *    planned 的 pin/digest 漂移（伪造候选）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ensureSqlite } from "./support";
import { SHA, SYNTHETIC_CATALOG_PIN, SYNTHETIC_TASK_ID, syntheticRegistry } from "./v6KernelSupport";

const sqlitePath = ensureSqlite("f7-rt4-kernel-v9");

const { db } = require("../../../db/database") as typeof import("../../../db/database");
const kernelModule = require("../TutorSessionKernelV9") as typeof import("../TutorSessionKernelV9");
const eventModule = require("../TutorSessionEventV9") as typeof import("../TutorSessionEventV9");
const { TutorSessionKernelV9 } = kernelModule;
const { RuntimeStateReducerV9Error, TutorSessionIntegrityV9Error, TutorSessionEventStoreV9Error } = eventModule;
type KernelV9 = import("../TutorSessionKernelV9").TutorSessionKernelV9;

const at = (): string => new Date().toISOString();
const registryProvider = (): import("../RuntimeStateRebuilderV9").V9RegistryProvider => () => syntheticRegistry();

const PRESENTER_PIN = {
  provider: "deepseek-api",
  model_id: "deepseek-v4-flash",
  prompt_version: "presenter-interleaved/v1",
  context_builder_version: "presentation-context-builder/v1",
  tool_catalog_version: "presentation-tool-catalog/v1",
};

function sessionStartedPayloadV9(options?: { presenterPin?: boolean }): Record<string, unknown> {
  return {
    task_id: SYNTHETIC_TASK_ID,
    session_mode: "teaching" as const,
    scenario_id: "golden-similarity-mvp-001:QT-SMV-002",
    question_ref: { artifact_id: "QT-SMV-002", version: "v2", content_hash: SHA("qt-f9") },
    approach_set_ref: { artifact_id: "AS-SMV-002", version: "v1", content_hash: SHA("as-f9") },
    solution_graph_ref: { artifact_id: "RG-SMV-002", version: "v1", content_hash: SHA("rg-f9") },
    protocol_refs: [{ artifact_id: "PR-SMV-002", version: "v1", content_hash: SHA("pr-f9") }],
    tutor_plan_ref: { artifact_id: "TP-SMV-002", version: "v7", content_hash: SHA("tp-f9") },
    policy_profile_snapshot: {
      profile_id: "PP-SMV-001", version: "v1", primary_provider: "deterministic-rules",
      fallback_provider: "safe-fallback", model_id: "none", prompt_version: "pv-1",
    },
    initial_cursor: { protocol_id: "PR-SMV-002", beat_id: "BT-01" },
    workspace_catalog_pin: { ...SYNTHETIC_CATALOG_PIN },
    model_gate_pin: { provider: "p", model_id: "m", prompt_version: "pv", adjudicator_version: "av" },
    ...(options?.presenterPin === false ? {} : { presenter_generation_pin: PRESENTER_PIN }),
  };
}

function startKernel(sessionId: string, options?: { presenterPin?: boolean }): KernelV9 {
  return TutorSessionKernelV9.start(
    { sessionId, studentId: "student-f7rt4", sessionStarted: sessionStartedPayloadV9(options) as never, occurred_at: at() },
    registryProvider(),
  );
}

let sessionCounter = 9100;
function freshSessionId(): string {
  sessionCounter += 1;
  return `TS-00${sessionCounter}`;
}

interface RequestSnapshot {
  request_id: string;
  source_request_id: string;
  decision_id: string;
  scope: { kind: "approved"; protocol_id: string; beat_id: string };
  reservation_revision: number;
  epoch: number;
  attempt: number;
  max_attempts: number;
  retry_policy_version: string;
  timeout_ms: number;
  retry_delays_ms: number[];
  context: {
    plan_ref: { artifact_id: string; version: string; content_hash: string };
    graph_ref: { artifact_id: string; version: string; content_hash: string };
    selected_fact_ids: string[];
    selected_inference_ids: string[];
    resource_ids: string[];
    event_cutoff: number;
    workspace_revision: number;
  };
  input_digest: string;
  presenter_pin: typeof PRESENTER_PIN;
  status: "pending" | "committed" | "failed" | "cancelled";
  phase?: "running" | "waiting_retry";
  retry_at?: string;
  error_class?: string;
  sequence_id?: string;
  cancel_reason?: string;
}

function requestSnapshot(kernel: KernelV9, overrides: Partial<RequestSnapshot> = {}): RequestSnapshot {
  const sessionId = kernel.sessionId;
  const revision = kernel.revision;
  const base: RequestSnapshot = {
    request_id: `GR-${sessionId}-0001`,
    source_request_id: `src-${sessionId}-turn-1`,
    decision_id: `TD-${sessionId}-0001`,
    scope: { kind: "approved", protocol_id: "PR-SMV-002", beat_id: "BT-02" },
    reservation_revision: revision,
    epoch: 1,
    attempt: 1,
    max_attempts: 3,
    retry_policy_version: "retry-policy/v1-default",
    timeout_ms: 30_000,
    retry_delays_ms: [1_000, 3_000],
    context: {
      plan_ref: { artifact_id: "TP-SMV-002", version: "v7", content_hash: SHA("tp-f9") },
      graph_ref: { artifact_id: "RG-SMV-002", version: "v1", content_hash: SHA("rg-f9") },
      selected_fact_ids: ["FN-01"],
      selected_inference_ids: ["IF-01"],
      resource_ids: ["RES1"],
      event_cutoff: revision,
      workspace_revision: 0,
    },
    input_digest: SHA(`input-${sessionId}`),
    presenter_pin: PRESENTER_PIN,
    status: "pending",
    phase: "running",
    ...overrides,
  };
  return base;
}

function plannedPayloadV4(kernel: KernelV9, request: RequestSnapshot, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const sequenceIdFixed = `PS-${String(kernel.state.generation_requests.length + 1).padStart(4, "0")}`;
  return {
    sequence_id: sequenceIdFixed,
    decision_id: request.decision_id,
    scope: request.scope,
    generation: {
      request_id: request.request_id,
      attempt: request.attempt,
      input_digest: request.input_digest,
      presenter_pin: request.presenter_pin,
      epoch: request.epoch,
    },
    actions: [
      {
        ordinal: 0,
        kind: "voice",
        basis_refs: ["FN-01"],
        voice_action: {
          action_id: `VA-${kernel.sessionId}-${sequenceIdFixed.slice(3)}-G0`,
          decision_id: request.decision_id,
          text: "我们先看这两个角。",
          source: "model-generated",
          generation_id: `VG-${kernel.sessionId}-${sequenceIdFixed.slice(3)}-G0`,
          interruptible: true,
          intent: "narrate",
        },
      },
    ],
    ...overrides,
  };
}

function eventSchemaOf(sessionId: string): string | undefined {
  const row = db.prepare("SELECT event_schema FROM tutor_sessions WHERE session_id = ?").get(sessionId) as { event_schema?: string } | undefined;
  return row?.event_schema;
}

function expectReducerFailure(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof RuntimeStateReducerV9Error && error.code === code);
}

test("v9 start/resume roundtrip: presenter pin required, event_schema=v9, state/v4 shape", () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  assert.equal(eventSchemaOf(sessionId), "v9");
  assert.equal(kernel.state.schema, "ai_teaching_tutor_runtime_state/v4");
  assert.deepEqual(kernel.state.generation_slot, { status: "idle" });
  assert.deepEqual(kernel.state.generation_requests, []);
  assert.deepEqual(kernel.state.pinned_plan.presenter_generation_pin, PRESENTER_PIN);

  const resumed = TutorSessionKernelV9.resume(sessionId, registryProvider(), { expectedPresenterPin: PRESENTER_PIN });
  assert.equal(resumed.revision, kernel.revision);
  // 恢复方 presenter pin 漂移 → fail closed（零事件）。
  assert.throws(
    () => TutorSessionKernelV9.resume(sessionId, registryProvider(), {
      expectedPresenterPin: { ...PRESENTER_PIN, model_id: "other-model" },
    }),
    /PRESENTER_PIN_MISMATCH/,
  );

  // session_started 缺 presenter pin → 初始态 fail closed（state/v4 必填）。
  const pinless = freshSessionId();
  assert.throws(
    () => startKernel(pinless, { presenterPin: false }),
    (error: unknown) => error instanceof RuntimeStateReducerV9Error && error.code === "PRESENTER_PIN_MISMATCH",
  );
});

test("v7 session rows are refused by the v9 reader (no half-upgraded online chain)", () => {
  const v7Session = freshSessionId();
  // 直接写一行 v7 会话（不走 v9 kernel start），随后 v9 resume 必须显式拒绝。
  const { TutorSessionKernelV7 } = require("../TutorSessionKernelV7") as typeof import("../TutorSessionKernelV7");
  TutorSessionKernelV7.start(
    {
      sessionId: v7Session,
      studentId: "legacy",
      sessionStarted: {
        task_id: SYNTHETIC_TASK_ID,
        session_mode: "teaching",
        scenario_id: "golden-similarity-mvp-001:QT-SMV-002",
        question_ref: { artifact_id: "QT-SMV-002", version: "v2", content_hash: SHA("qt-f9") },
        approach_set_ref: { artifact_id: "AS-SMV-002", version: "v1", content_hash: SHA("as-f9") },
        solution_graph_ref: { artifact_id: "RG-SMV-002", version: "v1", content_hash: SHA("rg-f9") },
        protocol_refs: [{ artifact_id: "PR-SMV-002", version: "v1", content_hash: SHA("pr-f9") }],
        tutor_plan_ref: { artifact_id: "TP-SMV-002", version: "v7", content_hash: SHA("tp-f9") },
        policy_profile_snapshot: { profile_id: "PP-SMV-001", version: "v1", primary_provider: "deterministic-rules", fallback_provider: "safe-fallback", model_id: "none", prompt_version: "pv-1" },
        initial_cursor: { protocol_id: "PR-SMV-002", beat_id: "BT-01" },
        workspace_catalog_pin: { ...SYNTHETIC_CATALOG_PIN },
      } as never,
      occurred_at: at(),
    },
    () => syntheticRegistry(),
  );
  assert.equal(eventSchemaOf(v7Session), "v7");
  assert.throws(
    () => TutorSessionKernelV9.resume(v7Session, registryProvider()),
    (error: unknown) => error instanceof TutorSessionIntegrityV9Error && error.code === "SESSION_VERSION_UNSUPPORTED",
  );
});

test("reserve -> call -> commit: planned(v4+generation) commits the request and atomically clears the slot", () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const reservation = requestSnapshot(kernel);
  // Reservation is a budget baseline; first worker ownership gets a new epoch.
  const request = { ...reservation, epoch: 2 };
  kernel.append(kernel.revision, [
    {
      event_type: "presentation_generation_requested",
      payload: reservation,
      occurred_at: at(),
      causation_sequence: 1,
      idempotency_key: `gr:${sessionId}:1`,
    },
  ]);
  assert.deepEqual(kernel.state.generation_slot, { status: "pending", request_id: request.request_id });
  assert.equal(kernel.state.generation_requests[0].status, "pending");
  assert.equal(kernel.state.generation_requests[0].phase, "running");

  kernel.append(kernel.revision, [
    {
      event_type: "presentation_generation_attempt_started",
      payload: { ...request, attempt: 1, epoch: 2 },
      occurred_at: at(),
      causation_sequence: 1,
      idempotency_key: `ga:${sessionId}:1:1`,
    },
  ]);

  assert.equal(kernel.state.generation_requests[0].attempt, 1);
  assert.equal(kernel.state.generation_requests[0].epoch, 2);
  const planned = plannedPayloadV4(kernel, request);
  kernel.append(kernel.revision, [
    {
      event_type: "presentation_sequence_planned",
      payload: planned,
      occurred_at: at(),
      causation_sequence: 1,
      idempotency_key: `ps:${sessionId}:${(planned as { sequence_id: string }).sequence_id}`,
    },
  ]);
  const settled = kernel.state.generation_requests[0];
  assert.equal(settled.status, "committed");
  assert.equal(settled.sequence_id, (planned as { sequence_id: string }).sequence_id);
  assert.deepEqual(kernel.state.generation_slot, { status: "idle" });
  assert.ok(settled.phase === undefined && settled.retry_at === undefined);

  // rebuild 幂等：纯重放零模型参与，状态逐字段一致。
  const rebuilt = TutorSessionKernelV9.resume(sessionId, registryProvider());
  assert.deepEqual(rebuilt.state, kernel.state);
  const parity = kernel.assertReplayParity();
  assert.equal(parity.equal, true, JSON.stringify(parity.differences));
});

test("attempt ownership requires a strictly newer epoch; equal/backward claims append nothing", () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const reservation = requestSnapshot(kernel);
  kernel.append(kernel.revision, [
    { event_type: "presentation_generation_requested", payload: reservation, occurred_at: at(), causation_sequence: 1, idempotency_key: `gr:${sessionId}:1` },
  ]);
  function rejectClaim(epoch: number, attempt = 1) {
    const before = structuredClone(kernel.state);
    const revision = kernel.revision;
    expectReducerFailure(() => kernel.append(revision, [
      { event_type: "presentation_generation_attempt_started", payload: { ...reservation, epoch, attempt }, occurred_at: at(), causation_sequence: 1, idempotency_key: `ga-reject:${sessionId}:${revision}:${epoch}` },
    ]), "GENERATION_BUDGET_INVALID");
    assert.equal(kernel.revision, revision);
    assert.deepEqual(kernel.state, before);
    assert.deepEqual(TutorSessionKernelV9.resume(sessionId, registryProvider()).state, before);
  }
  rejectClaim(1); // Even the first claim cannot reuse the reservation epoch.
  kernel.append(kernel.revision, [
    { event_type: "presentation_generation_attempt_started", payload: { ...reservation, epoch: 2 }, occurred_at: at(), causation_sequence: 1, idempotency_key: `ga:${sessionId}:1:2` },
  ]);
  rejectClaim(2); // Same epoch under a different event identity is not another owner.
  rejectClaim(1); // Fencing cannot roll back to the reservation token.
  rejectClaim(3); // New epoch alone cannot buy another call without consuming budget.
  assert.equal(kernel.state.generation_requests[0].attempt, 1);
  assert.equal(kernel.state.generation_requests[0].epoch, 2);
  kernel.append(kernel.revision, [
    { event_type: "presentation_generation_attempt_started", payload: { ...reservation, attempt: 2, epoch: 3 }, occurred_at: at(), causation_sequence: 1, idempotency_key: `ga:${sessionId}:2:3` },
  ]);
  rejectClaim(4, 2); // Takeover at a later attempt must consume its successor too.
  assert.equal(kernel.state.generation_requests[0].attempt, 2);
  assert.equal(kernel.state.generation_requests[0].epoch, 3);
});

test("timeout auto-retry: waiting_retry then attempt 2 commits (same request, new attempt/epoch)", () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const reservation = requestSnapshot(kernel);
  // Reservation is a budget baseline; first worker ownership gets a new epoch.
  const request = { ...reservation, epoch: 2 };
  kernel.append(kernel.revision, [
    { event_type: "presentation_generation_requested", payload: reservation, occurred_at: at(), causation_sequence: 1, idempotency_key: `gr:${sessionId}:1` },
    { event_type: "presentation_generation_attempt_started", payload: { ...request }, occurred_at: at(), causation_sequence: 1, idempotency_key: `ga:${sessionId}:1:1` },
  ]);
  const retryAt = new Date(Date.parse(at()) + 1_000).toISOString();
  kernel.append(kernel.revision, [
    {
      event_type: "presentation_generation_retry_scheduled",
      payload: { ...request, phase: "waiting_retry", retry_at: retryAt },
      occurred_at: at(),
      causation_sequence: 1,
      idempotency_key: `grs:${sessionId}:1`,
    },
  ]);
  assert.equal(kernel.state.generation_requests[0].phase, "waiting_retry");
  assert.equal(kernel.state.generation_requests[0].retry_at, retryAt);

  const attempt2 = { ...request, attempt: 2, epoch: 3 };
  kernel.append(kernel.revision, [
    { event_type: "presentation_generation_attempt_started", payload: attempt2, occurred_at: at(), causation_sequence: 1, idempotency_key: `ga:${sessionId}:1:2` },
  ]);
  assert.equal(kernel.state.generation_requests[0].attempt, 2);
  assert.equal(kernel.state.generation_requests[0].epoch, 3);

  const planned = plannedPayloadV4(kernel, attempt2);
  kernel.append(kernel.revision, [
    { event_type: "presentation_sequence_planned", payload: planned, occurred_at: at(), causation_sequence: 1, idempotency_key: `ps:${sessionId}:${(planned as { sequence_id: string }).sequence_id}` },
  ]);
  assert.equal(kernel.state.generation_requests[0].status, "committed");
  assert.equal(kernel.state.generation_requests[0].attempt, 2);
  assert.deepEqual(kernel.state.generation_slot, { status: "idle" });
});

test("RETRY_EXHAUSTED caps the budget: failure at max attempts only", () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const reservation = requestSnapshot(kernel);
  // Reservation is a budget baseline; first worker ownership gets a new epoch.
  const request = { ...reservation, epoch: 2 };
  kernel.append(kernel.revision, [
    { event_type: "presentation_generation_requested", payload: reservation, occurred_at: at(), causation_sequence: 1, idempotency_key: `gr:${sessionId}:1` },
    { event_type: "presentation_generation_attempt_started", payload: { ...request }, occurred_at: at(), causation_sequence: 1, idempotency_key: `ga:${sessionId}:1:1` },
  ]);
  // attempt 1 失败但预算未耗尽 → RETRY_EXHAUSTED 非法（只能先 retry 或以他类失败）。
  const premature = { ...request, status: "failed" as const, error_class: "RETRY_EXHAUSTED" };
  delete premature.phase;
  // canonical 层即拒绝（attempt<max 不允许 RETRY_EXHAUSTED）；kernel 侧零事件。
  assert.throws(
    () => kernel.append(kernel.revision, [
      { event_type: "presentation_generation_failed", payload: premature, occurred_at: at(), causation_sequence: 1, idempotency_key: `gf:${sessionId}:1:1` },
    ]),
    (error: unknown) => error instanceof TutorSessionEventStoreV9Error || (error instanceof RuntimeStateReducerV9Error && error.code === "GENERATION_BUDGET_INVALID"),
  );
  // 正常重试到 attempt 3（=max）后耗尽。
  kernel.append(kernel.revision, [
    {
      event_type: "presentation_generation_retry_scheduled",
      payload: { ...request, phase: "waiting_retry", retry_at: at() },
      occurred_at: at(), causation_sequence: 1, idempotency_key: `grs:${sessionId}:1`,
    },
    { event_type: "presentation_generation_attempt_started", payload: { ...request, attempt: 2, epoch: 3 }, occurred_at: at(), causation_sequence: 1, idempotency_key: `ga:${sessionId}:1:2` },
    {
      event_type: "presentation_generation_retry_scheduled",
      payload: { ...request, attempt: 2, epoch: 3, phase: "waiting_retry", retry_at: at() },
      occurred_at: at(), causation_sequence: 1, idempotency_key: `grs:${sessionId}:2`,
    },
    { event_type: "presentation_generation_attempt_started", payload: { ...request, attempt: 3, epoch: 4 }, occurred_at: at(), causation_sequence: 1, idempotency_key: `ga:${sessionId}:1:3` },
  ]);
  const exhausted = { ...request, attempt: 3, epoch: 4, status: "failed" as const, error_class: "RETRY_EXHAUSTED" };
  delete exhausted.phase;
  kernel.append(kernel.revision, [
    { event_type: "presentation_generation_failed", payload: exhausted, occurred_at: at(), causation_sequence: 1, idempotency_key: `gf:${sessionId}:1:3` },
  ]);
  assert.equal(kernel.state.generation_requests[0].status, "failed");
  assert.equal(kernel.state.generation_requests[0].error_class, "RETRY_EXHAUSTED");
  assert.deepEqual(kernel.state.generation_slot, { status: "failed", request_id: request.request_id });
});

test("cancellation is a normal control outcome: invalidated clears the slot, late results zero-commit", () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const request = requestSnapshot(kernel);
  kernel.append(kernel.revision, [
    { event_type: "presentation_generation_requested", payload: request, occurred_at: at(), causation_sequence: 1, idempotency_key: `gr:${sessionId}:1` },
  ]);
  const cancelledPayload = { ...request, status: "cancelled" as const, cancel_reason: "cancelled" as const };
  delete cancelledPayload.phase;
  kernel.append(kernel.revision, [
    { event_type: "presentation_generation_invalidated", payload: cancelledPayload, occurred_at: at(), causation_sequence: 1, idempotency_key: `gi:${sessionId}:1` },
  ]);
  assert.equal(kernel.state.generation_requests[0].status, "cancelled");
  assert.equal(kernel.state.generation_requests[0].cancel_reason, "cancelled");
  assert.deepEqual(kernel.state.generation_slot, { status: "idle" });

  // 迟到的 worker 结果（attempt_started / planned）对终态 request 零提交。
  expectReducerFailure(
    () => kernel.append(kernel.revision, [
      { event_type: "presentation_generation_attempt_started", payload: { ...request }, occurred_at: at(), causation_sequence: 1, idempotency_key: `ga-late:${sessionId}:1` },
    ]),
    "GENERATION_REQUEST_STATE_INVALID",
  );
  const planned = plannedPayloadV4(kernel, request);
  expectReducerFailure(
    () => kernel.append(kernel.revision, [
      { event_type: "presentation_sequence_planned", payload: planned, occurred_at: at(), causation_sequence: 1, idempotency_key: `ps-late:${sessionId}` },
    ]),
    "GENERATION_REQUEST_STATE_INVALID",
  );
});

test("fencing: planned candidate with stale attempt/epoch or drifted pin/digest never commits", () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const reservation = requestSnapshot(kernel);
  // Reservation is a budget baseline; first worker ownership gets a new epoch.
  const request = { ...reservation, epoch: 2 };
  kernel.append(kernel.revision, [
    { event_type: "presentation_generation_requested", payload: reservation, occurred_at: at(), causation_sequence: 1, idempotency_key: `gr:${sessionId}:1` },
    { event_type: "presentation_generation_attempt_started", payload: { ...request }, occurred_at: at(), causation_sequence: 1, idempotency_key: `ga:${sessionId}:1:1` },
    {
      event_type: "presentation_generation_retry_scheduled",
      payload: { ...request, phase: "waiting_retry", retry_at: at() },
      occurred_at: at(), causation_sequence: 1, idempotency_key: `grs:${sessionId}:1`,
    },
    { event_type: "presentation_generation_attempt_started", payload: { ...request, attempt: 2, epoch: 3 }, occurred_at: at(), causation_sequence: 1, idempotency_key: `ga:${sessionId}:1:2` },
  ]);
  // 旧 epoch=2 的候选在 epoch=3 后提交 → GENERATION_SLOT_MISMATCH 零提交。
  const stale = plannedPayloadV4(kernel, { ...request, attempt: 1, epoch: 2 });
  expectReducerFailure(
    () => kernel.append(kernel.revision, [
      { event_type: "presentation_sequence_planned", payload: stale, occurred_at: at(), causation_sequence: 1, idempotency_key: `ps-stale:${sessionId}` },
    ]),
    "GENERATION_SLOT_MISMATCH",
  );
  // pin/digest 漂移的伪造候选 → GENERATION_REQUEST_STATE_INVALID。
  const forged = plannedPayloadV4(kernel, { ...request, attempt: 2, epoch: 3, input_digest: SHA("forged") });
  expectReducerFailure(
    () => kernel.append(kernel.revision, [
      { event_type: "presentation_sequence_planned", payload: forged, occurred_at: at(), causation_sequence: 1, idempotency_key: `ps-forged:${sessionId}` },
    ]),
    "GENERATION_REQUEST_STATE_INVALID",
  );
  assert.equal(kernel.state.generation_requests[0].status, "pending");
});

test("slot uniqueness and delivery-overlap negatives fail closed with zero events", () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const first = requestSnapshot(kernel);
  kernel.append(kernel.revision, [
    { event_type: "presentation_generation_requested", payload: first, occurred_at: at(), causation_sequence: 1, idempotency_key: `gr:${sessionId}:1` },
  ]);
  const revisionBefore = kernel.revision;
  // 同 request_id 重复登记。
  expectReducerFailure(
    () => kernel.append(kernel.revision, [
      { event_type: "presentation_generation_requested", payload: first, occurred_at: at(), causation_sequence: 1, idempotency_key: `gr-dup:${sessionId}` },
    ]),
    "GENERATION_REQUEST_DUPLICATE",
  );
  // 同 source_request_id 异 payload 再预约（幂等身份冲突在入口已拒；kernel 侧兜底）。
  const sameSource = requestSnapshot(kernel, { request_id: `GR-${sessionId}-0002`, decision_id: `TD-${sessionId}-0002` });
  expectReducerFailure(
    () => kernel.append(kernel.revision, [
      { event_type: "presentation_generation_requested", payload: sameSource, occurred_at: at(), causation_sequence: 1, idempotency_key: `gr2:${sessionId}` },
    ]),
    "GENERATION_REQUEST_DUPLICATE",
  );
  // 新 source_request_id 但 slot 仍 pending → GENERATION_SLOT_MISMATCH（一会话一活跃 slot）。
  const newSource = requestSnapshot(kernel, {
    request_id: `GR-${sessionId}-0003`,
    source_request_id: `src-${sessionId}-turn-2`,
    decision_id: `TD-${sessionId}-0003`,
  });
  expectReducerFailure(
    () => kernel.append(kernel.revision, [
      { event_type: "presentation_generation_requested", payload: newSource, occurred_at: at(), causation_sequence: 1, idempotency_key: `gr3:${sessionId}` },
    ]),
    "GENERATION_SLOT_MISMATCH",
  );
  // slot pending 期间无 generation 的确定性 planned 混入 → 拒绝（scaffold voice
  // 本可无 provenance，但 slot pending 时不允许旁路序列提交）。
  const withGeneration = plannedPayloadV4(kernel, newSource) as {
    generation?: unknown;
    actions: Array<{ voice_action?: { source?: string; generation_id?: string } }>;
  };
  const deterministicPlanned: Record<string, unknown> = { ...withGeneration };
  delete deterministicPlanned.generation;
  deterministicPlanned.actions = withGeneration.actions.map((action) => ({
    ...action,
    voice_action: action.voice_action
      ? { ...action.voice_action, source: "deterministic-scaffold" }
      : undefined,
  }));
  expectReducerFailure(
    () => kernel.append(kernel.revision, [
      { event_type: "presentation_sequence_planned", payload: deterministicPlanned, occurred_at: at(), causation_sequence: 1, idempotency_key: `ps-det:${sessionId}` },
    ]),
    "GENERATION_SLOT_MISMATCH",
  );
  assert.equal(kernel.revision, revisionBefore, "all rejected batches appended zero events");
});

test("reservation while a presentation cursor is awaiting_browser is refused (pending slot => idle cursor)", () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  // 构造 awaiting_browser cursor：planned（无 generation）+ validated + applied(voice 无 applied) + delivered。
  const sequenceId = "PS-0001";
  kernel.append(kernel.revision, [
    {
      event_type: "presentation_sequence_planned",
      payload: {
        sequence_id: sequenceId,
        decision_id: `TD-${sessionId}-0001`,
        scope: { kind: "approved", protocol_id: "PR-SMV-002", beat_id: "BT-02" },
        actions: [
          {
            ordinal: 0,
            kind: "voice",
            voice_action: {
              action_id: `VA-${sessionId}-0001`,
              decision_id: `TD-${sessionId}-0001`,
              text: "确定性段。",
              source: "deterministic-scaffold",
              interruptible: true,
              intent: "narrate",
            },
          },
        ],
      },
      occurred_at: at(),
      causation_sequence: 1,
      idempotency_key: `ps:${sessionId}:${sequenceId}`,
    },
    {
      event_type: "presentation_action_validated",
      payload: { sequence_id: sequenceId, ordinal: 0, action_id: `VA-${sessionId}-0001`, kind: "voice" },
      occurred_at: at(),
      causation_sequence: kernel.revision + 1,
      idempotency_key: `val:${sessionId}:0`,
    },
    {
      event_type: "presentation_action_delivered",
      payload: { sequence_id: sequenceId, ordinal: 0, action_id: `VA-${sessionId}-0001`, kind: "voice" },
      occurred_at: at(),
      causation_sequence: kernel.revision + 1,
      idempotency_key: `del:${sessionId}:0`,
    },
  ]);
  assert.equal(kernel.state.presentation_cursor.status, "awaiting_browser");
  const request = requestSnapshot(kernel, { reservation_revision: kernel.revision, context: undefined as never });
  request.context = {
    plan_ref: { artifact_id: "TP-SMV-002", version: "v7", content_hash: SHA("tp-f9") },
    graph_ref: { artifact_id: "RG-SMV-002", version: "v1", content_hash: SHA("rg-f9") },
    selected_fact_ids: ["FN-01"],
    selected_inference_ids: ["IF-01"],
    resource_ids: ["RES1"],
    event_cutoff: kernel.revision,
    workspace_revision: 0,
  };
  expectReducerFailure(
    () => kernel.append(kernel.revision, [
      { event_type: "presentation_generation_requested", payload: request, occurred_at: at(), causation_sequence: 1, idempotency_key: `gr:${sessionId}:1` },
    ]),
    "PRESENTATION_CURSOR_MISMATCH",
  );
});

test("canonical envelope: generation events without causation are rejected by the store", () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const request = requestSnapshot(kernel);
  assert.throws(
    () => kernel.append(kernel.revision, [
      { event_type: "presentation_generation_requested", payload: request, occurred_at: at(), idempotency_key: `gr-nocaus:${sessionId}` },
    ]),
    (error: unknown) => error instanceof TutorSessionEventStoreV9Error || error instanceof RuntimeStateReducerV9Error,
  );
});

void sqlitePath;
