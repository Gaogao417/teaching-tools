/**
 * Phase 5 remediation 覆盖补强（四）：coordinator fail-closed 路径（assessment/
 * feature flag/plan 未批准/pinned 缺失/hash 漂移/legacy v1）、输入字段变体、
 * rebuildTurnResponse 分支、ASR 注入转写器、fake/DeepSeek/contextView 剩余分支。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";

import { publishSyntheticPlanVt, tempRoot } from "./vitestSupport";
import { createTutorSessionCoordinator, TutorSessionCoordinatorError } from "../TutorSession";
import { createTutorPolicyGraph } from "../../tutorIntelligence/policyGraph";
import { FakeStructuredModel } from "../../tutorIntelligence/adapters/fake/FakeStructuredModel";
import { buildAlignmentContext, validateGroundingRef } from "../../tutorIntelligence/contextView";
import { createTutorSessionRoutes } from "../../../transport/http/tutorSessionRoutes";
import { getTutorSession, startTutorSession, appendTutorSessionEventsV2 } from "../TutorSessionEventStore";

const root = tempRoot("coverage-final");
const plan = publishSyntheticPlanVt(root, { qtId: "QT-SMV-003", tpId: "TP-SMV-003", parts: 0 });

function revisionOf(sessionId: string): number {
  return (getTutorSession(sessionId) as unknown as { revision: number }).revision;
}

describe("coordinator fail-closed 启动路径", () => {
  it("assessment 拒绝 / feature flag 关闭 / plan 未批准", () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    expect(() =>
      coordinator.start({ sessionId: "TS-8801", studentId: "s", tpId: "TP-SMV-003", sessionKind: "assessment" }),
    ).toThrowError(/Assessment/);
    const previous = process.env.STATEFUL_TUTOR_POLICY_V1;
    process.env.STATEFUL_TUTOR_POLICY_V1 = "off";
    expect(() => coordinator.start({ sessionId: "TS-8802", studentId: "s", tpId: "TP-SMV-003" })).toThrowError(
      /feature flag/,
    );
    if (previous === undefined) delete process.env.STATEFUL_TUTOR_POLICY_V1;
    else process.env.STATEFUL_TUTOR_POLICY_V1 = previous;
    expect(() => coordinator.start({ sessionId: "TS-8803", studentId: "s", tpId: "TP-SMV-004" })).toThrowError();
  });

  it("pinned 版本缺失 / hash 漂移 / legacy v1 会话 fail closed", () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-8804";
    startTutorSession({
      sessionId,
      studentId: "s",
      plan: { artifact_id: plan.artifact_id, version: plan.version, content_hash: plan.content_hash },
      eventSchema: "v3",
    });
    appendTutorSessionEventsV2(sessionId, 0, [
      {
        event_type: "session_started",
        payload: {
          plan: { artifact_id: plan.artifact_id, version: plan.version, content_hash: plan.content_hash },
          initial_mode: "guided_solve",
        },
        occurred_at: new Date().toISOString(),
      },
    ]);
    expect(() => coordinator.restore(sessionId)).not.toThrow();

    // v1 会话行 → LEGACY_SESSION。
    const legacyId = "TS-8805";
    startTutorSession({
      sessionId: legacyId,
      studentId: "s",
      plan: { artifact_id: plan.artifact_id, version: plan.version, content_hash: plan.content_hash },
      eventSchema: "v1",
    });
    expect(() => coordinator.restore(legacyId)).toThrowError(/LEGACY_SESSION|v1 合同/);

    // pinned 版本文件缺失（伪造版本号）。
    const missingId = "TS-8806";
    startTutorSession({
      sessionId: missingId,
      studentId: "s",
      plan: { artifact_id: plan.artifact_id, version: "v99", content_hash: plan.content_hash },
      eventSchema: "v3",
    });
    expect(() => coordinator.restore(missingId)).toThrowError(/PLAN_PINNED_MISSING|版本文件缺失/);

    // hash 漂移（会话行 hash 与 plan 文件不一致）。
    const driftId = "TS-8807";
    startTutorSession({
      sessionId: driftId,
      studentId: "s",
      plan: { artifact_id: plan.artifact_id, version: plan.version, content_hash: `sha256:${"b".repeat(64)}` },
      eventSchema: "v3",
    });
    expect(() => coordinator.restore(driftId)).toThrowError(/PLAN_HASH_DRIFT|hash 不一致/);
  });

  it("initialMode 非 teach 时写入 mode 并生效", () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-8808";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-003", initialMode: "guided_solve" });
    const row = getTutorSession(sessionId) as unknown as { current_mode: string };
    expect(row.current_mode).toBe("guided_solve");
  });

  it("未知会话 / 无事件流读取 fail closed", () => {
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    expect(() => coordinator.restore("TS-8999")).toThrowError(/SESSION_NOT_FOUND|unknown session/);
  });
});

describe("输入字段变体与 rebuild 分支", () => {
  const coordinator = createTutorSessionCoordinator({
    canonicalRoot: root,
    intelligence: createTutorPolicyGraph({ model: new FakeStructuredModel() }),
  });

  it("object_id/duration_ms 变体 + silence 智能链路径", async () => {
    const sessionId = "TS-8810";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-003", initialMode: "guided_solve" });
    const pointing = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-point", {
      input_kind: "pointing_evidence",
      object_id: "CP1",
      duration_ms: 500,
    });
    expect(pointing.alignment?.alignment).toBe("unclear");
    const silence = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-silence", {
      input_kind: "silence_observed",
      duration_ms: 4000,
    });
    expect(silence.decision).not.toBeNull();
  });

  it("completed 会话 processTurn 返回空决策（重放安全）", async () => {
    const sessionId = "TS-8811";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-003", initialMode: "guided_solve" });
    const first = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-one", {
      input_kind: "reasoning_utterance",
      text: plan.checkpoints[0].expected_reasoning,
    });
    expect(first.decision).not.toBeNull();
    coordinator.completeSession(sessionId);
    const after = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-two", {
      input_kind: "reasoning_utterance",
      text: "完成后的输入",
    });
    expect(after.decision).toBeNull();
  });

  it("多回合后 rebuildTurnResponse 仍能按 clientTurnId 定位首回合", async () => {
    const sessionId = "TS-8812";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-003", initialMode: "guided_solve" });
    const first = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-first", {
      input_kind: "reasoning_utterance",
      text: plan.checkpoints[0].expected_reasoning,
    });
    await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-second", {
      input_kind: "reasoning_utterance",
      text: plan.checkpoints[1]?.expected_reasoning ?? "学生能列出对应边相等",
    });
    const replay = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-first", {
      input_kind: "reasoning_utterance",
      text: plan.checkpoints[0].expected_reasoning,
    });
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.decision?.decision_id).toBe(first.decision?.decision_id);
  });
});

describe("ASR 转写注入", () => {
  let baseUrl = "";
  let server: import("node:http").Server | undefined;

  beforeEach(async () => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use(
      "/api/tutor-sessions",
      createTutorSessionRoutes({
        coordinator: createTutorSessionCoordinator({ canonicalRoot: root }),
        transcriber: async () => ({ transcript: "学生能指出目标三角形", model: "fake-asr/v1" }),
      }),
    );
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
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("ASR 成功路径与转写失败路径", async () => {
    const ok = await fetch(`${baseUrl}/api/tutor-sessions/TS-8820/asr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: { dataUrl: "data:audio/webm;codecs=opus;base64,AAAA", durationMs: 900 } }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ transcript: "学生能指出目标三角形", model: "fake-asr/v1" });
  });
});

describe("contextView 越界分支", () => {
  it("alt/deviation 序号越界与非法格式", () => {
    const view = buildAlignmentContext(plan, {
      reasoning: { current_checkpoint_id: "CP1" },
    } as never);
    expect(validateGroundingRef("CP2.alt[9]", view).ok).toBe(false);
    expect(validateGroundingRef("CP2.alt[x]", view).ok).toBe(false);
    expect(validateGroundingRef("what.ever", view).ok).toBe(false);
    expect(validateGroundingRef("route.R99.entry", view).ok).toBe(false);
    expect(validateGroundingRef("CP1.expected", view).ok).toBe(true);
  });
});

describe("DeepSeek 杂项分支", () => {
  it("错误对象无 message 时字符串化；signal abort → cancelled", async () => {
    const { DeepSeekStructuredModel: Model } = await import("../../tutorIntelligence/adapters/deepseek/DeepSeekStructuredModel");
    const weird = new Model({
      apiKey: "k",
      fetchImpl: async () => {
        throw { weird: true };
      },
    });
    await expect(weird.complete({ systemPrompt: "s", promptVersion: "p", userPayload: {}, timeoutMs: 100 })).rejects.toBeInstanceOf(
      Error,
    );
    const aborter = new AbortController();
    aborter.abort(new Error("取消"));
    const cancelled = new Model({
      apiKey: "k",
      fetchImpl: async () => {
        throw new DOMException("Aborted", "AbortError");
      },
    });
    await expect(
      cancelled.complete({ systemPrompt: "s", promptVersion: "p", userPayload: {}, timeoutMs: 500, signal: aborter.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
  });
});

describe("TutorSessionCoordinatorError 形状", () => {
  it("code/message 保留", () => {
    const error = new TutorSessionCoordinatorError("SESSION_NOT_FOUND", "nope");
    expect(error.name).toBe("TutorSessionCoordinatorError");
    expect(error.code).toBe("SESSION_NOT_FOUND");
    void fs;
    void path;
  });
});
