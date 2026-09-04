/**
 * F7 Step 4 — 统一 HTTP application profile 路由测试（v7 生产组合链；真实
 * golden canonical root + 脚本化 Gate 端口；会话经事件流持久，HTTP 层每请求
 * resume 重建——无第二会话真源）。
 *
 * 覆盖：availability+profile、start 学生安全面 + client_request_id 幂等/漂移、
 * presentation outcome 驱动的 golden 旅程（utterance/control 输入链 + BT-04
 * evidence 五判别）、GET resume 对账、revision 冲突显式 turn、inquiry（assistance
 * utterance）、assessment（locked + 权限矩阵 + mainline utterance 允许）、
 * 错误映射（404/400/409 v6 行）、ASR observe-only（415/413/422/注入 transcriber）。
 */
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "../../../db/database";
import { realCanonicalRoot } from "../../../services/tutorNavigator/__tests__/navigatorSupport";
import { createVNextTutorRoutes } from "../vnextTutorRoutes";
import { vNextGateModel } from "../../../services/tutorOrchestration/VNextGateModelFactory";
import { TutorSessionOrchestratorV6 } from "../../../services/tutorOrchestration/TutorSessionOrchestratorV6";

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

interface Snapshot {
  profile: string;
  session_id: string;
  task_id: string;
  revision: number;
  completed: boolean;
  assessment: boolean;
  question: { artifact_id: string; question_type: string; stem: string };
  views: {
    student_workspace_view: { session_id: string; revision: number; solution_board: { mode: string }; canvas: { interaction_enabled: boolean } };
    coach_panel_view: { session_id: string; revision: number; mainline: { kind: string }; inquiry: { kind: string; return_checkpoint_id?: string } };
    participation: { kind: string; gate_id?: string };
    status: { completed: boolean; session_revision: number; workspace_revision: number; last_failure?: { failure_class: string } };
  };
  render: { workspace_revision: number; geometry: Record<string, unknown> | null };
  active_action?: { action_id: string; action_ref: string; target_ids: string[]; student_view?: { input?: { labels?: string[] } } };
  pending_presentation?: { sequence_id: string; ordinal: number; action_id: string };
  turn?: { status: string; failure?: { failure_class: string } };
}

async function getSnapshot(sessionId: string): Promise<Snapshot> {
  const response = await call("GET", `/api/vnext/tutor-sessions/${sessionId}`);
  expect(response.status).toBe(200);
  return response.body as Snapshot;
}

/** 逐项 reported presented 直到序列耗尽（每次 outcome 携带服务端真 revision）。 */
async function presentAll(sessionId: string): Promise<number> {
  let presented = 0;
  for (let guard = 0; guard < 64; guard += 1) {
    const current = await getSnapshot(sessionId);
    const pending = current.pending_presentation;
    if (!pending) return presented;
    const outcome = await call(
      "POST",
      `/api/vnext/tutor-sessions/${sessionId}/presentation-actions/${pending.action_id}/outcomes`,
      {
        sequence_id: pending.sequence_id,
        ordinal: pending.ordinal,
        outcome: "presented",
        client_request_id: `po-${pending.sequence_id}-${pending.ordinal}-${presented}`,
        expected_revision: current.revision,
      },
    );
    expect(outcome.status).toBe(200);
    presented += 1;
  }
  throw new Error("presentAll guard exceeded（序列推进异常）");
}

/** presented 直到 participation 满足谓词；序列耗尽依序提交输入推进 Beat。 */
async function advanceUntil(
  sessionId: string,
  predicate: (snapshot: Snapshot) => boolean,
  inputs: Array<{ input: { kind: "utterance"; channel: "mainline"; text: string } | { kind: "control"; command: string }; client_request_id: string }>,
): Promise<Snapshot> {
  for (let guard = 0; guard < 32; guard += 1) {
    await presentAll(sessionId);
    const current = await getSnapshot(sessionId);
    if (predicate(current)) return current;
    const next = inputs.shift();
    if (!next) throw new Error("advanceUntil：输入耗尽而谓词未满足");
    const submitted = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
      ...next,
      expected_revision: current.revision,
    });
    expect(submitted.status).toBe(200);
    expect((submitted.body as Snapshot).views.status.last_failure).toBeUndefined();
  }
  throw new Error("advanceUntil guard exceeded");
}

describe("F7 Step 4 统一 HTTP application profile（v7 生产链）", () => {
  it("availability：golden task 开、其他任务关 + profile 字段", async () => {
    const golden = await call("GET", "/api/vnext/availability/goldenMinhangFold2020");
    expect(golden.status).toBe(200);
    expect(golden.body).toEqual({ task_id: "goldenMinhangFold2020", enabled: true, profile: "f7-tutor-runtime-http/v1" });
    const other = await call("GET", "/api/vnext/availability/someLegacyTask");
    expect(other.body.enabled).toBe(false);
    expect(other.body.profile).toBe("f7-tutor-runtime-http/v1");
  });

  it("start：201 + 统一快照（profile/views/render/question）+ 开场 BT-01 序列 pending；client_request_id 幂等/漂移", async () => {
    const started = await call("POST", "/api/vnext/tutor-sessions", {
      student_id: "route-v7-student", task_id: "goldenMinhangFold2020", client_request_id: "rv7-start-1",
    });
    expect(started.status).toBe(201);
    const snapshot = started.body as Snapshot;
    expect(snapshot.profile).toBe("f7-tutor-runtime-http/v1");
    expect(snapshot.task_id).toBe("goldenMinhangFold2020");
    expect(snapshot.assessment).toBe(false);
    // 三视图 + render 同 session/revision 对账（一致性门禁已在线格式层强制）。
    expect(snapshot.views.student_workspace_view.session_id).toBe(snapshot.session_id);
    expect(snapshot.views.coach_panel_view.revision).toBe(snapshot.views.student_workspace_view.revision);
    expect(snapshot.render.workspace_revision).toBe(snapshot.views.status.workspace_revision);
    expect(snapshot.render.geometry && "points" in (snapshot.render.geometry as Record<string, unknown>)
      ? ((snapshot.render.geometry as { points: unknown[] }).points?.length ?? 0)
      : 0).toBeGreaterThan(0);
    expect(snapshot.question.stem).toContain("翻折");
    // 开场即 BT-01 序列队首 pending（呈现先于学生输入）。
    expect(snapshot.pending_presentation?.sequence_id).toMatch(/^PS-/);
    expect(snapshot.active_action).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain("ANSWER");
    // 同键同 payload → 200 existing（同一 session）。
    const replay = await call("POST", "/api/vnext/tutor-sessions", {
      student_id: "route-v7-student", task_id: "goldenMinhangFold2020", client_request_id: "rv7-start-1",
    });
    expect(replay.status).toBe(200);
    expect(replay.body.session_id).toBe(snapshot.session_id);
    // 同键异 payload → 409 REQUEST_PAYLOAD_DRIFT（零新会话）。
    const sessionsBefore = (db.prepare("SELECT COUNT(*) AS n FROM tutor_sessions").get() as { n: number }).n;
    const drift = await call("POST", "/api/vnext/tutor-sessions", {
      student_id: "route-v7-student-OTHER", task_id: "goldenMinhangFold2020", client_request_id: "rv7-start-1",
    });
    expect(drift.status).toBe(409);
    expect(drift.body.error.code).toBe("REQUEST_PAYLOAD_DRIFT");
    expect((db.prepare("SELECT COUNT(*) AS n FROM tutor_sessions").get() as { n: number }).n).toBe(sessionsBefore);
    process.env.__VNEXT_V7_SESSION__ = snapshot.session_id;
  });

  it("golden 旅程：presented 逐项推进 → confirm/utterance → BT-04 evidence 错值拒/对值 committed → completed", async () => {
    const sessionId = process.env.__VNEXT_V7_SESSION__!;
    // BT-01 呈现完 → confirm_input；control.confirm 过 GT-01 → BT-02 answer_input。
    const atAnswer = await advanceUntil(sessionId, (current) => current.views.participation.kind === "answer_input", [
      { input: { kind: "control", command: "confirm" }, client_request_id: "rv7-confirm-1" },
    ]);
    expect(atAnswer.views.participation.gate_id).toBe("GT-02");
    // BT-02/BT-03 mainline utterance（后端解释为 submit_answer；脚本 Gate pass）。
    for (const step of [2, 3]) {
      const current = await getSnapshot(sessionId);
      const answered = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
        input: { kind: "utterance", channel: "mainline", text: "子母型相似，对应边成比例" },
        client_request_id: `rv7-answer-${step}`,
        expected_revision: current.revision,
      });
      expect(answered.status).toBe(200);
      expect((answered.body as Snapshot).views.status.last_failure).toBeUndefined();
      await presentAll(sessionId);
    }
    // BT-04：构造全部 presented → active_action 挂载（workspace_input）。
    const atBt04 = await advanceUntil(
      sessionId,
      (current) => current.views.participation.kind === "workspace_input" && current.active_action !== undefined,
      [],
    );
    expect(atBt04.active_action?.action_ref).toContain("mark-segment-values");
    expect(atBt04.active_action?.target_ids).toEqual(["seg-AO", "seg-DO", "seg-BO", "seg-OE"]);
    const bt04Action = atBt04.active_action!;
    // 安全①：错误数值 → evidence-rejected（wrong + diagnosis）零事件（revision 不变）。
    const revisionBefore = atBt04.revision;
    const wrong = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/action-evidence`, {
      evidence: {
        actionId: bt04Action.action_id, sourceStepId: "BT-04", kind: "mark-segment-values", version: 1,
        values: { "seg-AO": "1", "seg-DO": "1", "seg-BO": "1", "seg-OE": "1" },
      },
      expected_revision: revisionBefore, client_request_id: "rv7-cc-wrong",
    });
    expect(wrong.status).toBe(200);
    expect(wrong.body.action_submission.status).toBe("evidence-rejected");
    expect(wrong.body.action_submission.evaluation.evaluation).toBe("wrong");
    expect(wrong.body.action_submission.evaluation.diagnosis.wrongObjectIds).toHaveLength(4);
    expect(wrong.body.revision).toBe(revisionBefore);
    // 正确四值 → workspace-committed（verified-correct 过 GT-04）→ BT-05。
    const right = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/action-evidence`, {
      evidence: {
        actionId: bt04Action.action_id, sourceStepId: "BT-04", kind: "mark-segment-values", version: 1,
        values: { "seg-AO": "\\frac{16}{5}", "seg-DO": "\\frac{32}{15}", "seg-BO": "\\frac{6}{5}", "seg-OE": "\\frac{4}{5}" },
      },
      expected_revision: revisionBefore, client_request_id: "rv7-cc-right",
    });
    expect(right.body.action_submission.status).toBe("workspace-committed");
    expect(right.body.action_submission.evaluation.evaluation).toBe("correct");
    // BT-05 序列呈现完成后才开放作答（presenting → awaiting_evidence）。
    const atBt05 = await advanceUntil(sessionId, (current) => current.views.participation.kind === "answer_input", []);
    expect(atBt05.views.participation.gate_id).toBe("GT-05");
    // BT-05 utterance → BT-06 confirm → completed（read-only 回顾）。
    const answered = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
      input: { kind: "utterance", channel: "mainline", text: "蝶形相似 BE=1" },
      client_request_id: "rv7-answer-5", expected_revision: atBt05.revision,
    });
    expect(answered.status).toBe(200);
    await presentAll(sessionId);
    const finalConfirm = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
      input: { kind: "control", command: "confirm" },
      client_request_id: "rv7-confirm-6", expected_revision: (await getSnapshot(sessionId)).revision,
    });
    expect(finalConfirm.status).toBe(200);
    const done = await getSnapshot(sessionId);
    expect(done.completed).toBe(true);
    expect(done.views.participation.kind).toBe("read_only_completed");
    expect(done.views.student_workspace_view.solution_board.mode).toBe("review");
    expect(done.views.student_workspace_view.canvas.interaction_enabled).toBe(false);
    expect(done.active_action).toBeUndefined();
  });

  it("GET resume 与提交后投影一致（refresh 从服务端 verified rebuild；同 session/revision/题面）", async () => {
    const sessionId = process.env.__VNEXT_V7_SESSION__!;
    const restored = await getSnapshot(sessionId);
    expect(restored.completed).toBe(true);
    expect(restored.views.status.session_revision).toBe(restored.revision);
    expect(restored.question.stem).toContain("翻折");
    expect(restored.pending_presentation).toBeUndefined();
  });

  it("安全失败：stale expected_revision → 显式 turn.revision-conflict（HTTP 200），服务端真 revision 重试可恢复", async () => {
    const started = await call("POST", "/api/vnext/tutor-sessions", {
      student_id: "route-v7-student-2", task_id: "goldenMinhangFold2020", client_request_id: "rv7-start-stale",
    });
    const sessionId = started.body.session_id;
    // 呈现完成后才开放学生输入（默认串行契约）。
    await presentAll(sessionId);
    const current = await getSnapshot(sessionId);
    const stale = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
      input: { kind: "control", command: "confirm" }, client_request_id: "rv7-stale-1", expected_revision: 0,
    });
    expect(stale.status).toBe(200);
    expect((stale.body as Snapshot).turn?.status).toBe("revision-conflict");
    expect((stale.body as Snapshot).turn?.failure?.failure_class).toBe("revision_conflict");
    const retried = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
      input: { kind: "control", command: "confirm" }, client_request_id: "rv7-stale-2", expected_revision: (await getSnapshot(sessionId)).revision,
    });
    expect(retried.status).toBe(200);
    expect((retried.body as Snapshot).turn?.status).toBe("committed");
    // 重试后的新 Beat 序列呈现完成 → answer_input（失败不毒化会话）。
    await presentAll(sessionId);
    const recovered = await getSnapshot(sessionId);
    expect(recovered.views.participation.kind).toBe("answer_input");
  });

  it("inquiry：assistance utterance 打开（暂停 + 返回点可见），分支收尾回主线", async () => {
    const started = await call("POST", "/api/vnext/tutor-sessions", {
      student_id: "route-v7-student-3", task_id: "goldenMinhangFold2020", client_request_id: "rv7-start-iq",
    });
    const sessionId = started.body.session_id;
    await presentAll(sessionId);
    const current = await getSnapshot(sessionId);
    const asked = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
      input: { kind: "utterance", channel: "assistance", text: "这道题问的是什么？" },
      client_request_id: "rv7-iq-1", expected_revision: current.revision,
    });
    expect(asked.status).toBe(200);
    expect((asked.body as Snapshot).views.participation.kind).toBe("temporarily_paused_for_inquiry");
    expect((asked.body as Snapshot).views.coach_panel_view.inquiry.kind).not.toBe("no_inquiry");
    expect((asked.body as Snapshot).views.coach_panel_view.inquiry.return_checkpoint_id).toBe("BT-01");
    // 分支内作答（inquiry 语境 mainline utterance；脚本 Gate pass）→ 分支推进。
    const branchAnswer = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
      input: { kind: "utterance", channel: "mainline", text: "我卡在第一组子母型" },
      client_request_id: "rv7-iq-2", expected_revision: (asked.body as Snapshot).revision,
    });
    expect(branchAnswer.status).toBe(200);
    expect((branchAnswer.body as Snapshot).views.participation.kind).toBe("temporarily_paused_for_inquiry");
    expect((branchAnswer.body as Snapshot).views.status.last_failure).toBeUndefined();
    // 分支收尾（confirm；末 Beat 确认即返回）→ 主线恢复。
    let views = (branchAnswer.body as Snapshot).views;
    let guard = 0;
    while (views.coach_panel_view.inquiry.kind !== "no_inquiry" && guard < 8) {
      await presentAll(sessionId);
      const step = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
        input: { kind: "control", command: "confirm" }, client_request_id: `rv7-iq-c${guard}`, expected_revision: (await getSnapshot(sessionId)).revision,
      });
      views = (step.body as Snapshot).views;
      guard += 1;
    }
    expect(views.coach_panel_view.inquiry.kind).toBe("no_inquiry");
  });

  it("assessment：locked + 权限矩阵（assistance/scaffold/workspace 命令 403 零事实；mainline utterance 允许）", async () => {
    const started = await call("POST", "/api/vnext/tutor-sessions", {
      student_id: "route-v7-student-4", task_id: "goldenMinhangFold2020", assessment: true, client_request_id: "rv7-start-as",
    });
    expect(started.status).toBe(201);
    const sessionId = started.body.session_id;
    expect((started.body as Snapshot).assessment).toBe(true);
    expect((started.body as Snapshot).views.student_workspace_view.canvas.interaction_enabled).toBe(false);
    // 单确定性指示 voice（零 workspace action）。
    const presented = await presentAll(sessionId);
    expect(presented).toBe(1);
    const current = await getSnapshot(sessionId);
    // 越界①：assistance utterance → 403 零事实。
    const forbiddenHelp = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
      input: { kind: "utterance", channel: "assistance", text: "能给点提示吗" },
      client_request_id: "rv7-as-1", expected_revision: current.revision,
    });
    expect(forbiddenHelp.status).toBe(403);
    expect(forbiddenHelp.body.error.code).toBe("ASSESSMENT_INTENT_FORBIDDEN");
    // 越界②：control.request_scaffold → 403 零事实。
    const forbiddenScaffold = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
      input: { kind: "control", command: "request_scaffold" },
      client_request_id: "rv7-as-2", expected_revision: current.revision,
    });
    expect(forbiddenScaffold.status).toBe(403);
    // 越界③：学生 workspace 命令（catalog locked）→ 403 零事实。
    const forbiddenCommand = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/workspace-commands`, {
      command: {
        schema: "ai_teaching_student_workspace_command/v1", session_id: sessionId,
        command_id: "SC-rv7-as-1", surface: "geometry", capability: "similarity.mark-known-segments",
        origin: "student", target_ids: ["seg-AO"], expected_workspace_revision: current.views.status.workspace_revision,
        client_command_id: "rv7-as-cc-1",
      },
      expected_revision: current.revision,
    });
    expect(forbiddenCommand.status).toBe(403);
    const after = await getSnapshot(sessionId);
    expect(after.revision).toBe(current.revision);
    // 允许：mainline utterance（后端解释为独立作答并评价；仍收集答案）。
    const answered = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
      input: { kind: "utterance", channel: "mainline", text: "我独立作答：对应边成比例" },
      client_request_id: "rv7-as-3", expected_revision: current.revision,
    });
    expect(answered.status).toBe(200);
    expect((answered.body as Snapshot).revision).toBeGreaterThan(current.revision);
  });

  it("错误映射：未知会话 404、缺 task_id 400（零会话行）、非法输入形态 400、v6 会话行 409 SESSION_VERSION_UNSUPPORTED", async () => {
    const missing = await call("GET", "/api/vnext/tutor-sessions/TS-99999999");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("SESSION_NOT_FOUND");
    const badBody = await call("POST", "/api/vnext/tutor-sessions", { student_id: "", task_id: "goldenMinhangFold2020", client_request_id: "rv7-bad-0" });
    expect(badBody.status).toBe(400);
    const sessionsBefore = (db.prepare("SELECT COUNT(*) AS n FROM tutor_sessions").get() as { n: number }).n;
    const eventsBefore = (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events").get() as { n: number }).n;
    const missingTaskId = await call("POST", "/api/vnext/tutor-sessions", { student_id: "route-v7-x", client_request_id: "rv7-bad-1" });
    expect(missingTaskId.status).toBe(400);
    expect((db.prepare("SELECT COUNT(*) AS n FROM tutor_sessions").get() as { n: number }).n).toBe(sessionsBefore);
    expect((db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events").get() as { n: number }).n).toBe(eventsBefore);
    // HTTP /student-inputs 只收 utterance|control：语义标签 → 400。
    const started = await call("POST", "/api/vnext/tutor-sessions", {
      student_id: "route-v7-student-5", task_id: "goldenMinhangFold2020", client_request_id: "rv7-start-err",
    });
    const labelInput = await call("POST", `/api/vnext/tutor-sessions/${started.body.session_id}/student-inputs`, {
      input: { kind: "utterance", channel: "mainline", text: "答案", intent_kind: "submit_answer" },
      client_request_id: "rv7-bad-2", expected_revision: started.body.revision,
    });
    expect(labelInput.status).toBe(400);
    // v6 会话行进入 v7 profile → 409 SESSION_VERSION_UNSUPPORTED（新生产只服务 v7）。
    const v6Session = TutorSessionOrchestratorV6.start({
      sessionId: `TS-${Date.now()}71`,
      studentId: "route-v7-v6-row",
      taskId: "goldenMinhangFold2020",
      canonicalRoot: realCanonicalRoot(),
      model: vNextGateModel(),
    });
    const v6ViaV7 = await call("GET", `/api/vnext/tutor-sessions/${v6Session.sessionId}`);
    expect(v6ViaV7.status).toBe(409);
    expect(v6ViaV7.body.error.code).toBe("SESSION_VERSION_UNSUPPORTED");
  });

  it("ASR：observe-only（415/413/注入 transcriber 422；响应携带 observed_revision）", async () => {
    const started = await call("POST", "/api/vnext/tutor-sessions", {
      student_id: "route-v7-student-6", task_id: "goldenMinhangFold2020", client_request_id: "rv7-start-asr",
    });
    const sessionId = started.body.session_id;
    const base = `/api/vnext/tutor-sessions/${sessionId}/asr`;
    const badMime = await call("POST", base, { audio: { data_url: "data:text/plain;base64,eA==", mime_type: "text/plain" }, client_request_id: "rv7-asr-1" });
    expect(badMime.status).toBe(415);
    const tooLarge = await call("POST", base, {
      audio: { data_url: `data:audio/wav;base64,${"A".repeat(6_000_001)}`, mime_type: "audio/wav" },
      client_request_id: "rv7-asr-2",
    });
    expect(tooLarge.status).toBe(413);
    // 注入 transcriber：空 transcript → 422；非空 → transcript + observed_revision。
    const app = express();
    app.use(express.json({ limit: "10mb" }));
    app.use("/api/vnext", createVNextTutorRoutes({
      transcriber: async (input) => (input.dataUrl.includes("EMPTY") ? { transcript: "  ", model: "stub-asr" } : { transcript: "我认为是 16 比 5", model: "stub-asr" }),
    }));
    await new Promise<void>((resolve) => {
      const stubServer = app.listen(0, "127.0.0.1", () => {
        const address = stubServer.address() as { port: number };
        void (async () => {
          const empty = await fetch(`http://127.0.0.1:${address.port}${base}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: { data_url: "data:audio/wav;base64,EMPTY", mime_type: "audio/wav" }, client_request_id: "rv7-asr-3" }),
          });
          expect(empty.status).toBe(422);
          expect((await empty.json()).error.code).toBe("EMPTY_TRANSCRIPT");
          const ok = await fetch(`http://127.0.0.1:${address.port}${base}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: { data_url: "data:audio/wav;base64,QUJD", mime_type: "audio/wav" }, client_request_id: "rv7-asr-4" }),
          });
          expect(ok.status).toBe(200);
          const body = (await ok.json()) as { session_id: string; observed_revision: number; transcript: string; model: string };
          expect(body.session_id).toBe(sessionId);
          expect(body.observed_revision).toBe((await getSnapshot(sessionId)).revision);
          expect(body.transcript).toContain("16");
          await new Promise<void>((done) => stubServer.close(() => done()));
          resolve();
        })();
      });
    });
  });

  it("F7 Step 2 task 绑定：restore 题面按 session pin 解析（allowlist 重排不改变内容）", async () => {
    const explicit = await call("POST", "/api/vnext/tutor-sessions", {
      student_id: "route-v7-student-7", task_id: "goldenMinhangFold2020", client_request_id: "rv7-start-pin",
    });
    expect(explicit.status).toBe(201);
    const previousTasks = process.env.TUTOR_VNEXT_TASKS;
    process.env.TUTOR_VNEXT_TASKS = "someOtherTask,goldenMinhangFold2020";
    try {
      const resumed = await getSnapshot(explicit.body.session_id);
      expect(resumed.question.artifact_id).toBe(explicit.body.question.artifact_id);
      expect(resumed.question.stem).toBe(explicit.body.question.stem);
      expect(resumed.render.geometry).toEqual(explicit.body.render.geometry);
    } finally {
      if (previousTasks === undefined) delete process.env.TUTOR_VNEXT_TASKS;
      else process.env.TUTOR_VNEXT_TASKS = previousTasks;
    }
  });
});
