/**
 * F6 G6 门禁测试（node 链）：Orchestrator、Presenter 与统一 Projection 集成。
 *
 * 覆盖 f6-scope-ledger「退出门禁」+ 计划 §5 F6 G6（全部经真实公开入口——
 * TutorSessionOrchestratorV5（start/resume/submitStudentIntent/submitWorkspaceCommand/
 * executePresentationPlan）与 F3/F5 既有公开 API；负例不绕道内部纯函数冒充
 * fail-closed 证明）。Plan 输入 = F4 importer 真实 Approved 链（TP-SMV-009@v1，
 * 同 G5 口径）；自然语言 Gate 判卷人 = 固定响应 provider（R3 4B 口径）。
 *
 * 1. 完整 headless 旅程（start → confirm → workspace command+committed outcome →
 *    模型裁决 gate → final completion → rebuild/resume → live/replay 语义一致）
 *    + 每个 visible delta 因果链（decision→Beat→action/command→outcome→revision→
 *    view delta）逐跳断言；
 * 2. approved inquiry/scaffold 打开与显式返回（主线冻结+返回点可见）；
 * 3. 负例矩阵（任务列举全集）：stale revision / duplicate id / 伪造 gate（GT-99、
 *    future/stale、伪造 evidence）/ 模型 timeout+非法 JSON+候选外 / Voice
 *    interrupted+failed / Workspace partial failure / action 顺序与因果错误 /
 *    capability+target+mode+truth-leak 拒绝 / catalog+Plan+model pin mismatch /
 *    Assessment 禁用动作 / 损坏流 resume 拒绝 / final 未满足 Gate 不 reveal /
 *    同一 committed 判断 replay 不再调模型；
 * 4. canonical fixtures 消费（presentation-plan/coach-panel-view/mainline-
 *    participation 正负 + model_gate_pin 负例）。
 */
import assert from "node:assert/strict";
import type { FixedResponseGateProvider, GateAdjudicationProvider } from "../../tutorNavigator/ModelGateAdjudicatorV5";
import type { TutorSessionOrchestratorV5 as Orchestrator } from "../TutorSessionOrchestratorV5";
import type { StoredV5Event } from "../../tutorSession/TutorSessionEventV5";

import {
  ANSWER_GOAL_OK,
  ANSWER_INVARIANTS_OK,
  ANSWER_INVARIANTS_WRONG,
  ensureF6Sqlite,
  f6Model,
  GOLDEN,
  markKnownSegmentsCommand,
  QUESTION_IN_BOUND,
  readFixtureJson,
  realCanonicalRoot,
  SCAFFOLD_STEP1_OK,
} from "./f6Support";

ensureF6Sqlite();

const { db } = require("../../../db/database") as typeof import("../../../db/database");
const canonical = require("../../../../../shared/canonical") as typeof import("../../../../../shared/canonical");
const orchestratorModule = require("../TutorSessionOrchestratorV5") as typeof import("../TutorSessionOrchestratorV5");
const presenterModule = require("../TutorPresenterV5") as typeof import("../TutorPresenterV5");
const catalogModule = require("../GoldenWorkspaceCatalog") as typeof import("../GoldenWorkspaceCatalog");
const workspaceRuntimeModule = require("../../tutorSession/WorkspaceSessionRuntimeV5") as typeof import("../../tutorSession/WorkspaceSessionRuntimeV5");
const navigatorSessionModule = require("../../tutorNavigator/NavigatorSessionV5") as typeof import("../../tutorNavigator/NavigatorSessionV5");
const adjudicatorModule = require("../../tutorNavigator/ModelGateAdjudicatorV5") as typeof import("../../tutorNavigator/ModelGateAdjudicatorV5");
const storeModule = require("../../tutorSession/TutorSessionEventStoreV5") as typeof import("../../tutorSession/TutorSessionEventStoreV5");

const { TutorSessionOrchestratorV5, OrchestratorError } = orchestratorModule;
const { HangingGateProvider, UnavailableGateProvider } = adjudicatorModule;
const FixedResponseGateProviderCtor = adjudicatorModule.FixedResponseGateProvider as new (responses: readonly string[], name?: string) => FixedResponseGateProvider;
const { buildGoldenWorkspaceCatalogV5 } = catalogModule;

const ROOT = realCanonicalRoot();
const PASS_GT03 = JSON.stringify({ response_kind: "final_answer", matched_gate_id: "GT-03", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-05"], brief_reason: "ok" });
const PASS_GT04 = JSON.stringify({ response_kind: "final_answer", matched_gate_id: "GT-04", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-08"], brief_reason: "ok" });

function journeyProvider(): FixedResponseGateProvider {
  return new FixedResponseGateProviderCtor([PASS_GT03, PASS_GT04], "fixed-f6-journey");
}

function startOrchestrator(sessionId: string, provider: FixedResponseGateProvider, options: { assessment?: boolean } = {}): Orchestrator {
  return TutorSessionOrchestratorV5.start({
    sessionId,
    studentId: "student-f6",
    canonicalRoot: ROOT,
    model: f6Model(provider, `fixed-response/${provider.name}`),
    ...(options.assessment ? { assessment: true } : {}),
  });
}

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function eventsOf(sessionId: string): StoredV5Event[] {
  return storeModule.readTutorSessionEventsV5(sessionId);
}

function countEvents(sessionId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id = ?").get(sessionId) as { n: number }).n;
}

const insertRawEvent = db.prepare(`
  INSERT INTO tutor_session_events
    (session_id, sequence, event_type, payload_json, occurred_at, idempotency_key, recorded_revision, recorded_at, causation_sequence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

/** 测试侧直写（模拟存储篡改/崩溃窗口——生产代码对事件表只 INSERT/SELECT）。 */
function insertRaw(sessionId: string, eventType: string, payload: Record<string, unknown>, causation: number): void {
  const rowRevision = Number((db.prepare("SELECT revision AS r FROM tutor_sessions WHERE session_id = ?").get(sessionId) as { r: number }).r);
  const nextSeq = countEvents(sessionId) + 1;
  insertRawEvent.run(sessionId, nextSeq, eventType, JSON.stringify(payload), new Date().toISOString(), `f6-tamper-${sessionId}-${nextSeq}`, rowRevision + 1, new Date().toISOString(), causation);
  db.prepare("UPDATE tutor_sessions SET revision = ? WHERE session_id = ?").run(rowRevision + 1, sessionId);
}

/** 逐事件因果审计：每个 voice issued 锚定 committed 决策且 Beat 对齐；outcome causation→issued。 */
function auditCausalityChain(sessionId: string): void {
  const events = eventsOf(sessionId);
  const decisions = new Map<number, { decision_id: string; beat_id: string }>();
  for (const event of events) {
    if (event.event_type === "policy_decision_made") {
      decisions.set(event.sequence, event.payload as { decision_id: string; beat_id: string });
    }
  }
  const issuedVoices = new Map<number, { action_id: string; decision_id: string; beat_id?: string }>();
  for (const event of events) {
    if (event.event_type === "voice_action_issued") {
      const payload = event.payload as { action_id: string; decision_id: string; beat_id?: string };
      const anchor = [...decisions.values()].find((decision) => decision.decision_id === payload.decision_id);
      assert.ok(anchor, `voice ${payload.action_id} must reference a committed decision (${payload.decision_id})`);
      if (payload.beat_id !== undefined) {
        assert.equal(payload.beat_id, anchor.beat_id, `voice ${payload.action_id} beat must match its decision beat`);
      }
      issuedVoices.set(event.sequence, payload);
    } else if (event.event_type === "workspace_surface_action_issued") {
      const payload = event.payload as { action_id: string; decision_id: string; beat_id?: string };
      const anchor = [...decisions.values()].find((decision) => decision.decision_id === payload.decision_id);
      assert.ok(anchor, `workspace action ${payload.action_id} must reference a committed decision`);
    } else if (event.event_type === "action_outcome_recorded") {
      const payload = event.payload as { action_id: string; action_kind: string; outcome: string };
      let hasIssuer = false;
      for (const other of events) {
        if (other.sequence >= event.sequence) break;
        if (payload.action_kind === "voice" && other.event_type === "voice_action_issued") {
          hasIssuer = (other.payload as { action_id: string }).action_id === payload.action_id || hasIssuer;
        }
        if (payload.action_kind === "workspace_surface" && other.event_type === "workspace_surface_action_issued") {
          hasIssuer = (other.payload as { action_id: string }).action_id === payload.action_id || hasIssuer;
        }
        if (payload.action_kind === "student_command" && other.event_type === "student_intent_recorded") {
          hasIssuer = (other.payload as { workspace_command?: { command_id: string } }).workspace_command?.command_id === payload.action_id || hasIssuer;
        }
      }
      assert.ok(hasIssuer, `outcome for ${payload.action_id} must reference an earlier issued action/intent`);
      assert.ok(event.causation_sequence !== undefined, "outcome facts require causation_sequence");
    }
  }
  for (const event of events) {
    assert.deepEqual(canonical.validatePayload(event), { ok: true, errors: [] }, `event seq ${event.sequence} fails canonical v5`);
  }
}

// --------------------------------------------------------------------------- //

async function main(): Promise<void> {
  await runTest("G6 journey: start pins plan+catalog+model, presents BT-01 (voice completed -> awaiting confirmation)", async () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7001", provider);
    const started = eventsOf("TS-7001")[0].payload as {
      workspace_catalog_pin?: { content_hash: string };
      model_gate_pin?: { provider: string };
      tutor_plan_ref: { artifact_id: string };
    };
    assert.equal(started.tutor_plan_ref.artifact_id, GOLDEN.tpId);
    assert.ok(started.workspace_catalog_pin?.content_hash.startsWith("sha256:"), "session_started must pin the server-computed catalog");
    assert.equal(started.model_gate_pin?.provider, "fixed-response/fixed-f6-journey", "session_started must pin the injected gate model");
    const projection = orch.projectUnifiedViews();
    assert.deepEqual(projection.coachPanelView.mainline, { kind: "awaiting_confirmation", beat_id: "BT-01", gate_id: "GT-01" });
    assert.deepEqual(projection.participation, { kind: "confirm_input", gate_id: "GT-01" });
    assert.equal(projection.studentWorkspaceView.revision, 0);
    assert.equal(projection.coachPanelView.transcript.length, 1, "opening narration visible");
    assert.ok(projection.coachPanelView.transcript[0].content.includes("翻折"), "voice text comes from approved resource RES1");
    assert.equal(projection.status.completed, false);
    // voice completed 已把相位推进 awaiting_evidence（呈现完成=开始等学生证据）。
    assert.equal(orch.state.teaching_cursor.phase, "awaiting_evidence");
    auditCausalityChain("TS-7001");
  });

  await runTest("G6 journey full: confirm -> committed workspace outcome -> model gates -> completion, every visible delta traceable", async () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7002", provider);
    // BT-01 confirm → transition BT-02 + presentation (voice RES2 + reveal BE-04)。
    const confirmTurn = await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7002-1" });
    assert.equal(confirmTurn.turn.decision?.decision_kind, "transition_beat");
    assert.equal(confirmTurn.turn.decision?.to_beat_id, "BT-02");
    assert.equal(confirmTurn.presentations.length, 1, "transition realizes the new beat via executeCurrentBeat + presenter");
    const afterConfirm = orch.projectUnifiedViews();
    assert.deepEqual(afterConfirm.coachPanelView.mainline, { kind: "awaiting_workspace", beat_id: "BT-02", gate_id: "GT-02", action_id: "similarity.mark-known-segments" });
    assert.deepEqual(afterConfirm.participation, { kind: "workspace_input", gate_id: "GT-02" });
    assert.equal(afterConfirm.studentWorkspaceView.revision, 1, "reveal BE-04 (FN-04 intermediate) advanced workspace revision");
    const revealed = afterConfirm.studentWorkspaceView.solution_board.groups.flatMap((group) => group.entries.map((entry) => entry.entry_id));
    assert.deepEqual(revealed, ["BE-04"], "only the beat's intermediate entry is revealed");
    // BT-02 学生命令（真实 F3 提交路径）→ committed outcome → GT-02 satisfied → BT-03。
    const commandTurn = orch.submitWorkspaceCommand(markKnownSegmentsCommand({
      sessionId: "TS-7002", commandId: "SC-TS-7002-0001", clientCommandId: "cc-7002-1", expectedWorkspaceRevision: 1,
    }));
    assert.equal(commandTurn.turn.decision?.decision_kind, "transition_beat");
    assert.equal(commandTurn.turn.decision?.to_beat_id, "BT-03");
    const outcome = eventsOf("TS-7002").find(
      (event) => event.event_type === "action_outcome_recorded" && (event.payload as { action_id: string }).action_id === "SC-TS-7002-0001",
    );
    assert.ok(outcome, "student command committed outcome");
    assert.equal((outcome!.payload as { resulting_revision?: number }).resulting_revision, 2);
    const gate = eventsOf("TS-7002").find((event) => event.event_type === "gate_evaluated" && (event.payload as { gate_id: string }).gate_id === "GT-02");
    assert.deepEqual(
      { ...(gate!.payload as object) },
      { gate_id: "GT-02", beat_id: "BT-02", satisfied: true, evidence_sequence: outcome!.sequence },
      "gate satisfaction references the committed outcome sequence (causality)",
    );
    // BT-03/BT-04 自然语言 gate：固定响应模型裁决（每次一次调用）。
    await orch.submitStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-7002-3" });
    assert.equal(orch.state.teaching_cursor.beat_id, "BT-04");
    assert.equal(provider.callCount, 1);
    await orch.submitStudentIntent({ intent_kind: "submit_answer", text: ANSWER_GOAL_OK, client_request_id: "cr-7002-4" });
    assert.equal(orch.state.teaching_cursor.beat_id, "BT-05");
    assert.equal(provider.callCount, 2);
    const afterAnswers = orch.projectUnifiedViews();
    const revealedEntries = afterAnswers.studentWorkspaceView.solution_board.groups.flatMap((group) => group.entries.map((entry) => entry.entry_id));
    assert.ok(revealedEntries.includes("BE-06") && revealedEntries.includes("BE-07"), "BT-04 intermediates revealed");
    assert.ok(!revealedEntries.includes("BE-08"), "final answer entry (FN-08) must NOT be revealed (no legal window; truth boundary)");
    // BT-05 final confirm → complete_beat + session_completed + locked review。
    const finalTurn = await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7002-5" });
    assert.equal(finalTurn.turn.decision?.decision_kind, "complete_beat");
    assert.equal(orch.state.completed, true);
    const completed = eventsOf("TS-7002").find((event) => event.event_type === "session_completed");
    assert.deepEqual(completed!.payload, { final_beat_id: "BT-05", completed_parts: ["1"] });
    const finalProjection = orch.projectUnifiedViews();
    assert.deepEqual(finalProjection.coachPanelView.mainline, { kind: "completed" });
    assert.deepEqual(finalProjection.participation, { kind: "read_only_completed" });
    assert.equal(finalProjection.studentWorkspaceView.canvas.interaction_enabled, false, "completed => locked review");
    assert.equal(finalProjection.status.completed, true);
    auditCausalityChain("TS-7002");
    // ---- rebuild/resume：live 与 replay 持久语义一致；零模型调用 ----
    const resumed = TutorSessionOrchestratorV5.resume({ sessionId: "TS-7002", canonicalRoot: ROOT, model: f6Model(provider, "fixed-response/fixed-f6-journey") });
    assert.deepEqual(resumed.state, orch.state, "rebuilt teaching state equals live state");
    assert.deepEqual(resumed.projectUnifiedViews(), finalProjection, "unified projection equals live projection (same reducer/projector)");
    assert.equal(provider.callCount, 2, "resume/replay never calls the model again");
  });

  await runTest("G6 inquiry: approved branch opens with frozen mainline + visible return checkpoint, returns explicitly", async () => {
    const provider = new FixedResponseGateProviderCtor([
      JSON.stringify({ response_kind: "question", verdict: "not_applicable", reasoning_location: "aligned", grounding_refs: ["FN-03"] }),
      JSON.stringify({ response_kind: "final_answer", matched_gate_id: "GT-01", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-01"] }),
    ], "fixed-f6-inquiry");
    const orch = startOrchestrator("TS-7003", provider);
    const opened = await orch.submitStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "cr-7003-1" });
    assert.equal(opened.turn.decision?.decision_kind, "open_inquiry");
    assert.equal(opened.turn.decision?.inquiry?.inquiry_protocol_id, GOLDEN.scaffoldProtocol);
    assert.equal(opened.turn.decision?.inquiry?.return_beat_id, "BT-01");
    const inInquiry = orch.projectUnifiedViews();
    assert.deepEqual(inInquiry.participation, { kind: "temporarily_paused_for_inquiry", return_checkpoint_id: "BT-01" });
    assert.equal(inInquiry.coachPanelView.inquiry.kind, "clarifying");
    assert.equal((inInquiry.coachPanelView.inquiry as { return_checkpoint_id: string }).return_checkpoint_id, "BT-01");
    assert.equal(orch.state.teaching_cursor.beat_id, "BT-01", "mainline cursor frozen");
    // 分支推进 + 返回（F5 轨迹：answer → confirm → confirm → return）。
    await orch.submitStudentIntent({ intent_kind: "submit_answer", text: SCAFFOLD_STEP1_OK, client_request_id: "cr-7003-2" });
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7003-3" });
    const returned = await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7003-4" });
    assert.equal(returned.turn.decision?.decision_kind, "return_to_mainline");
    assert.equal(returned.turn.decision?.to_beat_id, "BT-01");
    const after = orch.projectUnifiedViews();
    assert.deepEqual(after.coachPanelView.inquiry, { kind: "no_inquiry" });
    assert.equal(orch.state.teaching_cursor.beat_id, "BT-01");
    // 返回后相位=presenting（return_to_mainline 清 gate 重呈现——复述由下一轮 narration
    // 驱动 awaiting_evidence）；主线等待学生继续。
    assert.deepEqual(after.participation, { kind: "listen_only" });
    assert.deepEqual(after.coachPanelView.mainline, { kind: "presenting", beat_id: "BT-01" });
    auditCausalityChain("TS-7003");
  });

  await runTest("G6 negative: stale expected revision -> revision_conflict failure fact, zero teaching effect, category revision_conflict_failure", async () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7004", provider);
    const stale = await orch.submitStudentIntent(
      { intent_kind: "confirm", client_request_id: "cr-7004-1" },
      { expectedRevision: orch.revision - 1 },
    );
    assert.equal(stale.turn.failure?.failure_class, "revision_conflict");
    const projection = orch.projectUnifiedViews();
    assert.equal(projection.status.last_failure?.category, "revision_conflict_failure");
    assert.equal(orch.state.teaching_cursor.beat_id, "BT-01", "zero teaching effect");
    const failureEvent = eventsOf("TS-7004").find((event) => event.event_type === "runtime_failure");
    assert.equal((failureEvent!.payload as { failure_class: string }).failure_class, "revision_conflict");
    auditCausalityChain("TS-7004");
  });

  await runTest("G6 negative: duplicate client_request_id replays the committed judgment (no re-adjudication, no double writes)", async () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7005", provider);
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7005-1" });
    // BT-03 模型裁决轮后，同 client_request_id 重发。
    const before = { events: countEvents("TS-7005"), revision: orch.revision, cursor: orch.state.teaching_cursor.beat_id };
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7005-1" });
    assert.equal(countEvents("TS-7005"), before.events, "idempotent retry appends nothing");
    assert.equal(orch.revision, before.revision);
    assert.equal(orch.state.teaching_cursor.beat_id, before.cursor);
    // 自然语言轮：同 cr 重试不再调模型。
    const modelTurn = await orch.submitStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-7005-2" });
    void modelTurn;
    const callsAfterFirst = provider.callCount;
    await orch.submitStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-7005-2" });
    assert.equal(provider.callCount, callsAfterFirst, "duplicate natural-language turn does not re-adjudicate");
  });

  await runTest("G6 negative: forged gate via appendExternalFacts refused whole-batch (GT-99@current beat cannot pollute the F6 session)", async () => {
    // R3.1 写入边界在 F6 集成下仍封口（真实公开入口 NavigatorSession.appendExternalFacts）。
    const provider = new FixedResponseGateProviderCtor([], "fixed-boundary");
    const navigator = navigatorSessionModule.NavigatorSessionV5.start({
      sessionId: "TS-7006", studentId: "student-f6", canonicalRoot: ROOT,
      gateProvider: provider,
      sessionStartedPins: {
        workspace_catalog_pin: { catalog_schema_version: 1, content_hash: "sha256:" + "0".repeat(64), entry_count: 8 },
        model_gate_pin: f6Model(provider, "fixed-response/fixed-boundary").pin,
      },
    });
    const before = navigator.events.length;
    assert.throws(
      () => navigator.appendExternalFacts(navigator.revision, [
        { event_type: "gate_evaluated" as const, payload: { gate_id: "GT-99", beat_id: "BT-01", satisfied: true, evidence_sequence: 2 }, occurred_at: new Date().toISOString(), causation_sequence: 1 },
      ]),
      (error: unknown) => error instanceof navigatorSessionModule.NavigatorWriteBoundaryError,
    );
    assert.equal(navigator.events.length, before, "zero commit");
    assert.equal(navigator.state.teaching_cursor.phase, "presenting", "no pollution");
  });

  await runTest("G6 negative: forged/future/stale gate facts in the stream refuse orchestrator resume (plan-aware integrity)", async () => {
    const provider = journeyProvider();
    const forge = (sessionId: string, payload: Record<string, unknown>, evidenceSequence: number): void => {
      const orch = startOrchestrator(sessionId, provider);
      void orch;
      insertRaw(sessionId, "gate_evaluated", payload, evidenceSequence);
    };
    // (a) GT-99@BT-01（当前 Beat、伪造 gate_id——候选外绑定）。
    forge("TS-7007", { gate_id: "GT-99", beat_id: "BT-01", satisfied: true, evidence_sequence: 2 }, 2);
    assert.throws(
      () => TutorSessionOrchestratorV5.resume({ sessionId: "TS-7007", canonicalRoot: ROOT, model: f6Model(provider, "fixed-response/fixed-f6-journey") }),
      (error: unknown) => error instanceof navigatorSessionModule.NavigatorResumeIntegrityError && error.code === "PLAN_GATE_BINDING_MISMATCH",
    );
    // (b) 未来 Beat 的 gate（BT-04@GT-04 于 BT-01 时点）→ reducer wrong-beat fail closed。
    forge("TS-7008", { gate_id: "GT-04", beat_id: "BT-04", satisfied: true, evidence_sequence: 2 }, 2);
    assert.throws(
      () => TutorSessionOrchestratorV5.resume({ sessionId: "TS-7008", canonicalRoot: ROOT, model: f6Model(provider, "fixed-response/fixed-f6-journey") }),
      (error: unknown) => (error as { code?: string }).code === "GATE_BEAT_MISMATCH",
    );
    // (c) satisfied 但 evidence_sequence 指向不存在事件（伪造证据链；GT-01 是
    // student_confirmation——合法候选，伪造证据指向 999）。
    forge("TS-7009", { gate_id: "GT-01", beat_id: "BT-01", satisfied: true, evidence_sequence: 999 }, 2);
    assert.throws(
      () => TutorSessionOrchestratorV5.resume({ sessionId: "TS-7009", canonicalRoot: ROOT, model: f6Model(provider, "fixed-response/fixed-f6-journey") }),
      (error: unknown) => error instanceof navigatorSessionModule.NavigatorResumeIntegrityError && error.code === "GATE_EVIDENCE_FORGED",
    );
  });

  await runTest("G6 negative: model timeout / invalid JSON / out-of-candidate gate degrade unclear with runtime/model failure (never student incorrect, never pass)", async () => {
    const cases: Array<{ name: string; provider: GateAdjudicationProvider; timeoutMs?: number }> = [
      { name: "timeout", provider: new HangingGateProvider(), timeoutMs: 150 },
      { name: "invalid-json", provider: new FixedResponseGateProviderCtor(["not json at all"], "fixed-badjson") },
      { name: "gate-not-in-candidates", provider: new FixedResponseGateProviderCtor([JSON.stringify({ response_kind: "final_answer", matched_gate_id: "GT-99", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-05"] })], "fixed-gt99") },
      { name: "unavailable-provider", provider: new UnavailableGateProvider() },
    ];
    for (const [index, testCase] of cases.entries()) {
      const sessionId = `TS-701${index}`;
      const orch = TutorSessionOrchestratorV5.start({
        sessionId, studentId: "student-f6", canonicalRoot: ROOT,
        model: f6Model(testCase.provider, `case/${testCase.name}`),
        ...(testCase.timeoutMs !== undefined ? { modelTimeoutMs: testCase.timeoutMs } : {}),
      });
      await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: `cr-${sessionId}-1` });
      const turn = await orch.submitStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: `cr-${sessionId}-2` });
      assert.equal(orch.state.teaching_cursor.beat_id, "BT-02", `${testCase.name}: no beat advance on model failure`);
      const projection = orch.projectUnifiedViews();
      assert.equal(projection.status.last_failure?.category, "model_runtime_failure", `${testCase.name}: classified as model/runtime failure`);
      assert.notEqual(projection.status.last_failure?.category, "student_incorrect", `${testCase.name}: model failure must not be recorded as student incorrect`);
      const failure = eventsOf(sessionId).find((event) => event.event_type === "runtime_failure");
      assert.ok(failure, `${testCase.name}: runtime_failure fact committed`);
      assert.ok((failure!.payload as { message: string }).message.startsWith("gate_adjudicator_model_failure"), `${testCase.name}: failure family marker`);
      assert.notEqual(turn.turn.decision?.decision_kind, "transition_beat");
      auditCausalityChain(sessionId);
    }
  });

  await runTest("G6 negative: voice interrupted in the crash window closes as interrupted (zero completion side effects) and recovery is visible", async () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7020", provider);
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7020-1" });
    // 崩溃窗口模拟：真实提交路径只落 voice issued（两批 append 之间崩溃——生产代码
    // 对事件表只 INSERT，测试直写同型）。锚定最新 execute_beat 决策。
    const anchor = [...eventsOf("TS-7020")].reverse().find((event) => event.event_type === "policy_decision_made")!;
    insertRaw("TS-7020", "voice_action_issued", {
      action_id: `VA-TS-7020-crash`, decision_id: (anchor.payload as { decision_id: string }).decision_id, beat_id: "BT-02",
      text: "正在播报的叙述（将被 barge-in 打断）", source: "deterministic-scaffold", interruptible: true,
    }, anchor.sequence);
    const resumed = TutorSessionOrchestratorV5.resume({ sessionId: "TS-7020", canonicalRoot: ROOT, model: f6Model(provider, "fixed-response/fixed-f6-journey") });
    assert.deepEqual(resumed.projectUnifiedViews().coachPanelView.mainline, { kind: "recovering", checkpoint_id: "BT-02" }, "pending voice is visible as recovering");
    const bargeIn = await resumed.submitStudentIntent({ intent_kind: "barge_in", text: "等一下，我先问个问题", client_request_id: "cr-7020-2" });
    void bargeIn;
    const interrupted = eventsOf("TS-7020").find(
      (event) => event.event_type === "action_outcome_recorded" && (event.payload as { action_id: string; outcome: string }).action_id === "VA-TS-7020-crash",
    );
    assert.equal((interrupted!.payload as { outcome: string }).outcome, "interrupted", "pending voice closed as interrupted");
    assert.notEqual(resumed.state.teaching_cursor.phase, "gate_satisfied", "interrupted voice produces no completion side effect");
    assert.equal(resumed.state.teaching_cursor.beat_id, "BT-02", "barge-in does not advance the beat");
    assert.equal(
      resumed.projectUnifiedViews().coachPanelView.mainline.kind === "awaiting_workspace"
        || resumed.projectUnifiedViews().coachPanelView.mainline.kind === "presenting", true,
      "after barge-in the session still waits at BT-02 (no fabricated completion)",
    );
    auditCausalityChain("TS-7020");
  });

  await runTest("G6 negative: voice validation failure and workspace partial failure record presentation_failed with completed_action_ids (no fake rollback)", async () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7021", provider);
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7021-1" });
    const decision = [...eventsOf("TS-7021")].reverse().find((event) => event.event_type === "policy_decision_made")!;
    const decisionPayload = decision.payload as { decision_id: string; protocol_id: string; beat_id: string };
    // (a) 非法 voice（空文本）→ presentation_failed(action_validation_rejected)，零 issued。
    const badVoicePlan = {
      schema: "ai_teaching_presentation_plan/v1",
      session_id: "TS-7021", plan_id: "PPT-TS-7021-9001", decision_id: decisionPayload.decision_id,
      protocol_id: decisionPayload.protocol_id, beat_id: "BT-02",
      voice_actions: [{ action_id: "VA-TS-7021-9001", decision_id: decisionPayload.decision_id, text: "", source: "deterministic-scaffold" }],
      workspace_actions: [],
    } as Parameters<typeof orch.executePresentationPlan>[0];
    const failedVoice = orch.executePresentationPlan(badVoicePlan, decision.sequence);
    assert.equal(failedVoice.failure?.failure_class, "action_validation_rejected");
    const pf1 = eventsOf("TS-7021").filter((event) => event.event_type === "presentation_failed").at(-1)!;
    assert.equal((pf1.payload as { failure_class: string }).failure_class, "action_validation_rejected");
    assert.equal(eventsOf("TS-7021").some((event) => (event.payload as { action_id?: string }).action_id === "VA-TS-7021-9001" && event.event_type === "voice_action_issued"), false, "invalid voice never issued");
    // (b) partial：合法 voice + 非法 target 的 reveal → voice 已成功保留，reveal 拒绝。
    const partialPlan = {
      schema: "ai_teaching_presentation_plan/v1",
      session_id: "TS-7021", plan_id: "PPT-TS-7021-9002", decision_id: decisionPayload.decision_id,
      protocol_id: decisionPayload.protocol_id, beat_id: "BT-02",
      voice_actions: [{ action_id: "VA-TS-7021-9002", decision_id: decisionPayload.decision_id, text: "部分失败场景的叙述", source: "deterministic-scaffold" }],
      workspace_actions: [{ action_id: "WSA-TS-7021-9002", decision_id: decisionPayload.decision_id, surface: "solution_board", capability: "board.reveal-entry", origin: "tutor" as const, target_ids: ["BE-99"], reveal_scope: "intermediate_result" as const }],
    } as Parameters<typeof orch.executePresentationPlan>[0];
    const partial = orch.executePresentationPlan(partialPlan, decision.sequence);
    assert.equal(partial.failure?.failure_class, "action_validation_rejected");
    assert.deepEqual(partial.failure?.completed_action_ids, ["VA-TS-7021-9002"], "already-succeeded voice stands (no fake rollback)");
    const voiceOutcome = eventsOf("TS-7021").find(
      (event) => event.event_type === "action_outcome_recorded" && (event.payload as { action_id: string }).action_id === "VA-TS-7021-9002",
    );
    assert.equal((voiceOutcome!.payload as { outcome: string }).outcome, "completed");
    const pf2 = eventsOf("TS-7021").filter((event) => event.event_type === "presentation_failed").at(-1)!;
    assert.deepEqual((pf2.payload as { completed_action_ids?: string[] }).completed_action_ids, ["VA-TS-7021-9002"]);
    const projection = orch.projectUnifiedViews();
    assert.equal(projection.status.last_failure?.category, "presentation_action_failure");
    auditCausalityChain("TS-7021");
  });

  await runTest("G6 negative: action-order/causation violations rejected on the real append path (future causation, wrong-beat decision anchor)", async () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7022", provider);
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7022-1" });
    // (a) causation 指向未来 sequence → store CAUSATION_REF_INVALID（整批零写入）。
    const before = countEvents("TS-7022");
    assert.throws(
      () => storeModule.appendTutorSessionEventsV5("TS-7022", (db.prepare("SELECT revision AS r FROM tutor_sessions WHERE session_id = ?").get("TS-7022") as { r: number }).r, [
        { event_type: "voice_action_issued", payload: { action_id: "VA-TS-7022-9001", decision_id: "TD-TS-7022-0009", text: "x", source: "deterministic-scaffold" }, occurred_at: new Date().toISOString(), causation_sequence: 9999 },
      ]),
      (error: unknown) => (error as { code?: string }).code === "CAUSATION_REF_INVALID",
    );
    assert.equal(countEvents("TS-7022"), before, "whole batch rolled back");
    // (b) wrong-beat 决策锚（真实公开入口）：BT-01 的 execute_beat 决策锚定 reveal
    // （cursor 已在 BT-02）→ F3 assertTutorActionCausation 拒绝 + presentation_failed。
    const bt01Decision = eventsOf("TS-7022").find(
      (event) => event.event_type === "policy_decision_made" && (event.payload as { decision_kind: string; beat_id: string }).beat_id === "BT-01",
    )!;
    const staleDecisionId = (bt01Decision.payload as { decision_id: string }).decision_id;
    const stalePlan = {
      schema: "ai_teaching_presentation_plan/v1",
      session_id: "TS-7022", plan_id: "PPT-TS-7022-9002", decision_id: staleDecisionId,
      protocol_id: "PR-SMV-001", beat_id: "BT-01",
      voice_actions: [],
      workspace_actions: [{ action_id: "WSA-TS-7022-9002", decision_id: staleDecisionId, surface: "solution_board", capability: "board.reveal-entry", origin: "tutor" as const, target_ids: ["BE-06"], reveal_scope: "step_narration" as const }],
    } as Parameters<typeof orch.executePresentationPlan>[0];
    const staleExecution = orch.executePresentationPlan(stalePlan, bt01Decision.sequence);
    assert.equal(staleExecution.failure?.failure_class, "action_validation_rejected");
    assert.ok(
      staleExecution.receipts.some((receipt) => receipt.reason?.includes("wrong-beat")),
      `wrong-beat causation rejected: ${JSON.stringify(staleExecution.receipts.map((receipt) => receipt.reason))}`,
    );
    const revealAfter = eventsOf("TS-7022").some(
      (event) => event.event_type === "workspace_surface_action_issued" && (event.payload as { action_id: string }).action_id === "WSA-TS-7022-9002",
    );
    assert.equal(revealAfter, false, "rejected tutor action leaves zero issued facts");
  });

  await runTest("G6 negative: student command capability/target rejections commit intent+outcome(rejected) facts with zero state effect", async () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7023", provider);
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7023-1" });
    const wsRevBefore = orch.projectUnifiedViews().studentWorkspaceView.revision;
    // 未知 capability。
    const unknownCapability = orch.submitWorkspaceCommand(markKnownSegmentsCommand({
      sessionId: "TS-7023", commandId: "SC-TS-7023-0001", clientCommandId: "cc-7023-1", expectedWorkspaceRevision: 1, capability: "geometry.nonexistent",
    }));
    assert.equal(unknownCapability.projection.status.completed, false);
    const rejectedOutcome = eventsOf("TS-7023").find(
      (event) => event.event_type === "action_outcome_recorded" && (event.payload as { action_id: string }).action_id === "SC-TS-7023-0001",
    );
    assert.equal((rejectedOutcome!.payload as { outcome: string }).outcome, "rejected", "canonical-legal rejection persists intent+outcome(rejected) facts");
    // 非法 target（未知线段）。
    const illegalTarget = orch.submitWorkspaceCommand(markKnownSegmentsCommand({
      sessionId: "TS-7023", commandId: "SC-TS-7023-0002", clientCommandId: "cc-7023-2", expectedWorkspaceRevision: 1, targetIds: ["seg-XX"],
    }));
    assert.equal(illegalTarget.projection.studentWorkspaceView.revision, wsRevBefore, "illegal target leaves workspace state untouched");
    // stale expected revision（F3 乐观并发）。
    const stale = orch.submitWorkspaceCommand(markKnownSegmentsCommand({
      sessionId: "TS-7023", commandId: "SC-TS-7023-0003", clientCommandId: "cc-7023-3", expectedWorkspaceRevision: 0,
    }));
    assert.equal(stale.projection.studentWorkspaceView.revision, wsRevBefore);
    assert.equal(orch.state.teaching_cursor.beat_id, "BT-02", "no gate satisfied from rejected commands");
    auditCausalityChain("TS-7023");
  });

  await runTest("G6 negative: final reveal without a satisfied gate refused by the truth boundary (presenter pre-check + runtime re-check)", async () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7024", provider);
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7024-1" });
    // Presenter 预检：全程已 issued 的 reveal 不含 final 条目（GT-04 未满足）。
    const revealActions = eventsOf("TS-7024")
      .filter((event) => event.event_type === "workspace_surface_action_issued")
      .flatMap((event) => (event.payload as { target_ids?: string[] }).target_ids ?? []);
    assert.ok(!revealActions.includes("BE-08"), "presenter never schedules the final entry before its gate is satisfied");
    // 运行时再检（真实公开入口 executePresentationPlan）：对 BE-08 的 final reveal
    // → F3 truth boundary 拒绝 + presentation_failed 事实。
    const decision = [...eventsOf("TS-7024")].reverse().find((event) => event.event_type === "policy_decision_made")!;
    const decisionPayload = decision.payload as { decision_id: string; protocol_id: string; beat_id: string };
    const forcedPlan = {
      schema: "ai_teaching_presentation_plan/v1",
      session_id: "TS-7024", plan_id: "PPT-TS-7024-9001", decision_id: decisionPayload.decision_id,
      protocol_id: decisionPayload.protocol_id, beat_id: decisionPayload.beat_id,
      voice_actions: [{ action_id: "VA-TS-7024-9001", decision_id: decisionPayload.decision_id, text: "核验前的越界 reveal 尝试", source: "deterministic-scaffold" }],
      workspace_actions: [{ action_id: "WSA-TS-7024-9001", decision_id: decisionPayload.decision_id, surface: "solution_board", capability: "board.reveal-entry", origin: "tutor" as const, target_ids: ["BE-08"], reveal_scope: "final_result" as const }],
    } as Parameters<typeof orch.executePresentationPlan>[0];
    const forced = orch.executePresentationPlan(forcedPlan, decision.sequence);
    assert.equal(forced.failure?.failure_class, "action_validation_rejected");
    assert.ok(
      forced.receipts.some((receipt) => receipt.reason?.includes("gate 未满足") || receipt.reason?.includes("truth boundary")),
      `final reveal refused by the truth boundary: ${JSON.stringify(forced.receipts.map((receipt) => receipt.reason))}`,
    );
  });

  await runTest("G6 negative: catalog pin mismatch refused on F6 sessions (resume with an unverifiable catalog)", async () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7025", provider);
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7025-1" });
    // 篡改 catalog（多一条 intermediate 条目 → digest 变化）经 F3 公开 resume 对账。
    const importerModule = require("../../planBuild/v4/ImportApprovedPlanV4") as typeof import("../../planBuild/v4/ImportApprovedPlanV4");
    const imported = importerModule.importApprovedPlanV4({ canonicalRoot: ROOT, anchored: true }, GOLDEN.tpId);
    assert.equal(imported.ok, true);
    const golden = buildGoldenWorkspaceCatalogV5(imported.imported);
    const tampered = { ...golden.catalog, boardEntries: [...golden.catalog.boardEntries, { entryId: "BE-99", kind: "derivation" as const, content: "篡改条目", presentationGroup: "PG-99", revealRequirement: "intermediate" as const }] };
    assert.throws(
      () => workspaceRuntimeModule.WorkspaceSessionRuntimeV5.resume("TS-7025", tampered),
      (error: unknown) => (error as { code?: string }).code === "HASH_MISMATCH",
    );
    void orch;
  });

  await runTest("G6 negative: model pin mismatch refuses orchestrator resume (fail closed, zero events)", async () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7026", provider);
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7026-1" });
    const before = countEvents("TS-7026");
    assert.throws(
      () => TutorSessionOrchestratorV5.resume({
        sessionId: "TS-7026", canonicalRoot: ROOT,
        model: { provider, pin: { provider: "different/provider", model_id: "other-model", prompt_version: "other", adjudicator_version: "other" } },
      }),
      (error: unknown) => error instanceof OrchestratorError && error.code === "MODEL_PIN_MISMATCH",
    );
    assert.equal(countEvents("TS-7026"), before, "zero events appended on pin mismatch");
    void orch;
  });

  await runTest("G6 negative: corrupted stream refuses resume (gap / corrupt payload, fail closed)", async () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7027", provider);
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-7027-1" });
    // 损坏最后一条事件 payload（测试侧 UPDATE——模拟存储篡改）。
    const lastSeq = countEvents("TS-7027");
    db.prepare("UPDATE tutor_session_events SET payload_json = ? WHERE session_id = ? AND sequence = ?").run("{not-json", "TS-7027", lastSeq);
    assert.throws(
      () => TutorSessionOrchestratorV5.resume({ sessionId: "TS-7027", canonicalRoot: ROOT, model: f6Model(provider, "fixed-response/fixed-f6-journey") }),
      (error: unknown) => error instanceof Error,
    );
    void orch;
  });

  await runTest("G6 assessment isolation: explicit entry, locked workspace, teaching tools disabled, failures never student incorrect", async () => {
    const provider = journeyProvider();
    const orch = TutorSessionOrchestratorV5.start({
      sessionId: "TS-7028", studentId: "student-f6", canonicalRoot: ROOT,
      model: f6Model(provider, "fixed-response/fixed-f6-journey"), assessment: true,
    });
    assert.equal(orch.assessmentMode, true);
    const projection = orch.projectUnifiedViews();
    assert.equal(projection.studentWorkspaceView.canvas.interaction_enabled, false, "assessment catalog starts locked (review-only)");
    // Presenter 教学工具禁用：无 workspace 动作、voice 只剩确定性指示。
    const presentPlan = orch.presentCurrentBeat();
    assert.deepEqual(presentPlan.plan.workspace_actions, [], "no workspace actions in assessment");
    assert.equal(presentPlan.plan.voice_actions.length, 1);
    assert.equal(presentPlan.plan.voice_actions[0].source, "deterministic-scaffold");
    // 强制 tutor reveal（真实公开入口 executePresentationPlan）→ mode 拒绝（locked）。
    const decision = [...eventsOf("TS-7028")].reverse().find((event) => event.event_type === "policy_decision_made")!;
    const decisionPayload = decision.payload as { decision_id: string; protocol_id: string; beat_id: string };
    const forcedReveal = orch.executePresentationPlan({
      schema: "ai_teaching_presentation_plan/v1",
      session_id: "TS-7028", plan_id: "PPT-TS-7028-9001", decision_id: decisionPayload.decision_id,
      protocol_id: decisionPayload.protocol_id, beat_id: decisionPayload.beat_id,
      voice_actions: [{ action_id: "VA-TS-7028-9001", decision_id: decisionPayload.decision_id, text: "越界 reveal 尝试", source: "deterministic-scaffold" }],
      workspace_actions: [{ action_id: "WSA-TS-7028-9001", decision_id: decisionPayload.decision_id, surface: "solution_board", capability: "board.reveal-entry", origin: "tutor" as const, target_ids: ["BE-04"], reveal_scope: "step_narration" as const }],
    } as Parameters<typeof orch.executePresentationPlan>[0], decision.sequence);
    assert.ok(
      forcedReveal.receipts.some((receipt) => receipt.reason?.includes("mode 不匹配") || receipt.reason?.includes("locked")),
      `locked mode refuses reveal: ${JSON.stringify(forcedReveal.receipts.map((receipt) => receipt.reason))}`,
    );
    const initialVoice = eventsOf("TS-7028").find((event) => event.event_type === "voice_action_issued")!;
    assert.ok((initialVoice.payload as { text: string }).text.includes("请独立完成作答"), "assessment opening voice is the deterministic instruction");
    // 教学类 intent 边界拒绝（零事实）。
    const before = countEvents("TS-7028");
    await assert.rejects(
      () => orch.submitStudentIntent({ intent_kind: "request_scaffold", client_request_id: "cr-7028-x" }),
      (error: unknown) => error instanceof OrchestratorError && error.code === "ASSESSMENT_INTENT_FORBIDDEN",
    );
    assert.equal(countEvents("TS-7028"), before, "boundary refusal leaves zero facts (input never became a fact)");
    // 模型失败 ≠ student incorrect（assessment 下同样成立）。
    const failing = TutorSessionOrchestratorV5.start({
      sessionId: "TS-7029", studentId: "student-f6", canonicalRoot: ROOT,
      model: f6Model(new UnavailableGateProvider(), "case/unavailable"), assessment: true,
    });
    await failing.submitStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_WRONG, client_request_id: "cr-7029-1" });
    const failingProjection = failing.projectUnifiedViews();
    assert.equal(failingProjection.status.last_failure?.category, "model_runtime_failure");
    assert.notEqual(failingProjection.status.last_failure?.category, "student_incorrect");
    auditCausalityChain("TS-7028");
  });

  await runTest("G6 canonical fixtures consumed: presentation-plan / coach-panel-view / mainline-participation / model_gate_pin", () => {
    assert.equal(canonical.validatePayload(readFixtureJson("presentation-plan.positive.json")).ok, true);
    assert.equal(canonical.validatePayload(readFixtureJson("presentation-plan.negative.empty-actions.json")).ok, false);
    assert.equal(canonical.validatePayload(readFixtureJson("coach-panel-view.positive.json")).ok, true);
    assert.equal(canonical.validatePayload(readFixtureJson("coach-panel-view.negative.untyped-mainline.json")).ok, false);
    assert.equal(canonical.validatePayload(readFixtureJson("mainline-participation.positive.json")).ok, true);
    assert.equal(canonical.validatePayload(readFixtureJson("mainline-participation.negative.unknown-kind.json")).ok, false);
    // F6 合同增补负例：model_gate_pin 缺字段/多字段 → v5 事件 schema 拒绝。
    const badPin = readFixtureJson("tutor-session-event.v5.negative.session-started-bad-model-gate-pin.json");
    assert.equal(canonical.validatePayload(badPin).ok, false);
  });

  await runTest("G6 presenter discipline: refuses uncommitted decision causation and beat mismatch (never invents)", () => {
    const provider = journeyProvider();
    const orch = startOrchestrator("TS-7030", provider);
    const importerModule = require("../../planBuild/v4/ImportApprovedPlanV4") as typeof import("../../planBuild/v4/ImportApprovedPlanV4");
    const imported = importerModule.importApprovedPlanV4({ canonicalRoot: ROOT, anchored: true }, GOLDEN.tpId);
    assert.equal(imported.ok, true);
    const golden = buildGoldenWorkspaceCatalogV5(imported.imported);
    const decision = eventsOf("TS-7030").find((event) => event.event_type === "policy_decision_made")!;
    const workspaceRebuild = require("../../tutorSession/WorkspaceStateRebuilderV5").rebuildWorkspaceRuntimeStateV5("TS-7030", golden.catalog);
    const resources = new Map(imported.imported.plan.resources.map((resource) => [resource.resource_id, resource] as const));
    const beat = orch.plan.mainline.beats.get("BT-01")!;
    // 未提交决策 → 拒绝。
    assert.throws(
      () => presenterModule.realizePresentationPlanV5({
        sessionId: "TS-7030",
        decision: { ...(decision.payload as object), decision_id: "TD-TS-7030-9999" } as never,
        beat, presentationIntent: undefined, resources,
        catalog: golden.catalog, factEntryIds: golden.factEntryIds,
        gateLedger: workspaceRebuild.context.gateLedger, actionSerial: 99,
      }),
      (error: unknown) => error instanceof presenterModule.TutorPresenterError,
    );
    // Beat 与决策不符 → 拒绝。
    assert.throws(
      () => presenterModule.realizePresentationPlanV5({
        sessionId: "TS-7030",
        decision: decision.payload as never,
        beat: orch.plan.mainline.beats.get("BT-02")!, presentationIntent: undefined, resources,
        catalog: golden.catalog, factEntryIds: golden.factEntryIds,
        gateLedger: workspaceRebuild.context.gateLedger, actionSerial: 99,
      }),
      (error: unknown) => error instanceof presenterModule.TutorPresenterError,
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
