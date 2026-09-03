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

  it("旅程：confirm → 两拍模型作答 → BT-04 workspace action（active_action 下发+错值拒+对值过门）→ completed", async () => {
    const sessionId = process.env.__VNEXT_SESSION__!;
    let current = await call("GET", `/api/vnext/tutor-sessions/${sessionId}`);
    let revision: number = current.body.revision;
    const confirmed = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
      intent_kind: "confirm", client_request_id: "rv-cr-1", expected_revision: revision,
    });
    expect(confirmed.body.views.participation.kind).toBe("answer_input");
    revision = confirmed.body.revision;
    for (const step of [2, 3]) {
      const answered = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
        intent_kind: "submit_answer", text: "子母型相似，对应边成比例", client_request_id: `rv-cr-${step}`, expected_revision: revision,
      });
      expect(answered.body.views.status.last_failure).toBeUndefined();
      revision = answered.body.revision;
    }
    // BT-04：构造已 committed（进入呈现）→ active_action 下发（构造先于挂载）。
    expect(confirmed.body.active_action).toBeUndefined();
    const atBt04 = await call("GET", `/api/vnext/tutor-sessions/${sessionId}`);
    expect(atBt04.body.views.participation.kind).toBe("workspace_input");
    expect(atBt04.body.active_action?.action_ref).toContain("mark-segment-values");
    expect(atBt04.body.active_action?.target_ids).toEqual(["seg-AO", "seg-DO", "seg-BO", "seg-OE"]);
    expect(atBt04.body.active_action?.student_view?.input?.labels ?? []).toEqual([]);
    // 安全①：错误数值 → evaluator rejected（genuine wrong + diagnosis）零事件。
    const eventsBefore = revision; // revision 单调反映事件增长
    const wrongEvidence = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/action-evidence`, {
      evidence: { actionId: atBt04.body.active_action.action_id, sourceStepId: "BT-04", kind: "mark-segment-values", version: 1, values: { "seg-AO": "1", "seg-DO": "1", "seg-BO": "1", "seg-OE": "1" } },
      expected_revision: revision, client_command_id: "cc-rv-wrong",
    });
    expect(wrongEvidence.status).toBe(200);
    expect(wrongEvidence.body.action_submission.status).toBe("evidence-rejected");
    expect(wrongEvidence.body.action_submission.evaluation.evaluation).toBe("wrong");
    expect(wrongEvidence.body.action_submission.evaluation.diagnosis.wrongObjectIds).toHaveLength(4);
    expect(wrongEvidence.body.revision).toBe(eventsBefore);
    // 正确四值 → workspace-committed + GT-04 满足 → BT-05。
    const rightEvidence = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/action-evidence`, {
      evidence: { actionId: atBt04.body.active_action.action_id, sourceStepId: "BT-04", kind: "mark-segment-values", version: 1, values: { "seg-AO": "\\frac{16}{5}", "seg-DO": "\\frac{32}{15}", "seg-BO": "\\frac{6}{5}", "seg-OE": "\\frac{4}{5}" } },
      expected_revision: revision, client_command_id: "cc-rv-right",
    });
    expect(rightEvidence.body.action_submission.status).toBe("workspace-committed");
    expect(rightEvidence.body.action_submission.evaluation.evaluation).toBe("correct");
    expect(rightEvidence.body.views.participation.kind).toBe("answer_input");
    revision = rightEvidence.body.revision;
    // BT-05 模型答 → BT-06 confirm → completed。
    const answered = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
      intent_kind: "submit_answer", text: "蝶形相似 BE=1", client_request_id: "rv-cr-5", expected_revision: revision,
    });
    expect(answered.body.views.status.last_failure).toBeUndefined();
    const finalConfirm = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-intents`, {
      intent_kind: "confirm", client_request_id: "rv-cr-6", expected_revision: answered.body.revision,
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

  it("F7 Step 2 task 绑定：start 显式 task_id；restore 题面按 session pin 解析（allowlist 重排不改变 restore 内容）", async () => {
    // start 显式传 task_id（golden）。
    const explicit = await call("POST", "/api/vnext/tutor-sessions", { student_id: "route-student-6", task_id: "goldenMinhangFold2020" });
    expect(explicit.status).toBe(201);
    expect(explicit.body.question.stem).toContain("翻折");
    // availability 之外的 task_id → 400（route policy 前置）。
    const notEnabled = await call("POST", "/api/vnext/tutor-sessions", { student_id: "route-student-7", task_id: "someLegacyTask" });
    expect(notEnabled.status).toBe(400);
    // allowlist 第一项换成别的任务（模拟环境重排/多任务）：restore 的题面仍来自
    // 会话 pin 的 task_id，不受 allowlist 第一项影响（禁止读取 allowlist 第一项）。
    const previousTasks = process.env.TUTOR_VNEXT_TASKS;
    process.env.TUTOR_VNEXT_TASKS = "someOtherTask,goldenMinhangFold2020";
    try {
      const resumed = await call("GET", `/api/vnext/tutor-sessions/${explicit.body.session_id}`);
      expect(resumed.status).toBe(200);
      expect(resumed.body.question.artifact_id).toBe(explicit.body.question.artifact_id);
      expect(resumed.body.question.stem).toBe(explicit.body.question.stem);
      expect(resumed.body.geometry).toEqual(explicit.body.geometry);
    } finally {
      if (previousTasks === undefined) delete process.env.TUTOR_VNEXT_TASKS;
      else process.env.TUTOR_VNEXT_TASKS = previousTasks;
    }
  });
});
