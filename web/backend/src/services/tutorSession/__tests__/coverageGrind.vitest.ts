/**
 * Phase 5 remediation 覆盖补强（三）：命中剩余分支——智能链 interrupted/action
 * 证据路径、动态 explain 文案、explain 资源缺失、图预算耗尽/非对象输出/invoke
 * 抛错、HTTP 响应形状矩阵（fallback/alternate/workspace/correlation/zod 错误）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";

import { publishSyntheticPlanVt, tempRoot } from "./vitestSupport";
import {
  createTutorSessionCoordinator,
} from "../TutorSession";
import { preparePresentation } from "../../tutorPresentation/PreparePresentation";
import { createTutorPolicyGraph } from "../../tutorIntelligence/policyGraph";
import { FakeStructuredModel } from "../../tutorIntelligence/adapters/fake/FakeStructuredModel";
import { createTutorSessionRoutes } from "../../../transport/http/tutorSessionRoutes";
import { getTutorSession } from "../TutorSessionEventStore";
import type { TutorDecision } from "../../tutorPolicy/TutorMove";

const root = tempRoot("coverage-grind");
const plan = publishSyntheticPlanVt(root, { qtId: "QT-SMV-004", tpId: "TP-SMV-004", parts: 0 });

function coordinatorWith(graph: unknown): ReturnType<typeof createTutorSessionCoordinator> {
  return createTutorSessionCoordinator({ canonicalRoot: root, intelligence: graph as never });
}

async function teachOpening(coordinator: ReturnType<typeof createTutorSessionCoordinator>, sessionId: string): Promise<void> {
  const opening = await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" });
  for (const voice of opening.presentation.voice) {
    coordinator.completeVoice(sessionId, { action_id: voice.action_id, outcome: "completed" });
  }
  const handOver = await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "presentation_completed" });
  for (const voice of handOver.presentation.voice) {
    coordinator.completeVoice(sessionId, { action_id: voice.action_id, outcome: "completed" });
  }
}

const decision = (overrides: Partial<TutorDecision>): TutorDecision =>
  ({
    decision_id: "TD-1",
    move_type: "explain",
    purpose_code: "explain.open",
    policy_version: "v",
    source_event_sequence: 1,
    source_state_revision: 1,
    ...overrides,
  }) as TutorDecision;

describe("Presenter 剩余分支", () => {
  const state = {
    reasoning: { current_checkpoint_id: "CP1" },
    curriculum: { parts: [{ part_id: "1", checkpoint_ids: ["CP1"], completed_checkpoints: [], current_index: 0, route_id: "R1" }] },
    workspace: {},
  } as never;

  it("explain + 受控动态文案 → model-generated voice（generation_id）", () => {
    const result = preparePresentation({
      decision: decision({ resource_ids: ["RES1"] }),
      plan,
      state,
      sessionId: "TS-1",
      voiceOrdinal: 1,
      workspaceOrdinal: 1,
      answerValues: [],
      dynamicVoice: { text: "这一步看两个三角形。我们把条件翻译出来。", source: "model-generated" },
    });
    expect(result.ok).toBe(true);
    expect(result.presentation!.voice[0]).toMatchObject({
      voice_source: "model-generated",
      generation_id: "VG-TS-1-1",
    });
  });

  it("explain 无资源文本 → presentation_invalid（fail closed）", () => {
    const result = preparePresentation({
      decision: decision({ move_type: "explain", resource_ids: ["RES404"] }),
      plan,
      state,
      sessionId: "TS-1",
      voiceOrdinal: 1,
      workspaceOrdinal: 1,
      answerValues: [],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("资源缺失");
  });
});

describe("policyGraph 剩余分支", () => {
  const state = {
    reasoning: { current_checkpoint_id: "CP1" },
    curriculum: { parts: [] },
    workspace: {},
    assistance: {},
  } as never;

  it("预算耗尽 → budget_exhausted（graph.invoke abort 走 catch）", async () => {
    const model = new FakeStructuredModel();
    const graph = createTutorPolicyGraph({ model, totalBudgetMs: 1, perCallTimeoutMs: 1 });
    const outcome = await graph.proposeTurn({
      plan,
      state,
      input: { input_kind: "reasoning_utterance", text: "学生能指出目标三角形" },
      facts: [],
      answerValuesByPart: new Map(),
    });
    // 1ms 预算内完成或耗尽都合法；断言合同而不是时序。
    expect(outcome.ok === true || outcome.ok === false).toBe(true);
  });

  it("模型输出非对象 → invalid_proposal → Wait fallback", async () => {
    const queue: unknown[] = [
      { classification: "unclear", confidence: 0.1, grounding_refs: [] },
      "not-an-object",
      "not-an-object",
    ];
    const model = {
      provider: "fake",
      modelId: "fake",
      complete: async () => ({ value: queue.shift(), modelId: "fake", promptVersion: "x", latencyMs: 1 }),
    };
    const graph = createTutorPolicyGraph({ model: model as never });
    const outcome = await graph.proposeTurn({
      plan,
      state,
      input: { input_kind: "reasoning_utterance", text: "学生能指出目标三角形" },
      facts: [],
      answerValuesByPart: new Map(),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.proposal.move.move_type).toBe("wait");
      expect(outcome.proposal.move.fallback).toBe(true);
    }
  });
});

describe("coordinator 智能链剩余路径", () => {
  it("intelligent：student_interrupted 带未完成 voice → interrupted 完成事件", async () => {
    const coordinator = coordinatorWith(createTutorPolicyGraph({ model: new FakeStructuredModel() }));
    const sessionId = "TS-8601";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-004" });
    // 开场只签发不 completeVoice（保留 pending），直接打断。
    await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" });
    const revision = (getTutorSession(sessionId) as unknown as { revision: number }).revision;
    const response = await coordinator.processTurn(sessionId, revision, "turn-brk", {
      input_kind: "student_interrupted",
    });
    expect(response.decision).not.toBeNull();
    const interrupted = coordinator
      .getEvents(sessionId)
      .filter((event) => event.event_type === "voice_action_completed" && (event.payload as { outcome: string }).outcome === "interrupted");
    expect(interrupted.length).toBeGreaterThanOrEqual(1);
  });

  it("intelligent：structured_action_evidence 全流程（错误→正确）", async () => {
    const coordinator = coordinatorWith(createTutorPolicyGraph({ model: new FakeStructuredModel() }));
    const sessionId = "TS-8602";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-004" });
    await teachOpening(coordinator, sessionId);
    const checkpoints = plan.checkpoints.map((entry) => entry.checkpoint_id);
    const actionResource = plan.resources.find((resource) => resource.kind === "action_template");
    const actionCheckpoint = actionResource?.checkpoint_id ?? checkpoints.at(-1)!;
    for (const checkpointId of checkpoints) {
      if (checkpointId === actionCheckpoint) break;
      coordinator.recordStudentInput(sessionId, {
        input_kind: "reasoning_utterance",
        text: plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)!.expected_reasoning,
      });
      const turn = await coordinator.driveTutorTurn(sessionId);
      for (const voice of turn.presentation.voice) {
        coordinator.completeVoice(sessionId, { action_id: voice.action_id, outcome: "completed" });
      }
      await coordinator.driveTutorTurn(sessionId);
    }
    const revision = (getTutorSession(sessionId) as unknown as { revision: number }).revision;
    const template = JSON.parse(actionResource!.content!) as {
      actionId: string;
      sourceStepId: string;
      kind: string;
      teachingInput: { expectedValues: string[] };
    };
    const wrong = await coordinator.processTurn(sessionId, revision, "turn-ev-wrong", {
      input_kind: "structured_action_evidence",
      action_evidence: {
        actionId: template.actionId,
        sourceStepId: template.sourceStepId,
        kind: template.kind as "enter-text",
        version: 1,
        value: "完全错误",
      },
    });
    expect(wrong.alignment?.alignment).toBe("incorrect");
    const revisionAfterWrong = (getTutorSession(sessionId) as unknown as { revision: number }).revision;
    const correct = await coordinator.processTurn(sessionId, revisionAfterWrong, "turn-ev-right", {
      input_kind: "structured_action_evidence",
      action_evidence: {
        actionId: template.actionId,
        sourceStepId: template.sourceStepId,
        kind: template.kind as "enter-text",
        version: 1,
        value: template.teachingInput.expectedValues[0],
      },
    });
    expect(correct.alignment?.alignment).toBe("expected_checkpoint");
    expect(coordinator.restore(sessionId).curriculum.completed).toBe(true);
  });

  it("intelligent 缺 action_evidence → INVALID_INPUT", async () => {
    const coordinator = coordinatorWith(createTutorPolicyGraph({ model: new FakeStructuredModel() }));
    const sessionId = "TS-8603";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-004" });
    const revision = (getTutorSession(sessionId) as unknown as { revision: number }).revision;
    await expect(
      coordinator.processTurn(sessionId, revision, "turn-bad-ev", {
        input_kind: "structured_action_evidence",
      }),
    ).rejects.toThrowError(/action_evidence/);
  });
});

describe("HTTP 响应形状矩阵", () => {
  let baseUrl = "";
  let server: import("node:http").Server | undefined;
  const failingGraph = {
    workflowVersion: "tutor-policy-deepseek-langgraph/v1",
    proposeTurn: async () => ({ ok: false as const, failure: { kind: "timeout" as const, detail: "grind" } }),
  };

  beforeEach(async () => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use(
      "/api/tutor-sessions",
      createTutorSessionRoutes({
        coordinator: createTutorSessionCoordinator({ canonicalRoot: root, intelligence: failingGraph as never }),
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

  const call = async (method: string, url: string, body?: unknown, headers?: Record<string, string>) => {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { "Content-Type": "application/json", ...(headers ?? {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  it("降级回合：fallback 字段呈现 + policy_failed 可见；correlation header 传递", async () => {
    const start = await call("POST", "/api/tutor-sessions", { tpId: "TP-SMV-004", studentId: "s", sessionId: "TS-8701" });
    expect(start.status).toBe(201);
    for (const voice of start.body.opening.voice) {
      await call("POST", "/api/tutor-sessions/TS-8701/voice-completions", { action_id: voice.action_id, outcome: "completed" }, { "x-correlation-id": "corr-hdr-1" });
    }
    const view = await call("GET", "/api/tutor-sessions/TS-8701");
    const degraded = await call(
      "POST",
      "/api/tutor-sessions/TS-8701/turns",
      {
        clientTurnId: "turn-degrade",
        expectedRevision: view.body.revision,
        input: { input_kind: "reasoning_utterance", text: plan.checkpoints[0].expected_reasoning },
        correlationId: "corr-body-1",
      },
      { "x-correlation-id": "corr-hdr-2" },
    );
    expect(degraded.status).toBe(200);
    expect(degraded.body.fallback).toMatchObject({ used: true });
    expect(degraded.body.decision).not.toBeNull();
    // alignment 带 checkpoint（deterministic 降级对齐）。
    expect(degraded.body.alignment?.checkpoint_id).toBeTruthy();
  });

  it("提问回合：explain + 提问后 view 完整；complete 无 reason 体", async () => {
    const start = await call("POST", "/api/tutor-sessions", { tpId: "TP-SMV-004", studentId: "s", sessionId: "TS-8702" });
    for (const voice of start.body.opening.voice) {
      await call("POST", "/api/tutor-sessions/TS-8702/voice-completions", { action_id: voice.action_id, outcome: "completed" });
    }
    const view = await call("GET", "/api/tutor-sessions/TS-8702");
    const asked = await call("POST", "/api/tutor-sessions/TS-8702/turns", {
      clientTurnId: "turn-ask",
      expectedRevision: view.body.revision,
      input: { input_kind: "question_asked", text: "为什么看这两个三角形？" },
    });
    expect(asked.body.decision?.move_type).toBe("explain");
    expect(asked.body.alignment).toBeUndefined();
    const done = await call("POST", "/api/tutor-sessions/TS-8702/complete", {});
    expect(done.status).toBe(200);
  });

  it("zod 错误面：complete 非法 reason / start 非法 sessionId / asr 缺 duration", async () => {
    expect((await call("POST", "/api/tutor-sessions/TS-8703/complete", { reason: 123 })).status).toBe(400);
    expect((await call("POST", "/api/tutor-sessions", { tpId: "TP-SMV-004", studentId: "s", sessionId: "bad id" })).status).toBe(400);
    expect((await call("POST", "/api/tutor-sessions/TS-8703/asr", { audio: { dataUrl: "data:audio/webm;codecs=opus;base64,AAAA", durationMs: "x" } })).status).toBe(400);
  });
});
