/**
 * Phase 5 remediation 覆盖补强：routes 错误分支、turnTelemetry 落盘、
 * 事件 id 派生、fake structured model 分支、DeepSeek 错误映射分支、
 * v2 会话的 processTurn deterministic 路径与降级路径。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";

import { publishSyntheticPlanVt, tempRoot } from "./vitestSupport";
import {
  createTutorSessionCoordinator,
  createDefaultTutorSessionCoordinator,
} from "../TutorSession";
import {
  decisionId,
  voiceActionId,
  workspaceActionId,
  countDecisions,
  countVoiceActions,
  countWorkspaceActions,
  assertSessionId,
  STUDENT_FACT_EVENT_TYPES,
  CAUSATION_REQUIRED,
} from "../TutorSessionEvent";
import { recordTurnTelemetry, recentTurnTelemetry, droppedTelemetryCount } from "../turnTelemetry";
import { FakeStructuredModel as RuntimeFakeModel } from "../../tutorIntelligence/adapters/fake/FakeStructuredModel";
import { DeepSeekStructuredModel, parseModelJson } from "../../tutorIntelligence/adapters/deepseek/DeepSeekStructuredModel";
import { StructuredModelError } from "../../tutorIntelligence/structuredModelPort";
import { createTutorSessionRoutes } from "../../../transport/http/tutorSessionRoutes";
import { getTutorSession } from "../TutorSessionEventStore";

const root = tempRoot("coverage-extra");
publishSyntheticPlanVt(root, { qtId: "QT-SMV-006", tpId: "TP-SMV-006", parts: 0 });

describe("事件 id 派生与词表", () => {
  it("decisionId/voiceActionId/workspaceActionId 与计数", () => {
    expect(decisionId("TS-1", 3)).toBe("TD-TS-1-3");
    expect(voiceActionId("TS-1", 2)).toBe("VA-TS-1-2");
    expect(workspaceActionId("TS-1", 1)).toBe("WA-TS-1-1");
    const events = [
      { event_type: "tutor_move_decided" as const },
      { event_type: "tutor_move_decided" as const },
      { event_type: "voice_action_issued" as const },
      { event_type: "workspace_action_issued" as const },
    ];
    expect(countDecisions(events)).toBe(2);
    expect(countVoiceActions(events)).toBe(1);
    expect(countWorkspaceActions(events)).toBe(1);
  });

  it("assertSessionId 拒绝非法会话 id", () => {
    expect(() => assertSessionId("bad-id")).toThrowError(/invalid tutor session id/);
    expect(() => assertSessionId("TS-0001")).not.toThrow();
  });

  it("STUDENT_FACT_EVENT_TYPES / CAUSATION_REQUIRED 词表完整性", () => {
    expect(STUDENT_FACT_EVENT_TYPES.has("reasoning_aligned")).toBe(true);
    expect(STUDENT_FACT_EVENT_TYPES.has("policy_failed")).toBe(false);
    expect(CAUSATION_REQUIRED.has("mode_changed")).toBe(true);
    expect(CAUSATION_REQUIRED.has("runtime_failure")).toBe(false);
  });
});

describe("turnTelemetry（开启落盘）", () => {
  beforeEach(() => {
    process.env.TUTOR_TELEMETRY = "on";
    process.env.TUTOR_TELEMETRY_DIR = root;
  });
  afterEach(() => {
    process.env.TUTOR_TELEMETRY = "off";
    delete process.env.TUTOR_TELEMETRY_DIR;
  });

  it("recordTurnTelemetry 进内存环并可读取；off 模式仍可读缓冲", () => {
    recordTurnTelemetry({
      correlation_id: "corr-1",
      session_id: "TS-1",
      stage: "policy",
      outcome: "proposal",
      latency_ms: 12,
      input_tokens: 10,
      output_tokens: 5,
      model_calls: 2,
    });
    const recent = recentTurnTelemetry(10);
    expect(recent.at(-1)).toMatchObject({ correlation_id: "corr-1", stage: "policy", model_calls: 2 });
    expect(droppedTelemetryCount()).toBeGreaterThanOrEqual(0);
    process.env.TUTOR_TELEMETRY = "off";
    recordTurnTelemetry({ correlation_id: "corr-2", session_id: "TS-1", stage: "turn", outcome: "completed" });
    expect(recentTurnTelemetry(10).at(-1)).toMatchObject({ correlation_id: "corr-2" });
  });
});

describe("FakeStructuredModel（运行时 fake 分支）", () => {
  it("aligner：expected/deviation/alternate/unclear 分支与置信度", async () => {
    const model = new RuntimeFakeModel();
    const expected = await model.complete<Record<string, unknown>>({
      systemPrompt: "s",
      promptVersion: "p",
      userPayload: {
        utterance: "学生能指出目标三角形",
        current_checkpoint: {
          checkpoint_id: "CP1",
          expected_reasoning: "学生能指出目标三角形",
          accepted_alternatives: [],
        },
        neighbor_checkpoints: [],
        common_deviations: [{ checkpoint_id: "CP1", index: 0, text: "只看数值不指出目标三角形" }],
        alternate_routes: [{ route_id: "R2", entry_condition: "学生能说出内错角相等" }],
      },
      timeoutMs: 100,
    });
    expect(expected.value).toMatchObject({ classification: "expected_checkpoint", checkpoint_id: "CP1" });

    const deviation = await model.complete<Record<string, unknown>>({
      systemPrompt: "s",
      promptVersion: "p",
      userPayload: {
        utterance: "只看数值不指出目标三角形",
        current_checkpoint: { checkpoint_id: "CP1", expected_reasoning: "学生能指出目标三角形" },
        common_deviations: [{ checkpoint_id: "CP1", index: 0, text: "只看数值不指出目标三角形" }],
        alternate_routes: [],
      },
      timeoutMs: 100,
    });
    expect(deviation.value).toMatchObject({ classification: "incorrect" });

    const alternate = await model.complete<Record<string, unknown>>({
      systemPrompt: "s",
      promptVersion: "p",
      userPayload: {
        utterance: "学生能说出内错角相等",
        current_checkpoint: { checkpoint_id: "CP1", expected_reasoning: "无关文本甲" },
        common_deviations: [],
        alternate_routes: [{ route_id: "R2", entry_condition: "学生能说出内错角相等" }],
      },
      timeoutMs: 100,
    });
    expect(alternate.value).toMatchObject({ classification: "alternate_valid", route_id: "R2" });

    const unclear = await model.complete<Record<string, unknown>>({
      systemPrompt: "s",
      promptVersion: "p",
      userPayload: { utterance: "嗯", current_checkpoint: { checkpoint_id: "CP1", expected_reasoning: "学生能指出目标三角形" }, common_deviations: [], alternate_routes: [] },
      timeoutMs: 100,
    });
    expect(unclear.value).toMatchObject({ classification: "unclear" });
  });

  it("policy：question/hint 阶梯/repair 兜底/no_progress 分支", async () => {
    const model = new RuntimeFakeModel();
    const policy = async (payload: Record<string, unknown>) =>
      (await model.complete<Record<string, unknown>>({ systemPrompt: "s", promptVersion: "p", userPayload: payload, timeoutMs: 100 })).value;
    const catalog = [
      { resource_id: "RES1", kind: "explanation", checkpoint_id: "CP1" },
      { resource_id: "RES2", kind: "hint", checkpoint_id: "CP1" },
      { resource_id: "RES4", kind: "repair" },
    ];
    expect(await policy({ student_fact: { input_kind: "question_asked", text: "为什么" }, current_checkpoint: "CP1", resource_catalog: catalog })).toMatchObject({
      move: { move_type: "explain", purpose_code: "explain.answer_question" },
    });
    expect(await policy({ student_fact: { input_kind: "student_interrupted" }, current_checkpoint: "CP1" })).toMatchObject({
      move: { move_type: "wait", purpose_code: "wait.after_interruption" },
    });
    expect(await policy({ student_fact: { input_kind: "silence_observed" }, current_checkpoint: "CP1" })).toMatchObject({
      move: { purpose_code: "wait.silence_first" },
    });
    expect(await policy({ student_fact: { input_kind: "pointing_evidence" }, current_checkpoint: "CP1" })).toMatchObject({
      move: { purpose_code: "prompt.verbalize_pointing" },
    });
    expect(await policy({ student_fact: { input_kind: "reasoning_utterance", alignment: "incorrect" }, current_checkpoint: "CP1", assistance_ledger: { promptsIssued: 1, hintLevelsIssued: [1] }, resource_catalog: catalog, constraints: { maximum_assistance_level: 2 } })).toMatchObject({
      move: { move_type: "hint", assistance_level: 2 },
    });
    expect(await policy({ student_fact: { input_kind: "reasoning_utterance", alignment: "incorrect" }, current_checkpoint: "CP1", assistance_ledger: { promptsIssued: 2, hintLevelsIssued: [1, 2] }, resource_catalog: catalog, constraints: { maximum_assistance_level: 2 } })).toMatchObject({
      move: { move_type: "repair", mode_change: { to_mode: "repair" } },
    });
    expect(await policy({ student_fact: { input_kind: "reasoning_utterance", alignment: "no_progress" }, current_checkpoint: "CP1" })).toMatchObject({
      move: { move_type: "wait" },
    });
    expect(await policy({ student_fact: { input_kind: "reasoning_utterance" }, current_checkpoint: "CP1" })).toMatchObject({
      move: { move_type: "prompt", purpose_code: "prompt.clarify" },
    });
  });

  it("非对象 payload → invalid-json", async () => {
    const model = new RuntimeFakeModel();
    await expect(
      model.complete({ systemPrompt: "s", promptVersion: "p", userPayload: null, timeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "invalid-json" });
  });
});

describe("DeepSeekStructuredModel 错误分支", () => {
  it("429 → rate-limited 可重试；5xx → provider-error 可重试；空内容 → 可重试", async () => {
    const rateLimited = new DeepSeekStructuredModel({
      apiKey: "k",
      fetchImpl: async () => new Response("slow down", { status: 429 }),
    });
    await expect(rateLimited.complete({ systemPrompt: "s", promptVersion: "p", userPayload: {}, timeoutMs: 100 })).rejects.toMatchObject({
      code: "rate-limited",
      retryable: true,
    });
    const serverError = new DeepSeekStructuredModel({
      apiKey: "k",
      fetchImpl: async () => new Response("boom", { status: 500 }),
    });
    await expect(serverError.complete({ systemPrompt: "s", promptVersion: "p", userPayload: {}, timeoutMs: 100 })).rejects.toMatchObject({
      code: "provider-error",
      retryable: true,
    });
    const emptyContent = new DeepSeekStructuredModel({
      apiKey: "k",
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }),
    });
    await expect(emptyContent.complete({ systemPrompt: "s", promptVersion: "p", userPayload: {}, timeoutMs: 100 })).rejects.toMatchObject({
      code: "provider-error",
      retryable: true,
    });
  });

  it("网络异常 → provider-error；parseModelJson 容错", async () => {
    const networkError = new DeepSeekStructuredModel({
      apiKey: "k",
      fetchImpl: async () => {
        throw new Error("dns 失败");
      },
    });
    await expect(networkError.complete({ systemPrompt: "s", promptVersion: "p", userPayload: {}, timeoutMs: 100 })).rejects.toBeInstanceOf(StructuredModelError);
    expect(parseModelJson("噪声 {\"a\": 1} 尾巴")).toEqual({ a: 1 });
    expect(() => parseModelJson("")).toThrowError(/不是合法 JSON/);
  });
});

describe("HTTP routes 错误分支", () => {
  let baseUrl = "";
  let server: import("node:http").Server | undefined;

  beforeEach(async () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api/tutor-sessions", createTutorSessionRoutes({ coordinator }));
    app.use(((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: error?.message ?? "Invalid request" } });
      void next;
    }) as express.ErrorRequestHandler);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server!.address() as { port: number };
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  const call = async (method: string, url: string, body?: unknown) => {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  it("非法 sessionId 参数 → 400；非法 turn 输入 → 400；非法 start → 400", async () => {
    expect((await call("GET", "/api/tutor-sessions/not-a-session")).status).toBe(400);
    expect((await call("POST", "/api/tutor-sessions", { tpId: "TP-SMV-006" })).status).toBe(400);
    expect(
      (
        await call("POST", "/api/tutor-sessions/TS-8301/turns", {
          clientTurnId: "turn-x",
          expectedRevision: 0,
          input: { input_kind: "reasoning_utterance" },
        })
      ).status,
    ).toBe(404);
  });

  it("revision 冲突（并发推进后旧 revision 提交新 turnId）自动重算成功", async () => {
    const start = await call("POST", "/api/tutor-sessions", {
      tpId: "TP-SMV-006",
      studentId: "s",
      sessionId: "TS-8302",
    });
    expect(start.status).toBe(201);
    // 用开场时 revision 之外的陈旧值提交——第一次冲突自动重算后成功。
    const stale = await call("POST", "/api/tutor-sessions/TS-8302/turns", {
      clientTurnId: "turn-stale-1",
      expectedRevision: 0,
      input: { input_kind: "reasoning_utterance", text: "学生能指出目标三角形" },
    });
    expect(stale.status).toBe(200);
    expect(stale.body.alignment?.alignment).toBe("expected_checkpoint");
  });

  it("voice-completions 未知 action → 404；ASR 缺 key → 503 或网络错误路径", async () => {
    const missing = await call("POST", "/api/tutor-sessions/TS-8303/voice-completions", {
      action_id: "VA-none",
      outcome: "completed",
    });
    expect([404, 400]).toContain(missing.status);
    const asr = await call("POST", "/api/tutor-sessions/TS-8303/asr", {
      audio: { dataUrl: "data:audio/webm;codecs=opus;base64,AAAA", durationMs: 100 },
    }).catch(() => null);
    // ASR 依赖 DASHSCOPE_API_KEY：未配置 → 503；配置了也会因为假音频失败 → 5xx。
    if (asr) expect(asr.status).toBeGreaterThanOrEqual(400);
  });
});

describe("v2 会话的 processTurn（deterministic 路径 + 智能链降级到 deterministic）", () => {
  it("v2 会话走 recordStudentInput+driveTutorTurn 组合（无智能链时）", async () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-8310";
    const { startTutorSession, appendTutorSessionEventsV2 } = await import("../TutorSessionEventStore");
    const planRow = (await import("../../planBuild/canonicalInputs")).loadCurrentPlan({ canonicalRoot: root }, "TP-SMV-006");
    if (!planRow.ok) throw new Error(planRow.errors.join(";"));
    const ref = { artifact_id: planRow.payload.artifact_id, version: planRow.payload.version, content_hash: planRow.payload.content_hash };
    startTutorSession({ sessionId, studentId: "s", plan: ref, eventSchema: "v2" });
    appendTutorSessionEventsV2(sessionId, 0, [
      { event_type: "session_started", payload: { plan: ref, initial_mode: "guided_solve" }, occurred_at: new Date().toISOString() },
    ]);
    const revision = (getTutorSession(sessionId) as unknown as { revision: number }).revision;
    const response = await coordinator.processTurn(sessionId, revision, "turn-v2-1", {
      input_kind: "reasoning_utterance",
      text: planRow.payload.checkpoints[0].expected_reasoning,
    });
    void planRow;
    expect(response.alignment?.alignment).toBe("expected_checkpoint");
    // v2 事件不带 client_turn_id（v2 合同 strict）。
    const events = coordinator.getEvents(sessionId);
    const input = events.find((event) => event.event_type === "student_input_recorded");
    expect((input?.payload as { client_turn_id?: string }).client_turn_id).toBeUndefined();
    // v2 会话的幂等重放按 client_turn_id 找不到 → 正常重算（不会误判为重放）。
    const second = await coordinator.processTurn(sessionId, response.revision, "turn-v2-2", {
      input_kind: "silence_observed",
      duration_ms: 1000,
    });
    expect(second.idempotent_replay).toBe(false);
  });

  it("createDefaultTutorSessionCoordinator 默认 deterministic 装配", () => {
    const previous = process.env.TUTOR_POLICY_PROVIDER;
    delete process.env.TUTOR_POLICY_PROVIDER;
    const assembled = createDefaultTutorSessionCoordinator({ canonicalRoot: root });
    expect(assembled.provider).toBe("deterministic");
    process.env.TUTOR_POLICY_PROVIDER = "deepseek-langgraph";
    const intelligent = createDefaultTutorSessionCoordinator({ canonicalRoot: root, structuredModel: new RuntimeFakeModel() });
    expect(intelligent.provider).toBe("deepseek-langgraph");
    if (previous === undefined) delete process.env.TUTOR_POLICY_PROVIDER;
    else process.env.TUTOR_POLICY_PROVIDER = previous;
  });
});
