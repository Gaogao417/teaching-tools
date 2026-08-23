/**
 * 波次 B HTTP 合同测试：POST /api/learn/:taskId/experience（真实 express +
 * fetch）——tutor/legacy 联合结果、fail-closed 错误映射、同题换讲法关联。
 */
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { tempRoot, publishSyntheticV3Experience } from "../../../services/tutorSession/__tests__/vitestSupport";
import { createTutorSessionCoordinator } from "../../../services/tutorSession/TutorSession";
import { createLearnExperienceRoutes } from "../learnExperienceRoutes";
import { getTutorSession } from "../../../services/tutorSession/TutorSessionEventStore";
import { canonicalHash } from "../../../services/planBuild/canonicalInputs";

const root = tempRoot("experience-routes");
publishSyntheticV3Experience(root, {
  qtId: "QT-TST-911",
  tpId: "TP-TST-911",
  alternateTpId: "TP-TST-912",
  taskId: "task-learn-911",
  scenarioId: "SC-TST-911",
});
const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });

const emptyRoot = tempRoot("experience-empty");

let baseUrl = "";
let server: import("node:http").Server | undefined;
let server2: import("node:http").Server | undefined;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/learn", createLearnExperienceRoutes({ canonicalRoot: root, coordinator }));
  app.use("/api/learn-empty", createLearnExperienceRoutes({ canonicalRoot: emptyRoot }));
  app.use(((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error?.name === "ZodError" || error?.body) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: error.message ?? "Invalid request" } });
      return;
    }
    next(error);
  }) as express.ErrorRequestHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server!.address() as { port: number };
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

async function call(url: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

describe("POST /api/learn/:taskId/experience", () => {
  it("无 Binding 的 Topic → kind=legacy（原 LearnPage 照常）", async () => {
    const result = await call("/api/learn/task-unbound-001/experience", { studentId: "s1" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ kind: "legacy", task_id: "task-unbound-001", reason: "no_approved_binding" });

    const empty = await call("/api/learn-empty/task-anything/experience", { studentId: "s1" });
    expect(empty.body).toEqual({ kind: "legacy", task_id: "task-anything", reason: "no_approved_binding" });
  });

  it("Approved Binding → kind=tutor：v4 会话 + 题干/小问 + 开场回合 + 讲法目录", async () => {
    const result = await call("/api/learn/task-learn-911/experience", { studentId: "student-1" });
    expect(result.status).toBe(200);
    expect(result.body.kind).toBe("tutor");
    expect(result.body.task_id).toBe("task-learn-911");
    expect(result.body.binding).toMatchObject({
      artifact_id: "TB-TST-101",
      default_plan: "TP-TST-911",
      alternates_available: true,
    });
    expect(result.body.binding.variants).toHaveLength(2);
    expect(result.body.question.artifact_id).toBe("QT-TST-911");
    expect(typeof result.body.question.stem).toBe("string");
    expect(result.body.opening.session_id).toBe(result.body.session_id);
    expect(result.body.opening).not.toHaveProperty("reviewed_solution");

    const row = getTutorSession(result.body.session_id) as Record<string, unknown>;
    expect(row.event_schema).toBe("v4");
    const started = coordinator.getEvents(result.body.session_id)[0];
    expect(started.payload).toMatchObject({
      task_id: "task-learn-911",
      scenario_id: "SC-TST-911",
      question_ref: { artifact_id: "QT-TST-911" },
      tutor_plan_ref: { artifact_id: "TP-TST-911" },
      policy_profile_snapshot: { profile_id: "PP-TST-001" },
    });
    expect(started.payload).not.toHaveProperty("previous_session_id");
  });

  it("同题换讲法：旧会话完成、新会话记录 previous_session_id + switch_reason", async () => {
    const first = await call("/api/learn/task-learn-911/experience", { studentId: "student-2" });
    const originalSession = first.body.session_id as string;

    const switched = await call("/api/learn/task-learn-911/experience", {
      studentId: "student-2",
      switchFromSessionId: originalSession,
    });
    expect(switched.status).toBe(201);
    expect(switched.body.kind).toBe("tutor");
    expect(switched.body.previous_session_id).toBe(originalSession);
    expect(switched.body.switch_reason).toBe("alternate_approach");
    expect(switched.body.binding.default_plan).toBe("TP-TST-911");

    const started = coordinator.getEvents(switched.body.session_id)[0];
    expect(started.payload).toMatchObject({
      previous_session_id: originalSession,
      switch_reason: "alternate_approach",
      tutor_plan_ref: { artifact_id: expect.any(String) },
    });
    // 同题不换：新旧会话 question_ref 一致（§2 同题换讲法不变量）。
    const oldStarted = coordinator.getEvents(originalSession)[0];
    expect((started.payload as unknown as { question_ref: unknown }).question_ref).toEqual(
      (oldStarted.payload as unknown as { question_ref: unknown }).question_ref,
    );
    // 旧会话已被完成（挂起/结束）。
    expect(coordinator.getSessionView(originalSession).completed).toBe(true);
  });

  it("无 Binding 的 Topic 请求换讲法 → 409 NO_ALTERNATE_APPROACH（不静默回 legacy）", async () => {
    const missing = await call("/api/learn/task-unbound-001/experience", {
      studentId: "s",
      switchFromSessionId: "TS-9999",
    });
    expect(missing.status).toBe(409);
    expect(missing.body.error.code).toBe("NO_ALTERNATE_APPROACH");
  });

  it("换讲法指向不存在会话 → 404 SESSION_NOT_FOUND", async () => {
    const result = await call("/api/learn/task-learn-911/experience", {
      studentId: "s",
      switchFromSessionId: "TS-888888888888",
    });
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("已完成会话不可换讲法 → 409 SESSION_ALREADY_COMPLETED", async () => {
    const first = await call("/api/learn/task-learn-911/experience", { studentId: "student-3" });
    const sessionId = first.body.session_id as string;
    coordinator.completeSession(sessionId, "finished");
    const result = await call("/api/learn/task-learn-911/experience", {
      studentId: "student-3",
      switchFromSessionId: sessionId,
    });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("SESSION_ALREADY_COMPLETED");
  });

  it("状态映射：coordinator 错误码 → HTTP 语义（纯函数）", async () => {
    const { coordinatorErrorStatus } = await import("../learnExperienceRoutes");
    expect(coordinatorErrorStatus("SESSION_NOT_FOUND")).toBe(404);
    expect(coordinatorErrorStatus("APPROACH_SET_MISMATCH")).toBe(409);
    expect(coordinatorErrorStatus("POLICY_PROFILE_INVALID")).toBe(409);
    expect(coordinatorErrorStatus("PLAN_NOT_APPROVED")).toBe(403);
    expect(coordinatorErrorStatus("FEATURE_FLAG_OFF")).toBe(403);
    expect(coordinatorErrorStatus("INVALID_INPUT")).toBe(400);
    expect(coordinatorErrorStatus("SOMETHING_ELSE")).toBe(500);
  });

  it("非 coordinator 错误透传 express 错误链（500）", async () => {
    const { createLearnExperienceRoutes } = await import("../learnExperienceRoutes");
    const app = express();
    app.use(express.json());
    app.use("/api/learn", createLearnExperienceRoutes({
      canonicalRoot: root,
      coordinator: {
        start: () => {
          throw new Error("boom");
        },
      } as never,
    }));
    await new Promise<void>((resolve) => {
      server2 = app.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server2!.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/api/learn/task-learn-911/experience`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId: "s" }),
    });
    expect(response.status).toBe(500);
    server2!.close();
  });

  it("非法请求体 → 400", async () => {
    const bad = await call("/api/learn/task-learn-911/experience", { studentId: "" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("BAD_REQUEST");
  });

  it("Binding 存在但漂移 → fail-closed 4xx（不静默换题/换讲法）", async () => {
    // canonical root 缺 Binding registry 的对照在 legacy 用例覆盖；此处覆盖
    // 路由对选择器 error 的透传：构造 AMBIGUOUS_BINDING。
    const { mkdirSync, writeFileSync, readFileSync, copyFileSync } = await import("node:fs");
    const src = `${root}/topic-question-binding/TB-TST-101`;
    const dst = `${root}/topic-question-binding/TB-TST-102`;
    mkdirSync(dst, { recursive: true });
    const payload = JSON.parse(readFileSync(`${src}/v1.json`, "utf8"));
    payload.artifact_id = "TB-TST-102";
    payload.artifact_uri = "artifact://topic-question-binding/TB-TST-102@v1";
    payload.content_hash = canonicalHash(payload, "authoring");
    writeFileSync(`${dst}/v1.json`, JSON.stringify(payload));
    writeFileSync(`${dst}/registry.yaml`, "artifact_id: TB-TST-102\ncurrent_version: v1\nversions:\n- {version: v1, status: Approved}\n");

    const ambiguous = await call("/api/learn/task-learn-911/experience", { studentId: "s" });
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.error.code).toBe("AMBIGUOUS_BINDING");

    // 清理，避免污染后续用例。
    const { rmSync } = await import("node:fs");
    rmSync(dst, { recursive: true, force: true });
  });
});

async function callGet(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${url}`);
  return { status: response.status, body: await response.json().catch(() => null) };
}

describe("GET /api/learn/:taskId/solution-board（波次 F 完成页板书回顾）", () => {
  // 板书来自 scenarioBank（编译进 backend 的正式记录），与 canonical root
  // 无关——golden 真题 task 直接可解析。
  const TRUTH_KEYS = ["localTruth", "teachingInput", "expectedValues"];

  it("golden 题：整板 learn 投影（全部表达式 complete）、响应无 truth 键", async () => {
    const result = await callGet("/api/learn/goldenMinhangCross2020/solution-board");
    expect(result.status).toBe(200);
    expect(result.body.task_id).toBe("goldenMinhangCross2020");
    expect(typeof result.body.scenario_id).toBe("string");
    const board = result.body.board;
    expect(board.schemaVersion).toBe(1);
    expect(Array.isArray(board.expressions)).toBe(true);
    expect(board.expressions.length).toBeGreaterThan(0);
    expect(board.expressions.every((expression: { phase: string }) => expression.phase === "complete")).toBe(true);
    const raw = JSON.stringify(result.body);
    for (const key of TRUTH_KEYS) {
      expect(raw).not.toContain(`"${key}"`);
    }
  });

  it("?scenario= 指定记录命中（等价投影）；未知 scenario id → 404", async () => {
    const first = await callGet("/api/learn/goldenMinhangCross2020/solution-board");
    const scenarioId = first.body.scenario_id as string;
    const again = await callGet(`/api/learn/goldenMinhangCross2020/solution-board?scenario=${encodeURIComponent(scenarioId)}`);
    expect(again.status).toBe(200);
    expect(again.body.scenario_id).toBe(scenarioId);
    expect(again.body.board).toEqual(first.body.board);

    const missing = await callGet("/api/learn/goldenMinhangCross2020/solution-board?scenario=not-a-scenario");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("SCENARIO_NOT_FOUND");
  });

  it("未知 task → 404；非 topic-practice task → 409", async () => {
    const unknown = await callGet("/api/learn/task-does-not-exist/solution-board");
    expect(unknown.status).toBe(404);

    const nonTopic = await callGet("/api/learn/meaning/solution-board");
    expect(nonTopic.status).toBe(409);
    expect(nonTopic.body.error.code).toBe("ACTION_NOT_ALLOWED");
  });
});
