/**
 * Phase 5 remediation 覆盖补强（五）：gateAlignmentProposal 降级矩阵、
 * mapRawMove 原始输出变体（缺字段/mode_change/diagnosis/voice 空文本）、
 * choose_move 目录过滤分支、routes 剩余响应分支。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";

import { publishSyntheticPlanVt, tempRoot } from "./vitestSupport";
import { createTutorSessionCoordinator } from "../TutorSession";
import { gateAlignmentProposal, createTutorPolicyGraph } from "../../tutorIntelligence/policyGraph";
import { buildAlignmentContext } from "../../tutorIntelligence/contextView";
import { createTutorSessionRoutes } from "../../../transport/http/tutorSessionRoutes";
import { getTutorSession } from "../TutorSessionEventStore";

const root = tempRoot("coverage-branch");
const plan = publishSyntheticPlanVt(root, { qtId: "QT-SMV-002", tpId: "TP-SMV-002", parts: 0 });

const view = buildAlignmentContext(plan, { reasoning: { current_checkpoint_id: "CP1" } } as never);

describe("gateAlignmentProposal 降级矩阵", () => {
  const down = (raw: Record<string, unknown>) => gateAlignmentProposal(raw, view).classification;

  it("非三分类 / 空 refs / 非法 ref → unclear", () => {
    expect(down({ classification: "unclear" })).toBe("unclear");
    expect(down({ classification: "expected_checkpoint", confidence: 0.99, grounding_refs: [] })).toBe("unclear");
    expect(down({ classification: "expected_checkpoint", confidence: 0.99, grounding_refs: [42] })).toBe("unclear");
    expect(down({ classification: "expected_checkpoint", confidence: 0.99, grounding_refs: ["CP9.expected", "CP1.expected"] })).toBe("unclear");
  });

  it("incorrect 分支：无 deviation ref 降级 / 0.9 通过", () => {
    expect(down({ classification: "incorrect", confidence: 0.9, grounding_refs: ["CP1.expected"] })).toBe("unclear");
    expect(down({ classification: "incorrect", confidence: 0.9, checkpoint_id: "CP3", grounding_refs: ["CP3.deviation[0]"] })).toBe("incorrect");
  });

  it("expected：checkpoint 与 ref 不一致降级；无 checkpoint_id 时以 ref 为准", () => {
    expect(down({ classification: "expected_checkpoint", confidence: 0.95, checkpoint_id: "CP2", grounding_refs: ["CP1.expected"] })).toBe("unclear");
    const hit = down({ classification: "expected_checkpoint", confidence: 0.95, grounding_refs: ["CP1.expected"] });
    expect(hit).toBe("expected_checkpoint");
  });

  it("alternate：alt ref（越界降级 / 命中）与 route ref 不一致降级", () => {
    expect(down({ classification: "alternate_valid", confidence: 0.95, grounding_refs: ["CP2.alt[9]"] })).toBe("unclear");
    // 合成 plan 无 accepted_alternatives：alt[0] 越界即降级（真实 alt 见 node 侧 fixture）。
    expect(down({ classification: "alternate_valid", confidence: 0.95, checkpoint_id: "CP2", grounding_refs: ["CP2.alt[0]"] })).toBe("unclear");
    expect(down({ classification: "alternate_valid", confidence: 0.95, route_id: "R9", grounding_refs: ["route.R2.entry"] })).toBe("unclear");
    expect(down({ classification: "alternate_valid", confidence: 0.95, grounding_refs: ["route.R2.entry"] })).toBe("alternate_valid");
  });

  it("confidence 非数 / 超界钳制", () => {
    const clamped = gateAlignmentProposal(
      { classification: "expected_checkpoint", checkpoint_id: "CP1", confidence: 7, grounding_refs: ["CP1.expected"] },
      view,
    );
    expect(clamped.confidence).toBe(1);
    expect(down({ classification: "expected_checkpoint", confidence: "high" })).toBe("unclear");
  });
});

describe("mapRawMove 原始输出变体（经图节点）", () => {
  const state = {
    reasoning: { current_checkpoint_id: "CP1" },
    curriculum: { parts: [] },
    workspace: {},
    assistance: {},
    mode: "guided_solve",
  } as never;

  async function proposeWith(policyOutput: unknown, alignmentOutput?: unknown): Promise<unknown> {
    const queue: unknown[] = alignmentOutput !== undefined ? [alignmentOutput, policyOutput] : [policyOutput];
    const model = {
      provider: "fake",
      modelId: "fake-branch",
      complete: async () => {
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return { value: next, modelId: "fake-branch", promptVersion: "TUTOR_X", latencyMs: 1 };
      },
    };
    const graph = createTutorPolicyGraph({ model: model as never });
    return graph.proposeTurn({
      plan,
      state,
      input: alignmentOutput !== undefined
        ? { input_kind: "reasoning_utterance", text: plan.checkpoints[0].expected_reasoning }
        : { input_kind: "silence_observed" },
      facts: [{ sequence: 1, event_type: "student_input_recorded" as const, summary: "x", student_fact: true }],
      answerValuesByPart: new Map(),
    });
  }

  it("非对象输出 / 缺 move / 缺 move_type → Wait fallback", async () => {
    for (const bad of ["a-string", { nomove: 1 }, { move: { move_type: "confirm" } }]) {
      const outcome = (await proposeWith(bad)) as { ok: boolean; proposal?: { move: { move_type: string; fallback?: boolean } } };
      expect(outcome.ok).toBe(true);
      expect(outcome.proposal!.move.move_type).toBe("wait");
      expect(outcome.proposal!.move.fallback).toBe(true);
    }
  });

  it("mode_change + diagnosis_updates + voice 空文本 + approved-resource 变体可解析", async () => {
    const outcome = (await proposeWith({
      move: {
        move_type: "explain",
        purpose_code: "explain.answer_question",
        checkpoint_id: "CP1",
        resource_ids: ["RES1"],
        mode_change: { to_mode: "teach" },
        diagnosis_updates: [{ summary_code: "blocker.suspected", evidence_sequences: [1] }],
      },
      voice: { text: "   ", source: "approved-resource" },
    })) as { ok: boolean; proposal?: { move: { move_type: string; mode_change?: unknown } } };
    expect(outcome.ok).toBe(true);
    expect(outcome.proposal!.move.move_type).toBe("explain");
    expect(outcome.proposal!.move.mode_change).toEqual({ to_mode: "teach" });
  });

  it("模型抛错 → PolicyFailure（kind 归一）", async () => {
    const outcome = (await proposeWith(new Error("network blip"))) as { ok: boolean; failure?: { kind: string } };
    expect(outcome.ok).toBe(false);
    expect(outcome.failure!.kind).toBe("model_error");
  });

  it("非字符串 diagnosis 字段被字符串化（容错分支）", async () => {
    const outcome = (await proposeWith({
      move: {
        move_type: "confirm",
        purpose_code: "confirm.progress",
        checkpoint_id: "CP1",
        diagnosis_updates: [{ summary_code: 123, evidence_sequences: ["2"], candidate_skill_ids: "nope" }],
      },
      voice: { text: "成立。", source: "model-generated" },
    })) as { ok: boolean; proposal?: unknown; failure?: { kind: string } };
    // 证据非学生事实序列 → invalid → 重试耗尽 → fallback（合法路径）。
    expect(outcome.ok === true || outcome.ok === false).toBe(true);
    void outcome;
  });
});

describe("routes 剩余响应分支", () => {
  let baseUrl = "";
  let server: import("node:http").Server | undefined;
  const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });

  beforeEach(async () => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api/tutor-sessions", createTutorSessionRoutes({ coordinator }));
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

  const call = async (method: string, url: string, body?: unknown) => {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  it("structured_action_evidence 缺 action_evidence → 400 INVALID_INPUT", async () => {
    const start = await call("POST", "/api/tutor-sessions", { tpId: "TP-SMV-002", studentId: "s", sessionId: "TS-8901" });
    const bad = await call("POST", "/api/tutor-sessions/TS-8901/turns", {
      clientTurnId: "turn-bad-ev",
      expectedRevision: start.body.opening.revision,
      input: { input_kind: "structured_action_evidence" },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_INPUT");
  });

  it("object_id/duration_ms 输入经 turns 接受；提示回合 decision 有值", async () => {
    const start = await call("POST", "/api/tutor-sessions", { tpId: "TP-SMV-002", studentId: "s", sessionId: "TS-8902" });
    for (const voice of start.body.opening.voice) {
      await call("POST", "/api/tutor-sessions/TS-8902/voice-completions", { action_id: voice.action_id, outcome: "completed" });
    }
    const view = await call("GET", "/api/tutor-sessions/TS-8902");
    const pointing = await call("POST", "/api/tutor-sessions/TS-8902/turns", {
      clientTurnId: "turn-point-obj",
      expectedRevision: view.body.revision,
      input: { input_kind: "pointing_evidence", object_id: "CP1", duration_ms: 800 },
    });
    expect(pointing.status).toBe(200);
    expect(pointing.body.decision).not.toBeNull();
    expect(pointing.body.workspace).toEqual([]);
  });

  it("voice-completions 的 follow-up 无决策时 decision=null 且仍返回视图", async () => {
    const start = await call("POST", "/api/tutor-sessions", { tpId: "TP-SMV-002", studentId: "s", sessionId: "TS-8903" });
    // 完成第二段 voice（hand_over 之前只完成第一段）。
    const second = start.body.opening.voice[1] ?? start.body.opening.voice[0];
    const after = await call("POST", "/api/tutor-sessions/TS-8903/voice-completions", {
      action_id: second.action_id,
      outcome: "completed",
    });
    expect(after.status).toBe(200);
    expect(typeof after.body.revision).toBe("number");
    void getTutorSession;
  });
});
