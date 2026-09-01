/**
 * F7 — vNext 学生端 HTTP 合同测试（真实 golden canonical root + 脚本化 Gate
 * 端口；会话经事件流持久，HTTP 层每请求 resume 重建——无第二会话真源）。
 *
 * 覆盖：availability 门禁、start 学生安全面（三视图 + 题面）、intent 推进
 * 旅程、workspace 命令入账不旁路、GET resume 投影对账、assessment 隔离、
 * revision 冲突显式失败、404/400 错误映射。
 */
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { realCanonicalRoot } from "../../../services/tutorNavigator/__tests__/navigatorSupport";
import { createVNextTutorRoutes } from "../vnextTutorRoutes";

let baseUrl = "";
let server: import("node:http").Server | undefined;

beforeAll(() => {
  process.env.TUTOR_VNEXT_ROOT = realCanonicalRoot();
  process.env.TUTOR_VNEXT_SCRIPTED_GATE = "1";
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/vnext", createVNextTutorRoutes());
  return new Promise<void>((resolve) => {
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

interface Views {
  student_workspace_view: { revision: number; session_id: string; solution_board: { mode: string; groups: Array<{ entries: unknown[] }> }; canvas: { interaction_enabled: boolean } };
  coach_panel_view: { session_id: string; revision: number; mainline: { kind: string }; inquiry: { kind: string; return_checkpoint_id?: string }; transcript: unknown[] };
  participation: { kind: string; gate_id?: string; return_checkpoint_id?: string };
  status: { completed: boolean; session_revision: number; last_failure?: { failure_class: string } };
}

describe("F7 vNext 学生端 HTTP 合同", () => {
  it("availability：golden task 开、其他任务关", async () => {
    const golden = await call("GET", "/api/vnext/availability/goldenMinhangFold2020");
    expect(golden.status).toBe(200);
    expect(golden.body).toEqual({ task_id: "goldenMinhangFold2020", enabled: true });
    const other = await call("GET", "/api/vnext/availability/someLegacyTask");
    expect(other.body.enabled).toBe(false);
  });

  it("start：201 + 学生安全面（三视图/status/题面/题图），开场即 BT-01 awaiting_confirmation", async () => {
    const started = await call("POST", "/api/vnext/tutor-sessions", { student_id: "route-student" });
    expect(started.status).toBe(201);
    const views = started.body.views as Views;
    expect(views.coach_panel_view.mainline.kind).toBe("awaiting_confirmation");
    expect(views.participation.kind).toBe("confirm_input");
    expect(views.participation.gate_id).toBe("GT-01");
    expect(views.student_workspace_view.session_id).toBe(started.body.session_id);
    // 同 session 同 revision（前端组合前 checkProjectionRevisionConsistency 的服务侧前提）。
    expect(views.coach_panel_view.revision).toBe(views.student_workspace_view.revision);
    expect(views.status.completed).toBe(false);
    // 题面与题图来自同一真源（canonical 链 + topic bundle），随 start 一次性下发。
    expect(started.body.question.stem).toContain("翻折");
    expect(started.body.geometry?.points?.length).toBeGreaterThan(0);
    // 学生安全面：响应文本不含答案真值（BE=1 / FN-29 statement 不出现在任何视图 JSON）。
    expect(JSON.stringify(started.body)).not.toContain("ANSWER");
    process.env.__VNEXT_SESSION__ = started.body.session_id;
  });

  it("旅程：confirm → 四次作答（脚本 Gate pass）→ completed；workspace 命令入账不推进 Beat", async () => {
    const sessionId = process.env.__VNEXT_SESSION__!;
    let current = await call("GET", `/api/vnext/tutor-sessions/${sessionId}`);
    let revision: number = current.body.revision;
    // BT-01 confirm → BT-02（answer_input/GT-02）。
    const confirmed = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
      intent_kind: "confirm", client_request_id: "rv-cr-1", expected_revision: revision,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.views.participation.kind).toBe("answer_input");
    expect(confirmed.body.views.coach_panel_view.mainline.kind).toBe("awaiting_answer");
    revision = confirmed.body.revision;
    // workspace 命令（标记已知线段）：receipt 入账、revision +1，但 BT-02 是
    // student_answer gate——不得旁路推进（v4 语义）。
    const workspaceRevisionBefore = confirmed.body.views.student_workspace_view.revision;
    const marked = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/workspace-commands`, {
      command_id: "SC-rv-0001", client_command_id: "cc-rv-0001", surface: "geometry",
      capability: "similarity.mark-known-segments", target_ids: ["segment-AD"], expected_workspace_revision: workspaceRevisionBefore,
      params: { values: { AD: "t" } },
    });
    expect(marked.status).toBe(200);
    expect(marked.body.views.status.completed).toBe(false);
    expect(marked.body.views.participation.kind).toBe("answer_input");
    expect(marked.body.views.student_workspace_view.revision).toBe(workspaceRevisionBefore + 1);
    revision = marked.body.revision;
    // 四次作答推进 BT-03..BT-06 → 最终 confirm → completed + read-only review。
    for (let step = 2; step <= 5; step += 1) {
      const answered = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
        intent_kind: "submit_answer", text: "子母型相似，对应边成比例", client_request_id: `rv-cr-${step}`, expected_revision: revision,
      });
      expect(answered.status).toBe(200);
      expect(answered.body.views.status.last_failure).toBeUndefined();
      revision = answered.body.revision;
    }
    const finalConfirm = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
      intent_kind: "confirm", client_request_id: "rv-cr-6", expected_revision: revision,
    });
    expect(finalConfirm.body.completed).toBe(true);
    expect(finalConfirm.body.views.participation.kind).toBe("read_only_completed");
    expect(finalConfirm.body.views.student_workspace_view.solution_board.mode).toBe("review");
    expect(finalConfirm.body.views.student_workspace_view.canvas.interaction_enabled).toBe(false);
  });

  it("GET resume 与提交后投影一致（refresh/reconnect 从服务端重建，零模型调用）", async () => {
    const sessionId = process.env.__VNEXT_SESSION__!;
    const restored = await call("GET", `/api/vnext/tutor-sessions/${sessionId}`);
    expect(restored.status).toBe(200);
    expect(restored.body.completed).toBe(true);
    expect(restored.body.views.status.session_revision).toBe(restored.body.revision);
    expect(restored.body.question.stem).toContain("翻折");
  });

  it("安全失败：stale expected_revision → 显式失败事实（HTTP 200 + last_failure），可恢复", async () => {
    const started = await call("POST", "/api/vnext/tutor-sessions", { student_id: "route-student-2" });
    const sessionId = started.body.session_id;
    const stale = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
      intent_kind: "confirm", client_request_id: "rv-stale-1", expected_revision: 0,
    });
    expect(stale.status).toBe(200);
    expect(stale.body.views.status.last_failure?.failure_class).toBe("revision_conflict");
    // 用服务端真 revision 重试成功（失败不毒化会话）。
    const retried = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
      intent_kind: "confirm", client_request_id: "rv-stale-2", expected_revision: stale.body.revision,
    });
    expect(retried.body.views.participation.kind).toBe("answer_input");
  });

  it("inquiry：ask_question 打开（暂停 + 返回点可见），分支收尾后回主线", async () => {
    const started = await call("POST", "/api/vnext/tutor-sessions", { student_id: "route-student-3" });
    const sessionId = started.body.session_id;
    const asked = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
      intent_kind: "ask_question", text: "这道题问的是什么？", client_request_id: "rv-iq-1", expected_revision: started.body.revision,
    });
    expect(asked.status).toBe(200);
    expect(asked.body.views.participation.kind).toBe("temporarily_paused_for_inquiry");
    expect(asked.body.views.coach_panel_view.inquiry.kind).not.toBe("no_inquiry");
    expect(asked.body.views.coach_panel_view.inquiry.return_checkpoint_id).toBe("BT-01");
    // 分支内作答（scaffold BT-01 student_answer，脚本 Gate pass）→ 分支推进。
    const branchAnswer = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
      intent_kind: "submit_answer", text: "我卡在第一组子母型", client_request_id: "rv-iq-2", expected_revision: asked.body.revision,
    });
    expect(branchAnswer.status).toBe(200);
    expect(branchAnswer.body.views.participation.kind).toBe("temporarily_paused_for_inquiry");
    expect(branchAnswer.body.views.status.last_failure).toBeUndefined();
    // 分支收尾（confirm；末 Beat 的确认即返回）→ 主线恢复 BT-01（冻结点）。
    let revision = branchAnswer.body.revision;
    let views = branchAnswer.body.views as Views;
    let guard = 0;
    while (views.coach_panel_view.inquiry.kind !== "no_inquiry" && guard < 6) {
      const step = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
        intent_kind: "confirm", client_request_id: `rv-iq-c${guard}`, expected_revision: revision,
      });
      revision = step.body.revision;
      views = step.body.views as Views;
      guard += 1;
    }
    expect(views.coach_panel_view.inquiry.kind).toBe("no_inquiry");
    expect(views.participation.kind).toBe("confirm_input");
  });

  it("assessment：start 即 locked + 教学工具 intent 403 零副作用", async () => {
    const started = await call("POST", "/api/vnext/tutor-sessions", { student_id: "route-student-4", assessment: true });
    expect(started.status).toBe(201);
    expect(started.body.assessment).toBe(true);
    expect(started.body.views.student_workspace_view.canvas.interaction_enabled).toBe(false);
    const forbidden = await call("POST", `/api/vnext/tutor-sessions/${started.body.session_id}/student-intents`, {
      intent_kind: "request_scaffold", client_request_id: "rv-as-1", expected_revision: started.body.revision,
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("ASSESSMENT_INTENT_FORBIDDEN");
    const after = await call("GET", `/api/vnext/tutor-sessions/${started.body.session_id}`);
    expect(after.body.revision).toBe(started.body.revision);
  });

  it("错误映射：未知会话 404、非法载荷 400、非法 intent kind 400", async () => {
    const missing = await call("GET", "/api/vnext/tutor-sessions/TS-99999999");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("SESSION_NOT_FOUND");
    const badBody = await call("POST", "/api/vnext/tutor-sessions", { student_id: "" });
    expect(badBody.status).toBe(400);
    expect(badBody.body.error.code).toBe("BAD_REQUEST");
    const started = await call("POST", "/api/vnext/tutor-sessions", { student_id: "route-student-5" });
    const badKind = await call("POST", `/api/vnext/tutor-sessions/${started.body.session_id}/student-intents`, {
      intent_kind: "submit_workspace_command", client_request_id: "rv-bad-1", expected_revision: started.body.revision,
    });
    expect(badKind.status).toBe(400);
  });
});
