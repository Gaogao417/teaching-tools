/**
 * Phase 5 remediation 覆盖补强（七·终轮）：buildRecentFacts 全事件类型摘要、
 * 输入字段全量、completeVoice 附加字段、routes PLAN_NOT_APPROVED/FEATURE_FLAG、
 * 图目录过滤分支（跨 part 资源 / 无 checkpoint repair）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";

import { publishSyntheticPlanVt, tempRoot } from "./vitestSupport";
import { createTutorSessionCoordinator } from "../TutorSession";
import { createTutorPolicyGraph } from "../../tutorIntelligence/policyGraph";
import { FakeStructuredModel } from "../../tutorIntelligence/adapters/fake/FakeStructuredModel";
import { createTutorSessionRoutes } from "../../../transport/http/tutorSessionRoutes";
import { getTutorSession } from "../TutorSessionEventStore";
import type { TutorPlanV2Payload } from "../../planBuild/canonicalInputs";

const root = tempRoot("coverage-terminal");
const plan = publishSyntheticPlanVt(root, { qtId: "QT-SMV-001", tpId: "TP-SMV-001", parts: 0 });

function revisionOf(sessionId: string): number {
  return (getTutorSession(sessionId) as unknown as { revision: number }).revision;
}

describe("buildRecentFacts 全类型摘要（经 intelligent processTurn）", () => {
  const coordinator = createTutorSessionCoordinator({
    canonicalRoot: root,
    intelligence: createTutorPolicyGraph({ model: new FakeStructuredModel() }),
  });

  it("构造含各类事件的流后，recent facts 摘要分支全部命中（不再断言内部值）", async () => {
    const sessionId = "TS-8970";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-001", initialMode: "guided_solve" });
    // 预期推理（progressed+aligned）
    await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-a", {
      input_kind: "reasoning_utterance",
      text: plan.checkpoints[0].expected_reasoning,
    });
    // 提问（question 摘要分支）
    await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-q", {
      input_kind: "question_asked",
      text: "为什么？",
    });
    // 打断（interrupted 摘要）
    await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-i", {
      input_kind: "student_interrupted",
    });
    // 静默（silence 摘要）
    await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-s", {
      input_kind: "silence_observed",
      duration_ms: 5000,
    });
    // 指认（object_id 摘要）
    await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-p", {
      input_kind: "pointing_evidence",
      object_id: "CP2",
    });
    const events = coordinator.getEvents(sessionId);
    expect(events.length).toBeGreaterThan(6);
  });

  it("输入字段全量（text+object_id+duration_ms 同时携带）", async () => {
    const sessionId = "TS-8971";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-001", initialMode: "guided_solve" });
    const response = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-full-fields", {
      input_kind: "pointing_evidence",
      text: "指着这条边",
      object_id: "CP1",
      duration_ms: 1200,
    });
    expect(response.decision).toBeTruthy();
    const input = coordinator
      .getEvents(sessionId)
      .find((event) => (event.payload as { client_turn_id?: string }).client_turn_id === "turn-full-fields");
    expect(input?.payload).toMatchObject({ text: "指着这条边", object_id: "CP1", duration_ms: 1200 });
  });

  it("completeVoice 携带 failure_class/message 字段", async () => {
    const sessionId = "TS-8972";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-001", initialMode: "guided_solve" });
    const opening = await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" });
    const voice = opening.presentation.voice[0];
    coordinator.completeVoice(sessionId, {
      action_id: voice.action_id,
      outcome: "failed",
      failure_class: "tts_unavailable",
      message: "synth 失败",
    });
    const completed = coordinator
      .getEvents(sessionId)
      .find(
        (event) =>
          event.event_type === "voice_action_completed" &&
          (event.payload as { action_id: string }).action_id === voice.action_id,
      );
    expect(completed?.payload).toMatchObject({ outcome: "failed", failure_class: "tts_unavailable", message: "synth 失败" });
  });
});

describe("图目录过滤分支", () => {
  it("跨 part 资源被排除；无 checkpoint 的 repair 资源保留；assistance ledger 缺省", async () => {
    // 定制 plan：加一个外 part 资源 + 一个无 checkpoint 的 repair。
    const customPlan = JSON.parse(JSON.stringify(plan)) as TutorPlanV2Payload;
    customPlan.resources.push(
      { resource_id: "RES90", kind: "hint", checkpoint_id: "CP88", assistance_level: 1, content: "外部 part" } as never,
      { resource_id: "RES91", kind: "repair", content: "整题修复" } as never,
    );
    const state = {
      reasoning: { current_checkpoint_id: "CP1" },
      curriculum: { parts: [] },
      workspace: {},
      assistance: {},
      mode: "guided_solve",
    } as never;
    const seenCatalog: Array<Record<string, unknown>> = [];
    const model = {
      provider: "fake",
      modelId: "fake-catalog",
      complete: async (request: { userPayload: unknown }) => {
        const payload = request.userPayload as { resource_catalog?: Array<Record<string, unknown>> };
        if (payload.resource_catalog) seenCatalog.push(...payload.resource_catalog);
        return {
          value: { move: { move_type: "wait", purpose_code: "wait.silence_first", checkpoint_id: "CP1" }, voice: {} },
          modelId: "fake-catalog",
          promptVersion: "TUTOR_POLICY_VOICE@x",
          latencyMs: 1,
          usage: { inputTokens: 3, outputTokens: 4 },
        };
      },
    };
    const graph = createTutorPolicyGraph({ model: model as never });
    const outcome = await graph.proposeTurn({
      plan: customPlan,
      state,
      input: { input_kind: "silence_observed" },
      facts: [],
      answerValuesByPart: new Map(),
    });
    expect(outcome.ok).toBe(true);
    expect(seenCatalog.some((entry) => entry.resource_id === "RES90")).toBe(false);
    expect(seenCatalog.some((entry) => entry.resource_id === "RES91")).toBe(true);
  });
});

describe("routes PLAN_NOT_APPROVED / FEATURE_FLAG", () => {
  let baseUrl = "";
  let server: import("node:http").Server | undefined;
  let previousFlag: string | undefined;

  beforeEach(async () => {
    previousFlag = process.env.STATEFUL_TUTOR_POLICY_V1;
    // 只发布了 TP-SMV-001 的 root：TP-SMV-002 是白名单成员但缺 plan → 403。
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api/tutor-sessions", createTutorSessionRoutes({ coordinator: createTutorSessionCoordinator({ canonicalRoot: root }) }));
    app.use(((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: error?.message ?? "Invalid request" } });
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
    if (previousFlag === undefined) delete process.env.STATEFUL_TUTOR_POLICY_V1;
    else process.env.STATEFUL_TUTOR_POLICY_V1 = previousFlag;
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("白名单内 plan 未发布 → 403 PLAN_NOT_APPROVED", async () => {
    const response = await fetch(`${baseUrl}/api/tutor-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tpId: "TP-SMV-002", studentId: "s" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PLAN_NOT_APPROVED");
  });

  it("feature flag off → 403 FEATURE_FLAG_OFF；空 correlation header 走 fallback", async () => {
    process.env.STATEFUL_TUTOR_POLICY_V1 = "off";
    const response = await fetch(`${baseUrl}/api/tutor-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-correlation-id": "  " },
      body: JSON.stringify({ tpId: "TP-SMV-001", studentId: "s", sessionId: "TS-8980" }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FEATURE_FLAG_OFF");
  });
});
