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
 * Plan 输入 = F4 importer 真实 Approved 链（TP-SMV-009@v3，registry 锚定对账）。
 *
 * ## R3（2026-08-31）：自然语言 Gate 由模型裁决，确定性测试注入固定响应
 * provider（判卷人换假模型，断言口径不变——用户裁定 4B）；R1 结构化路径
 * 负例（workspace/confirmation/narration/timeout/orphan）原样保留为回归基线。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ANSWER_ALTERNATE_COORDINATE,
  ANSWER_GOAL_OK,
  ANSWER_INVARIANTS_OK,
  ANSWER_INVARIANTS_WRONG,
  adjudicationJson,
  failFor,
  FIXTURES_DIR,
  GOLDEN,
  passFor,
  QUESTION_IN_BOUND,
  QUESTION_OUT_OF_BOUND,
  SCAFFOLD_STEP1_OK,
  questionOn,
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
const adjudicator5 = require("../ModelGateAdjudicatorV5") as typeof import("../ModelGateAdjudicatorV5");

const { NavigatorSessionV5 } = session5;
const { decideNavigation, MAX_LOCAL_INQUIRY_STEPS, canonicalPolicyFailureClass } = navigator5;
const { hypothesisFromAdjudication } = interpreter5;
const { buildExternalSupportEvidence } = ese5;
const { buildLocalInquiryProtocol, findLocalInquiryProtocol, LocalInquiryBoundaryError } = localInquiry5;
const { FixedResponseGateProvider, HangingGateProvider } = adjudicator5;

type NavigatorSession = import("../NavigatorSessionV5").NavigatorSessionV5;
type TurnResult = import("../NavigatorSessionV5").TurnResult;

interface StartOptions {
  responses?: readonly string[];
  provider?: import("../ModelGateAdjudicatorV5").GateAdjudicationProvider;
  modelTimeoutMs?: number;
}

function startSession(sessionId: string, options: StartOptions = {}): NavigatorSession {
  const provider =
    options.provider ??
    (options.responses !== undefined ? new FixedResponseGateProvider(options.responses) : undefined);
  return NavigatorSessionV5.start({
    sessionId,
    studentId: "student-nav5",
    canonicalRoot: realCanonicalRoot(),
    tpId: GOLDEN.tpId,
    taskId: GOLDEN.taskId,
    scenarioId: GOLDEN.scenarioId,
    ...(provider !== undefined ? { gateProvider: provider } : {}),
    ...(options.modelTimeoutMs !== undefined ? { modelTimeoutMs: options.modelTimeoutMs } : {}),
  });
}

function latestIntentSeq(session: NavigatorSession): number {
  const intent = [...session.events].reverse().find((event) => event.event_type === "student_intent_recorded");
  if (!intent) throw new Error("no committed student_intent_recorded for receipt causation");
  return intent.sequence;
}

/**
 * R1 workspace 回执链（真实提交路径）：学生命令意图（acceptStudentIntent →
 * intent+interpretation+decision 落库）→ F3 侧执行回执（appendExternalFacts——
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
  void session.acceptStudentIntent({
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
  session.appendExternalFacts(session.revision, [
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

/** 把 submit_workspace_command 轮的 promise 抽干（acceptStudentIntent 异步化）。 */
async function submitWorkspaceCommandWithReceiptAsync(
  session: NavigatorSession,
  input: Parameters<typeof submitWorkspaceCommandWithReceipt>[1],
): Promise<TurnResult> {
  const capability = input.capability ?? "similarity.mark-known-segments";
  await session.acceptStudentIntent({
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
  session.appendExternalFacts(session.revision, [
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

/** 固定裁决结果（hypothesisFromAdjudication 输入；server 已校验形状）。 */
function fixedAdjudication(fields: {
  response_kind: "final_answer" | "alternate_path" | "question" | "help_request" | "restatement" | "mixed_or_ambiguous";
  matched_gate_id?: string;
  verdict: "pass" | "fail" | "unclear" | "not_applicable";
  reasoning_location: "aligned" | "partially_aligned" | "misaligned" | "unknown";
  grounding_refs: readonly string[];
}): import("../ModelGateAdjudicatorV5").GateAdjudicationResult {
  return {
    response_kind: fields.response_kind,
    ...(fields.matched_gate_id !== undefined ? { matched_gate_id: fields.matched_gate_id } : {}),
    verdict: fields.verdict,
    reasoning_location: fields.reasoning_location,
    grounding_refs: [...fields.grounding_refs],
    provider: "fixed-response",
  };
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

  await runTest("G5 mainline journey: orientation -> three similarity chunks -> summary completes (rebuild identical at every step)", async () => {
    // v3：四个自然语言 gate 均由固定响应模型裁决；grounding 精确落到
    // 当下 Beat 的细图出口，而不是沿用 v2 的粗粒度 Fact 编号。
    const session = startSession("TS-9802", {
      responses: [
        passFor("GT-02", "FN-08"),
        passFor("GT-03", "FN-12"),
        passFor("GT-04", "FN-23"),
        passFor("GT-05", "FN-29"),
      ],
    });
    // BT-01（GT-01 student_confirmation）
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    // BT-02（GT-02：识别第一组子母型相似）
    await session.acceptStudentIntent({ intent_kind: "submit_answer", text: "△CAD∽△CBA，对应 C-C、A-B、D-A。", client_request_id: "cr-0002" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-03");
    // BT-03（GT-03：求出 AD、CD、BD）
    await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-0003" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-04");
    // BT-04（GT-04：第二组子母型相似与四条分段长度）
    await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_GOAL_OK, client_request_id: "cr-0004" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-05");
    // BT-05（GT-05：蝶形相似收束到 BE）
    await session.acceptStudentIntent({ intent_kind: "submit_answer", text: "△BOE∽△AOD，所以 BE:AD=3:8，BE=1。", client_request_id: "cr-0005" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-06");
    // BT-06（GT-06 summary confirmation → complete + session_completed）
    const final = await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0006" });
    assert.equal(final.decision?.decision_kind, "complete_beat");
    assert.equal(session.state.completed, true);
    assert.equal(session.state.teaching_cursor.phase, "completed");
    const completed = session.events.find((event) => event.event_type === "session_completed");
    assert.ok(completed);
    assert.deepEqual((completed.payload as { final_beat_id: string; completed_parts: string[] }), {
      final_beat_id: "BT-06",
      completed_parts: ["1"],
    });
    // 轨迹逐 Beat 推进：transition 决策链与游标一致，全journey rebuild 一致。
    const kinds = decisionsOf(session).map((decision) => decision.kind);
    assert.deepEqual(kinds, [
      "execute_beat",
      "transition_beat",
      "transition_beat",
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

  await runTest("G5 gate unsatisfied: wrong answer stays awaiting_evidence, no illegal transition; repeated unclear opens approved scaffold", async () => {
    const session = startSession("TS-9803", { responses: [failFor("FN-08"), failFor("FN-08")] });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    const first = await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_WRONG, client_request_id: "cr-0003" });
    assert.equal(first.decision?.decision_kind, "request_clarification");
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    assert.equal(session.state.teaching_cursor.phase, "awaiting_evidence");
    const unsatisfied = session.events.filter((event) => event.event_type === "gate_evaluated").at(-1);
    assert.equal((unsatisfied?.payload as { satisfied: boolean }).satisfied, false);
    // 第二次未解决 → BT-02 声明的 unclear 分支（PR-SMV-002，返回点 BT-02）。
    const second = await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_WRONG, client_request_id: "cr-0004" });
    assert.equal(second.decision?.decision_kind, "open_scaffold");
    assert.equal(second.decision?.inquiry?.inquiry_protocol_id, "PR-SMV-002");
    assert.equal(second.decision?.inquiry?.return_beat_id, "BT-02");
    assert.ok(session.state.inquiry_cursor);
    // 主线游标冻结在 BT-02。
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
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

  await runTest("G5 approved inquiry: open/advance/return with frozen mainline cursor and explicit return point (trajectory rebuilt)", async () => {
    const session = startSession("TS-9805", { responses: [questionOn("FN-03"), passFor("GT-01", "FN-05")] });
    const opened = await session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "cr-0001" });
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
    // 分支 Beat 1（student_answer，basis=requirement；R3 由固定响应模型判 pass）
    await session.acceptStudentIntent({ intent_kind: "submit_answer", text: SCAFFOLD_STEP1_OK, client_request_id: "cr-0002" });
    assert.equal(session.currentBeat.beat_id, "BT-02");
    // 分支 Beat 2（student_confirmation）
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0003" });
    assert.equal(session.currentBeat.beat_id, "BT-03");
    assert.equal(session.state.teaching_cursor.beat_id, "BT-01"); // 仍冻结
    // 分支 Beat 3（student_confirmation）
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0004" });
    assert.equal(session.currentBeat.beat_id, "BT-04");
    // 分支 Beat 4（学生选定最小下一步，末 Beat → return）
    const returned = await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0005" });
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
    assert.deepEqual(inInquiry, ["execute_beat", "open_inquiry", "continue_inquiry", "continue_inquiry", "continue_inquiry", "return_to_mainline"]);
  });

  await runTest("G5 scaffold support evidence: orient recorded within boundary; ladder violations fail closed; canonical fixtures agree", async () => {
    const session = startSession("TS-9806", { responses: [passFor("GT-02", "FN-08")] });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-0002" });
    assert.equal(session.currentBeat.beat_id, "BT-03");
    const opened = await session.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "cr-0003" });
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

  await runTest("G5 bounded LocalInquiryProtocol: fallback open is session-local, forced return at bound, plan untouched", async () => {
    const session = startSession("TS-9807", {
      responses: [questionOn("FN-03"), questionOn("FN-03"), questionOn("FN-03"), questionOn("FN-03")],
    });
    // BT-01 分支 trigger=ask_question：request_scaffold 不匹配 → fallback 链 → LocalInquiry。
    const opened = await session.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "cr-0001" });
    assert.equal(opened.decision?.decision_kind, "open_inquiry");
    assert.equal(opened.decision?.inquiry?.inquiry_protocol_id, undefined); // session-local
    const openedEvent = session.events.find((event) => event.event_type === "inquiry_opened");
    assert.equal((openedEvent?.payload as { local: boolean }).local, true);
    assert.equal(session.state.teaching_cursor.beat_id, "BT-01"); // 主线冻结
    // bounded：MAX_LOCAL_INQUIRY_STEPS 步内 continue，随后强制返回。
    for (let step = 0; step < MAX_LOCAL_INQUIRY_STEPS; step += 1) {
      const turn = await session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: `cr-1${step}` });
      assert.equal(turn.decision?.decision_kind, "continue_inquiry");
    }
    const forced = await session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "cr-9999" });
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

  await runTest("G5 barge-in pauses without cursor advance; out-of-bound falls back clarification -> safe fallback (no branch opened)", async () => {
    const session = startSession("TS-9808", { responses: [questionOn(null), questionOn(null)] });
    const barge = await session.acceptStudentIntent({ intent_kind: "barge_in", client_request_id: "cr-0001" });
    assert.equal(barge.decision?.decision_kind, "pause");
    assert.equal(session.state.teaching_cursor.beat_id, "BT-01");
    assert.equal(session.state.teaching_cursor.phase, "presenting");
    // out-of-bound：首次澄清，连续未解决 → 计划内安全 fallback；不打开任何分支。
    const first = await session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_OUT_OF_BOUND, client_request_id: "cr-0002" });
    assert.equal(first.decision?.decision_kind, "request_clarification");
    const second = await session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_OUT_OF_BOUND, client_request_id: "cr-0003" });
    assert.equal(second.decision?.decision_kind, "safe_fallback");
    assert.equal(session.events.some((event) => event.event_type === "inquiry_opened"), false);
    assert.equal(session.state.teaching_cursor.beat_id, "BT-01");
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("G5 timeout: bounded_wait beat transitions on declared timeout edge; student_driven beat refuses timeout explicitly", async () => {
    const session = startSession("TS-9809");
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    // BT-02 bounded_wait 180s，timeout 出边声明 BT-02→BT-02（自环重试）。
    const timeoutAtBt02 = session.reportTimeout();
    assert.equal(timeoutAtBt02.decision?.decision_kind, "transition_beat");
    assert.equal(timeoutAtBt02.decision?.to_beat_id, "BT-02");
    assert.deepEqual(timeoutAtBt02.decision?.transition_basis, { basis: "timeout" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    assert.equal(session.assertReplayParity().equal, true);
    // student_driven Beat 的 timeout：decide 真实入口显式拒绝（确定性 failure）。
    const fresh = startSession("TS-9810");
    const refused = fresh.reportTimeout();
    assert.equal(refused.failure?.failure_class, "no_legal_transition");
    const failed = fresh.events.filter((event) => event.event_type === "policy_failed");
    assert.equal((failed[0].payload as { failure_class: string }).failure_class, "no_legal_transition");
    assert.equal(fresh.state.teaching_cursor.beat_id, "BT-01");
  });

  await runTest("G5 accept_alternate_path: double-angle hypothesis verified against RG SV-02 before acceptance", async () => {
    const session = startSession("TS-9811", {
      responses: [adjudicationJson({ response_kind: "alternate_path", verdict: "not_applicable", reasoning_location: "aligned", grounding_refs: ["SV-02", "FN-29"] })],
    });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    const turn = await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_ALTERNATE_COORDINATE, client_request_id: "cr-0002" });
    assert.equal(turn.decision?.decision_kind, "accept_alternate_path");
    assert.deepEqual(turn.decision?.transition_basis, { basis: "student_evidence", graph_variant_id: "SV-02" });
    // decision 只描述教学选择：游标不动。
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("G5 determinism: same plan/state/interpretation -> identical decision or identical explicit failure (repeated decide)", async () => {
    const session = startSession("TS-9812");
    const base = {
      sessionId: session.sessionId,
      plan: session.plan,
      state: session.state,
      revision: session.revision,
      localInquirySteps: 0,
      unresolvedClarifications: 0,
    };
    // R3：假设来自同一次模型调用的固定裁决（in-bound 提问，引用 FN-03）。
    const hypothesis = hypothesisFromAdjudication({
      plan: session.plan,
      beat: session.currentBeat,
      intent_kind: "ask_question",
      text: QUESTION_IN_BOUND,
      adjudication: fixedAdjudication({ response_kind: "question", verdict: "not_applicable", reasoning_location: "aligned", grounding_refs: ["FN-03"] }),
      evidence_sequence: 7,
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
    const a = startSession("TS-9813", { responses: [questionOn(null), questionOn(null)] });
    const b = startSession("TS-9814", { responses: [questionOn(null), questionOn(null)] });
    const inputs = [
      { intent_kind: "confirm", client_request_id: "cr-1" },
      { intent_kind: "ask_question", text: QUESTION_OUT_OF_BOUND, client_request_id: "cr-2" },
      { intent_kind: "ask_question", text: QUESTION_OUT_OF_BOUND, client_request_id: "cr-3" },
    ] as const;
    for (const input of inputs) {
      await a.acceptStudentIntent({ ...input });
      await b.acceptStudentIntent({ ...input });
    }
    const stripSession = (value: unknown): string => JSON.stringify(value).replaceAll("TS-9813", "TS-XXXX").replaceAll("TS-9814", "TS-XXXX");
    assert.equal(stripSession(a.events.map(({ payload, event_type }) => ({ event_type, payload }))), stripSession(b.events.map(({ payload, event_type }) => ({ event_type, payload }))));
    assert.equal(a.assertReplayParity().equal, true);
    assert.equal(b.assertReplayParity().equal, true);
  });

  await runTest("G5 negative persistence via real append path: stale revision / duplicate idempotency roll back whole batches", async () => {
    const session = startSession("TS-9815");
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    // R3.1：外部事实入口只收 action_outcome_recorded 回执——store 事务语义
    //（乐观并发/幂等键）改经合法载具验证（先提交 workspace 命令 intent）。
    await session.acceptStudentIntent({
      intent_kind: "submit_workspace_command",
      client_request_id: "cr-wc-915",
      workspace_command: {
        command_id: "SC-TS-9815-0001",
        surface: "geometry",
        capability: "similarity.mark-known-segments",
        target_ids: ["seg-AD"],
        expected_workspace_revision: 0,
        client_command_id: "cc-915",
      },
    });
    const countBefore = session.events.length;
    const revision = session.revision;
    const receipt = () => ({
      event_type: "action_outcome_recorded" as const,
      payload: { action_id: "SC-TS-9815-0001", action_kind: "student_command", outcome: "completed", resulting_revision: 1 },
      occurred_at: new Date().toISOString(),
      causation_sequence: latestIntentSeq(session),
    });
    // stale expectedRevision：整批拒绝（store 事务先核对乐观并发）。
    expectCode(
      () => session.appendExternalFacts(revision + 5, [receipt()]),
      "REVISION_CONFLICT",
    );
    assert.equal(session.events.length, countBefore);
    // 幂等键重复（复用已提交命令 intent 的 key）：DUPLICATE_EVENT，零新事实。
    const committed = session.events.find(
      (event) => event.event_type === "student_intent_recorded" &&
        (event.payload as { workspace_command?: { command_id: string } }).workspace_command?.command_id === "SC-TS-9815-0001",
    );
    assert.ok(committed);
    expectCode(
      () => session.appendExternalFacts(session.revision, [{ ...receipt(), idempotency_key: committed.idempotency_key }]),
      "DUPLICATE_EVENT",
    );
    assert.equal(session.events.length, countBefore);
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("G5 new path writes zero TutorMove/Hint/H control facts (event vocabulary + payload scan)", async () => {
    const session = startSession("TS-9816");
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    session.completeNarration(); // 显式 failure 也入流（policy_failed）
    await submitWorkspaceCommandWithReceiptAsync(session, { command_id: "SC-TS-9816-0001" });
    await session.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "cr-0003" });
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

  await runTest("G5 canonical fixtures consumed: decision positive/negative + navigator decision passes canonical v1", async () => {
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
    const turn = await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
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

  await runTest("G5 interpreter hypotheses are refutable: unknown classification recorded, branch trigger discipline enforced", async () => {
    const session = startSession("TS-9818", {
      responses: [adjudicationJson({ response_kind: "mixed_or_ambiguous", verdict: "unclear", reasoning_location: "unknown" })],
    });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    // BT-02 的分支 trigger=request_scaffold（不是 unclear）：unknown 假设不得
    // 打开该分支——trigger 不匹配 → 澄清（假设可推翻，Navigator 不迁就假设）。
    const turn = await session.acceptStudentIntent({ intent_kind: "submit_answer", text: "完全不知道", client_request_id: "cr-0002" });
    assert.equal(turn.decision?.decision_kind, "request_clarification");
    assert.equal(session.events.some((event) => event.event_type === "inquiry_opened"), false);
    const interpretation = session.events.filter((event) => event.event_type === "semantic_interpretation_recorded").at(-1);
    assert.equal((interpretation?.payload as { reasoning_location: string }).reasoning_location, "unknown");
    // 主线仍在 BT-02（clarification 是事实，不推进游标）。
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("G5 completed guard: after session_completed no further teaching decision is legal (explicit failure fact)", async () => {
    const session = startSession("TS-9819", {
      responses: [
        passFor("GT-02", "FN-08"),
        passFor("GT-03", "FN-12"),
        passFor("GT-04", "FN-23"),
        passFor("GT-05", "FN-29"),
        questionOn("FN-03"),
      ],
    });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-0002" });
    await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-0003" });
    await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_GOAL_OK, client_request_id: "cr-0004" });
    await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_GOAL_OK, client_request_id: "cr-0005" });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0006" });
    assert.equal(session.state.completed, true);
    const completedCount = session.events.filter((event) => event.event_type === "session_completed").length;
    // 收束后的新输入：只落 intent/interpretation fact + 显式 failure，不产生新决策。
    const after = await session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "cr-0007" });
    assert.equal(after.failure?.failure_class, "no_legal_transition");
    assert.equal(session.events.filter((event) => event.event_type === "session_completed").length, completedCount);
    assert.equal(session.events.filter((event) => event.event_type === "policy_decision_made").length, 7);
    assert.equal(session.assertReplayParity().equal, true);
  });

  // ------------------------------------------------------------------ //
  // R1 修复波次（2026-08-31）：outcome 回执消费模式 / ReasoningFocus /
  // 五类 alignment 对抗负例 / LocalInquiryProtocol 结构化 / Plan-untouched。
  // （student_answer 路径判卷人已换固定响应模型——用户裁定 4B，断言不变。）
  // ------------------------------------------------------------------ //

  await runTest("R1 workspace outcome receipts are consumed, never self-reported (fail closed without a committed receipt)", async () => {
    const session = startSession("TS-9820");
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    const turn = await submitWorkspaceCommandWithReceiptAsync(session, { command_id: "SC-TS-9820-0001" });
    // v3 当前 BT-02 是自然语言 gate：合法 workspace 回执可以入流，但绝不能
    // 旁路满足 student_answer gate 或推动 Beat。
    assert.equal(turn.decision, undefined);
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
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
    await session.acceptStudentIntent({
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

  await runTest("R1 orphan/mismatch student_command receipts fail closed at persistence and rebuild boundaries", async () => {
    const session = startSession("TS-9821");
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    const countBefore = session.events.length;
    // (a) 孤儿回执（无对应已提交命令）：append 边界整批拒绝（store 事务内先纯
    // 折叠，reducer 拒绝 ⇒ 回滚）。
    expectCode(
      () =>
        session.appendExternalFacts(session.revision, [
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
    // (b) 当前是 student_answer gate：任何 workspace capability 都不能被错配成
    // 当前 gate 的证据，消费回执后零决策、游标不动。
    const wrongCapability = await submitWorkspaceCommandWithReceiptAsync(session, { command_id: "SC-TS-9821-wrong", capability: "similarity.map-corresponding-sides" });
    assert.equal(wrongCapability.decision, undefined);
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    // (c) resulting_revision 与流内状态不符（expected=1，携带 r=5）：append 拒绝。
    await session.acceptStudentIntent({
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
        session.appendExternalFacts(session.revision, [
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
    const rejected = await submitWorkspaceCommandWithReceiptAsync(session, { command_id: "SC-TS-9821-rej", outcome: "rejected", expectedRevision: 1 });
    assert.equal(rejected.decision, undefined);
    assert.equal(session.state.workspace_revision, 1, "rejected outcome must not advance workspace_revision");
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    const recovered = await submitWorkspaceCommandWithReceiptAsync(session, { command_id: "SC-TS-9821-ok", expectedRevision: 1 });
    assert.equal(recovered.decision, undefined);
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    assert.equal(session.state.workspace_revision, 2);
    assert.equal(session.assertReplayParity().equal, true);
    // (e) 重建边界：绕过 store 直写 DB 的孤儿回执 → rebuild/resume fail closed。
    const sessionId = "TS-9822";
    const clean = startSession(sessionId);
    await clean.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
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
    expectCode(() => clean.rebuildState(), "CORRUPT_EVENT");
    // 清理后健康流可重建（fail closed 不留残余影响）。
    db.prepare("DELETE FROM tutor_session_events WHERE session_id = ? AND idempotency_key = ?").run(sessionId, `tamper-${sessionId}`);
    db.prepare("UPDATE tutor_sessions SET revision = ? WHERE session_id = ?").run(rowRevision, sessionId);
    assert.equal(clean.rebuildState().teaching_cursor.beat_id, "BT-02");
  });

  await runTest("R1 reasoning focus: interpretation-carried focus overwrites state without moving the cursor; rebuild identical", async () => {
    // 旧流（不含 reasoning_focus 载荷）：state.reasoning_focus 保持缺省。
    const legacy = startSession("TS-9823");
    await legacy.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    assert.equal(legacy.state.reasoning_focus, undefined);
    assert.equal(legacy.rebuildState().reasoning_focus, undefined);
    // 学生追问旧推理区域：cursor 不动、focus 转局部子图（R0 §1 语义）。
    // 注：BT-02 分支 trigger=request_scaffold 不匹配 ask_question → 该问题
    // 打开 session-local inquiry（主线游标冻结——正是 focus 转移的语境）。
    const session = startSession("TS-9824", { responses: [questionOn("FN-06")] });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    await session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "cr-0002" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02", "focus transfer must not move the mainline cursor");
    assert.deepEqual(session.state.reasoning_focus?.graph_fact_refs, ["FN-06"]);
    const askedInterpretation = session.events.filter((event) => event.event_type === "semantic_interpretation_recorded").at(-1);
    assert.deepEqual((askedInterpretation?.payload as { reasoning_focus?: { part_id?: string; graph_fact_refs: string[] } }).reasoning_focus, {
      part_id: "1",
      graph_fact_refs: ["FN-06"],
    });
    // FN-06 是教研审核后的根事实：区域内部推导不出 inference（无 conclusion=FN-06 的
    // 推理步）→ 按合同省略 alignment（expected_region 必带 inference_ids，
    // 推导不出就不得伪造引用——fail closed 表达）。
    assert.equal((askedInterpretation?.payload as { reasoning_alignment?: { kind: string } }).reasoning_alignment, undefined);
    // 重建与在线同构：fold/在线同一 reducer（含 focus 覆写）。
    assert.equal(session.assertReplayParity().equal, true);
    assert.deepEqual(session.rebuildState().reasoning_focus, session.state.reasoning_focus);
    // 后续命中新 fact 的作答（独立旅程）：focus 被新载荷整体覆写（FN-08 ←
    // IF-01 conclusion，expected_region 引用集可推导），主线推进照常。
    const journey = startSession("TS-9829", { responses: [passFor("GT-02", "FN-08")] });
    await journey.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    await journey.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-0002" });
    assert.deepEqual(journey.state.reasoning_focus?.graph_fact_refs, ["FN-08"]);
    const answeredInterpretation = journey.events.filter((event) => event.event_type === "semantic_interpretation_recorded").at(-1);
    assert.equal((answeredInterpretation?.payload as { reasoning_alignment?: { kind: string } }).reasoning_alignment?.kind, "expected_region");
    assert.deepEqual(journey.rebuildState().reasoning_focus?.graph_fact_refs, ["FN-08"]);
    assert.equal(journey.state.teaching_cursor.beat_id, "BT-03");
    assert.equal(journey.assertReplayParity().equal, true);
  });

  await runTest("R1 adversarial answers (negation / wrong value / stuffing) classify incorrect_reasoning and stop at the clarification gate", async () => {
    const adversarialTexts = [
      "并不是 AE=AC=4", // negation：显式否定正确事实
      "AE=AC=5", // 关键词正确但结论数值错误
      "△CAD∽△CBA，AD=CD=8/3、BD=10/3，所以 BE=3，全部线段长都知道了", // answer stuffing：正确片段 + 编造最终值
    ];
    for (const [index, text] of adversarialTexts.entries()) {
      // 每个对抗样本在 BT-02（student_answer gate GT-02/FN-08）接受裁决；
      // R3：判卷人=固定响应模型（fail + 锚定 FN-08）。
      const session = startSession(["TS-9830", "TS-9831", "TS-9832"][index], { responses: [failFor("FN-08")] });
      await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
      assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
      const turn = await session.acceptStudentIntent({ intent_kind: "submit_answer", text, client_request_id: "cr-adv" });
      assert.equal(turn.decision?.decision_kind, "request_clarification", `adversarial answer #${index} must reach the clarification gate`);
      const interpretation = session.events.filter((event) => event.event_type === "semantic_interpretation_recorded").at(-1);
      const alignment = (interpretation?.payload as { reasoning_location: string; reasoning_alignment?: { kind: string; anchored_fact_ids?: string[] } });
      assert.equal(alignment.reasoning_location, "misaligned");
      assert.equal(alignment.reasoning_alignment?.kind, "incorrect_reasoning");
      assert.deepEqual(alignment.reasoning_alignment?.anchored_fact_ids, ["FN-08"]);
      const gate = session.events.filter((event) => event.event_type === "gate_evaluated").at(-1);
      assert.equal((gate?.payload as { satisfied: boolean }).satisfied, false, `adversarial answer #${index} must not satisfy the gate`);
      assert.equal(session.state.teaching_cursor.beat_id, "BT-02", `adversarial answer #${index} must not advance the mainline`);
      assert.equal(session.assertReplayParity().equal, true);
    }
    // 连续未解决的升级路径仍是计划内批准 unclear 分支（非 transition；主线冻结）。
    const escalating = startSession("TS-9833", { responses: [failFor("FN-08"), failFor("FN-08")] });
    await escalating.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    await escalating.acceptStudentIntent({ intent_kind: "submit_answer", text: adversarialTexts[0], client_request_id: "cr-e1" });
    const escalated = await escalating.acceptStudentIntent({ intent_kind: "submit_answer", text: adversarialTexts[1], client_request_id: "cr-e2" });
    assert.equal(escalated.decision?.decision_kind, "open_scaffold");
    assert.equal(escalated.decision?.inquiry?.inquiry_protocol_id, "PR-SMV-002");
    assert.equal(escalating.state.teaching_cursor.beat_id, "BT-02", "escalation opens an approved branch without advancing the mainline");
    assert.equal(escalating.assertReplayParity().equal, true);
  });

  await runTest("R1 low-confidence in-bound assistance and silence reach the clarification gate (no_progress fact, no branch)", async () => {
    const session = startSession("TS-9826", {
      responses: [adjudicationJson({ response_kind: "help_request", verdict: "not_applicable", reasoning_location: "unknown" })],
    });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    // 低置信但 in_bound（模型无 canonical grounding → out-of-bound 低置信假设）：
    // BT-02 声明的 request_scaffold 分支本可匹配，但低置信假设不得开分支——澄清门禁优先。
    const lowConfidence = await session.acceptStudentIntent({
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
    await local.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "cr-0001" }); // BT-01 分支 trigger 不匹配 → LocalInquiry
    assert.ok(local.state.inquiry_cursor);
    const forced = local.reportSilence();
    assert.equal(forced.decision?.decision_kind, "return_to_mainline");
    assert.equal(local.state.inquiry_cursor, null);
    assert.equal(local.state.teaching_cursor.beat_id, "BT-01");
    assert.equal(local.assertReplayParity().equal, true);
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("R1 structured LocalInquiryProtocol: six elements persisted once, replayable from events, boundary-checked, plan untouched", async () => {
    const importedSnapshot = JSON.stringify(importGoldenPlan());
    const planContentHash = JSON.parse(importedSnapshot).plan.content_hash;
    const session = startSession("TS-9828", {
      responses: [questionOn("FN-03"), questionOn("FN-03"), questionOn("FN-03"), questionOn("FN-03")],
    });
    const opened = await session.acceptStudentIntent({ intent_kind: "request_scaffold", client_request_id: "cr-0001" });
    assert.equal(opened.decision?.decision_kind, "open_inquiry");
    assert.equal(opened.decision?.inquiry?.inquiry_protocol_id, undefined);
    const protocol = opened.decision?.local_inquiry_protocol;
    assert.ok(protocol, "local open_inquiry decision carries the structured protocol");
    // 六要素（09:1288 逐字段）。
    assert.ok(protocol.local_protocol_id.startsWith("LPR-TS-9828-"));
    assert.equal(protocol.source_plan.artifact_id, "TP-SMV-009");
    assert.deepEqual(protocol.anchor_fact_ids, ["FN-01", "FN-02", "FN-03", "FN-04"]);
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
      await session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: `cr-l${step}` });
    }
    const forced = await session.acceptStudentIntent({ intent_kind: "ask_question", text: QUESTION_IN_BOUND, client_request_id: "cr-lfinal" });
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

  // ------------------------------------------------------------------ //
  // R3 波次（2026-08-31）：模型故障矩阵 / 候选集与 grounding 薄边界 /
  // Gate-Beat 身份校验 / kernel 私有化 / 幂等重试 / resume Plan-aware 核对 /
  // P3-2（student_command failed 回执负例）。
  // ------------------------------------------------------------------ //

  await runTest("R3 model failure matrix: unavailable / timeout / non-JSON / missing fields / unknown gate / pass with out-of-plan grounding all fail closed (unclear, no beat advance, runtime/model failure fact, not student incorrect)", async () => {
    const failureResponses: Array<{ label: string; provider: import("../ModelGateAdjudicatorV5").GateAdjudicationProvider; timeoutMs?: number }> = [
      { label: "provider unavailable", provider: new adjudicator5.UnavailableGateProvider() },
      { label: "provider timeout", provider: new HangingGateProvider(), timeoutMs: 40 },
      { label: "non-JSON output", provider: new FixedResponseGateProvider(["我认为这个答案是对的，可以通过。"]) },
      { label: "missing required fields", provider: new FixedResponseGateProvider([JSON.stringify({ response_kind: "final_answer" })]) },
      { label: "matched_gate_id outside candidates (GT-99)", provider: new FixedResponseGateProvider([adjudicationJson({ matched_gate_id: "GT-99", verdict: "pass", grounding_refs: ["FN-08"] })]) },
      { label: "pass with grounding outside the plan (FN-99)", provider: new FixedResponseGateProvider([adjudicationJson({ matched_gate_id: "GT-02", verdict: "pass", grounding_refs: ["FN-99"] })]) },
    ];
    for (const [index, entry] of failureResponses.entries()) {
      const sessionId = `TS-9${(840 + index).toString().padStart(3, "0")}`;
      const session = NavigatorSessionV5.start({
        sessionId,
        studentId: "student-r3",
        canonicalRoot: realCanonicalRoot(),
        tpId: GOLDEN.tpId,
        taskId: GOLDEN.taskId,
        scenarioId: GOLDEN.scenarioId,
        gateProvider: entry.provider,
        ...(entry.timeoutMs !== undefined ? { modelTimeoutMs: entry.timeoutMs } : {}),
      });
      await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
      assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
      const turn = await session.acceptStudentIntent({
        intent_kind: "submit_answer",
        text: "由 △CAD∽△CBA 得 AD=CD=8/3、BD=10/3",
        client_request_id: "cr-0002",
      });
      // 统一不推进 Beat：unclear 降级 → 澄清门禁（或安全 fallback），非 student incorrect。
      assert.equal(session.state.teaching_cursor.beat_id, "BT-02", `${entry.label}: model failure must not advance the beat`);
      assert.notEqual(turn.decision?.decision_kind, "transition_beat");
      assert.notEqual(turn.decision?.decision_kind, "complete_beat");
      assert.ok(
        turn.decision?.decision_kind === "request_clarification" || turn.decision?.decision_kind === "safe_fallback",
        `${entry.label}: expected clarification or safe fallback, got ${String(turn.decision?.decision_kind ?? turn.failure?.failure_class)}`,
      );
      // runtime/model failure 事实已记录（canonical 封闭枚举 internal_error + 专用前缀）。
      const runtimeFailure = session.events.find((event) => event.event_type === "runtime_failure");
      assert.ok(runtimeFailure, `${entry.label}: runtime_failure fact must be recorded`);
      const failurePayload = runtimeFailure.payload as { failure_class: string; message: string };
      assert.equal(failurePayload.failure_class, "internal_error");
      assert.ok(failurePayload.message.startsWith("gate_adjudicator_model_failure:"), `${entry.label}: failure must be attributed to the model adjudicator`);
      assert.ok(validatePayload(runtimeFailure), `${entry.label}: runtime_failure must stay canonical`);
      // gate 事实存在且不满足；无 student incorrect 语义写入。
      const gate = session.events.filter((event) => event.event_type === "gate_evaluated").at(-1);
      assert.equal((gate?.payload as { satisfied: boolean }).satisfied, false);
      assert.equal(session.assertReplayParity().equal, true);
    }
  });

  await runTest("R3 gate/beat identity: GT-99@BT-01 and future-beat gate_evaluated triggers are refused with gate_binding_mismatch (zero transitions, zero cursor changes)", () => {
    const session = startSession("TS-9860");
    const base = {
      sessionId: session.sessionId,
      plan: session.plan,
      state: session.state,
      revision: session.revision,
      localInquirySteps: 0,
      unresolvedClarifications: 0,
    };
    // 候选集外 gate（GT-99）绑在当前 Beat 上：显式拒绝。
    const wrongGate = decideNavigation(base, { kind: "gate_evaluated", sequence: 3, gate_id: "GT-99", beat_id: "BT-01", satisfied: true });
    assert.ok(!wrongGate.ok);
    assert.equal(wrongGate.failure.failure_class, "gate_binding_mismatch");
    assert.match(wrongGate.failure.message, /GT-99@BT-01/);
    // 未来 Beat 的合法 gate（GT-04@BT-04）在 BT-01 上：同样拒绝。
    const futureBeat = decideNavigation(base, { kind: "gate_evaluated", sequence: 3, gate_id: "GT-04", beat_id: "BT-04", satisfied: true });
    assert.ok(!futureBeat.ok);
    assert.equal(futureBeat.failure.failure_class, "gate_binding_mismatch");
    // 正确绑定（GT-01@BT-01）不受影响：合法 decision。
    const correct = decideNavigation(base, { kind: "gate_evaluated", sequence: 3, gate_id: "GT-01", beat_id: "BT-01", satisfied: true });
    assert.ok(correct.ok);
    // decide 是纯函数（零转移零游标变化）；持久化映射：内部类 → canonical
    // policy_failed 封闭枚举（零 schema 变更约束，偏差已登记）。
    const mapped = canonicalPolicyFailureClass("gate_binding_mismatch");
    assert.equal(mapped.failure_class, "policy_engine_error");
    assert.equal(mapped.message_prefix, "gate_binding_mismatch:");
    assert.equal(session.state.teaching_cursor.beat_id, "BT-01");
    assert.equal(session.state.teaching_cursor.phase, "presenting");
  });

  await runTest("R3.1 write boundary: gate_evaluated (any form) via appendExternalFacts is refused EXTERNAL_FACT_TYPE_FORBIDDEN (whole batch, zero cursor change)", async () => {
    // R3 的 wrong-beat fail closed（reducer GATE_BEAT_MISMATCH）仍在 kernel/
    // 重建边界测试（tutorSessionKernelV5.vitest.ts + resume DB 直写负例）；
    // R3.1 起 Navigator 公开入口更早拒绝：gate 事实只能由 session 内部证据
    // 评估路径生成，连「正确绑定」的 gate_evaluated 也不得外部提交。
    const session = startSession("TS-9861");
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    const countBefore = session.events.length;
    const revisionBefore = session.revision;
    const cursorBefore = { ...session.state.teaching_cursor };
    // 未来/stale Beat 的 gate 事件（BT-03 的 GT-03 出现在 BT-02 会话位置）：
    // 边界整批拒绝（批未进入 store）。
    expectCode(
      () =>
        session.appendExternalFacts(session.revision, [
          {
            event_type: "gate_evaluated",
            payload: { gate_id: "GT-03", beat_id: "BT-03", satisfied: true, evidence_sequence: 2 },
            occurred_at: new Date().toISOString(),
            causation_sequence: 2,
          },
        ]),
      "EXTERNAL_FACT_TYPE_FORBIDDEN",
    );
    assert.equal(session.events.length, countBefore);
    assert.equal(session.revision, revisionBefore);
    assert.deepEqual(session.state.teaching_cursor, cursorBefore);
    assert.equal(session.assertReplayParity().equal, true);
    // 对照：合法 student_command 回执照常可经该入口提交（R1 链路零回归）。
    await session.acceptStudentIntent({
      intent_kind: "submit_workspace_command",
      client_request_id: "cr-wc-9861",
      workspace_command: {
        command_id: "SC-TS-9861-0001",
        surface: "geometry",
        capability: "similarity.mark-known-segments",
        target_ids: ["seg-AD"],
        expected_workspace_revision: 0,
        client_command_id: "cc-9861",
      },
    });
    const legal = session.appendExternalFacts(session.revision, [
      {
        event_type: "action_outcome_recorded",
        payload: { action_id: "SC-TS-9861-0001", action_kind: "student_command", outcome: "completed", resulting_revision: 1 },
        occurred_at: new Date().toISOString(),
        causation_sequence: latestIntentSeq(session),
      },
    ]);
    assert.ok(legal.appendedSequences.length === 1);
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("R3.1 write boundary: forged gate facts (GT-99 / right-gate forged evidence / future-stale beat) cannot pollute online state (fail closed, zero commit)", () => {
    const forge = (
      session: NavigatorSession,
      payload: Record<string, unknown>,
    ) => session.appendExternalFacts(session.revision, [
      { event_type: "gate_evaluated", payload, occurred_at: new Date().toISOString(), causation_sequence: 2 },
    ]);
    // 负例 1（用户 2026-08-31 实测向量）：GT-99@当前 BT-01，satisfied=true。
    const s1 = startSession("TS-9872");
    const before1 = { count: s1.events.length, revision: s1.revision, cursor: { ...s1.state.teaching_cursor } };
    expectCode(() => forge(s1, { gate_id: "GT-99", beat_id: "BT-01", satisfied: true, evidence_sequence: 2 }), "EXTERNAL_FACT_TYPE_FORBIDDEN");
    assert.equal(s1.events.length, before1.count);
    assert.equal(s1.revision, before1.revision);
    assert.deepEqual(s1.state.teaching_cursor, before1.cursor);
    assert.notEqual(s1.state.teaching_cursor.phase, "gate_satisfied");
    assert.ok((s1.state.teaching_cursor as { gate_id?: string }).gate_id === undefined);
    assert.equal(s1.assertReplayParity().equal, true);
    assert.equal(s1.rebuildState().teaching_cursor.phase, "presenting");
    // 负例 2：正确 GT-01@BT-01 但伪造 evidence_sequence——正确绑定也不得经
    // 外部入口（gate 评估只属于 session 内部证据路径）。
    const s2 = startSession("TS-9873");
    const before2 = { count: s2.events.length, revision: s2.revision, cursor: { ...s2.state.teaching_cursor } };
    expectCode(() => forge(s2, { gate_id: "GT-01", beat_id: "BT-01", satisfied: true, evidence_sequence: 999999 }), "EXTERNAL_FACT_TYPE_FORBIDDEN");
    assert.equal(s2.events.length, before2.count);
    assert.equal(s2.revision, before2.revision);
    assert.deepEqual(s2.state.teaching_cursor, before2.cursor);
    assert.notEqual(s2.state.teaching_cursor.phase, "gate_satisfied");
    assert.equal(s2.assertReplayParity().equal, true);
    // 负例 3：future / stale Beat 的 gate（GT-04@BT-04、GT-01@BT-05）。
    for (const [sessionId, payload] of [
      ["TS-9874", { gate_id: "GT-04", beat_id: "BT-04", satisfied: true, evidence_sequence: 2 }],
      ["TS-9875", { gate_id: "GT-01", beat_id: "BT-05", satisfied: true, evidence_sequence: 2 }],
    ] as const) {
      const session = startSession(sessionId);
      const before = { count: session.events.length, revision: session.revision, cursor: { ...session.state.teaching_cursor } };
      expectCode(() => forge(session, payload), "EXTERNAL_FACT_TYPE_FORBIDDEN");
      assert.equal(session.events.length, before.count);
      assert.equal(session.revision, before.revision);
      assert.deepEqual(session.state.teaching_cursor, before.cursor);
      assert.notEqual(session.state.teaching_cursor.phase, "gate_satisfied");
      assert.equal(session.assertReplayParity().equal, true);
    }
  });

  await runTest("R3.1 write boundary: forged gate mixed with a legal receipt rolls back the WHOLE batch; a receipt alone cannot bypass the v3 answer gate", async () => {
    const session = startSession("TS-9876");
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" }); // BT-01 → BT-02
    await session.acceptStudentIntent({
      intent_kind: "submit_workspace_command",
      client_request_id: "cr-wc-9870",
      workspace_command: {
        command_id: "SC-TS-9876-0001",
        surface: "geometry",
        capability: "similarity.mark-known-segments",
        target_ids: ["seg-AD"],
        expected_workspace_revision: 0,
        client_command_id: "cc-9870",
      },
    });
    const countBefore = session.events.length;
    const revisionBefore = session.revision;
    const cursorBefore = { ...session.state.teaching_cursor };
    // 负例 4：合法回执 + 伪造 gate 同批 → 整批零提交（合法项不得部分提交）。
    expectCode(
      () =>
        session.appendExternalFacts(session.revision, [
          {
            event_type: "action_outcome_recorded",
            payload: { action_id: "SC-TS-9876-0001", action_kind: "student_command", outcome: "completed", resulting_revision: 1 },
            occurred_at: new Date().toISOString(),
            causation_sequence: latestIntentSeq(session),
          },
          {
            event_type: "gate_evaluated",
            payload: { gate_id: "GT-02", beat_id: "BT-02", satisfied: true, evidence_sequence: 2 },
            occurred_at: new Date().toISOString(),
            causation_sequence: 2,
          },
        ]),
      "EXTERNAL_FACT_TYPE_FORBIDDEN",
    );
    assert.equal(session.events.length, countBefore, "legal receipt must roll back with the forged gate (whole batch)");
    assert.equal(session.revision, revisionBefore);
    assert.deepEqual(session.state.teaching_cursor, cursorBefore);
    assert.notEqual(session.state.teaching_cursor.phase, "gate_satisfied");
    assert.equal(session.assertReplayParity().equal, true);
    // 正例保留：同一合法回执单独提交可被消费；但当前 v3 gate 是
    // student_answer，回执不得跨 evidence_kind 旁路满足它。
    session.appendExternalFacts(session.revision, [
      {
        event_type: "action_outcome_recorded",
        payload: { action_id: "SC-TS-9876-0001", action_kind: "student_command", outcome: "completed", resulting_revision: 1 },
        occurred_at: new Date().toISOString(),
        causation_sequence: latestIntentSeq(session),
      },
    ]);
    const turn = session.consumeWorkspaceCommandOutcome({ command_id: "SC-TS-9876-0001" });
    assert.equal(turn.decision, undefined);
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("R3.1 write boundary: every Navigator-internal event type is refused; only action_outcome_recorded receipts may enter", () => {
    const forbiddenTypes = [
      "session_started",
      "student_intent_recorded",
      "semantic_interpretation_recorded",
      "policy_decision_made",
      "gate_evaluated",
      "voice_action_issued",
      "workspace_surface_action_issued",
      "external_support_recorded",
      "inquiry_opened",
      "inquiry_returned",
      "student_progressed",
      "policy_failed",
      "presentation_failed",
      "runtime_failure",
      "session_completed",
    ] as const;
    const session = startSession("TS-9877");
    const countBefore = session.events.length;
    const revisionBefore = session.revision;
    const cursorBefore = { ...session.state.teaching_cursor };
    // 每类内部控制事实单独提交 → 一律 EXTERNAL_FACT_TYPE_FORBIDDEN（fail
    // closed；含计划明示的六类：gate_evaluated/policy_decision_made/
    // semantic_interpretation_recorded/session_completed/inquiry_opened/
    // inquiry_returned）。
    for (const event_type of forbiddenTypes) {
      expectCode(
        () =>
          session.appendExternalFacts(session.revision, [
            { event_type, payload: { forged: true }, occurred_at: new Date().toISOString(), causation_sequence: 2 },
          ]),
        "EXTERNAL_FACT_TYPE_FORBIDDEN",
      );
    }
    // 全部拒绝后流零变化；allowlist 类型仍是唯一合法入口。
    assert.equal(session.events.length, countBefore);
    assert.equal(session.revision, revisionBefore);
    assert.deepEqual(session.state.teaching_cursor, cursorBefore);
    assert.equal(session.assertReplayParity().equal, true);
  });

  await runTest("R3 forged gate events refuse resume: GT-99@BT-01 binding mismatch, satisfied without student evidence, wrong-beat stream (Plan-aware rebuild boundary)", async () => {
    const root = realCanonicalRoot();
    // (a) 伪造 gate_id：DB 直写 GT-99@BT-01 satisfied → Navigator resume 拒绝。
    const tamperGate = async (sessionId: string, payload: Record<string, unknown>) => {
      const session = startSession(sessionId);
      await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-t" });
      return session;
    };
    const insertRawGateEvent = (sessionId: string, payload: Record<string, unknown>, evidenceSequence?: number) => {
      const rowRevision = Number((db.prepare("SELECT revision AS r FROM tutor_sessions WHERE session_id = ?").get(sessionId) as { r: number }).r);
      const nextSeq = Number((db.prepare("SELECT COUNT(*) AS c FROM tutor_session_events WHERE session_id = ?").get(sessionId) as { c: number }).c) + 1;
      db.prepare(
        "INSERT INTO tutor_session_events (session_id, sequence, event_type, payload_json, occurred_at, idempotency_key, recorded_revision, recorded_at, causation_sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        sessionId,
        nextSeq,
        "gate_evaluated",
        JSON.stringify(payload),
        new Date().toISOString(),
        `r3-tamper-${sessionId}-${nextSeq}`,
        rowRevision + 1,
        new Date().toISOString(),
        ...(evidenceSequence !== undefined ? [evidenceSequence] : [nextSeq - 1]),
      );
      db.prepare("UPDATE tutor_sessions SET revision = ? WHERE session_id = ?").run(rowRevision + 1, sessionId);
    };
    const s1 = await tamperGate("TS-9862", {});
    void s1;
    insertRawGateEvent("TS-9862", { gate_id: "GT-99", beat_id: "BT-02", satisfied: true, evidence_sequence: 2 }, 2);
    assert.throws(
      () => NavigatorSessionV5.resume({ sessionId: "TS-9862", canonicalRoot: root }),
      (error: unknown) => error instanceof session5.NavigatorResumeIntegrityError && error.code === "PLAN_GATE_BINDING_MISMATCH",
    );
    // (b) pass 无对应学生证据（evidence_sequence 指向不存在的事件）→ 拒绝。
    const s2 = await tamperGate("TS-9863", {});
    void s2;
    // TS-9863 confirm 后游标在 BT-02；合法 gate GT-02 是 student_answer，
    // satisfied 必须指向本轮模型核验过的学生证据；伪造指向不存在 sequence。
    insertRawGateEvent("TS-9863", { gate_id: "GT-02", beat_id: "BT-02", satisfied: true, evidence_sequence: 999 }, 999);
    assert.throws(
      () => NavigatorSessionV5.resume({ sessionId: "TS-9863", canonicalRoot: root }),
      (error: unknown) => error instanceof session5.NavigatorResumeIntegrityError && error.code === "GATE_EVIDENCE_FORGED",
    );
    // (c) wrong-beat gate 事件：kernel verified rebuild（F2 fold）先行拒绝
    // （GATE_BEAT_MISMATCH 家族；reducer 授权收紧，2026-08-31）。
    const s3 = await tamperGate("TS-9864", {});
    void s3;
    insertRawGateEvent("TS-9864", { gate_id: "GT-04", beat_id: "BT-04", satisfied: true, evidence_sequence: 2 }, 2);
    assert.throws(
      () => NavigatorSessionV5.resume({ sessionId: "TS-9864", canonicalRoot: root }),
      (error: unknown) => (error as { code?: string }).code === "GATE_BEAT_MISMATCH",
    );
    // (d) 健康流 resume：正常恢复（不抛、cursor 一致、零模型调用见下一用例）。
    const healthy = startSession("TS-9865");
    await healthy.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    const resumed = NavigatorSessionV5.resume({ sessionId: "TS-9865", canonicalRoot: root });
    assert.equal(resumed.state.teaching_cursor.beat_id, healthy.state.teaching_cursor.beat_id);
    assert.equal(resumed.assertReplayParity().equal, true);
  });

  await runTest("R3 idempotent retry and refresh-replay: same client_request_id re-reads the committed judgment (no re-adjudication, no double writes); resume never calls the model", async () => {
    const provider = new FixedResponseGateProvider([passFor("GT-02", "FN-08")]);
    const session = NavigatorSessionV5.start({
      sessionId: "TS-9866",
      studentId: "student-r3",
      canonicalRoot: realCanonicalRoot(),
      tpId: GOLDEN.tpId,
      taskId: GOLDEN.taskId,
      scenarioId: GOLDEN.scenarioId,
      gateProvider: provider,
    });
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    const first = await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-retry" });
    assert.equal(first.decision?.decision_kind, "transition_beat");
    assert.equal(provider.callCount, 1);
    const eventsAfterFirst = session.events.length;
    const revisionAfterFirst = session.revision;
    // 同 client_request_id 重试：读已提交判断，provider 不再被调用，零新事件。
    const retried = await session.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-retry" });
    assert.equal(provider.callCount, 1, "retry must not re-adjudicate");
    assert.equal(session.events.length, eventsAfterFirst, "retry must not double-write");
    assert.equal(session.revision, revisionAfterFirst);
    assert.equal(retried.decision?.decision_id, first.decision?.decision_id);
    assert.equal(retried.intentSequence, first.intentSequence);
    assert.equal(retried.gateSequence, first.gateSequence);
    // refresh/replay：resume（含计数 provider）零模型调用，状态一致。
    const replayProvider = new FixedResponseGateProvider([passFor("GT-03", "FN-12")]);
    const resumed = NavigatorSessionV5.resume({ sessionId: "TS-9866", canonicalRoot: realCanonicalRoot(), gateProvider: replayProvider });
    assert.equal(replayProvider.callCount, 0, "replay must not call the model");
    assert.deepEqual(resumed.state, session.state);
    assert.equal(resumed.assertReplayParity().equal, true);
    // resume 后续轮次照常可用模型（新 client_request_id）。
    const next = await resumed.acceptStudentIntent({ intent_kind: "submit_answer", text: ANSWER_GOAL_OK, client_request_id: "cr-0002" });
    assert.equal(next.decision?.decision_kind, "transition_beat");
    assert.equal(replayProvider.callCount, 1);
    assert.equal(resumed.state.teaching_cursor.beat_id, "BT-04");
  });

  await runTest("R3 P3-2: failed student_command receipt records failure_class, cannot satisfy the v3 answer gate, and does not advance workspace_revision", async () => {
    const session = startSession("TS-9867");
    await session.acceptStudentIntent({ intent_kind: "confirm", client_request_id: "cr-0001" });
    const turn = await submitWorkspaceCommandWithReceiptAsync(session, { command_id: "SC-TS-9867-failed", outcome: "failed" });
    assert.equal(turn.decision, undefined);
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
    assert.equal(session.state.workspace_revision, 0, "failed outcome must not advance workspace_revision");
    const receipt = session.events.find(
      (event) => event.event_type === "action_outcome_recorded" && (event.payload as { action_id: string }).action_id === "SC-TS-9867-failed",
    );
    assert.ok(receipt, "failed receipt is committed via the real path");
    assert.deepEqual(receipt.payload as Record<string, unknown>, {
      action_id: "SC-TS-9867-failed",
      action_kind: "student_command",
      outcome: "failed",
      failure_class: "internal_error",
    });
    const bt02Gates = session.events
      .filter((event) => event.event_type === "gate_evaluated" && (event.payload as { beat_id: string }).beat_id === "BT-02");
    assert.equal(bt02Gates.length, 0, "wrong evidence_kind must not even evaluate the BT-02 answer gate");
    assert.equal(session.assertReplayParity().equal, true);
    // 随后 completed 回执仍不能冒充自然语言答案证据。
    const recovered = await submitWorkspaceCommandWithReceiptAsync(session, { command_id: "SC-TS-9867-ok" });
    assert.equal(recovered.decision, undefined);
    assert.equal(session.state.teaching_cursor.beat_id, "BT-02");
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
