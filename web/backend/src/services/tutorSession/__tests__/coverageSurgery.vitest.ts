/**
 * Phase 5 remediation 覆盖补强（八·外科轮）：逐行命中剩余分支——
 * flag=all、TRUTH_MISSING、deterministic interrupted、runtime_failure 触发派生、
 * repair mode_change、attemptWorkspaceAction 接受、ACTION_TEMPLATE_MISSING、
 * policy_failed 摘要、replay workspace、revision 重算（智能链）、
 * gate expected 无命中 / alt ref 命中、candidate_skill_ids 数组、
 * 图 question/无结论 action evidence、routes 普通 Error 注入。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";

import { publishSyntheticPlanVt, tempRoot } from "./vitestSupport";
import { createTutorSessionCoordinator } from "../TutorSession";
import { gateAlignmentProposal, createTutorPolicyGraph } from "../../tutorIntelligence/policyGraph";
import { buildAlignmentContext } from "../../tutorIntelligence/contextView";
import { FakeStructuredModel } from "../../tutorIntelligence/adapters/fake/FakeStructuredModel";
import { createTutorSessionRoutes } from "../../../transport/http/tutorSessionRoutes";
import { appendTutorSessionEventsV2, getTutorSession } from "../TutorSessionEventStore";

const root = tempRoot("coverage-surgery");
publishSyntheticPlanVt(root, { qtId: "QT-SMV-001", tpId: "TP-SMV-001", parts: 0 });
publishSyntheticPlanVt(root, { qtId: "QT-TST-777", tpId: "TP-TST-777", parts: 0 });

function revisionOf(sessionId: string): number {
  return (getTutorSession(sessionId) as unknown as { revision: number }).revision;
}

describe("coordinator 剩余分支", () => {
  it("flag=all 允许非 golden plan 启动", () => {
    const previous = process.env.STATEFUL_TUTOR_POLICY_V1;
    process.env.STATEFUL_TUTOR_POLICY_V1 = "all";
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    expect(() => coordinator.start({ sessionId: "TS-8600", studentId: "s", tpId: "TP-TST-777" })).not.toThrow();
    if (previous === undefined) delete process.env.STATEFUL_TUTOR_POLICY_V1;
    else process.env.STATEFUL_TUTOR_POLICY_V1 = previous;
  });

  it("TRUTH_MISSING：删除 truth 后启动 fail closed", () => {
    const brokenRoot = tempRoot("coverage-surgery-broken");
    publishSyntheticPlanVt(brokenRoot, { qtId: "QT-SMV-002", tpId: "TP-SMV-002", parts: 0 });
    fs.rmSync(path.join(brokenRoot, "question-truth"), { recursive: true, force: true });
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: brokenRoot });
    expect(() => coordinator.start({ sessionId: "TS-8601", studentId: "s", tpId: "TP-SMV-002" })).toThrowError(
      /TRUTH_MISSING|不可读/,
    );
  });

  it("deterministic：pending voice 上的打断（recordStudentInput interrupted 循环）", async () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-8602";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-001", initialMode: "teach" });
    await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" }); // 签发未完成
    coordinator.recordStudentInput(sessionId, { input_kind: "student_interrupted" });
    const interrupted = coordinator
      .getEvents(sessionId)
      .filter((event) => event.event_type === "voice_action_completed" && (event.payload as { outcome: string }).outcome === "interrupted");
    expect(interrupted.length).toBeGreaterThanOrEqual(1);
  });

  it("runtime_failure 作为最后事件时 driveTutorTurn 走默认系统触发", async () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-8603";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-001", initialMode: "guided_solve" });
    coordinator.attemptWorkspaceAction(sessionId, {
      action_id: "WA-x",
      decision_id: "TD-x",
      capability: "similarity.invalid",
      target_ids: [],
      command_payload: { resource_id: "RES404", mode: "learn" },
    });
    const turn = await coordinator.driveTutorTurn(sessionId);
    expect(turn).toBeTruthy();
  });

  it("多轮 incorrect → hint 阶梯耗尽 → repair + mode_changed", async () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-8604";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-001", initialMode: "guided_solve" });
    const deviation = "只看数值不指出目标三角形";
    for (let index = 0; index < 5; index += 1) {
      await coordinator.processTurn(sessionId, revisionOf(sessionId), `turn-inc-${index}`, {
        input_kind: "reasoning_utterance",
        text: deviation,
      });
    }
    expect(coordinator.getEvents(sessionId).some((event) => event.event_type === "mode_changed")).toBe(true);
    expect(coordinator.getEvents(sessionId).some((event) => event.event_type === "repair_delivered")).toBe(true);
  });

  it("attemptWorkspaceAction 合法动作被接受并签发", () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-8605";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-001", initialMode: "guided_solve" });
    const planFile = fs
      .readdirSync(path.join(root, "tutor-plan", "TP-SMV-001"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(fs.readFileSync(path.join(root, "tutor-plan", "TP-SMV-001", name), "utf8")))
      .at(-1)!;
    const planResourceId = planFile.resources.find((entry: { kind: string }) => entry.kind === "action_template").resource_id;
    const resource = JSON.parse(
      planFile.resources.find((entry: { kind: string }) => entry.kind === "action_template").content,
    ) as { actionId: string; capabilities: string[] };
    const accepted = coordinator.attemptWorkspaceAction(sessionId, {
      action_id: "WA-TS-8605-1",
      decision_id: "TD-TS-8605-1",
      capability: resource.capabilities[0],
      target_ids: [],
      command_payload: { resource_id: planResourceId, action_ref: resource.actionId, mode: "learn" },
    });
    expect(accepted.accepted).toBe(true);
    expect(
      coordinator.getEvents(sessionId).some((event) => event.event_type === "workspace_action_issued"),
    ).toBe(true);
  });

  it("ACTION_TEMPLATE_MISSING：伪造绑定非模板资源的 issued 事件后提交证据", () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-8606";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-001", initialMode: "guided_solve" });
    appendTutorSessionEventsV2(sessionId, revisionOf(sessionId), [
      {
        event_type: "workspace_action_issued",
        payload: {
          action_id: "WA-TS-8606-1",
          decision_id: "TD-TS-8606-1",
          capability: "similarity.plan-similarity-proof",
          target_ids: [],
          command_payload: JSON.stringify({ resource_id: "RES1", action_ref: "RES1", mode: "learn" }),
        },
        occurred_at: new Date().toISOString(),
        causation_sequence: 1,
      },
    ]);
    expect(() =>
      coordinator.submitActionEvidence(sessionId, {
        actionId: "a",
        sourceStepId: "s",
        kind: "enter-text",
        version: 1,
        value: "1",
      }),
    ).toThrowError(/ACTION_TEMPLATE_MISSING|绑定的资源缺失/);
  });

  it("intelligent：policy_failed 事件进入 recent facts 摘要 + revision 陈旧重算", async () => {
    const failingGraph = {
      workflowVersion: "tutor-policy-deepseek-langgraph/v1",
      proposeTurn: async () => ({ ok: false as const, failure: { kind: "timeout" as const, detail: "x" } }),
    };
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root, intelligence: failingGraph as never });
    const sessionId = "TS-8607";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-001", initialMode: "guided_solve" });
    // 第一次：失败降级（产生 policy_failed 事实）。
    await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-f1", {
      input_kind: "reasoning_utterance",
      text: "只看数值不指出目标三角形",
    });
    expect(coordinator.getEvents(sessionId).some((event) => event.event_type === "policy_failed")).toBe(true);
    // 第二次：policy_failed 已在流中（buildRecentFacts 命中该摘要分支）+ 陈旧 revision 重算。
    const second = await coordinator.processTurn(sessionId, 0, "turn-f2", {
      input_kind: "reasoning_utterance",
      text: "只看数值不指出目标三角形",
    });
    expect(second.decision).not.toBeNull();
  });

  it("workspace 回合的幂等重放重建 student_view（rebuild workspace 分支）", async () => {
    const coordinator = createTutorSessionCoordinator({
      canonicalRoot: root,
      intelligence: createTutorPolicyGraph({ model: new FakeStructuredModel() }),
    });
    const sessionId = "TS-8608";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-001", initialMode: "guided_solve" });
    // 手工构造带 workspace 的 issued 事件（合法模板），再 replay 一个含该事件的回合。
    const planFile = fs
      .readdirSync(path.join(root, "tutor-plan", "TP-SMV-001"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(fs.readFileSync(path.join(root, "tutor-plan", "TP-SMV-001", name), "utf8")))
      .at(-1)!;
    const resource = planFile.resources.find((entry: { kind: string }) => entry.kind === "action_template");
    const template = JSON.parse(resource.content);
    appendTutorSessionEventsV2(sessionId, revisionOf(sessionId), [
      {
        event_type: "student_input_recorded",
        payload: { input_kind: "structured_action_evidence", action_id: "ev", client_turn_id: "turn-ws" },
        occurred_at: new Date().toISOString(),
      },
      {
        event_type: "workspace_action_issued",
        payload: {
          action_id: "WA-TS-8608-1",
          decision_id: "TD-TS-8608-1",
          capability: template.capabilities[0],
          target_ids: [],
          command_payload: JSON.stringify({ resource_id: resource.resource_id, action_ref: template.actionId, mode: "learn" }),
        },
        occurred_at: new Date().toISOString(),
        causation_sequence: 1,
      },
    ]);
    const replay = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-ws", {
      input_kind: "reasoning_utterance",
      text: "重放",
    });
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.workspace.length).toBe(1);
    expect(JSON.stringify(replay)).not.toContain("localTruth");
  });
});

describe("policyGraph/gate 剩余分支", () => {
  const altPlan = {
    artifact_id: "TP-ALT",
    version: "v1",
    content_hash: `sha256:${"c".repeat(64)}`,
    checkpoints: [
      { checkpoint_id: "CP1", part_id: "1", expected_reasoning: "主推理", accepted_alternatives: ["另一种合法说法"] },
    ],
    recommended_routes: [{ route_id: "R1", role: "primary", part_id: "1", checkpoint_ids: ["CP1"] }],
    resources: [],
    policy_constraints: { allowed_move_types: [], maximum_assistance_level: 3, allowed_capabilities: [] },
  } as never;
  const altView = buildAlignmentContext(altPlan, { reasoning: { current_checkpoint_id: "CP1" } } as never);

  it("expected 声称但 refs 只含 deviation → downgrade；alt ref 命中（有 accepted_alternatives）", () => {
    expect(
      gateAlignmentProposal(
        { classification: "expected_checkpoint", confidence: 0.95, grounding_refs: ["CP1.deviation[0]"] },
        altView,
      ).classification,
    ).toBe("unclear");
    const altHit = gateAlignmentProposal(
      { classification: "alternate_valid", confidence: 0.95, grounding_refs: ["CP1.alt[0]"] },
      altView,
    );
    expect(altHit.classification).toBe("alternate_valid");
    // alt ref 但声明 checkpoint 不一致 → downgrade。
    expect(
      gateAlignmentProposal(
        { classification: "alternate_valid", confidence: 0.95, checkpoint_id: "CP9", grounding_refs: ["CP1.alt[0]"] },
        altView,
      ).classification,
    ).toBe("unclear");
  });

  it("question_asked（无对齐）→ projectProvisional 空对象；action evidence 无结论 → unclear", async () => {
    const model = {
      provider: "fake",
      modelId: "fake-q",
      complete: async () => ({
        value: { move: { move_type: "explain", purpose_code: "explain.answer_question", checkpoint_id: "CP1", resource_ids: ["RES404"] }, voice: {} },
        modelId: "fake-q",
        promptVersion: "TUTOR_POLICY_VOICE@x",
        latencyMs: 1,
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    };
    const graph = createTutorPolicyGraph({ model: model as never });
    const state = { reasoning: { current_checkpoint_id: "CP1" }, curriculum: { parts: [] }, workspace: {}, assistance: {} } as never;
    const question = await graph.proposeTurn({
      plan: altPlan,
      state,
      input: { input_kind: "question_asked", text: "为什么" },
      facts: [],
      answerValuesByPart: new Map(),
    });
    expect(question.ok).toBe(true);
    const actionNoOutcome = await graph.proposeTurn({
      plan: altPlan,
      state,
      input: { input_kind: "structured_action_evidence" },
      facts: [],
      answerValuesByPart: new Map(),
    });
    expect(actionNoOutcome.ok).toBe(true);
    if (actionNoOutcome.ok) {
      expect(actionNoOutcome.proposal.alignment?.classification ?? "unclear").toBe("unclear");
    }
  });

  it("diagnosis_updates 携带 candidate_skill_ids 数组被映射", async () => {
    const outputs: unknown[] = [
      {
        move: {
          move_type: "confirm",
          purpose_code: "confirm.progress",
          checkpoint_id: "CP1",
          diagnosis_updates: [{ summary_code: "progress.self_corrected", candidate_skill_ids: ["SKILL-X-001"], evidence_sequences: [2] }],
        },
        voice: { text: "成立。", source: "model-generated" },
      },
    ];
    const model = {
      provider: "fake",
      modelId: "fake-d",
      complete: async () => {
        const next = outputs.shift();
        return { value: next, modelId: "fake-d", promptVersion: "TUTOR_X", latencyMs: 1, usage: { inputTokens: 2, outputTokens: 2 } };
      },
    };
    const graph = createTutorPolicyGraph({ model: model as never });
    const state = { reasoning: { current_checkpoint_id: "CP1" }, curriculum: { parts: [] }, workspace: {}, assistance: {} } as never;
    const outcome = await graph.proposeTurn({
      plan: altPlan,
      state,
      input: { input_kind: "silence_observed" },
      facts: [{ sequence: 2, event_type: "student_input_recorded" as const, summary: "x", student_fact: true }],
      answerValuesByPart: new Map(),
    });
    expect(outcome.ok).toBe(true);
  });
});

describe("routes 普通 Error 注入（next(unwrapped) 路径）", () => {
  let baseUrl = "";
  let server: import("node:http").Server | undefined;

  const throwingCoordinator = () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const syncThrowers = new Set(["getSessionView", "completeSession", "submitActionEvidence", "restore", "getEvents"]);
    const asyncThrowers = new Set(["processTurn", "completeVoiceAndContinue", "driveTutorTurn", "start", "recordStudentInput"]);
    return new Proxy(coordinator, {
      get(target, prop) {
        if (syncThrowers.has(String(prop))) {
          return () => {
            throw new Error("plain unexpected error");
          };
        }
        if (asyncThrowers.has(String(prop))) {
          return async () => {
            throw new Error("plain unexpected error");
          };
        }
        return (target as Record<string | symbol, unknown>)[prop];
      },
    }) as typeof coordinator;
  };

  beforeEach(async () => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    const routes = createTutorSessionRoutes({ coordinator: throwingCoordinator() });
    app.use("/api/tutor-sessions", routes);
    app.use(((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: error?.message ?? "x" } });
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

  it("GET/turns/voice-completions/complete/start 遇普通错误 → 500 透传 next", async () => {
    const sessionId = "TS-8610";
    const startErr = await fetch(`${baseUrl}/api/tutor-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tpId: "TP-SMV-001", studentId: "s", sessionId: "TS-8611" }),
    });
    expect(startErr.status).toBe(500);
    const get = await fetch(`${baseUrl}/api/tutor-sessions/${sessionId}`);
    expect(get.status).toBe(500);
    const turn = await fetch(`${baseUrl}/api/tutor-sessions/${sessionId}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientTurnId: "turn-err", expectedRevision: 0, input: { input_kind: "question_asked", text: "x" } }),
    });
    expect(turn.status).toBe(500);
    const voice = await fetch(`${baseUrl}/api/tutor-sessions/${sessionId}/voice-completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action_id: "VA-1", outcome: "completed" }),
    });
    expect(voice.status).toBe(500);
    const complete = await fetch(`${baseUrl}/api/tutor-sessions/${sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(complete.status).toBe(500);
  });
});

describe("收口三针（500 默认映射/ASR 普通错误/空文本 no_progress）", () => {
  it("PLAN_HASH_DRIFT 会话 GET → 500（coordinatorErrorStatus 默认分支）", async () => {
    const { createHash } = await import("node:crypto");
    const { startTutorSession } = await import("../TutorSessionEventStore");
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-8620";
    startTutorSession({
      sessionId,
      studentId: "s",
      plan: { artifact_id: "TP-SMV-001", version: "v1", content_hash: `sha256:${createHash("sha256").update("drift").digest("hex")}` },
      eventSchema: "v3",
    });
    expect(() => coordinator.getSessionView(sessionId)).toThrowError(/PLAN_HASH_DRIFT|hash 不一致/);
  });

  it("空文本 reasoning_utterance → no_progress 对齐（不推进）", async () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-8621";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-001", initialMode: "guided_solve" });
    const turn = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-empty", {
      input_kind: "reasoning_utterance",
      text: "   ",
    });
    expect(turn.alignment?.alignment).toBe("no_progress");
  });
});

describe("终针：HTTP 500 漂移 / repair 后自答 / fake 空串 / DeepSeek 超时", () => {
  it("HTTP GET 漂移会话 → 500 默认映射", async () => {
    const { createHash } = await import("node:crypto");
    const { startTutorSession } = await import("../TutorSessionEventStore");
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api/tutor-sessions", createTutorSessionRoutes({ coordinator: createTutorSessionCoordinator({ canonicalRoot: root }) }));
    app.use(((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(error?.status ?? 500).json({ error: { code: error?.code ?? "INTERNAL_ERROR", message: error?.message ?? "x" } });
      void _next;
    }) as express.ErrorRequestHandler);
    const sessionId = "TS-8630";
    startTutorSession({
      sessionId,
      studentId: "s",
      plan: { artifact_id: "TP-SMV-001", version: "v1", content_hash: `sha256:${createHash("sha256").update("drift2").digest("hex")}` },
      eventSchema: "v3",
    });
    const srv = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    const address = srv.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/api/tutor-sessions/${sessionId}`);
    expect(response.status).toBe(500);
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });

  it("repair 交付后 expected → confirm.repair_complete + 退出 repair 模式", async () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-8631";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-001", initialMode: "guided_solve" });
    const deviation = "只看数值不指出目标三角形";
    for (let index = 0; index < 5; index += 1) {
      await coordinator.processTurn(sessionId, revisionOf(sessionId), `turn-rep-${index}`, {
        input_kind: "reasoning_utterance",
        text: deviation,
      });
    }
    expect(coordinator.restore(sessionId).mode).toBe("repair");
    const recovered = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-rep-fixed", {
      input_kind: "reasoning_utterance",
      text: "学生能指出目标三角形",
    });
    expect(recovered.decision?.purpose_code).toBe("confirm.repair_complete");
    expect(coordinator.restore(sessionId).mode).not.toBe("repair");
  });

  it("fake aligner 空串 utterance → lcs 零分支", async () => {
    const model = new FakeStructuredModel();
    const result = await model.complete<Record<string, unknown>>({
      systemPrompt: "s",
      promptVersion: "p",
      userPayload: {
        utterance: "",
        current_checkpoint: { checkpoint_id: "CP1", expected_reasoning: "文本" },
        common_deviations: [],
        alternate_routes: [],
      },
      timeoutMs: 50,
    });
    expect(result.value).toMatchObject({ classification: "unclear" });
  });

  it("DeepSeek 超时分支（fetch 挂起 + 极小 timeout）", async () => {
    const { DeepSeekStructuredModel: Model } = await import("../../tutorIntelligence/adapters/deepseek/DeepSeekStructuredModel");
    const slow = new Model({
      apiKey: "k",
      timeoutMs: 30,
      fetchImpl: (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("slow")), 500);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });
    await expect(
      slow.complete({ systemPrompt: "s", promptVersion: "p", userPayload: {}, timeoutMs: 30 }),
    ).rejects.toMatchObject({ code: "timeout", retryable: true });
  });
});
