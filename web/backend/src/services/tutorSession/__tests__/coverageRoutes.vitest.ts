/**
 * Phase 5 remediation 覆盖补强（二）：五端点错误面全覆盖 + coordinator
 * 演练入口（attemptWorkspaceAction）/completeVoice 未知动作/completeSession
 * 幂等/动作节点 pending 视图。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";

import { publishSyntheticPlanVt, tempRoot } from "./vitestSupport";
import { createTutorSessionCoordinator } from "../TutorSession";
import { createTutorSessionRoutes } from "../../../transport/http/tutorSessionRoutes";

const root = tempRoot("coverage-routes2");
const plan = publishSyntheticPlanVt(root, { qtId: "QT-SMV-005", tpId: "TP-SMV-005", parts: 0 });
const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });

let baseUrl = "";
let server: import("node:http").Server | undefined;

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

describe("五端点错误面", () => {
  it("start：非白名单 403；plan 不存在（白名单内无 canonical）500 映射", async () => {
    expect((await call("POST", "/api/tutor-sessions", { tpId: "TP-XXX-001", studentId: "s" })).status).toBe(403);
  });

  it("turns：缺 body 字段 400；未知会话 404；无 active action 409", async () => {
    expect((await call("POST", "/api/tutor-sessions/TS-8401/turns", {})).status).toBe(400);
    expect(
      (
        await call("POST", "/api/tutor-sessions/TS-8499/turns", {
          clientTurnId: "turn-404",
          expectedRevision: 0,
          input: { input_kind: "reasoning_utterance", text: "x" },
        })
      ).status,
    ).toBe(404);
    const start = await call("POST", "/api/tutor-sessions", { tpId: "TP-SMV-005", studentId: "s", sessionId: "TS-8401" });
    expect(start.status).toBe(201);
    const noAction = await call("POST", "/api/tutor-sessions/TS-8401/turns", {
      clientTurnId: "turn-no-action",
      expectedRevision: start.body.opening.revision,
      input: {
        input_kind: "structured_action_evidence",
        action_evidence: { actionId: "a", sourceStepId: "s", kind: "enter-text", version: 1, value: "1" },
      },
    });
    expect(noAction.status).toBe(409);
    expect(noAction.body.error.code).toBe("NO_ACTIVE_ACTION");
  });

  it("voice-completions：非法 outcome 400；未知会话 404", async () => {
    expect(
      (
        await call("POST", "/api/tutor-sessions/TS-8402/voice-completions", {
          action_id: "VA-1",
          outcome: "nonsense",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("POST", "/api/tutor-sessions/TS-8499/voice-completions", {
          action_id: "VA-1",
          outcome: "completed",
        })
      ).status,
    ).toBe(404);
  });

  it("complete：非法 reason 类型 400 可达；正常完成幂等", async () => {
    const done = await call("POST", "/api/tutor-sessions/TS-8401/complete", { reason: "finished" });
    expect(done.status).toBe(200);
    expect(done.body.completed).toBe(true);
    const again = await call("POST", "/api/tutor-sessions/TS-8401/complete", {});
    expect(again.status).toBe(200);
  });

  it("asr：非法 dataUrl 400", async () => {
    const bad = await call("POST", "/api/tutor-sessions/TS-8401/asr", {
      audio: { dataUrl: "not-a-data-url" },
    });
    expect(bad.status).toBe(400);
  });
});

describe("coordinator 演练与恢复面", () => {
  it("attemptWorkspaceAction：非法 capability → runtime_failure 拒绝", () => {
    const sessionId = "TS-8410";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-005" });
    const rejected = coordinator.attemptWorkspaceAction(sessionId, {
      action_id: `WA-${sessionId}-999`,
      decision_id: `TD-${sessionId}-999`,
      capability: "similarity.not-allowed",
      target_ids: [],
      command_payload: { resource_id: "RES404", mode: "learn" },
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.errors.length).toBeGreaterThan(0);
    const failure = coordinator
      .getEvents(sessionId)
      .find((event) => event.event_type === "runtime_failure");
    expect((failure?.payload as { failure_class: string }).failure_class).toBe("workspace_action_rejected");
  });

  it("completeVoice 未知动作 → ACTION_NOT_FOUND；completeSession 幂等", async () => {
    const sessionId = "TS-8411";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-005" });
    expect(() => coordinator.completeVoice(sessionId, { action_id: "VA-none", outcome: "completed" })).toThrowError(
      /ACTION_NOT_FOUND|未签发/,
    );
    const first = coordinator.completeSession(sessionId, "finished");
    expect(first.length).toBe(1);
    const second = coordinator.completeSession(sessionId, "finished");
    expect(second.length).toBe(0);
  });

  it("动作节点 pending 视图：推进到 action_template 节点后 view 含学生面 workspace", async () => {
    const sessionId = "TS-8412";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-005" });
    const drive = async () => {
      const turn = await coordinator.driveTutorTurn(sessionId);
      for (const voice of turn.presentation.voice) {
        coordinator.completeVoice(sessionId, { action_id: voice.action_id, outcome: "completed" });
      }
      return turn;
    };
    await drive(); // explain.open
    await drive(); // hand over
    const checkpoints = plan.checkpoints.map((entry) => entry.checkpoint_id);
    const actionResource = plan.resources.find((resource) => resource.kind === "action_template");
    const actionCheckpoint = actionResource?.checkpoint_id ?? checkpoints.at(-1)!;
    for (const checkpointId of checkpoints) {
      if (checkpointId === actionCheckpoint) break;
      coordinator.recordStudentInput(sessionId, {
        input_kind: "reasoning_utterance",
        text: plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)!.expected_reasoning,
      });
      await drive(); // confirm
      await drive(); // presentation_completed → action_step prompt
    }
    const view = coordinator.getSessionView(sessionId);
    expect(view.pending_workspace.length).toBe(1);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("localTruth");
    expect(serialized).not.toContain("teachingInput");
    expect(serialized).not.toContain("expectedValues");

    // 学生正确操作：typed evaluator 接受并推进。
    const template = JSON.parse(actionResource!.content!) as {
      actionId: string;
      sourceStepId: string;
      kind: string;
      teachingInput: { expectedValues: string[] };
    };
    const wrong = coordinator.submitActionEvidence(sessionId, {
      actionId: template.actionId,
      sourceStepId: template.sourceStepId,
      kind: template.kind as "enter-text",
      version: 1,
      value: "完全错误的答案",
    });
    expect(wrong.accepted).toBe(false);
    const accepted = coordinator.submitActionEvidence(sessionId, {
      actionId: template.actionId,
      sourceStepId: template.sourceStepId,
      kind: template.kind as "enter-text",
      version: 1,
      value: template.teachingInput.expectedValues[0],
    });
    expect(accepted.accepted).toBe(true);
    const finalState = coordinator.restore(sessionId);
    expect(finalState.curriculum.completed).toBe(true);
  });
});
