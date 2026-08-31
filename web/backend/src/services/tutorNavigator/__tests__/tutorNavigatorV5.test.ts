/**
 * F5 G5 门禁测试（node 链）：Session 与 Protocol Navigator 内核。
 *
 * 覆盖 f5-scope-ledger 的正/负例义务 + G5 三条门禁：
 * 1. 确定性：对固定 Plan/state/interpretation 重复执行 decide 得到相同合法
 *    decision 或相同显式 failure；
 * 2. 轨迹可重建：mainline、gate unsatisfied/satisfied、inquiry、return、
 *    barge-in、unclear、out-of-bound 轨迹全部由 committed events 重建
 *    （kernel.rebuild 与在线 state 逐字段一致，F2 comparator 白名单空集）；
 * 3. 新路径零 TutorMove/Hint/H control 写入。
 *
 * 负例全部经真实提交路径（NavigatorSessionV5 → TutorSessionKernelV5.append /
 * decideNavigation 真实入口），禁止绕道内部纯函数冒充 fail-closed 证明。
 * Plan 输入 = F4 importer 真实 Approved 链（TP-SMV-009@v1，registry 锚定对账）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ANSWER_ALTERNATE_COORDINATE,
  ANSWER_GOAL_OK,
  ANSWER_INVARIANTS_OK,
  ANSWER_INVARIANTS_WRONG,
  FIXTURES_DIR,
  GOLDEN,
  QUESTION_IN_BOUND,
  QUESTION_OUT_OF_BOUND,
  SCAFFOLD_STEP1_OK,
  ensureNavigatorSqlite,
  importGoldenPlan,
  realCanonicalRoot,
} from "./navigatorSupport";

ensureNavigatorSqlite();

// node 链纪律：db 单例须在 ensureNavigatorSqlite（设 SQLITE_PATH）之后惰性
// require（先例 workspaceKernelV5.test.ts）——静态 import 会在 env 设置前
// 打开缺省 dev 库。
const { db } = require("../../../db/database") as typeof import("../../../db/database");
const { validatePayload } = require("../../../../../shared/canonical") as typeof import("../../../../../shared/canonical");
const session5 = require("../NavigatorSessionV5") as typeof import("../NavigatorSessionV5");
const navigator5 = require("../TutorNavigatorV5") as typeof import("../TutorNavigatorV5");
const interpreter5 = require("../SemanticInterpreterV5") as typeof import("../SemanticInterpreterV5");
const ese5 = require("../ExternalSupportEvidenceV5") as typeof import("../ExternalSupportEvidenceV5");
const localInquiry5 = require("../LocalInquiryProtocolV5") as typeof import("../LocalInquiryProtocolV5");

const { NavigatorSessionV5 } = session5;
const { decideNavigation, MAX_LOCAL_INQUIRY_STEPS } = navigator5;
const { interpretStudentInput } = interpreter5;
const { buildExternalSupportEvidence } = ese5;
const { buildLocalInquiryProtocol, findLocalInquiryProtocol, LocalInquiryBoundaryError } = localInquiry5;

type NavigatorSession = import("../NavigatorSessionV5").NavigatorSessionV5;
type TurnResult = import("../NavigatorSessionV5").TurnResult;

function startSession(sessionId: string): NavigatorSession {
  return NavigatorSessionV5.start({
    sessionId,
    studentId: "student-nav5",
    canonicalRoot: realCanonicalRoot(),
    tpId: GOLDEN.tpId,
    taskId: GOLDEN.taskId,
    scenarioId: GOLDEN.scenarioId,
  });
}

function latestIntentSeq(session: NavigatorSession): number {
  const intent = [...session.events].reverse().find((event) => event.event_type === "student_intent_recorded");
  if (!intent) throw new Error("no committed student_intent_recorded for receipt causation");
  return intent.sequence;
}

/**
 * R1 workspace 回执链（真实提交路径）：学生命令意图（acceptStudentIntent →
 * intent+interpretation+decision 落库）→ F3 侧执行回执（kernel.append——
 * Navigator 永不自报 outcome）→ Navigator 消费（consumeWorkspaceCommandOutcome）。
 */
function submitWorkspaceCommandWithReceipt(
  session: NavigatorSession,
  input: {
    command_id: string;
    capability?: string;
    outcome?: "completed" | "rejected" | "failed";
    resultingRevision?: number;
    expectedRevision?: number;
  },
): TurnResult {
  const capability = input.capability ?? "similarity.mark-known-segments";
  session.acceptStudentIntent({
    intent_kind: "submit_workspace_command",
    client_request_id: `cr-wc-${input.command_id}`,
    workspace_command: {
      command_id: input.command_id,
      surface: "geometry",
      capability,
      target_ids: ["seg-AD"],
      expected_workspace_revision: input.expectedRevision ?? 0,
      client_command_id: `cc-${input.command_id}`,
    },
  });
  const outcome = input.outcome ?? "completed";
  session.kernel.append(session.kernel.revision, [
    {
      event_type: "action_outcome_recorded",
      payload: {
        action_id: input.command_id,
        action_kind: "student_command",
        outcome,
        ...(outcome === "failed" ? { failure_class: "internal_error" as const } : {}),
        ...(input.resultingRevision !== undefined
          ? { resulting_revision: input.resultingRevision }
          : outcome === "completed"
            ? { resulting_revision: (input.expectedRevision ?? 0) + 1 }
            : {}),
      },
      occurred_at: new Date().toISOString(),
      causation_sequence: latestIntentSeq(session),
    },
  ]);
  return session.consumeWorkspaceCommandOutcome({ command_id: input.command_id });
}

function decisionsOf(session: NavigatorSession): { kind: string; beat: string; to?: string }[] {
  return session.events
    .filter((event) => event.event_type === "policy_decision_made")
    .map((event) => {
      const payload = event.payload as { decision_kind: string; beat_id: string; to_beat_id?: string };
      return { kind: payload.decision_kind, beat: payload.beat_id, ...(payload.to_beat_id !== undefined ? { to: payload.to_beat_id } : {}) };
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

function decisionsProjection(event: { payload: Record<string, unknown> }): string {
  return (event.payload as { decision_kind: string }).decision_kind;
}

function expectCode(fn: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, `expected error with code ${code}, got ${String(thrown)}`);
  assert.equal((thrown as { code?: string }).code, code, `expected code ${code}: ${String(thrown)}`);
}

async function main(): Promise<void> {
  await runTest("G5 start: real approved chain pins TP-SMV-009 (protocols+profile+entry cursor) via F2 kernel", () => {
    const session = startSession("TS-9801");
    const state = session.state;
    assert.equal(state.pinned_plan.tutor_plan_ref.artifact_id, "TP-SMV-009");
    assert.equal(state.pinned_plan.solution_graph_ref.artifact_id, "RG-SMV-001");
    const protocolIds = state.pinned_plan.protocol_refs.map((ref) => ref.artifact_id).sort();
    assert.deepEqual(protocolIds, ["PR-SMV-001", "PR-SMV-002"]);
    assert.equal(state.pinned_plan.policy_profile_snapshot?.profile_id, "PP-SMV-001");
    assert.deepEqual(
      { protocol_id: state.teaching_cursor.protocol_id, beat_id: state.teaching_cursor.beat_id, phase: state.teaching_cursor.phase },
      { protocol_id: "PR-SMV-001", beat_id: "BT-01", phase: "presenting" },
    );
    // 起步决策事实（execute entry Beat，causation→session_started seq 1）。
    const first = decisionsOf(session)[0];
    assert.deepEqual(first, { kind: "execute_beat", beat: "BT-01" });
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("G5 mainline journey: confirm -> workspace gate -> answer gates -> final confirm completes (rebuild identical at every step)", () => {
    const session = startSession("TS-9802");
    // BT-01（GT-01 student_confirmation）
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    // BT-02（GT-02 workspace_command similarity.mark-known-segments）
    submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9802-0001" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-03");
    // BT-03（GT-03 student_answer FN-05）
    session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-0003" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-04");
    // BT-04（GT-04 student_answer FN-08 goal）
    session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_GOAL_OK, client_request_id: "cr-0004" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-05");
    // BT-05（GT-05 student_confirmation，最后一 Beat → complete + session_completed）
    const final = session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0005" });
    assert.equal(final.decision?.decision_kind, "complete_beat");
    assert.equal(session.state.completed, true);
    assert.equal(session.state.teaching_cursor.phase, "completed");
    const completed = session.events.find((event) => event.event_type === "session_completed");
    assert.ok(completed);
    assert.deepEqual((completed.payload as { final_beat_id: string; completed_parts: string[] }), {
      final_beat_id: "BT-05",
      completed_parts: ["1"],
    });
    // 轨迹逐 Beat 推进：transition 决策链与游标一致，全journey rebuild 一致。
    // （submit_workspace_command 意图轮为 execute_beat：完成证据经 outcome 事实判定。）
    const kinds = decisionsOf(session).map((decision) => decision.kind);
    assert.deepEqual(kinds, [
      "execute_beat",
      "transition_beat",
      "execute_beat",
      "transition_beat",
      "transition_beat",
      "transition_beat",
      "complete_beat",
    ]);
    assert.equal(session.assertReplayParity().equal, true);
    // 每条 committed 事件过 canonical v5（store 已保证，显式复核）。
    for (const event of session.events) {
      assert.deepEqual(validatePayload(event), { ok: true, errors: [] }, `event seq ${event.sequence}`);
    }
  });

  await runTest("G5 gate unsatisfied: wrong answer stays awaiting_evidence, no illegal transition; repeated unclear opens approved scaffold", () => {
    const session = startSession("TS-9803");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9803-0001" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-03");
    const first = session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_WRONG, client_request_id: "cr-0003" });
    assert.equal(first.decision?.decision_kind, "request_clarification");
    assert.equal(session.state.teaching_cursor.beat_id, "BT-03");
    assert.equal(session.state.teaching_cursor.phase, "awaiting_evidence");
    const unsatisfied = session.events.filter((event) => event.event_type === "gate_evaluated").at(-1);
    assert.equal((unsatisfied?.payload as { satisfied: boolean }).satisfied, false);
    // 第二次未解决 → BT-03 声明的 unclear 分支（PR-SMV-002，返回点 BT-03）。
    const second = session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_WRONG, client_request_id: "cr-0004" });
    assert.equal(second.decision?.decision_kind, "open_scaffold");
    assert.equal(second.decision?.inquiry?.inquiry_protocol_id, "PR-SMV-002");
    assert.equal(second.decision?.inquiry?.return_beat_id, "BT-03");
    assert.ok(session.state.inquiry_cursor);
    // 主线游标冻结在 BT-03。
    assert.equal(session.state.teaching_cursor.beat_id, "BT-03");
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("G5 narration cannot substitute student evidence (gate_unresolvable fail closed through the real append path)", () => {
    const session = startSession("TS-9804");
    const result = session.completeNarration();
    assert.equal(result.advanced, false);
    assert.equal(result.failure?.failure_class, "gate_unresolvable");
    // 显式 failure 已作为 policy_failed 事实落库（相同显式 failure 可追溯）。
    const failed = session.events.filter((event) => event.event_type === "policy_failed");
    assert.equal(failed.length, 1);
    assert.equal((failed[0].payload as { failure_class: string }).failure_class, "gate_unresolvable");
    // 学生证据 gate 不被 narration 满足：无 gate_evaluated、不进 gate_satisfied。
    assert.equal(session.events.some((event) => event.event_type === "gate_evaluated"), false);
    assert.notEqual(session.state.teaching_cursor.phase, "gate_satisfied");
    assert.equal(session.state.completed, false);
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("G5 approved inquiry: open/advance/return with frozen mainline cursor and explicit return point (trajectory rebuilt)", () => {
    const session = startSession("TS-9805");
    const opened = session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "cr-0001" });
    assert.equal(opened.decision?.decision_kind, "open_inquiry");
    assert.equal(opened.decision?.inquiry?.inquiry_protocol_id, "PR-SMV-002");
    assert.equal(opened.decision?.inquiry?.return_beat_id, "BT-01");
    const openedEvent = session.events.find((event) => event.event_type === "inquiry_opened");
    assert.deepEqual(openedEvent?.payload, {
      inquiry_id: opened.decision?.inquiry?.inquiry_id,
      inquiry_protocol_id: "PR-SMV-002",
      return_beat_id: "BT-01",
      local: false,
      trigger: "ask_question",
    });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-01"); // 冻结
    // 分支 Beat 1（student_answer，basis=requirement）
    session.acceptStudentIntent({ intent_kind: "submit_answer", text: SCAFFOLD_STEP1_OK, client_request_id: "cr-0002" });
    // 分支 Beat 2（student_confirmation）
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0003" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-01"); // 仍冻结
    // 分支 Beat 3（student_confirmation，末 Beat → return）
    const returned = session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0004" });
    assert.equal(returned.decision?.decision_kind, "return_to_mainline");
    assert.equal(returned.decision?.to_beat_id, "BT-01");
    const returnedEvent = session.events.find((event) => event.event_type === "inquiry_returned");
    assert.equal((returnedEvent?.payload as { return_beat_id: string }).return_beat_id, "BT-01");
    assert.equal(session.state.inquiry_cursor, null);
    assert.equal(session.state.teaching_cursor.beat_id, "BT-01"); // 回到显式返回点
    assert.equal(session.assertReplayParity().equal, true);
    // 分支内推进不隐式推进主线：全程主线 Beat 序列只有 BT-01。
    const inInquiry = session.events
      .filter((event) => event.event_type === "policy_decision_made")
      .map((event) => decisionsProjection(event));
    assert.deepEqual(inInquiry, ["execute_beat", "open_inquiry", "continue_inquiry", "continue_inquiry", "return_to_mainline"]);
  });

  await runTest("G5 scaffold support evidence: orient recorded within boundary; ladder violations fail closed; canonical fixtures agree", () => {
    const session = startSession("TS-9806");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    const opened = session.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "cr-0002" });
    assert.equal(opened.decision?.decision_kind, "open_scaffold");
    const ese = session.events.find((event) => event.event_type === "external_support_recorded");
    assert.ok(ese, "scaffold opening records concrete ExternalSupportEvidence");
    const payload = ese.payload as {
      support_kinds: string[];
      initiated_by: string;
      derived_partial: boolean;
      action_ids: string[];
    };
    assert.deepEqual(payload.support_kinds, ["orient"]);
    assert.equal(payload.initiated_by, "student_requested");
    assert.equal(payload.derived_partial, false);
    assert.ok(payload.action_ids[0].startsWith("VA-"));
    assert.ok(!("legacy_source" in ese.payload));
    // 阶梯越界 fail closed（构造器真实入口）。
    const plan = session.plan;
    const beat01 = plan.mainline.beats.get("BT-01");
    const beat04 = plan.mainline.beats.get("BT-04");
    assert.ok(beat01 && beat04);
    assert.equal(buildExternalSupportEvidence({
      session_id: "TS-9806", evidence_id: "ESE-TS-9806-9001", beat: beat01,
      support_kinds: ["specify_operation"], initiated_by: "tutor_initiated", action_ids: ["VA-x-0001"],
    }).ok, false);
    assert.equal(buildExternalSupportEvidence({
      session_id: "TS-9806", evidence_id: "ESE-TS-9806-9002", beat: beat04,
      support_kinds: ["provide_final_conclusion"], initiated_by: "tutor_initiated", action_ids: ["VA-x-0002"],
    }).ok, false);
    // canonical fixture 同口径：正例通过 / derived_partial 无 legacy_source 拒绝。
    const esePositive = JSON.parse(readFileSync(`${FIXTURES_DIR}/external-support-evidence.positive.json`, "utf8"));
    const eseNegative = JSON.parse(readFileSync(`${FIXTURES_DIR}/external-support-evidence.negative.derived-partial-without-legacy-source.json`, "utf8"));
    assert.equal(validatePayload(esePositive).ok, true);
    assert.equal(validatePayload(eseNegative).ok, false);
  });

  await runTest("G5 bounded LocalInquiryProtocol: fallback open is session-local, forced return at bound, plan untouched", () => {
    const session = startSession("TS-9807");
    // BT-01 分支 trigger=ask_question：request_scaffold 不匹配 → fallback 链 → LocalInquiry。
    const opened = session.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "cr-0001" });
    assert.equal(opened.decision?.decision_kind, "open_inquiry");
    assert.equal(opened.decision?.inquiry?.inquiry_protocol_id, undefined); // session-local
    const openedEvent = session.events.find((event) => event.event_type === "inquiry_opened");
    assert.equal((openedEvent?.payload as { local: boolean }).local, true);
    assert.equal(session.state.teaching_cursor.beat_id, "BT-01"); // 主线冻结
    // bounded：MAX_LOCAL_INQUIRY_STEPS 步内 continue，随后强制返回。
    for (let step = 0; step < MAX_LOCAL_INQUIRY_STEPS; step += 1) {
      const turn = session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: `cr-1${step}` });
      assert.equal(turn.decision?.decision_kind, "continue_inquiry");
    }
    const forced = session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "cr-9999" });
    assert.equal(forced.decision?.decision_kind, "return_to_mainline");
    assert.equal(session.state.inquiry_cursor, null);
    assert.equal(session.state.teaching_cursor.beat_id, "BT-01");
    assert.equal(session.assertReplayParity().equal, true);
    // 不回写 Approved Plan：pin refs 不变，LocalInquiry 无 protocol id。
    assert.equal(session.state.pinned_plan.protocol_refs.length, 2);
    assert.ok(session.events.every((event) => {
      if (event.event_type !== "policy_decision_made") return true;
      const payload = event.payload as { inquiry?: { inquiry_protocol_id?: string } };
      return payload.inquiry?.inquiry_protocol_id === undefined || payload.inquiry.inquiry_protocol_id === "PR-SMV-002";
    }));
  });

  await runTest("G5 barge-in pauses without cursor advance; out-of-bound falls back clarification -> safe fallback (no branch opened)", () => {
    const session = startSession("TS-9808");
    const barge = session.acceptStudentIntent({ intent_kind: "barge_in", client_request_id: "cr-0001" });
    assert.equal(barge.decision?.decision_kind, "pause");
    assert.equal(session.state.teaching_cursor.beat_id, "BT-01");
    assert.equal(session.state.teaching_cursor.phase, "presenting");
    // out-of-bound：首次澄清，连续未解决 → 计划内安全 fallback；不打开任何分支。
    const first = session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_OUT_OF_BOUND, client_request_id: "cr-0002" });
    assert.equal(first.decision?.decision_kind, "request_clarification");
    const second = session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_OUT_OF_BOUND, client_request_id: "cr-0003" });
    assert.equal(second.decision?.decision_kind, "safe_fallback");
    assert.equal(session.events.some((event) => event.event_type === "inquiry_opened"), false);
    assert.equal(session.state.teaching_cursor.beat_id, "BT-01");
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("G5 timeout: bounded_wait beat transitions on declared timeout edge; student_driven beat refuses timeout explicitly", () => {
    const session = startSession("TS-9809");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9809-0001" });
    // BT-03 bounded_wait 180s，timeout 出边声明 BT-03→BT-03（自环重试）。
    const timeoutAtBt03 = session.reportTimeout();
    assert.equal(timeoutAtBt03.decision?.decision_kind, "transition_beat");
    assert.equal(timeoutAtBt03.decision?.to_beat_id, "BT-03");
    assert.deepEqual(timeoutAtBt03.decision?.transition_basis, { basis: "timeout" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-03");
    assert.equal(session.assertReplayParity().equal, true);
    // student_driven Beat 的 timeout：decide 真实入口显式拒绝（确定性 failure）。
    const fresh = startSession("TS-9810");
    const refused = fresh.reportTimeout();
    assert.equal(refused.failure?.failure_class, "no_legal_transition");
    const failed = fresh.events.filter((event) => event.event_type === "policy_failed");
    assert.equal((failed[0].payload as { failure_class: string }).failure_class, "no_legal_transition");
    assert.equal(fresh.state.teaching_cursor.beat_id, "BT-01");
  });

  await runTest("G5 accept_alternate_path: coordinate-method hypothesis verified against RG SV-02 before acceptance", () => {
    const session = startSession("TS-9811");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9811-0001" });
    const turn = session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_ALTERNATE_COORDINATE, client_request_id: "cr-0003" });
    assert.equal(turn.decision?.decision_kind, "accept_alternate_path");
    assert.deepEqual(turn.decision?.transition_basis, { basis: "student_evidence", graph_variant_id: "SV-02" });
    // decision 只描述教学选择：游标不动。
    assert.equal(session.state.teaching_cursor.beat_id, "BT-03");
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("G5 determinism: same plan/state/interpretation -> identical decision or identical explicit failure (repeated decide)", () => {
    const session = startSession("TS-9812");
    const base = {
      sessionId: session.sessionId,
      plan: session.plan,
      state: session.state,
      revision: session.kernel.revision,
      localInquirySteps: 0,
      unresolvedClarifications: 0,
    };
    const hypothesis = interpretStudentInput(session.plan, {
      intent_kind: "ask_question",
      text: QUESTION_IN_BOUND,
      beat: session.currentBeat,
    });
    const trigger = { kind: "student_input" as const, sequence: 7, intent_kind: "ask_question" as const, text: QUESTION_IN_BOUND, hypothesis };
    const first = decideNavigation(base, trigger);
    const second = decideNavigation(base, trigger);
    assert.ok(first.ok && second.ok);
    assert.deepEqual(first.decision, second.decision);
    // 显式 failure 同样确定。
    const narrationFirst = decideNavigation(base, { kind: "narration_completed", sequence: 9 });
    const narrationSecond = decideNavigation(base, { kind: "narration_completed", sequence: 9 });
    assert.ok(!narrationFirst.ok && !narrationSecond.ok);
    assert.deepEqual(narrationFirst.failure, narrationSecond.failure);
    // 两个独立会话走完全相同输入 → 相同 decision_kind 序列与同形 payload（仅 session 域 id 不同）。
    const a = startSession("TS-9813");
    const b = startSession("TS-9814");
    const inputs = [
      { intent_kind: "confirm", client_request_id: "cr-1" },
      { intent_kind: "ask_question", text: QUESTION_OUT_OF_BOUND, client_request_id: "cr-2" },
      { intent_kind: "ask_question", text: QUESTION_OUT_OF_BOUND, client_request_id: "cr-3" },
    ] as const;
    for (const input of inputs) {
      a.acceptStudentIntent({ ...input });
      b.acceptStudentIntent({ ...input });
    }
    const stripSession = (value: unknown): string => JSON.stringify(value).replaceAll("TS-9813", "TS-XXXX").replaceAll("TS-9814", "TS-XXXX");
    assert.equal(stripSession(a.events.map(({ payload, event_type }) => ({ event_type, payload }))), stripSession(b.events.map(({ payload, event_type }) => ({ event_type, payload }))));
    assert.equal(a.assertReplayParity().equal, true);
    assert.equal(b.assertReplayParity().equal, true);
  });

  await runTest("G5 negative persistence via real append path: stale revision / duplicate idempotency roll back whole batches", () => {
    const session = startSession("TS-9815");
    const countBefore = session.events.length;
    const revision = session.kernel.revision;
    // stale expectedRevision：整批拒绝。
    expectCode(
      () => session.kernel.append(revision + 5, [
        { event_type: "student_intent_recorded", payload: { intent_kind: "continue", client_request_id: "cr-stale" }, occurred_at: new Date().toISOString() },
      ]),
      "REVISION_CONFLICT",
    );
    assert.equal(session.events.length, countBefore);
    // 幂等键重复（复用已提交 decision 的 key）：DUPLICATE_EVENT，零新事实。
    const committed = session.events.find((event) => event.event_type === "policy_decision_made");
    assert.ok(committed);
    expectCode(
      () => session.kernel.append(session.kernel.revision, [
        {
          event_type: "student_intent_recorded",
          payload: { intent_kind: "continue", client_request_id: "cr-dup" },
          occurred_at: new Date().toISOString(),
          idempotency_key: committed.idempotency_key,
        },
      ]),
      "DUPLICATE_EVENT",
    );
    assert.equal(session.events.length, countBefore);
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("G5 new path writes zero TutorMove/Hint/H control facts (event vocabulary + payload scan)", () => {
    const session = startSession("TS-9816");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    session.completeNarration(); // 显式 failure 也入流（policy_failed）
    submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9816-0001" });
    session.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "cr-0003" });
    const serialized = JSON.stringify(session.events.map((event) => ({ t: event.event_type, p: event.payload })));
    for (const forbidden of ["tutor_move_decided", "hint_issued", "move_type", "hint_level", "assistance_level", "legacy_source"]) {
      assert.ok(!serialized.includes(forbidden), `new path must not write ${forbidden}`);
    }
    // H0–H5 控制变量：ESE 无 level 字段；决策无 hint 语义。
    for (const event of session.events) {
      if (event.event_type === "external_support_recorded") {
        const payload = event.payload as Record<string, unknown>;
        assert.ok(!("level" in payload));
        assert.ok(!("legacy_source" in payload));
      }
    }
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("G5 canonical fixtures consumed: decision positive/negative + navigator decision passes canonical v1", () => {
    const decisionPositive = JSON.parse(readFileSync(`${FIXTURES_DIR}/tutor-policy-decision.positive.json`, "utf8"));
    const decisionNoReturn = JSON.parse(readFileSync(`${FIXTURES_DIR}/tutor-policy-decision.negative.inquiry-without-return.json`, "utf8"));
    const decisionMoveType = JSON.parse(readFileSync(`${FIXTURES_DIR}/tutor-policy-decision.negative.move-type-field.json`, "utf8"));
    const intentPositive = JSON.parse(readFileSync(`${FIXTURES_DIR}/student-intent.positive.json`, "utf8"));
    assert.equal(validatePayload(decisionPositive).ok, true);
    assert.equal(validatePayload(decisionNoReturn).ok, false);
    assert.equal(validatePayload(decisionMoveType).ok, false);
    assert.equal(validatePayload(intentPositive).ok, true);
    // navigator 产生的决策 payload 包装成 canonical 决策对象后通过 v1 校验。
    const session = startSession("TS-9817");
    const turn = session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    const decision = turn.decision;
    assert.ok(decision);
    const canonical = {
      schema: "ai_teaching_tutor_policy_decision/v1",
      session_id: session.sessionId,
      ...decision,
    };
    assert.deepEqual(validatePayload(canonical), { ok: true, errors: [] });
    // 同一 payload 作为 v5 policy_decision_made 事件（已落库）往返一致。
    const committed = session.events.find(
      (event) => event.event_type === "policy_decision_made" && (event.payload as { decision_id: string }).decision_id === decision.decision_id,
    );
    assert.ok(committed);
    assert.deepEqual(validatePayload(committed), { ok: true, errors: [] });
  });

  await runTest("G5 interpreter hypotheses are refutable: unknown classification recorded, branch trigger discipline enforced", () => {
    const session = startSession("TS-9818");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    // BT-02 的分支 trigger=request_scaffold（不是 unclear）：unknown 假设不得
    // 打开该分支——trigger 不匹配 → 澄清（假设可推翻，Navigator 不迁就假设）。
    const turn = session.acceptStudentIntent({ intent_kind: "submit_answer", text: "完全不知道", client_request_id: "cr-0002" });
    assert.equal(turn.decision?.decision_kind, "request_clarification");
    assert.equal(session.events.some((event) => event.event_type === "inquiry_opened"), false);
    const interpretation = session.events.filter((event) => event.event_type === "semantic_interpretation_recorded").at(-1);
    assert.equal((interpretation?.payload as { reasoning_location: string }).reasoning_location, "unknown");
    // 主线仍在 BT-02（clarification 是事实，不推进游标）。
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("G5 completed guard: after session_completed no further teaching decision is legal (explicit failure fact)", () => {
    const session = startSession("TS-9819");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9819-0001" });
    session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-0003" });
    session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_GOAL_OK, client_request_id: "cr-0004" });
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0005" });
    assert.equal(session.state.completed, true);
    const completedCount = session.events.filter((event) => event.event_type === "session_completed").length;
    // 收束后的新输入：只落 intent/interpretation fact + 显式 failure，不产生新决策。
    const after = session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "cr-0006" });
    assert.equal(after.failure?.failure_class, "no_legal_transition");
    assert.equal(session.events.filter((event) => event.event_type === "session_completed").length, completedCount);
    assert.equal(session.events.filter((event) => event.event_type === "policy_decision_made").length, 7);
    assert.equal(session.assertReplayParity().equal, true);
  });

  // ------------------------------------------------------------------ //
  // R1 修复波次（2026-08-31）：outcome 回执消费模式 / ReasoningFocus /
  // 五类 alignment 对抗负例 / LocalInquiryProtocol 结构化 / Plan-untouched。
  // ------------------------------------------------------------------ //

  await runTest("R1 workspace outcome receipts are consumed, never self-reported (fail closed without a committed receipt)", () => {
    const session = startSession("TS-9820");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    const turn = submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9820-0001" });
    assert.equal(turn.decision?.decision_kind, "transition_beat");
    assert.equal(session.state.teaching_cursor.beat_id, "BT-03");
    // 消费模式核心断言：流内 student_command outcome 只能来自调用方/F3 显式
    // 提交（本测试恰好 1 条）；consume 调用本身零追加（capability/outcome/
    // revision 全取自 committed 回执）。
    const receipts = session.events.filter(
      (event) => event.event_type === "action_outcome_recorded" && (event.payload as { action_kind: string }).action_kind === "student_command",
    );
    assert.equal(receipts.length, 1);
    assert.equal((receipts[0].payload as { action_id: string }).action_id, "SC-TS-9820-0001");
    // 未知 command_id：fail closed，零事件追加。
    const countBefore = session.events.length;
    assert.throws(() => session.consumeWorkspaceCommandOutcome({ command_id: "SC-unknown-9999" }), /nothing to consume/);
    assert.equal(session.events.length, countBefore);
    // 命令已提交但回执未落库：同样 fail closed（Navigator 不代写回执）。
    session.acceptStudentIntent({
      intent_kind: "submit_workspace_command",
      client_request_id: "cr-wc-pending",
      workspace_command: {
        command_id: "SC-TS-9820-pending",
        surface: "geometry",
        capability: "similarity.mark-known-segments",
        target_ids: ["seg-AD"],
        expected_workspace_revision: 1,
        client_command_id: "cc-pending",
      },
    });
    assert.throws(() => session.consumeWorkspaceCommandOutcome({ command_id: "SC-TS-9820-pending" }), /never fabricates outcomes/);
    assert.equal(session.events.length, countBefore + 3); // intent+interpretation+decision，无 outcome
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("R1 orphan/mismatch student_command receipts fail closed at persistence and rebuild boundaries", () => {
    const session = startSession("TS-9821");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    const countBefore = session.events.length;
    // (a) 孤儿回执（无对应已提交命令）：append 边界整批拒绝（store 事务内先纯
    // 折叠，reducer 拒绝 ⇒ 回滚）。
    expectCode(
      () =>
        session.kernel.append(session.kernel.revision, [
          {
            event_type: "action_outcome_recorded",
            payload: { action_id: "SC-orphan-0001", action_kind: "student_command", outcome: "completed", resulting_revision: 1 },
            occurred_at: new Date().toISOString(),
            causation_sequence: 2,
          },
        ]),
      "CORRUPT_EVENT",
    );
    assert.equal(session.events.length, countBefore);
    // (b) capability 不匹配（capability 取自 committed 命令，与 gate 要求不符）：
    // gate 不满足 → 澄清门禁，游标不动。
    const wrongCapability = submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9821-wrong", capability: "similarity.map-corresponding-sides" });
    assert.equal(wrongCapability.decision?.decision_kind, "request_clarification");
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    assert.equal(session.state.teaching_cursor.phase, "awaiting_evidence");
    // (c) resulting_revision 与流内状态不符（expected=1，携带 r=5）：append 拒绝。
    session.acceptStudentIntent({
      intent_kind: "submit_workspace_command",
      client_request_id: "cr-wc-rev",
      workspace_command: {
        command_id: "SC-TS-9821-rev",
        surface: "geometry",
        capability: "similarity.mark-known-segments",
        target_ids: ["seg-AD"],
        expected_workspace_revision: 1,
        client_command_id: "cc-rev",
      },
    });
    expectCode(
      () =>
        session.kernel.append(session.kernel.revision, [
          {
            event_type: "action_outcome_recorded",
            payload: { action_id: "SC-TS-9821-rev", action_kind: "student_command", outcome: "completed", resulting_revision: 5 },
            occurred_at: new Date().toISOString(),
            causation_sequence: latestIntentSeq(session),
          },
        ]),
      "CORRUPT_EVENT",
    );
    // (d) rejected 回执：不满足 gate、不推高 workspace_revision；随后合法
    // completed 回执恢复推进（fail closed 不留残余影响）。注：(b) 的错误
    // capability 命令本身执行成功——workspace_revision=1 是其执行副作用，
    // 与 gate 不满足是两件事（六态区分）。
    assert.equal(session.state.workspace_revision, 1);
    const rejected = submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9821-rej", outcome: "rejected", expectedRevision: 1 });
    assert.equal(rejected.decision?.decision_kind, "request_clarification");
    assert.equal(session.state.workspace_revision, 1, "rejected outcome must not advance workspace_revision");
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    const recovered = submitWorkspaceCommandWithReceipt(session, { command_id: "SC-TS-9821-ok", expectedRevision: 1 });
    assert.equal(recovered.decision?.decision_kind, "transition_beat");
    assert.equal(session.state.teaching_cursor.beat_id, "BT-03");
    assert.equal(session.state.workspace_revision, 2);
    assert.equal(session.assertReplayParity().equal, true);
    // (e) 重建边界：绕过 store 直写 DB 的孤儿回执 → rebuild/resume fail closed。
    const sessionId = "TS-9822";
    const clean = startSession(sessionId);
    clean.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    const rowRevision = Number((db.prepare("SELECT revision AS r FROM tutor_sessions WHERE session_id = ?").get(sessionId) as { r: number }).r);
    const nextSeq = clean.events.length + 1;
    db.prepare(
      "INSERT INTO tutor_session_events (session_id, sequence, event_type, payload_json, occurred_at, idempotency_key, recorded_revision, recorded_at, causation_sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      sessionId,
      nextSeq,
      "action_outcome_recorded",
      JSON.stringify({ action_id: "SC-db-tamper-0001", action_kind: "student_command", outcome: "completed", resulting_revision: 1 }),
      new Date().toISOString(),
      `tamper-${sessionId}`,
      rowRevision + 1,
      new Date().toISOString(),
      2,
    );
    db.prepare("UPDATE tutor_sessions SET revision = ? WHERE session_id = ?").run(rowRevision + 1, sessionId);
    expectCode(() => clean.kernel.rebuild(), "CORRUPT_EVENT");
    // 清理后健康流可重建（fail closed 不留残余影响）。
    db.prepare("DELETE FROM tutor_session_events WHERE session_id = ? AND idempotency_key = ?").run(sessionId, `tamper-${sessionId}`);
    db.prepare("UPDATE tutor_sessions SET revision = ? WHERE session_id = ?").run(rowRevision, sessionId);
    assert.equal(clean.kernel.rebuild().teaching_cursor.beat_id, "BT-02");
  });

  await runTest("R1 reasoning focus: interpretation-carried focus overwrites state without moving the cursor; rebuild identical", () => {
    // 旧流（不含 reasoning_focus 载荷）：state.reasoning_focus 保持缺省。
    const legacy = startSession("TS-9823");
    legacy.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    assert.equal(legacy.state.reasoning_focus, undefined);
    assert.equal(legacy.kernel.rebuild().reasoning_focus, undefined);
    // 学生追问旧推理区域：cursor 不动、focus 转局部子图（R0 §1 语义）。
    // 注：BT-02 分支 trigger=request_scaffold 不匹配 ask_question → 该问题
    // 打开 session-local inquiry（主线游标冻结——正是 focus 转移的语境）。
    const session = startSession("TS-9824");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "cr-0002" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02", "focus transfer must not move the mainline cursor");
    assert.deepEqual(session.state.reasoning_focus?.graph_fact_refs, ["FN-03"]);
    const askedInterpretation = session.events.filter((event) => event.event_type === "semantic_interpretation_recorded").at(-1);
    assert.deepEqual((askedInterpretation?.payload as { reasoning_focus?: { graph_fact_refs: string[] } }).reasoning_focus, { graph_fact_refs: ["FN-03"] });
    // FN-03 是 given fact：区域内部推导不出 inference（无 conclusion=FN-03 的
    // 推理步）→ 按合同省略 alignment（expected_region 必带 inference_ids，
    // 推导不出就不得伪造引用——fail closed 表达）。
    assert.equal((askedInterpretation?.payload as { reasoning_alignment?: { kind: string } }).reasoning_alignment, undefined);
    // 重建与在线同构：fold/在线同一 reducer（含 focus 覆写）。
    assert.equal(session.assertReplayParity().equal, true);
    assert.deepEqual(session.kernel.rebuild().reasoning_focus, session.state.reasoning_focus);
    // 后续命中新 fact 的作答（独立旅程）：focus 被新载荷整体覆写（FN-05 ←
    // IF-02 conclusion，expected_region 引用集可推导），主线推进照常。
    const journey = startSession("TS-9829");
    journey.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    submitWorkspaceCommandWithReceipt(journey, { command_id: "SC-TS-9829-0001" });
    assert.equal(journey.state.teaching_cursor.beat_id, "BT-03");
    journey.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-0002" });
    assert.deepEqual(journey.state.reasoning_focus?.graph_fact_refs, ["FN-05"]);
    const answeredInterpretation = journey.events.filter((event) => event.event_type === "semantic_interpretation_recorded").at(-1);
    assert.equal((answeredInterpretation?.payload as { reasoning_alignment?: { kind: string } }).reasoning_alignment?.kind, "expected_region");
    assert.deepEqual(journey.kernel.rebuild().reasoning_focus?.graph_fact_refs, ["FN-05"]);
    assert.equal(journey.state.teaching_cursor.beat_id, "BT-04");
    assert.equal(journey.assertReplayParity().equal, true);
  });

  await runTest("R1 adversarial answers (negation / wrong value / stuffing) classify incorrect_reasoning and stop at the clarification gate", () => {
    const adversarialTexts = [
      "并不是 AE=AC=4", // negation：显式否定正确事实
      "AE=AC=5", // 关键词正确但结论数值错误
      "翻折不变量 AE=AC=4、DE=DC=t，所以 BE=3，勾股定理 AB=5，全部线段长都知道了", // answer stuffing：正确片段 + 编造数值
    ];
    for (const [index, text] of adversarialTexts.entries()) {
      // 每个对抗样本独立旅程推进到 BT-03（student_answer gate GT-03/FN-05）。
      const session = startSession(["TS-9830", "TS-9831", "TS-9832"][index]);
      session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
      submitWorkspaceCommandWithReceipt(session, { command_id: ["SC-TS-9830-0001", "SC-TS-9831-0001", "SC-TS-9832-0001"][index] });
      assert.equal(session.state.teaching_cursor.beat_id, "BT-03");
      const turn = session.acceptStudentIntent({ intent_kind: "submit_answer", text, client_request_id: "cr-adv" });
      assert.equal(turn.decision?.decision_kind, "request_clarification", `adversarial answer #${index} must reach the clarification gate`);
      const interpretation = session.events.filter((event) => event.event_type === "semantic_interpretation_recorded").at(-1);
      const alignment = (interpretation?.payload as { reasoning_location: string; reasoning_alignment?: { kind: string; anchored_fact_ids?: string[] } });
      assert.equal(alignment.reasoning_location, "misaligned");
      assert.equal(alignment.reasoning_alignment?.kind, "incorrect_reasoning");
      assert.deepEqual(alignment.reasoning_alignment?.anchored_fact_ids, ["FN-05"]);
      const gate = session.events.filter((event) => event.event_type === "gate_evaluated").at(-1);
      assert.equal((gate?.payload as { satisfied: boolean }).satisfied, false, `adversarial answer #${index} must not satisfy the gate`);
      assert.equal(session.state.teaching_cursor.beat_id, "BT-03", `adversarial answer #${index} must not advance the mainline`);
      assert.equal(session.assertReplayParity().equal, true);
    }
    // 连续未解决的升级路径仍是计划内批准 unclear 分支（非 transition；主线冻结）。
    const escalating = startSession("TS-9833");
    escalating.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    submitWorkspaceCommandWithReceipt(escalating, { command_id: "SC-TS-9833-0001" });
    escalating.acceptStudentIntent({ intent_kind: "submit_answer", text: adversarialTexts[0], client_request_id: "cr-e1" });
    const escalated = escalating.acceptStudentIntent({ intent_kind: "submit_answer", text: adversarialTexts[1], client_request_id: "cr-e2" });
    assert.equal(escalated.decision?.decision_kind, "open_scaffold");
    assert.equal(escalated.decision?.inquiry?.inquiry_protocol_id, "PR-SMV-002");
    assert.equal(escalating.state.teaching_cursor.beat_id, "BT-03", "escalation opens an approved branch without advancing the mainline");
    assert.equal(escalating.assertReplayParity().equal, true);
  });

  await runTest("R1 low-confidence in-bound assistance and silence reach the clarification gate (no_progress fact, no branch)", () => {
    const session = startSession("TS-9826");
    session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    // 低置信但 in_bound（仅命中 Beat purpose，未命中任何 fact）：BT-02 声明的
    // request_scaffold 分支本可匹配，但低置信假设不得开分支——澄清门禁优先。
    const lowConfidence = session.acceptStudentIntent({
      intent_kind: "request_scaffold",
      text: "等角翻译成等边是什么意思",
      client_request_id: "cr-0002",
    });
    assert.equal(lowConfidence.decision?.decision_kind, "request_clarification");
    assert.equal(session.events.some((event) => event.event_type === "inquiry_opened"), false);
    const lowInterpretation = session.events.filter((event) => event.event_type === "semantic_interpretation_recorded").at(-1);
    assert.ok((lowInterpretation?.payload as { confidence: number }).confidence < 0.6);
    assert.equal((lowInterpretation?.payload as { reasoning_alignment?: { kind: string } }).reasoning_alignment?.kind, "unclear_reasoning");
    // silence：no_progress 假设入流 → 澄清（主线），无 gate_satisfied。
    const silence = session.reportSilence();
    assert.equal(silence.decision?.decision_kind, "request_clarification");
    const noProgress = session.events.filter((event) => event.event_type === "semantic_interpretation_recorded").at(-1);
    assert.equal((noProgress?.payload as { reasoning_alignment?: { kind: string } }).reasoning_alignment?.kind, "no_progress");
    assert.notEqual(session.state.teaching_cursor.phase, "gate_satisfied");
    // local inquiry 内的 silence：bounded 纪律强制返回主线（游标冻结后回返回点）。
    const local = startSession("TS-9827");
    local.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "cr-0001" }); // BT-01 分支 trigger 不匹配 → LocalInquiry
    assert.ok(local.state.inquiry_cursor);
    const forced = local.reportSilence();
    assert.equal(forced.decision?.decision_kind, "return_to_mainline");
    assert.equal(local.state.inquiry_cursor, null);
    assert.equal(local.state.teaching_cursor.beat_id, "BT-01");
    assert.equal(local.assertReplayParity().equal, true);
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("R1 structured LocalInquiryProtocol: six elements persisted once, replayable from events, boundary-checked, plan untouched", () => {
    const importedSnapshot = JSON.stringify(importGoldenPlan());
    const planContentHash = JSON.parse(importedSnapshot).plan.content_hash;
    const session = startSession("TS-9828");
    const opened = session.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "cr-0001" });
    assert.equal(opened.decision?.decision_kind, "open_inquiry");
    assert.equal(opened.decision?.inquiry?.inquiry_protocol_id, undefined);
    const protocol = opened.decision?.local_inquiry_protocol;
    assert.ok(protocol, "local open_inquiry decision carries the structured protocol");
    // 六要素（09:1288 逐字段）。
    assert.ok(protocol.local_protocol_id.startsWith("LPR-TS-9828-"));
    assert.equal(protocol.source_plan.artifact_id, "TP-SMV-009");
    assert.deepEqual(protocol.anchor_fact_ids, ["FN-01", "FN-02", "FN-03"]);
    assert.ok(protocol.anchor_inference_ids && protocol.anchor_inference_ids.length >= 1);
    assert.deepEqual(protocol.beats.map((beat) => beat.beat_id), ["LBT-01", "LBT-02", "LBT-03"]);
    assert.ok(protocol.beats.every((beat) => beat.support_boundary.may_reveal_answer === false));
    assert.deepEqual(protocol.beats.map((beat) => beat.resource_ids), [["RES1"], ["RES1"], ["RES1"]]);
    assert.equal(protocol.return_beat_id, "BT-01");
    assert.equal(protocol.expires_with_session, true);
    assert.ok(protocol.transitions.some((edge) => edge.from_beat === "LBT-03" && edge.to_beat === "BT-01" && edge.on === "gate_satisfied"));
    // 随决策事件持久化（canonical append 侧校验通过），inquiry_opened local=true。
    const committedDecision = session.events.find(
      (event) => event.event_type === "policy_decision_made" && (event.payload as { decision_id: string }).decision_id === opened.decision?.decision_id,
    );
    assert.deepEqual((committedDecision?.payload as { local_inquiry_protocol?: unknown }).local_inquiry_protocol, protocol);
    const openedEvent = session.events.find((event) => event.event_type === "inquiry_opened");
    assert.equal((openedEvent?.payload as { local: boolean }).local, true);
    assert.equal("inquiry_protocol_id" in (openedEvent?.payload ?? {}), false);
    // 步进 + 强制返回后，事件流可完整重建协议结构（开协议→步进→return）。
    for (let step = 0; step < MAX_LOCAL_INQUIRY_STEPS; step += 1) {
      session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: `cr-l${step}` });
    }
    const forced = session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "cr-lfinal" });
    assert.equal(forced.decision?.decision_kind, "return_to_mainline");
    const replayed = findLocalInquiryProtocol(session.events, opened.decision?.inquiry?.inquiry_id ?? "");
    assert.deepEqual(replayed, protocol, "protocol structure is fully replayable from committed events");
    // Builder 确定性：同输入重建逐字节相同。
    const anchorBeat = session.plan.mainline.beats.get("BT-01");
    assert.ok(anchorBeat);
    const rebuilt = buildLocalInquiryProtocol({
      plan: session.plan,
      anchorBeat,
      sessionId: "TS-9828",
      sequence: opened.decision?.source_event_sequence ?? 0,
      inquiryId: opened.decision?.inquiry?.inquiry_id ?? "",
    });
    assert.deepEqual(rebuilt, protocol);
    // 边界校验 fail closed（越界协议拒绝——真实 assert 入口）。
    const protocolType = protocol as NonNullable<typeof protocol>;
    const tamper = (mutate: (draft: typeof protocolType) => void): typeof protocolType => {
      const draft = JSON.parse(JSON.stringify(protocol)) as typeof protocolType;
      mutate(draft);
      return draft;
    };
    assert.throws(
      () => localInquiry5.assertLocalInquiryProtocolBoundary(session.plan, tamper((draft) => { draft.anchor_fact_ids = ["FN-99"]; })),
      LocalInquiryBoundaryError,
    );
    assert.throws(
      () => localInquiry5.assertLocalInquiryProtocolBoundary(session.plan, tamper((draft) => { draft.beats[0]!.resource_ids = ["RES-999"]; })),
      LocalInquiryBoundaryError,
    );
    assert.throws(
      () => localInquiry5.assertLocalInquiryProtocolBoundary(session.plan, tamper((draft) => { draft.return_beat_id = "BT-99"; })),
      LocalInquiryBoundaryError,
    );
    assert.throws(
      () => localInquiry5.assertLocalInquiryProtocolBoundary(session.plan, tamper((draft) => { (draft.beats[0]!.support_boundary as { may_reveal_answer: boolean }).may_reveal_answer = true; })),
      LocalInquiryBoundaryError,
    );
    assert.throws(
      () => localInquiry5.assertLocalInquiryProtocolBoundary(session.plan, tamper((draft) => { draft.source_plan = { artifact_id: "TP-SMV-008", version: "v1", content_hash: `sha256:${"0".repeat(64)}` }; })),
      LocalInquiryBoundaryError,
    );
    // Plan-untouched 强断言：深比较 + importer 公开入口复算 content hash。
    assert.equal(JSON.stringify(importGoldenPlan()), importedSnapshot, "deep comparison: the imported plan object is untouched");
    assert.equal(JSON.parse(importedSnapshot).plan.content_hash, planContentHash);
    assert.equal(session.state.pinned_plan.tutor_plan_ref.content_hash, planContentHash);
    assert.equal(session.state.pinned_plan.protocol_refs.length, 2, "pin refs unchanged (no protocol write-back)");
    assert.equal(session.assertReplayParity().equal, true);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
