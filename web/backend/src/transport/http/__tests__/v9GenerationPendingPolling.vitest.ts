/**
 * F7 P3（A5）— v9 pending 轮询组合层证据：真实 HTTP 路由 + 真实 SQLite + 后台
 * recovery worker（wake 通知即时接管）。故障矩阵对应行：
 * - FM-4-7 刷新×pending：mutation 即时回包 generation=pending；pending 期间 GET
 *   只读（零事件、零模型调用）；worker 推进 committed 后下一次 GET 呈现交付；
 * - FM-4-5 取消×模型迟到：pending 中 control.barge_in ⇒ cancelled；迟到模型
 *   结果经 CAS/取消裁决零提交；
 * - FM-5-2 响应丢失：v9 start 响应丢失后同 client_request_id 同 payload 重投
 *   取回既有会话与同一生成任务（零重复预约/零重复模型任务）；
 * - 生成重试语义：waiting_retry 中途快照含 attempt/max_attempts/retry_at；预算
 *   耗尽 ⇒ failed(RETRY_EXHAUSTED)（后台按冻结预算推进，恰好 3 次模型调用）；
 * - v7 缺省链（无 presenter）回归：start 立即带确定性 pending_presentation，
 *   零 generation 字段/事件，wake 不触发。
 */
import express from "express";
import { expect, it, vi } from "vitest";

import { db } from "../../../db/database";
import { realCanonicalRoot } from "../../../services/tutorNavigator/__tests__/navigatorSupport";
import { TutorRuntimeApplicationV7 } from "../../../services/tutorOrchestration/TutorRuntimeApplicationV7";
import { vNextGateModel } from "../../../services/tutorOrchestration/VNextGateModelFactory";
import { PresenterGenerationError, type PresenterGenerationPin, type PresenterGeneratorPort } from "../../../services/tutorOrchestration/presentationGeneration/GeneratorPort";
import { startGenerationRecoveryWorker, type GenerationRecoveryWorkerHandle } from "../../../services/tutorOrchestration/presentationGeneration/GenerationRecoveryWorker";
import { createVNextTutorRoutes } from "../vnextTutorRoutes";
import { parseSessionSnapshotHttp } from "../../../../../shared/tutorHttpProfile";

const root = realCanonicalRoot();

/** gated/failing scripted Presenter 端口（响应延迟与模型耗时解耦的计时 oracle）。 */
class GatedPresenterPort implements PresenterGeneratorPort {
  readonly provider = "scripted-p3-polling";
  readonly modelId = "scripted-p3-polling/v1";
  readonly pin: PresenterGenerationPin = {
    provider: this.provider,
    model_id: this.modelId,
    prompt_version: "presenter-interleaved/v1",
    context_builder_version: "presentation-context-builder/v1",
    tool_catalog_version: "presentation-tool-catalog/v1",
  };
  calls = 0;
  /** 已完成的模型调用数（gated 未释放 ⇒ 恒 0——响应未 await 模型终态的 oracle）。 */
  completed = 0;
  private gate: Promise<void> | undefined;
  private releaseGate: (() => void) | undefined;
  private failure: (() => never) | undefined;
  /** 下一次模型调用完成后才生效的失败注入（先 gate 后 fail）。 */
  constructor(failure?: () => never) {
    this.failure = failure;
  }
  hold(): void {
    this.gate = new Promise<void>((resolve) => { this.releaseGate = resolve; });
  }
  release(): void {
    this.releaseGate?.();
  }
  async generatePresentationDraft(request: {
    readonly request_id: string;
    readonly userPayload: unknown;
  }): Promise<{ readonly draft: { schema: "ai_teaching_presentation_draft/v2"; request_id: string; items: Array<{ type: "speech"; text: string; basis_refs: string[] }> }; readonly latencyMs: number }> {
    this.calls += 1;
    await this.gate;
    if (this.failure) this.failure();
    const ref = (request.userPayload as { allowed_knowledge?: Array<{ ref: string }> }).allowed_knowledge?.[0]?.ref ?? "FN-01";
    this.completed += 1;
    return {
      draft: {
        schema: "ai_teaching_presentation_draft/v2",
        request_id: request.request_id,
        items: [{ type: "speech", text: `我们把 ${ref} 讲清楚。`, basis_refs: [ref] }],
      },
      latencyMs: 1,
    };
  }
}

const retryableTimeout = (): never => {
  throw new PresenterGenerationError("timeout", "scripted retryable timeout", true);
};

interface TestServer {
  baseUrl: string;
  call(method: string, url: string, body?: unknown): Promise<{ status: number; body: any }>;
  worker: GenerationRecoveryWorkerHandle;
  workerErrors: unknown[];
  stop(): Promise<void>;
}

/** v9 组合层服务：路由注入 presenter + generationWake（= 后台 worker 的 wake）。 */
async function startV9Server(presenter: PresenterGeneratorPort): Promise<TestServer> {
  vi.stubEnv("TUTOR_VNEXT_ROOT", root);
  vi.stubEnv("TUTOR_VNEXT_SCRIPTED_GATE", "1");
  vi.stubEnv("TUTOR_VNEXT_GENERATION", "1");
  const application = TutorRuntimeApplicationV7.create({ canonicalRoot: root, model: vNextGateModel(), presenter });
  const workerErrors: unknown[] = [];
  const worker = startGenerationRecoveryWorker(() => application, (error) => workerErrors.push(error));
  const app = express();
  app.use(express.json({ limit: "14mb" }));
  app.use("/api/vnext", createVNextTutorRoutes({ applicationFactory: () => application, generationWake: worker.wake }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => { server.once("listening", resolve); });
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  return {
    baseUrl,
    call,
    worker,
    workerErrors,
    stop: async () => {
      worker.stop();
      await new Promise<void>((resolve) => { server.close(() => resolve()); });
    },
  };
}

const eventsOf = (id: string): Array<{ sequence: number; event_type: string }> =>
  db.prepare("SELECT sequence, event_type FROM tutor_session_events WHERE session_id = ? ORDER BY sequence").all(id) as Array<{ sequence: number; event_type: string }>;
const countEvents = (id: string, type: string): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id = ? AND event_type = ?").get(id, type) as { n: number }).n;
const generationPayload = (id: string, type: string): Record<string, unknown> | undefined => {
  const row = db.prepare("SELECT payload_json FROM tutor_session_events WHERE session_id = ? AND event_type = ? ORDER BY sequence DESC LIMIT 1").get(id, type) as { payload_json: string } | undefined;
  return row ? (JSON.parse(row.payload_json) as Record<string, unknown>) : undefined;
};

async function pollUntil<T>(probe: () => Promise<T> | T, predicate: (value: T) => boolean, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (predicate(value)) return value;
    if (Date.now() > deadline) throw new Error(`pollUntil(${label}) timed out; last=${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

it("A5/FM-4-7: mutation 预约后立即回包 generation=pending（延迟与模型耗时解耦）；后台 worker 无需客户端动作驱动至 committed", async () => {
  const port = new GatedPresenterPort();
  const server = await startV9Server(port);
  try {
    port.hold();
    const startedAt = Date.now();
    const started = await server.call("POST", "/api/vnext/tutor-sessions", {
      student_id: "p3-poll-s1", task_id: "goldenMinhangFold2020", client_request_id: "p3-poll-start-1",
    });
    const elapsedMs = Date.now() - startedAt;
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    expect(parseSessionSnapshotHttp(started.body).ok).toBe(true);
    // 响应未被 await 至模型终态：gated 模型调用在响应到达时仍未完成——响应延迟
    // 与模型耗时解耦（wake 的后台驱动与响应并行，不在响应路径上；上限取负载
    // 宽容值——旧阻塞式路由在 gate 永不释放时根本不会回包）。
    expect(port.completed).toBe(0);
    expect(elapsedMs).toBeLessThan(5_000);
    // 快照线格式：generation pending（running/attempt 1/3）+ active scope；无交付。
    expect(started.body.generation).toEqual({
      status: "pending", request_id: expect.any(String), phase: "running", attempt: 1, max_attempts: 3,
    });
    expect(started.body.scope).toMatchObject({ kind: "approved" });
    expect(started.body.pending_presentation).toBeUndefined();
    expect(started.body.active_action).toBeUndefined();
    const sessionId = started.body.session_id;

    // wake 接管：预约后零客户端动作，worker 认领并调用模型（仍 gated 在途）。
    await pollUntil(() => countEvents(sessionId, "presentation_generation_attempt_started"), (n) => n >= 1, 5_000, "worker claim");
    expect(port.calls).toBe(1);

    // FM-4-7：pending 期间 GET 只读——零新事件、零模型调用、快照稳定。
    const eventsBefore = eventsOf(sessionId);
    const during = await server.call("GET", `/api/vnext/tutor-sessions/${sessionId}`);
    expect(during.status).toBe(200);
    expect(during.body.generation).toMatchObject({ status: "pending", phase: "running", attempt: 1 });
    expect(eventsOf(sessionId)).toEqual(eventsBefore);
    expect(port.calls).toBe(1);

    // 释放模型 → worker committed → 下一次 GET 呈现交付（cursor 推进）。
    port.release();
    const committed = await pollUntil(
      async () => (await server.call("GET", `/api/vnext/tutor-sessions/${sessionId}`)).body,
      (body) => body.generation?.status === "idle" && body.pending_presentation !== undefined,
      5_000,
      "committed delivery",
    );
    expect(parseSessionSnapshotHttp(committed).ok).toBe(true);
    expect(committed.pending_presentation.sequence_id).toMatch(/^PS-/);
    expect(committed.scope).toBeNull();
    expect(countEvents(sessionId, "presentation_sequence_planned")).toBe(1);
    expect(port.calls).toBe(1);
    expect(server.workerErrors).toEqual([]);
  } finally {
    await server.stop();
    vi.unstubAllEnvs();
  }
}, 20_000);

it("生成重试语义：waiting_retry 中途快照含 attempt/max_attempts/retry_at；预算耗尽 ⇒ failed(RETRY_EXHAUSTED)（恰好 3 次模型调用）", async () => {
  const port = new GatedPresenterPort(retryableTimeout);
  const server = await startV9Server(port);
  try {
    const started = await server.call("POST", "/api/vnext/tutor-sessions", {
      student_id: "p3-retry-s1", task_id: "goldenMinhangFold2020", client_request_id: "p3-retry-start-1",
    });
    expect(started.status).toBe(201);
    const sessionId = started.body.session_id;
    // 第一次超时后进入 waiting_retry（1s 窗口内可观察）：attempt=1、retry_at 已冻结。
    const waiting = await pollUntil(
      async () => (await server.call("GET", `/api/vnext/tutor-sessions/${sessionId}`)).body,
      (body) => body.generation?.status === "pending" && body.generation?.phase === "waiting_retry",
      5_000,
      "waiting_retry snapshot",
    );
    expect(waiting.generation.attempt).toBe(1);
    expect(waiting.generation.max_attempts).toBe(3);
    expect(Number.isNaN(Date.parse(waiting.generation.retry_at))).toBe(false);
    expect(waiting.scope).toMatchObject({ kind: "approved" });
    expect(waiting.pending_presentation).toBeUndefined();
    // 预算耗尽（1s+3s 冻结退避）：failed + 错误类别投影；零部分提交。
    const failed = await pollUntil(
      async () => (await server.call("GET", `/api/vnext/tutor-sessions/${sessionId}`)).body,
      (body) => body.generation?.status === "failed",
      15_000,
      "RETRY_EXHAUSTED",
    );
    expect(failed.generation.error_class).toBe("RETRY_EXHAUSTED");
    expect(failed.generation.attempt).toBe(3);
    expect(failed.generation.max_attempts).toBe(3);
    expect(failed.pending_presentation).toBeUndefined();
    expect(port.calls).toBe(3);
    expect(countEvents(sessionId, "presentation_sequence_planned")).toBe(0);
    // failed 停留：后续 GET 只读不再推进（不无限重试）。
    const again = await server.call("GET", `/api/vnext/tutor-sessions/${sessionId}`);
    expect(again.body.generation).toEqual(failed.generation);
    expect(port.calls).toBe(3);
    expect(server.workerErrors).toEqual([]);
  } finally {
    await server.stop();
    vi.unstubAllEnvs();
  }
}, 30_000);

it("FM-4-5: pending 中用户取消 ⇒ cancelled；迟到模型结果零提交（HTTP+SQLite+worker 组合层）", async () => {
  const port = new GatedPresenterPort();
  const server = await startV9Server(port);
  try {
    port.hold();
    const started = await server.call("POST", "/api/vnext/tutor-sessions", {
      student_id: "p3-cancel-s1", task_id: "goldenMinhangFold2020", client_request_id: "p3-cancel-start-1",
    });
    expect(started.status).toBe(201);
    const sessionId = started.body.session_id;
    // worker 已认领且模型在途（gated）。
    await pollUntil(() => countEvents(sessionId, "presentation_generation_attempt_started"), (n) => n >= 1, 5_000, "worker claim");
    expect(port.calls).toBe(1);
    const current = await server.call("GET", `/api/vnext/tutor-sessions/${sessionId}`);
    expect(current.body.generation.status).toBe("pending");

    // pending 中合法 control 取消：响应即回（generation slot 清空）。
    const cancel = await server.call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
      input: { kind: "control", command: "barge_in" },
      client_request_id: "p3-cancel-1",
      expected_revision: current.body.revision,
    });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(parseSessionSnapshotHttp(cancel.body).ok).toBe(true);
    expect(cancel.body.generation.status).toBe("idle");
    const invalidated = generationPayload(sessionId, "presentation_generation_invalidated");
    expect(invalidated?.status).toBe("cancelled");
    expect(invalidated?.cancel_reason).toBe("cancelled");

    // 迟到模型结果：释放 gate → worker 提交路径被 CAS/取消裁决（superseded 零提交）。
    port.release();
    await pollUntil(
      () => db.prepare("SELECT expires_ms FROM tutor_generation_leases WHERE session_id = ?").get(sessionId) as { expires_ms: number } | undefined,
      (row) => row !== undefined && row.expires_ms === 0,
      5_000,
      "late owner fenced",
    );
    expect(countEvents(sessionId, "presentation_sequence_planned")).toBe(0);
    expect(port.calls).toBe(1);
    expect(server.workerErrors).toEqual([]);
    // 取消后快照稳定：slot idle、无第二条可交付旧序列。
    const after = await server.call("GET", `/api/vnext/tutor-sessions/${sessionId}`);
    expect(after.body.generation.status).toBe("idle");
    expect(after.body.pending_presentation).toBeUndefined();
  } finally {
    await server.stop();
    vi.unstubAllEnvs();
  }
}, 20_000);

it("FM-5-2: v9 start 响应丢失 ⇒ 同 client_request_id 同 payload 重投取回既有会话与同一生成任务（零重复预约）", async () => {
  const port = new GatedPresenterPort();
  const server = await startV9Server(port);
  try {
    const payload = { student_id: "p3-lost-s1", task_id: "goldenMinhangFold2020", client_request_id: "p3-lost-start-1" };
    const nativeFetch = globalThis.fetch;
    let lostBody: any;
    const lost = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (...args: Parameters<typeof fetch>) => {
      const response = await nativeFetch(...args);
      expect(response.ok).toBe(true);
      lostBody = await response.json();
      throw new TypeError("simulated response lost after start commit");
    });
    try {
      await fetch(`${server.baseUrl}/api/vnext/tutor-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      throw new Error("the lost start must reject");
    } catch (error) {
      expect((error as Error).message).toBe("simulated response lost after start commit");
    } finally {
      lost.mockRestore();
    }
    // 同键同 payload 重投：existing 回放（200）——不是第二个会话。
    const retry = await server.call("POST", "/api/vnext/tutor-sessions", payload);
    expect(retry.status).toBe(200);
    expect(retry.body.session_id).toBe(lostBody.session_id);
    // worker 驱动至 committed 后核对：同一 request 恰一次预约、恰一次模型调用、恰一次 planned。
    const sessionId = lostBody.session_id;
    const committed = await pollUntil(
      async () => (await server.call("GET", `/api/vnext/tutor-sessions/${sessionId}`)).body,
      (body) => body.generation?.status === "idle" && body.pending_presentation !== undefined,
      5_000,
      "lost-response replay committed",
    );
    expect(committed.pending_presentation.sequence_id).toMatch(/^PS-/);
    expect(countEvents(sessionId, "presentation_generation_requested")).toBe(1);
    expect(countEvents(sessionId, "presentation_sequence_planned")).toBe(1);
    expect(port.calls).toBe(1);
    expect(server.workerErrors).toEqual([]);
  } finally {
    await server.stop();
    vi.unstubAllEnvs();
  }
}, 20_000);

it("v7 缺省链回归：无 presenter 的 start 立即带确定性 pending_presentation，零 generation 字段/事件（wake 零触发）", async () => {
  vi.stubEnv("TUTOR_VNEXT_ROOT", root);
  vi.stubEnv("TUTOR_VNEXT_SCRIPTED_GATE", "1");
  vi.stubEnv("TUTOR_VNEXT_GENERATION", "0");
  let wakeCalls = 0;
  const application = TutorRuntimeApplicationV7.create({ canonicalRoot: root, model: vNextGateModel() });
  const app = express();
  app.use(express.json({ limit: "14mb" }));
  app.use("/api/vnext", createVNextTutorRoutes({
    applicationFactory: () => application,
    generationWake: () => { wakeCalls += 1; },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => { server.once("listening", resolve); });
  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/api/vnext/tutor-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: "p3-v7-s1", task_id: "goldenMinhangFold2020", client_request_id: "p3-v7-start-1" }),
    });
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(parseSessionSnapshotHttp(body).ok).toBe(true);
    // v7 线格式零 generation/scope；确定性链照常同步交付队首。
    expect(body.generation).toBeUndefined();
    expect(body.scope).toBeUndefined();
    expect(body.pending_presentation?.sequence_id).toMatch(/^PS-/);
    const sessionId = body.session_id;
    expect(countEvents(sessionId, "presentation_generation_requested")).toBe(0);
    expect(wakeCalls).toBe(0);
  } finally {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
    vi.unstubAllEnvs();
  }
}, 20_000);
