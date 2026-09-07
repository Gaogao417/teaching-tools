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
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "../../../db/database";
import { realCanonicalRoot } from "../../../services/tutorNavigator/__tests__/navigatorSupport";
import { createVNextTutorRoutes } from "../vnextTutorRoutes";
import { vNextGateModel } from "../../../services/tutorOrchestration/VNextGateModelFactory";
import { TutorSessionOrchestratorV6 } from "../../../services/tutorOrchestration/TutorSessionOrchestratorV6";
import { actionSubmissionHttpV1Schema, parseSessionSnapshotHttp } from "../../../../../shared/tutorHttpProfile";
import { composeRenderGeometryV7 } from "../../../services/tutorOrchestration/V7HttpSnapshotProjector";

/** 事件行数 oracle（安全负例/observe-only 的零事实判定）。 */
function eventCount(sessionId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id = ?").get(sessionId) as { n: number }).n;
}

/** 真值泄漏扫描：递归键黑名单 + 已知答案字符串缺席（start 快照面）。 */
function assertNoTruthLeak(payload: unknown): void {
  const forbiddenKeys = new Set(["answer", "canonical_answer", "solution", "truth", "answer_key"]);
  const forbiddenValues = ["\\frac{16}{5}", "\\frac{32}{15}", "2\\sqrt{3}"];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (forbiddenKeys.has(key.toLowerCase())) throw new Error(`truth-leak key: ${key}`);
        visit(value);
      }
      return;
    }
    if (typeof node === "string") {
      for (const value of forbiddenValues) {
        if (node.includes(value)) throw new Error(`truth-leak value: ${value}`);
      }
    }
  };
  visit(payload);
}

let baseUrl = "";
/** 旅程→resume 两用例间的共享会话（模块级显式依赖，非 env 全局）。 */
let sharedJourneySessionId: string | undefined;
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

it("Step 5 真实 HTTP client → golden route：start/restore/呈现/输入/evidence 全链", async () => {
  // Browser module is loaded by Vitest/Vite, not emitted into the CommonJS
  // backend build (it reads import.meta.env).
  const clientModulePath = resolve(__dirname, "../../../../../frontend/src/api/tutorRuntimeClient.ts");
  const { HttpTutorRuntimeClient } = await import(clientModulePath);
  const client = new HttpTutorRuntimeClient(baseUrl);
  expect((await client.availability("goldenMinhangFold2020")).enabled).toBe(true);
  const input = { taskId: "goldenMinhangFold2020", studentId: "step5-http-client", clientRequestId: "step5-http-start" };
  let snapshot = await client.start(input);
  const id = snapshot.session_id;
  const initialCount = eventCount(id);
  expect((await client.start(input)).session_id).toBe(id);
  expect(await client.restore(id)).toEqual(snapshot);
  expect(eventCount(id)).toBe(initialCount);
  let testedLostInput = false;
  for (let i = 0; i < 64 && !snapshot.active_action; i++) {
    const pending = snapshot.pending_presentation;
    if (!pending && !testedLostInput) {
      const input = snapshot.views.participation.kind === "confirm_input"
        ? { kind: "control", command: "confirm" }
        : { kind: "utterance", channel: "mainline", text: "子母型相似，对应边成比例" };
      const revision = snapshot.revision;
      const nativeFetch = globalThis.fetch;
      let lostResponse: unknown;
      const lost = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (...args) => {
        const response = await nativeFetch(...args);
        expect(response.ok).toBe(true);
        lostResponse = await response.json();
        throw new TypeError("simulated response lost after commit");
      });
      try {
        await expect(client.submitStudentInput(id, input, revision, "step5-lost-input")).rejects.toThrow("response lost");
      } finally { lost.mockRestore(); }
      const committedCount = eventCount(id);
      const restored = await client.restore(id);
      expect(restored.revision).toBeGreaterThan(revision);
      snapshot = await client.submitStudentInput(id, input, revision, "step5-lost-input");
      expect(snapshot).toEqual(lostResponse);
      expect(snapshot.revision).toBe(restored.revision);
      expect(snapshot.views).toEqual(restored.views);
      expect(snapshot.render).toEqual(restored.render);
      expect(eventCount(id)).toBe(committedCount);
      await expect(client.submitStudentInput(id, { kind: "utterance", channel: "mainline", text: "changed payload" }, revision, "step5-lost-input")).rejects.toMatchObject({ status: 409, code: "REQUEST_PAYLOAD_DRIFT" });
      expect(eventCount(id)).toBe(committedCount);
      testedLostInput = true;
      continue;
    }
    snapshot = pending
      ? await client.reportPresentationOutcome(id, pending.action_id, { sequenceId: pending.sequence_id, ordinal: pending.ordinal, outcome: "presented", expectedRevision: snapshot.revision, clientRequestId: `step5-present-${i}` })
      : await client.submitStudentInput(id, snapshot.views.participation.kind === "confirm_input"
        ? { kind: "control", command: "confirm" }
        : { kind: "utterance", channel: "mainline", text: "子母型相似，对应边成比例" }, snapshot.revision, `step5-input-${i}`);
  }
  expect(snapshot.active_action).toBeDefined();
  expect(testedLostInput).toBe(true);
  const evidence = { actionId: snapshot.active_action!.action_id, sourceStepId: "BT-04", kind: "mark-segment-values", version: 1, values: { "seg-AO": "9", "seg-DO": "9", "seg-BO": "9", "seg-OE": "9" } };
  const before = eventCount(id);
  const wrong = await client.submitActionEvidence(id, { evidence, expectedRevision: snapshot.revision, clientRequestId: "step5-wrong" });
  expect(wrong.actionSubmission.status).toBe("evidence-rejected");
  expect(wrong.snapshot.revision).toBe(snapshot.revision);
  expect(eventCount(id)).toBe(before);
  const right = await client.submitActionEvidence(id, { evidence: { ...evidence, values: { "seg-AO": "\\frac{16}{5}", "seg-DO": "\\frac{32}{15}", "seg-BO": "\\frac{6}{5}", "seg-OE": "\\frac{4}{5}" } }, expectedRevision: snapshot.revision, clientRequestId: "step5-right" });
  expect(right.actionSubmission.status).toBe("workspace-committed");
  expect(right.snapshot.active_action).toBeUndefined();
  expect(eventCount(id)).toBeGreaterThan(before);
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

/** mutation 成功响应（同型 SessionSnapshot）以共享 schema + 一致性门禁独立验收。 */
function expectSnapshotBody(body: unknown): void {
  const parsed = parseSessionSnapshotHttp(body);
  expect(parsed.ok).toBe(true);
}

/** action-evidence 成功响应 = 同型 Snapshot + action_submission（两者分别过共享 schema）。 */
function expectActionEvidenceResponse(body: unknown): void {
  const { action_submission, ...snapshot } = body as Record<string, unknown>;
  const parsed = parseSessionSnapshotHttp(snapshot);
  expect(parsed.ok).toBe(true);
  expect(actionSubmissionHttpV1Schema.safeParse(action_submission).success).toBe(true);
}

async function getSnapshot(sessionId: string): Promise<Snapshot> {
  const response = await call("GET", `/api/vnext/tutor-sessions/${sessionId}`);
  expect(response.status).toBe(200);
  // 响应以共享 schema + 一致性门禁独立验收（不信任手写类型断言）。
  const parsed = parseSessionSnapshotHttp(response.body);
  expect(parsed.ok).toBe(true);
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
    assertNoTruthLeak(snapshot);
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
    sharedJourneySessionId = snapshot.session_id;
  });

  it("golden 旅程：presented 逐项推进 → confirm/utterance → BT-04 evidence 错值拒/对值 committed → completed", async () => {
    const sessionId = sharedJourneySessionId!;
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
    const eventsBeforeWrong = eventCount(sessionId);
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
    expect(eventCount(sessionId)).toBe(eventsBeforeWrong);
    // 正确四值 → workspace-committed（verified-correct 过 GT-04）→ BT-05。
    const right = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/action-evidence`, {
      evidence: {
        actionId: bt04Action.action_id, sourceStepId: "BT-04", kind: "mark-segment-values", version: 1,
        values: { "seg-AO": "\\frac{16}{5}", "seg-DO": "\\frac{32}{15}", "seg-BO": "\\frac{6}{5}", "seg-OE": "\\frac{4}{5}" },
      },
      expected_revision: revisionBefore, client_request_id: "rv7-cc-right",
    });
    expectActionEvidenceResponse(right.body);
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

  it("GET resume 零副作用（verified rebuild：事件行数不变 + 完整快照逐字段一致）", async () => {
    const sessionId = sharedJourneySessionId!;
    const before = await getSnapshot(sessionId);
    const eventsBefore = eventCount(sessionId);
    const restored = await getSnapshot(sessionId);
    expect(restored.completed).toBe(true);
    expect(restored.views.status.session_revision).toBe(restored.revision);
    expect(restored.question.stem).toContain("翻折");
    expect(restored.pending_presentation).toBeUndefined();
    expect(eventCount(sessionId)).toBe(eventsBefore);
    expect(restored).toEqual(before);
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
    // Settle the Inquiry presentation before admitting its answer.
    await presentAll(sessionId);
    const branchReady = await getSnapshot(sessionId);
    // 分支内作答（inquiry 语境 mainline utterance；脚本 Gate pass）→ 分支推进。
    const branchAnswer = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
      input: { kind: "utterance", channel: "mainline", text: "我卡在第一组子母型" },
      client_request_id: "rv7-iq-2", expected_revision: branchReady.revision,
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

  it("ASR：observe-only（415/413/422 + 前后 revision 与事件行数均不变；响应携带 observed_revision）", async () => {
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
    const revisionBeforeAsr = (await getSnapshot(sessionId)).revision;
    const eventsBeforeAsr = eventCount(sessionId);
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
          expect(body.observed_revision).toBe(revisionBeforeAsr);
          expect(body.transcript).toContain("16");
          // 真实 MediaRecorder 上报完整 mime（含 codecs 参数）：归一化后按容器
          // 类型对白名单——Chromium webm;codecs=opus 与 Safari mp4 均可过，
          // 非音频容器（带参数）仍 415（真人验收发现回归）。
          const codecWebm = await fetch(`http://127.0.0.1:${address.port}${base}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: { data_url: "data:audio/webm;codecs=opus;base64,QUJD", mime_type: "audio/webm;codecs=opus" }, client_request_id: "rv7-asr-5" }),
          });
          expect(codecWebm.status).toBe(200);
          const codecMp4 = await fetch(`http://127.0.0.1:${address.port}${base}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: { data_url: "data:audio/mp4;codecs=mp4a.40.2;base64,QUJD", mime_type: "audio/mp4;codecs=mp4a.40.2" }, client_request_id: "rv7-asr-6" }),
          });
          expect(codecMp4.status).toBe(200);
          const badMimeWithParams = await fetch(`http://127.0.0.1:${address.port}${base}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: { data_url: "data:text/plain; charset=utf-8;base64,eA==", mime_type: "text/plain; charset=utf-8" }, client_request_id: "rv7-asr-7" }),
          });
          expect(badMimeWithParams.status).toBe(415);
          // observe-only：两次 ASR（422 + 200）后 revision 与事件行数都不变。
          expect((await getSnapshot(sessionId)).revision).toBe(revisionBeforeAsr);
          expect(eventCount(sessionId)).toBe(eventsBeforeAsr);
          await new Promise<void>((done) => stubServer.close(() => done()));
          resolve();
        })();
      });
    });
  });

  it("P0 workspace-commands 正向安全链（teaching）：错误命令 completed 但 Gate 不满足；幂等零事件；漂移 409；正确命令过门；causation 对账", async () => {
    const started = await call("POST", "/api/vnext/tutor-sessions", {
      student_id: "route-v7-wc", task_id: "goldenMinhangFold2020", client_request_id: "rv7-start-wc",
    });
    const sessionId = started.body.session_id;
    // 走到 BT-04 workspace_input（与 golden 旅程同型）。
    await advanceUntil(sessionId, (current) => current.views.participation.kind === "answer_input", [
      { input: { kind: "control", command: "confirm" }, client_request_id: "rv7-wc-c1" },
    ]);
    for (const step of [2, 3]) {
      const current = await getSnapshot(sessionId);
      const answered = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
        input: { kind: "utterance", channel: "mainline", text: "子母型相似，对应边成比例" },
        client_request_id: `rv7-wc-a${step}`, expected_revision: current.revision,
      });
      expect(answered.status).toBe(200);
      await presentAll(sessionId);
    }
    const atBt04 = await advanceUntil(
      sessionId,
      (current) => current.views.participation.kind === "workspace_input" && current.active_action !== undefined,
      [],
    );
    const targets = atBt04.active_action!.target_ids;
    const commandOf = (suffix: string, values: Record<string, string>) => {
      const current = atBt04;
      return {
        schema: "ai_teaching_student_workspace_command/v1",
        session_id: sessionId,
        command_id: `SC-rv7-wc-${suffix}`,
        surface: "geometry",
        capability: "similarity.mark-known-segments",
        origin: "student",
        target_ids: targets,
        expected_workspace_revision: current.render.workspace_revision,
        client_command_id: `rv7-wc-cc-${suffix}`,
        params: { values },
      };
    };
    // 值键 = 线段短名（evidenceToWorkspaceCommand 同口径：seg-AO → AO）。
    const wrongValues = Object.fromEntries(targets.map((id) => [id.replace(/^seg-/, ""), "1"]));

    // ① 错误命令：F3 completed（合法命令）+ evaluator verified-wrong → Gate 不满足（仍 workspace_input）。
    const eventsBefore = eventCount(sessionId);
    const wrongCommand = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/workspace-commands`, {
      command: commandOf("wrong", wrongValues), expected_revision: atBt04.revision,
    });
expect(wrongCommand.status).toBe(200);
    expectSnapshotBody(wrongCommand.body);
    expect((wrongCommand.body as Snapshot).views.participation.kind).toBe("workspace_input");
    expect(eventCount(sessionId)).toBeGreaterThanOrEqual(eventsBefore + 4); // 命令事实 + 回执 + gate + decision（+ 重锚定呈现）
    // causation 对账：回执事件 causation_sequence == 命令事实事件 sequence。
    const rows = db.prepare(
      "SELECT sequence, event_type, causation_sequence, payload_json FROM tutor_session_events WHERE session_id = ? AND sequence > ? ORDER BY sequence",
    ).all(sessionId, eventsBefore) as Array<{ sequence: number; event_type: string; causation_sequence: number | null; payload_json: string }>;
    const factRow = rows.find((row) => row.event_type === "student_workspace_command_recorded");
    const receiptRow = rows.find((row) => row.event_type === "action_outcome_recorded");
    expect(factRow).toBeDefined();
    expect(receiptRow).toBeDefined();
    expect(receiptRow!.causation_sequence).toBe(factRow!.sequence);
    expect((JSON.parse(factRow!.payload_json) as { source?: string }).source).toBe("direct");
    expect((JSON.parse(receiptRow!.payload_json) as { outcome?: string }).outcome).toBe("completed");

    // ② 幂等重放：同 client_command_id 同 payload → 零新事件、零推进。
    const eventsBeforeReplay = eventCount(sessionId);
    const replay = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/workspace-commands`, {
      command: commandOf("wrong", wrongValues), expected_revision: (await getSnapshot(sessionId)).revision,
    });
    expect(replay.status).toBe(200);
    expect(eventCount(sessionId)).toBe(eventsBeforeReplay);

    // ③ 载荷漂移：同 client_command_id 异 payload → 409 WORKSPACE_COMMAND_PAYLOAD_DRIFT（零事件）。
    const drift = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/workspace-commands`, {
      command: { ...commandOf("wrong", wrongValues), command_id: "SC-rv7-wc-drift", params: { values: { ...wrongValues, [targets[0]]: "999" } } },
      expected_revision: (await getSnapshot(sessionId)).revision,
    });
    expect(drift.status).toBe(409);
    expect(drift.body.error.code).toBe("WORKSPACE_COMMAND_PAYLOAD_DRIFT");
    expect(eventCount(sessionId)).toBe(eventsBeforeReplay);

    // ④ 错误命令后的重锚定呈现可正常走完（错误不毒化会话）。
    const presentedAfterWrong = await presentAll(sessionId);
    expect(presentedAfterWrong).toBeGreaterThan(0);
  });

  it("P0 workspace-commands 正确命令（teaching，全新会话）：verified-correct 过 GT-04 → BT-05", async () => {
    const started = await call("POST", "/api/vnext/tutor-sessions", {
      student_id: "route-v7-wc2", task_id: "goldenMinhangFold2020", client_request_id: "rv7-start-wc2",
    });
    const sessionId = started.body.session_id;
    await advanceUntil(sessionId, (current) => current.views.participation.kind === "answer_input", [
      { input: { kind: "control", command: "confirm" }, client_request_id: "rv7-wc2-c1" },
    ]);
    for (const step of [2, 3]) {
      const current = await getSnapshot(sessionId);
      const answered = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/student-inputs`, {
        input: { kind: "utterance", channel: "mainline", text: "子母型相似，对应边成比例" },
        client_request_id: `rv7-wc2-a${step}`, expected_revision: current.revision,
      });
      expect(answered.status).toBe(200);
      await presentAll(sessionId);
    }
    const atBt04 = await advanceUntil(
      sessionId,
      (current) => current.views.participation.kind === "workspace_input" && current.active_action !== undefined,
      [],
    );
    const targets = atBt04.active_action!.target_ids;
    const rightValues: Record<string, string> = { AO: "\\frac{16}{5}", DO: "\\frac{32}{15}", BO: "\\frac{6}{5}", OE: "\\frac{4}{5}" };
    // 直接命令正确值：与 evidence 派生命令同一 pinned evaluator/Gate 链 → verified-correct。
    const rightCommand = await call("POST", `/api/vnext/tutor-sessions/${sessionId}/workspace-commands`, {
      command: {
        schema: "ai_teaching_student_workspace_command/v1",
        session_id: sessionId,
        command_id: "SC-rv7-wc2-right",
        surface: "geometry",
        capability: "similarity.mark-known-segments",
        origin: "student",
        target_ids: targets,
        expected_workspace_revision: atBt04.render.workspace_revision,
        client_command_id: "rv7-wc2-cc-right",
        params: { values: rightValues },
      },
      expected_revision: atBt04.revision,
    });
    expect(rightCommand.status).toBe(200);
    expectSnapshotBody(rightCommand.body);
    expect((rightCommand.body as Snapshot).turn?.status).toBe("committed");
    const atBt05 = await advanceUntil(sessionId, (current) => current.views.participation.kind === "answer_input", []);
    expect(atBt05.views.participation.gate_id).toBe("GT-05");
  });

  it("P0 render fail-closed：合成失败抛 V7RenderProjectionError，不回退题图（composeRenderGeometryV7 单元负例）", () => {
    // committed tutor 命令引用 base 题图不存在的线段 → applyDomainCommands 抛
    // missing-reference → fail closed（服务端 revision 已前进时绝不下发旧题图）。
    const base = { points: [{ id: "pt-A", x: 0, y: 0, label: "A" }], segments: [{ id: "seg-AB", from: "pt-A", to: "pt-A" }] };
    const goodFold = { state: { revision: 0 }, context: { tutorCommands: [] } } as never;
    expect(composeRenderGeometryV7(goodFold, base)).toEqual(base);
    const badCommand = {
      commandId: "DC-bad-1", actionId: "WSA-bad-1", type: "set-segment-label",
      segmentId: "seg-NOT-IN-BASE", markId: "mk-1", valueLatex: "x", labelKind: "length",
    };
    const badFold = { state: { revision: 1 }, context: { tutorCommands: [badCommand] } } as never;
    expect(() => composeRenderGeometryV7(badFold, base)).toThrowError(/fail closed, no snapshot/);
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
