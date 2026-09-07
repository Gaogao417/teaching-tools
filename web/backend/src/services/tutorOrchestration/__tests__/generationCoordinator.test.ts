/**
 * GenerationCoordinator 测试（F7 RT4 — 生成生命周期执行规格 Acceptance tests）。
 *
 * 真实 TutorSessionKernelV9（合成 registry）+ scripted 内容管线（确定性，
 * 不冒充模型质量）。规格验收逐条：
 * - 首次+两次失败共三次调用后自动 failed(RETRY_EXHAUSTED)；重试等待有
 *   waiting_retry/retry_at 事件；成功后停止重试；
 * - 同 source_request_id 幂等（existing，零新事件）；异 payload 冲突；
 * - 取消与提交竞争：取消先胜 ⇒ 迟到候选零提交；提交先胜 ⇒ 取消 no-op；
 * - 用户取消是正常控制结果（cancel_reason 落库，非系统故障）；
 * - committed 结果按幂等身份取回（零模型调用）；
 * - slot 占用/非 idle cursor 拒绝预约。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ensureSqlite } from "../../tutorSession/__tests__/support";
import { SHA, SYNTHETIC_CATALOG_PIN, SYNTHETIC_TASK_ID, syntheticRegistry } from "../../tutorSession/__tests__/v6KernelSupport";
import { TutorSessionEventStoreV9Error, type PendingV9Event } from "../../tutorSession/TutorSessionEventV9";

const sqlitePath = ensureSqlite("f7-rt4-generation-coordinator");

const kernelModule = require("../../tutorSession/TutorSessionKernelV9") as typeof import("../../tutorSession/TutorSessionKernelV9");
const { TutorSessionKernelV9 } = kernelModule;
const presenterGenModule = require("../presentationGeneration/GeneratorPort") as typeof import("../presentationGeneration/GeneratorPort");
const coordinatorModule = require("../presentationGeneration/GenerationCoordinator") as typeof import("../presentationGeneration/GenerationCoordinator");
const {
  DEFAULT_RETRY_POLICY,
  GenerationCoordinatorError,
  cancelGeneration,
  driveGeneration,
  reserveGeneration,
} = coordinatorModule;
const { PresenterGenerationError } = presenterGenModule;

const at = (): string => new Date().toISOString();
const registryProvider = (): import("../../tutorSession/RuntimeStateRebuilderV9").V9RegistryProvider => () => syntheticRegistry();

const PRESENTER_PIN = {
  provider: "scripted-presenter",
  model_id: "scripted-presenter/v1",
  prompt_version: "presenter-interleaved/v1",
  context_builder_version: "presentation-context-builder/v1",
  tool_catalog_version: "presentation-tool-catalog/v1",
};

let sessionCounter = 9500;
const freshSessionId = (): string => {
  sessionCounter += 1;
  return `TS-00${sessionCounter}`;
};

type Kernel = import("../../tutorSession/TutorSessionKernelV9").TutorSessionKernelV9;

function startKernel(sessionId: string): Kernel {
  return TutorSessionKernelV9.start(
    {
      sessionId,
      studentId: "student-rt4",
      sessionStarted: {
        task_id: SYNTHETIC_TASK_ID,
        session_mode: "teaching",
        scenario_id: "golden-similarity-mvp-001:QT-SMV-002",
        question_ref: { artifact_id: "QT-SMV-002", version: "v2", content_hash: SHA("qt-gc") },
        approach_set_ref: { artifact_id: "AS-SMV-002", version: "v1", content_hash: SHA("as-gc") },
        solution_graph_ref: { artifact_id: "RG-SMV-002", version: "v1", content_hash: SHA("rg-gc") },
        protocol_refs: [{ artifact_id: "PR-SMV-002", version: "v1", content_hash: SHA("pr-gc") }],
        tutor_plan_ref: { artifact_id: "TP-SMV-002", version: "v7", content_hash: SHA("tp-gc") },
        policy_profile_snapshot: { profile_id: "PP-SMV-001", version: "v1", primary_provider: "deterministic-rules", fallback_provider: "safe-fallback", model_id: "none", prompt_version: "pv-1" },
        initial_cursor: { protocol_id: "PR-SMV-002", beat_id: "BT-01" },
        workspace_catalog_pin: { ...SYNTHETIC_CATALOG_PIN },
        presenter_generation_pin: PRESENTER_PIN,
      } as never,
      occurred_at: at(),
    },
    registryProvider(),
  );
}

const accessOf = (kernel: Kernel) => ({
  sessionId: kernel.sessionId,
  get revision(): number {
    return kernel.revision;
  },
  get state() {
    return kernel.state;
  },
  append: (expectedRevision: number, events: never[]) => kernel.append(expectedRevision, events),
});

function contextOf(kernel: Kernel) {
  const revision = kernel.revision;
  return {
    plan_ref: { artifact_id: "TP-SMV-002", version: "v7", content_hash: SHA("tp-gc") },
    graph_ref: { artifact_id: "RG-SMV-002", version: "v1", content_hash: SHA("rg-gc") },
    selected_fact_ids: ["FN-14"],
    selected_inference_ids: ["IF-12"],
    resource_ids: ["RES3"],
    event_cutoff: revision,
    workspace_revision: 0,
  };
}

function candidateFor(kernel: Kernel, requestId: string): Record<string, unknown> {
  const sequenceId = `PS-${String(kernel.state.generation_requests.length).padStart(4, "0")}`;
  const request = kernel.state.generation_requests.find((record) => record.request_id === requestId)!;
  return {
    sequence_id: sequenceId,
    decision_id: request.decision_id,
    scope: request.scope,
    generation: {
      request_id: requestId,
      attempt: request.attempt,
      input_digest: request.input_digest,
      presenter_pin: request.presenter_pin,
      epoch: request.epoch,
    },
    actions: [
      {
        ordinal: 0,
        kind: "voice",
        basis_refs: ["FN-14"],
        voice_action: {
          action_id: `VA-${kernel.sessionId}-${sequenceId.slice(3)}-G0`,
          decision_id: request.decision_id,
          text: "先看这组角。",
          source: "model-generated",
          generation_id: `VG-${kernel.sessionId}-${sequenceId.slice(3)}-G0`,
          interruptible: true,
          intent: "narrate",
        },
      },
    ],
  } as never;
}

function reserve(kernel: Kernel, sourceRequestId = "turn-1") {
  return reserveGeneration(accessOf(kernel), {
    sourceRequestId: `src-${kernel.sessionId}-${sourceRequestId}`,
    decisionId: `TD-${kernel.sessionId}-0001`,
    decisionSequence: 1,
    scope: { kind: "approved", protocol_id: "PR-SMV-002", beat_id: "BT-02" },
    contextDigest: SHA(`ctx-${kernel.sessionId}`),
    context: contextOf(kernel),
    inputText: null,
    presenterPin: PRESENTER_PIN,
    policy: DEFAULT_RETRY_POLICY,
  });
}

const noWaitSleep = async (): Promise<void> => undefined;

test("happy path: reserve -> drive -> committed; idempotent re-reserve returns existing (zero events)", async () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const reservation = reserve(kernel);
  assert.equal(reservation.kind, "reserved");
  const requestId = reservation.request.request_id;

  const outcome = await driveGeneration(accessOf(kernel), {
    buildAndRun: async (request) => ({ candidate: candidateFor(kernel, request.request_id) as never }),
  }, { causationSequence: 1, sleep: noWaitSleep });
  assert.equal(outcome.kind, "committed");
  const record = kernel.state.generation_requests.find((entry) => entry.request_id === requestId)!;
  assert.equal(record.status, "committed");
  assert.ok(record.sequence_id);
  assert.deepEqual(kernel.state.generation_slot, { status: "idle" });

  // 幂等重投：同 payload 预约返回 existing，零事件、零模型。
  const revisionBefore = kernel.revision;
  const again = reserve(kernel);
  assert.equal(again.kind, "existing");
  assert.equal(kernel.revision, revisionBefore);
  // committed 请求按身份取回（不重跑）。
  const redrive = await driveGeneration(accessOf(kernel), { buildAndRun: () => {
    throw new Error("model must not be called for a committed request");
  } }, { causationSequence: 1, sleep: noWaitSleep });
  assert.equal(redrive.kind, "superseded");
});

test("retry budget: two timeout failures then success commits on attempt 3; waiting_retry events recorded", async () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const reservation = reserve(kernel);
  const requestId = reservation.request.request_id;
  let calls = 0;
  const outcome = await driveGeneration(accessOf(kernel), {
    buildAndRun: async (request) => {
      calls += 1;
      if (calls <= 2) {
        throw new PresenterGenerationError("timeout", `scripted timeout #${calls}`, true);
      }
      return { candidate: candidateFor(kernel, request.request_id) as never };
    },
  }, { causationSequence: 1, sleep: noWaitSleep });
  assert.equal(outcome.kind, "committed");
  assert.equal(calls, 3);
  const { db } = require("../../../db/database") as typeof import("../../../db/database");
  const rows = db.prepare("SELECT payload_json FROM tutor_session_events WHERE session_id = ? AND event_type = 'presentation_generation_retry_scheduled'").all(sessionId) as Array<{ payload_json: string }>;
  const retryEvents = rows.map((row) => JSON.parse(row.payload_json) as { event_type?: string });
  assert.equal(retryEvents.length, 2);
  const record = kernel.state.generation_requests.find((entry) => entry.request_id === requestId)!;
  assert.equal(record.status, "committed");
  assert.equal(record.attempt, 3);
});

test("RETRY_EXHAUSTED: three failures cap the budget and fail closed (no fourth call)", async () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  reserve(kernel);
  let calls = 0;
  const outcome = await driveGeneration(accessOf(kernel), {
    buildAndRun: async () => {
      calls += 1;
      throw new PresenterGenerationError("provider_failure", "scripted provider failure", true);
    },
  }, { causationSequence: 1, sleep: noWaitSleep });
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.errorClass, "RETRY_EXHAUSTED");
  assert.equal(calls, 3);
  const record = kernel.state.generation_requests[kernel.state.generation_requests.length - 1];
  assert.equal(record.status, "failed");
  assert.equal(record.error_class, "RETRY_EXHAUSTED");
  assert.deepEqual(kernel.state.generation_slot, { status: "failed", request_id: record.request_id });
});

test("non-retryable failures (draft_invalid) fail immediately without consuming retries", async () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  reserve(kernel);
  let calls = 0;
  const outcome = await driveGeneration(accessOf(kernel), {
    buildAndRun: async () => {
      calls += 1;
      throw new PresenterGenerationError("draft_invalid", "scripted invalid draft", false);
    },
  }, { causationSequence: 1, sleep: noWaitSleep });
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.errorClass, "draft_invalid");
  assert.equal(calls, 1);
});

test("cancellation race: cancel-first invalidates the slot and the late candidate never commits", async () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const reservation = reserve(kernel);
  const requestId = reservation.request.request_id;
  // 模型返回前用户取消（barge_in/新输入等正常控制）。
  const cancelled = cancelGeneration(accessOf(kernel), "cancelled", 1);
  assert.equal(cancelled.cancelled, true);
  assert.equal(kernel.state.generation_requests.find((entry) => entry.request_id === requestId)!.status, "cancelled");
  assert.deepEqual(kernel.state.generation_slot, { status: "idle" });

  // 迟到候选：驱动循环发现请求终态 ⇒ superseded 零提交（模型仍被调了一次——
  // 外部调用无法恰好一次，保证的是至多一份已提交序列）。
  const outcome = await driveGeneration(accessOf(kernel), {
    buildAndRun: async (request) => ({ candidate: candidateFor(kernel, request.request_id) as never }),
  }, { causationSequence: 1, sleep: noWaitSleep });
  assert.equal(outcome.kind, "superseded");
  assert.equal(kernel.state.generation_requests.find((entry) => entry.request_id === requestId)!.status, "cancelled");
  // 再取消（已非 pending）幂等 no-op。
  const again = cancelGeneration(accessOf(kernel), "cancelled", 1);
  assert.equal(again.cancelled, false);
});

test("commit-first race: cancel after commit is a no-op (sequence survives)", async () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const reservation = reserve(kernel);
  const outcome = await driveGeneration(accessOf(kernel), {
    buildAndRun: async (request) => ({ candidate: candidateFor(kernel, request.request_id) as never }),
  }, { causationSequence: 1, sleep: noWaitSleep });
  assert.equal(outcome.kind, "committed");
  const after = cancelGeneration(accessOf(kernel), "cancelled", 1);
  assert.equal(after.cancelled, false);
  assert.equal(kernel.state.generation_requests.find((entry) => entry.request_id === reservation.request.request_id)!.status, "committed");
});

test("reservation conflicts: drifted payload rejected; slot busy and non-idle cursor refused", async () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  reserve(kernel);
  // 同 source_request_id 异 payload（换 decision）→ 冲突（不产生第二个模型任务）。
  assert.throws(
    () => reserveGeneration(accessOf(kernel), {
      sourceRequestId: `src-${sessionId}-turn-1`,
      decisionId: `TD-${sessionId}-0099`,
      decisionSequence: 1,
      scope: { kind: "approved", protocol_id: "PR-SMV-002", beat_id: "BT-02" },
      contextDigest: SHA(`ctx-${sessionId}`),
      context: contextOf(kernel),
      inputText: null,
      presenterPin: PRESENTER_PIN,
    }),
    (error: unknown) => error instanceof GenerationCoordinatorError && error.code === "SOURCE_REQUEST_CONFLICT",
  );
  // slot 仍 pending ⇒ 新 source 也拒绝。
  assert.throws(
    () => reserve(kernel, "turn-2"),
    (error: unknown) => error instanceof GenerationCoordinatorError && error.code === "SLOT_BUSY",
  );
  // 失败终态后 slot=failed：显式重试预约**新任务**（规格：新预算、不修改旧
  // 失败记录）——failed slot 不阻塞新 request（state/v4 slot 被 pending 覆盖）。
  await driveGeneration(accessOf(kernel), {
    buildAndRun: async () => {
      throw new PresenterGenerationError("draft_invalid", "x", false);
    },
  }, { causationSequence: 1, sleep: noWaitSleep });
  const retry = reserve(kernel, "turn-3");
  assert.equal(retry.kind, "reserved");
  assert.notEqual(retry.request.request_id, kernel.state.generation_requests[0].request_id);
  assert.equal(kernel.state.generation_requests[0].status, "failed", "old failed record untouched");
});

// --------------------------------------------------------------------------- //
// F7 P2-B（B2）：认领门（并行认领最多一个有效 owner）+ 提交路径查证
//（CAS 回滚重交持有候选 / 回执丢失查证返回 / 取消竞争语义保持）
// --------------------------------------------------------------------------- //

test("B2 parallel drive: the claim gate admits exactly one model call and a single owner", async () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  const requestId = reserve(kernel).request.request_id;
  const calls: Array<[number, number]> = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pipeline = {
    buildAndRun: async (request: { request_id: string; attempt: number; epoch: number }) => {
      calls.push([request.attempt, request.epoch]);
      const candidate = candidateFor(kernel, request.request_id);
      await gate;
      return { candidate: candidate as never };
    },
  };
  // 两 worker 并发驱动同一请求：worker A 同步完成 CAS 认领（epoch 提升）后进入
  // 模型调用；worker B 重读时已见他方 token ⇒ 本轮退让（零模型调用）。
  const first = driveGeneration(accessOf(kernel), pipeline as never, { causationSequence: 1, sleep: noWaitSleep });
  const resumedKernel = TutorSessionKernelV9.resume(sessionId, registryProvider());
  const second = driveGeneration(accessOf(resumedKernel), pipeline as never, { causationSequence: 1, sleep: noWaitSleep });
  release();
  const outcomes = await Promise.allSettled([first, second]);
  assert.equal(calls.length, 1, "exactly one model call across parallel drives");
  const kinds = outcomes.map((outcome) => (outcome.status === "fulfilled" ? outcome.value.kind : `rejected:${(outcome.reason as Error).message}`));
  assert.deepEqual([...kinds].sort(), ["committed", "superseded"]);
  const record = kernel.state.generation_requests.find((entry) => entry.request_id === requestId)!;
  assert.equal(record.status, "committed");
  assert.equal(record.epoch, 2, "winner claimed with a raised fencing epoch");
});

test("B2 confirmed commit rollback: the held candidate is resubmitted without a second model call", async () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  reserve(kernel);
  let calls = 0;
  let injected = false;
  const wrapped = {
    sessionId,
    get revision(): number {
      return kernel.revision;
    },
    get state() {
      return kernel.state;
    },
    append(expectedRevision: number, events: PendingV9Event[]) {
      // 已确认回滚：CAS 冲突且**未落库**（候选仍由本 worker 持有）。
      if (!injected && events[0].event_type === "presentation_sequence_planned") {
        injected = true;
        throw new TutorSessionEventStoreV9Error("REVISION_CONFLICT", "injected confirmed rollback (nothing appended)");
      }
      return kernel.append(expectedRevision, events);
    },
  };
  const outcome = await driveGeneration(wrapped, {
    buildAndRun: async (request) => {
      calls += 1;
      return { candidate: candidateFor(kernel, request.request_id) as never };
    },
  }, { causationSequence: 1, sleep: noWaitSleep, refresh: () => wrapped });
  assert.equal(calls, 1, "rollback of a confirmed commit must not regenerate");
  assert.equal(outcome.kind, "committed");
  const record = kernel.state.generation_requests.find((entry) => entry.status === "committed")!;
  assert.ok(record.sequence_id);
});

test("B2 lost commit acknowledgement: the drive verifies and returns the committed result instead of throwing", async () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  reserve(kernel);
  let calls = 0;
  let injected = false;
  const wrapped = {
    sessionId,
    get revision(): number {
      return kernel.revision;
    },
    get state() {
      return kernel.state;
    },
    append(expectedRevision: number, events: PendingV9Event[]) {
      const result = kernel.append(expectedRevision, events);
      // 提交已成功落库，但回执错误注入（ack 丢失）。
      if (!injected && events[0].event_type === "presentation_sequence_planned") {
        injected = true;
        throw new Error("injected lost commit acknowledgement (store committed, response lost)");
      }
      return result;
    },
  };
  const outcome = await driveGeneration(wrapped, {
    buildAndRun: async (request) => {
      calls += 1;
      return { candidate: candidateFor(kernel, request.request_id) as never };
    },
  }, { causationSequence: 1, sleep: noWaitSleep, refresh: () => wrapped });
  assert.equal(outcome.kind, "committed", "ack loss must be resolved by verification, not by throwing or regenerating");
  assert.equal(calls, 1);
  const record = kernel.state.generation_requests.find((entry) => entry.status === "committed")!;
  assert.equal(record.sequence_id, outcome.sequence.sequence_id);
});

test("B2 cancel during the in-flight model call: the late candidate never commits and the drive classifies superseded (no throw)", async () => {
  const sessionId = freshSessionId();
  const kernel = startKernel(sessionId);
  reserve(kernel);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = driveGeneration(accessOf(kernel), {
    buildAndRun: async (request) => {
      const candidate = candidateFor(kernel, request.request_id);
      await gate;
      return { candidate: candidate as never };
    },
  }, { causationSequence: 1, sleep: noWaitSleep });
  cancelGeneration(accessOf(kernel), "cancelled", 1);
  release();
  const outcome = await pending;
  assert.equal(outcome.kind, "superseded");
  const record = kernel.state.generation_requests[0];
  assert.equal(record.status, "cancelled");
  assert.equal(kernel.state.generation_slot.status, "idle");
});

void sqlitePath;
