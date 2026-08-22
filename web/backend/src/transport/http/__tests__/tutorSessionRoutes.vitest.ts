/**
 * 波次 D HTTP 合同测试（Phase 5 UI 集成波次 C 更新：公开 tpId 直启已下线，
 * 会话创建统一走 /experience——本文件用注入 coordinator 的内部启动路径
 * （benchmark/runner 等价面）准备会话，只测会话级端点）。
 * 断言学生安全面（无 truth/teachingInput/expectedValues）与错误映射
 * （403/404/409/400）。
 */
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { publishSyntheticPlanVt, tempRoot } from "../../../services/tutorSession/__tests__/vitestSupport";
import { createTutorSessionCoordinator } from "../../../services/tutorSession/TutorSession";
import { createTutorSessionRoutes } from "../tutorSessionRoutes";

const root = tempRoot("routes");
publishSyntheticPlanVt(root, { qtId: "QT-SMV-003", tpId: "TP-SMV-003", parts: 0 });
const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });

/** 内部启动路径（golden-whitelist 访问面，benchmark/runner 等价；非公开 HTTP）。 */
async function startSession(sessionId: string, studentId: string): Promise<void> {
  coordinator.start({ sessionId, studentId, tpId: "TP-SMV-003" });
  await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" });
}

let baseUrl = "";
let server: import("node:http").Server | undefined;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/tutor-sessions", createTutorSessionRoutes({ coordinator }));
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

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

describe("tutor-sessions HTTP 合同（会话级端点）", () => {
  it("公开 tpId 直启已下线：POST /api/tutor-sessions 404（会话创建走 /experience）", async () => {
    const gone = await call("POST", "/api/tutor-sessions", { tpId: "TP-SMV-003", studentId: "s" });
    expect(gone.status).toBe(404);
  });

  it("GET /:sessionId 恢复学生安全视图（pending voice + revision）", async () => {
    await startSession("TS-8201", "student-http");
    const view = await call("GET", "/api/tutor-sessions/TS-8201");
    expect(view.status).toBe(200);
    expect(view.body.revision).toBeGreaterThan(0);
    expect(view.body.pending_voice.length).toBeGreaterThanOrEqual(1);
    expect(view.body.current_checkpoint.checkpoint_id).toBeTruthy();
    expect(view.body).not.toHaveProperty("truth");
    const serialized = JSON.stringify(view.body);
    expect(serialized).not.toContain("localTruth");
    expect(serialized).not.toContain("teachingInput");
    expect(serialized).not.toContain("expectedValues");
  });

  it("GET 未知会话 404", async () => {
    const missing = await call("GET", "/api/tutor-sessions/TS-9999");
    expect(missing.status).toBe(404);
  });

  it("POST /turns：非法输入 400；合法回答推进并幂等", async () => {
    const view = await call("GET", "/api/tutor-sessions/TS-8201");
    const revision = view.body.revision;
    const bad = await call("POST", "/api/tutor-sessions/TS-8201/turns", {
      clientTurnId: "bad-input",
      expectedRevision: revision,
      input: { input_kind: "nonsense" },
    });
    expect(bad.status).toBe(400);

    // 播完开场 voice 后提交期望推理。
    for (const voice of view.body.pending_voice) {
      await call("POST", "/api/tutor-sessions/TS-8201/voice-completions", {
        action_id: voice.action_id,
        outcome: "completed",
      });
    }
    const fresh = await call("GET", "/api/tutor-sessions/TS-8201");
    const plan = coordinator.getEvents("TS-8201");
    void plan;
    const answer = await call("POST", "/api/tutor-sessions/TS-8201/turns", {
      clientTurnId: "turn-http-1",
      expectedRevision: fresh.body.revision,
      input: { input_kind: "reasoning_utterance", text: "学生能指出目标三角形" },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.alignment?.alignment).toBe("expected_checkpoint");
    const replay = await call("POST", "/api/tutor-sessions/TS-8201/turns", {
      clientTurnId: "turn-http-1",
      expectedRevision: answer.body.revision,
      input: { input_kind: "reasoning_utterance", text: "学生能指出目标三角形" },
    });
    expect(replay.body.idempotent_replay).toBe(true);
    expect(replay.body.decision?.decision_id).toBe(answer.body.decision?.decision_id);
  });

  it("POST /voice-completions → 自动续走系统回合；POST /complete 完成会话", async () => {
    await startSession("TS-8202", "student-http");
    const view = await call("GET", "/api/tutor-sessions/TS-8202");
    const voiceActionId = view.body.pending_voice[0].action_id;
    const afterVoice = await call("POST", "/api/tutor-sessions/TS-8202/voice-completions", {
      action_id: voiceActionId,
      outcome: "completed",
    });
    expect(afterVoice.status).toBe(200);
    expect(afterVoice.body.revision).toBeGreaterThan(view.body.revision);
    const done = await call("POST", "/api/tutor-sessions/TS-8202/complete", { reason: "finished" });
    expect(done.status).toBe(200);
    expect(done.body.completed).toBe(true);
  });
});
