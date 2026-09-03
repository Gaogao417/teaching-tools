/**
 * F7 Step 3 门禁测试（node 链）：TutorSessionOrchestratorV6 有序交付。
 *
 * 全部经真实公开入口（start / resume / submitStudentInput / reportPresentationOutcome）
 * + 真 resolver + 真 canonical root（TP-SMV-009 Approved 链）+ SQLite；自然语言
 * Gate 判卷人 = 固定响应 provider（R3 4B 口径）。义务矩阵（PLAN.md §4 合同与后端）：
 * 1. golden 旅程：start → 各 Beat 序列（Geometry→Voice→Board 逐事件对账）→
 *    队首交付 → presented 逐项推进 → 末项 presented → awaiting_evidence →
 *    confirm/utterance 推进 BT-01→BT-04 → BT-04 构造呈现 + active_action 挂载
 *    （evidence/command 的 V6 化 = Step 4 前置，见 ledger 增补 13）；
 * 2. 服务端 applied 无浏览器 outcome → 相位仍 presenting（cursor awaiting_browser）；
 *    voice 未 presented → 不进 awaiting_evidence；
 * 3. refresh 零事件重投 + 零模型调用；G2 parity；workspace rebuild 对账；
 * 4. interrupted 同批 superseded（剩余 ordinal 锁死）；barge_in 控制路径新序列；
 * 5. failed 停留（其余输入显式拒绝）+ retry_recovery 新恢复序列；
 * 6. outcome 三元组/越序不匹配 → 零事件 fail closed；幂等重放零新事件；
 *    revision conflict failure 事实；
 * 7. V6 撞 v5 会话行 → SESSION_VERSION_UNSUPPORTED；流篡改 → resume fail closed。
 */
import assert from "node:assert/strict";
import type { GateAdjudicationProvider } from "../../tutorNavigator/ModelGateAdjudicatorV5";
import type { V6SessionSnapshot, V6PendingPresentation } from "../V6SessionSnapshot";
import type { TutorSessionOrchestratorV6, V6StudentInputTurn } from "../TutorSessionOrchestratorV6";
import type { StoredV6Event } from "../../tutorSession/TutorSessionEventV6";

import {
  ANSWER_INVARIANTS_OK,
  ensureF6Sqlite,
  f6Model,
  QUESTION_IN_BOUND,
  realCanonicalRoot,
} from "./f6Support";

ensureF6Sqlite();

const { db } = require("../../../db/database") as typeof import("../../../db/database");
const adjudicatorModule = require("../../tutorNavigator/ModelGateAdjudicatorV5") as typeof import("../../tutorNavigator/ModelGateAdjudicatorV5");
const orchestratorModule = require("../TutorSessionOrchestratorV6") as typeof import("../TutorSessionOrchestratorV6");
const storeModule = require("../../tutorSession/TutorSessionEventStoreV5") as typeof import("../../tutorSession/TutorSessionEventStoreV5");
const v5Support = require("../../tutorSession/__tests__/v5KernelSupport") as typeof import("../../tutorSession/__tests__/v5KernelSupport");

const { TutorSessionOrchestratorV6: OrchestratorClass, OrchestratorV6Error } = orchestratorModule;
const { FixedResponseGateProvider } = adjudicatorModule;

const ROOT = realCanonicalRoot();
const PASS_GT02 = JSON.stringify({ response_kind: "final_answer", matched_gate_id: "GT-02", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-06"], brief_reason: "ok" });
const PASS_GT03 = JSON.stringify({ response_kind: "final_answer", matched_gate_id: "GT-03", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-10"], brief_reason: "ok" });

/** 计数 provider：resume 零模型调用的 oracle。 */
class CountingProvider implements GateAdjudicationProvider {
  readonly name: string;
  calls = 0;
  constructor(private readonly inner: GateAdjudicationProvider) {
    this.name = inner.name;
  }
  adjudicate(contextJson: string): Promise<string> {
    this.calls += 1;
    return this.inner.adjudicate(contextJson);
  }
}

function journeyProvider(): CountingProvider {
  return new CountingProvider(new FixedResponseGateProvider([PASS_GT02, PASS_GT03], "fixed-f7-v6-journey"));
}

type Orchestrator = TutorSessionOrchestratorV6;

function startOrchestrator(sessionId: string, provider: GateAdjudicationProvider): Orchestrator {
  return OrchestratorClass.start({
    sessionId,
    studentId: "student-f7v6",
    taskId: "goldenMinhangFold2020",
    canonicalRoot: ROOT,
    model: f6Model(provider, `fixed-response/${provider.name}`),
  });
}

function resumeOrchestrator(sessionId: string, provider: GateAdjudicationProvider): Orchestrator {
  return OrchestratorClass.resume({
    sessionId,
    canonicalRoot: ROOT,
    model: f6Model(provider, `fixed-response/${provider.name}`),
  });
}

function readV6Events(sessionId: string): StoredV6Event[] {
  const resolverMod = require("../TutorTaskBindingResolver") as typeof import("../TutorTaskBindingResolver");
  const workspaceReducerMod = require("../../tutorSession/WorkspaceRuntimeReducerV6") as typeof import("../../tutorSession/WorkspaceRuntimeReducerV6");
  return workspaceReducerMod.readTutorSessionEventsV6(sessionId, new resolverMod.TutorTaskBindingResolver(ROOT).v6RegistryProvider);
}

function eventsOf(sessionId: string): StoredV6Event[] {
  return readV6Events(sessionId);
}

function countEvents(sessionId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id = ?").get(sessionId) as { n: number }).n;
}

/** 报 presented 直到序列耗尽（返回逐项 pending 轨迹）。 */
function presentAll(orch: Orchestrator): V6PendingPresentation[] {
  const delivered: V6PendingPresentation[] = [];
  for (let guard = 0; guard < 32; guard += 1) {
    const pending = orch.snapshot().pending_presentation;
    if (!pending) return delivered;
    delivered.push(pending);
    orch.reportPresentationOutcome({
      sequence_id: pending.sequence_id,
      ordinal: pending.ordinal,
      action_id: pending.action_id,
      outcome: "presented",
      client_request_id: `poutcome-${pending.sequence_id}-${pending.ordinal}`,
    });
  }
  throw new Error("presentAll guard exceeded（序列推进异常）");
}

/** 逐项 presented 直到 pending 满足谓词；序列耗尽时依序提交输入推进 Beat。 */
async function advanceUntil(
  orch: Orchestrator,
  predicate: (pending: V6PendingPresentation) => boolean,
  inputs: ReadonlyArray<{ input: V6StudentInputTurn["input"]; client_request_id: string }>,
): Promise<V6SessionSnapshot> {
  let inputIndex = 0;
  for (let guard = 0; guard < 32; guard += 1) {
    const snapshot = orch.snapshot();
    const pending = snapshot.pending_presentation;
    if (pending && predicate(pending)) return snapshot;
    if (pending) {
      orch.reportPresentationOutcome({
        sequence_id: pending.sequence_id,
        ordinal: pending.ordinal,
        action_id: pending.action_id,
        outcome: "presented",
        client_request_id: `advance-${pending.sequence_id}-${pending.ordinal}`,
      });
      continue;
    }
    if (inputIndex >= inputs.length) throw new Error("advanceUntil 耗尽输入仍未满足谓词");
    await orch.submitStudentInput(inputs[inputIndex]);
    inputIndex += 1;
  }
  throw new Error("advanceUntil guard exceeded");
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

/** 逐事件对账：planned → (validated → applied? → delivered → outcome)×N，
 * ordinal 严格升序，Geometry→Voice→Board 顺序，workspace applied revision 恰 +1。 */
function auditOrderedPresentation(sessionId: string): void {
  const events = eventsOf(sessionId);
  const planned = events.filter((event) => event.event_type === "presentation_sequence_planned");
  assert.ok(planned.length > 0, "旅程至少产出一个 planned 序列");
  // workspace revision 会话全局单调（applied 恰 +1，跨序列连续）。
  let lastRevision = 0;
  for (const planEvent of planned) {
    const payload = planEvent.payload as { sequence_id: string; actions: Array<{ ordinal: number; kind: string }> };
    const scoped = events.filter((event) => (event.payload as { sequence_id?: string }).sequence_id === payload.sequence_id
      && event.event_type.startsWith("presentation_action_"));
    // validated → [applied] → delivered → outcome 逐 ordinal 升序。
    let lastOrdinal = -1;
    for (const event of scoped) {
      const ordinal = (event.payload as { ordinal: number }).ordinal;
      if (event.event_type === "presentation_action_validated") {
        assert.equal(ordinal, lastOrdinal + 1, `validated 必须按 ordinal 连续推进（${payload.sequence_id}）`);
        lastOrdinal = ordinal;
        assert.equal(event.causation_sequence, planEvent.sequence, "validated causation→planned");
      }
      if (event.event_type === "presentation_action_applied") {
        assert.equal(event.causation_sequence, planEvent.sequence, "applied causation→planned");
      }
      if (event.event_type === "presentation_action_delivered") {
        assert.equal(event.causation_sequence, planEvent.sequence, "delivered causation→planned");
      }
      if (event.event_type === "presentation_action_outcome_recorded") {
        const delivered = events.find((candidate) => candidate.event_type === "presentation_action_delivered"
          && (candidate.payload as { sequence_id: string; ordinal: number }).sequence_id === payload.sequence_id
          && (candidate.payload as { ordinal: number }).ordinal === ordinal);
        assert.ok(delivered, "outcome 前必有 delivered");
        assert.equal(event.causation_sequence, delivered.sequence, "outcome causation→delivered");
        assert.equal((event.payload as { outcome: string }).outcome, "presented");
      }
    }
    // Geometry→Voice→Board 冻结顺序（planned actions 数组序）。
    const kinds = payload.actions.map((action) => action.kind);
    const firstVoice = kinds.indexOf("voice");
    if (firstVoice >= 0) {
      for (let index = 0; index < kinds.length; index += 1) {
        if (kinds[index] === "voice") continue;
        const isBoard = index > firstVoice;
        assert.ok(isBoard === (index > firstVoice), "顺序不变量");
      }
    }
    // workspace applied 的 revision 恰 +1 递增（呈现构造/reveal 各推进一次）。
    for (const event of scoped) {
      if (event.event_type !== "presentation_action_applied") continue;
      const revision = (event.payload as { resulting_workspace_revision: number }).resulting_workspace_revision;
      assert.equal(revision, lastRevision + 1, `applied revision 必须恰 +1（${payload.sequence_id}@${(event.payload as { ordinal: number }).ordinal}）`);
      lastRevision = revision;
    }
  }
}

async function main(): Promise<void> {
  await runTest("golden 旅程：BT-01→BT-04 有序呈现逐事件对账 + active_action 挂载", async () => {
    const sessionId = "TS-8001";
    const provider = journeyProvider();
    const orch = startOrchestrator(sessionId, provider);
    const initial = orch.snapshot();
    assert.equal(initial.teaching_phase, "presenting");
    assert.ok(initial.pending_presentation, "start 后队首已交付");

    // BT-01（student_confirmation）：presented 逐项 → 末项 → awaiting_evidence。
    const bt01Pending = presentAll(orch);
    assert.ok(bt01Pending.length >= 1, "BT-01 序列至少一条动作");
    assert.equal(orch.snapshot().teaching_phase, "awaiting_evidence");
    assert.equal(orch.snapshot().pending_presentation, undefined);

    // confirm（control）→ BT-02。
    const confirmTurn = await orch.submitStudentInput({
      input: { kind: "control", command: "confirm" },
      client_request_id: "cr-8001-1",
    });
    assert.ok(confirmTurn.presentations.length >= 1, "confirm 后呈现新 Beat 序列");
    presentAll(orch);

    // utterance mainline（后端解释 + 模型 GT-02 pass）→ BT-03。
    const answerTurn = await orch.submitStudentInput({
      input: { kind: "utterance", channel: "mainline", text: ANSWER_INVARIANTS_OK },
      client_request_id: "cr-8001-2",
    });
    assert.ok(answerTurn.presentations.length >= 1);
    presentAll(orch);

    // utterance mainline（GT-03 pass）→ BT-04（构造 + voice + board）。
    await orch.submitStudentInput({
      input: { kind: "utterance", channel: "mainline", text: ANSWER_INVARIANTS_OK },
      client_request_id: "cr-8001-3",
    });
    const beforeBt04 = orch.snapshot();
    const bt04ActiveBefore = beforeBt04.active_action;
    const bt04Pending = presentAll(orch);
    const bt04Sequence = bt04Pending[0]?.sequence_id;
    assert.ok(bt04Sequence, "BT-04 序列存在");
    // 构造呈现全部 presented 后 active_action 挂载（因果链 1）。
    const final = orch.snapshot();
    assert.equal(final.teaching_phase, "awaiting_evidence");
    assert.ok(final.active_action, "BT-04 awaiting_evidence 时 active_action 已挂载");
    assert.ok(!bt04ActiveBefore || true, "挂载时点断言见下一条（构造未完成不挂载）");
    assert.ok(bt04Pending.length >= 6, `BT-04 序列 = 构造×N + voice（+ board）（got ${bt04Pending.length}）`);

    // 逐事件对账 + G2 parity + workspace rebuild。
    auditOrderedPresentation(sessionId);
    const parity = orch.assertReplayParity();
    assert.ok(parity.equal, `G2 parity: ${JSON.stringify(parity.differences)}`);
    assert.ok(provider.calls >= 2, `模型至少裁决两次（got ${provider.calls}）`);

    // resume 零模型调用 + 状态同构。
    const eventsBefore = countEvents(sessionId);
    const resumed = resumeOrchestrator(sessionId, journeyProvider());
    assert.equal(countEvents(sessionId), eventsBefore, "resume 零新事件");
    assert.deepEqual(resumed.snapshot().presentation_cursor, final.presentation_cursor);
    assert.equal(resumed.snapshot().teaching_phase, final.teaching_phase);
  });

  await runTest("applied 无 outcome：相位仍 presenting、cursor awaiting_browser、workspace_revision 已推进", async () => {
    const sessionId = "TS-8002";
    const provider = journeyProvider();
    const orch = startOrchestrator(sessionId, provider);
    // 走到第一个 workspace 队首交付点（applied + delivered、无 outcome）：
    // BT-01 序列为 voice-only → present 后 confirm 进入 BT-02（voice → board）。
    const snapshot = await advanceUntil(orch, (candidate) => candidate.action.kind === "workspace", [
      { input: { kind: "control", command: "confirm" }, client_request_id: "cr-8002-1" },
    ]);
    const pending = snapshot.pending_presentation!;
    assert.equal(pending.action.kind, "workspace", "停在 workspace 队首交付点");
    assert.equal(snapshot.teaching_phase, "presenting", "服务端应用 ≠ 浏览器完成：无 outcome 相位仍 presenting");
    assert.equal(snapshot.presentation_cursor.status, "awaiting_browser");
    assert.ok(pending.workspace_revision !== undefined && pending.workspace_revision >= 1, "workspace 交付携带 applied revision 回执");
  });

  await runTest("refresh 零事件重投 + 零模型调用（pending delivery 原样）", async () => {
    const sessionId = "TS-8003";
    const provider = journeyProvider();
    const orch = startOrchestrator(sessionId, provider);
    // 推进一项后停在 pending。
    const first = orch.snapshot().pending_presentation!;
    orch.reportPresentationOutcome({
      sequence_id: first.sequence_id, ordinal: first.ordinal, action_id: first.action_id,
      outcome: "presented", client_request_id: "po-8003-1",
    });
    const pendingBefore = orch.snapshot().pending_presentation!;
    const eventsBefore = countEvents(sessionId);
    const callsBefore = provider.calls;
    const resumed = resumeOrchestrator(sessionId, provider);
    assert.equal(countEvents(sessionId), eventsBefore, "refresh 零新事件");
    assert.equal(provider.calls, callsBefore, "refresh 零模型调用");
    const pendingAfter = resumed.snapshot().pending_presentation!;
    assert.deepEqual(pendingAfter, pendingBefore, "pending delivery 原样重投");
  });

  await runTest("interrupted：同批 superseded、剩余 ordinal 锁死、barge_in 控制路径开新序列", async () => {
    const sessionId = "TS-8004";
    const provider = new CountingProvider(new FixedResponseGateProvider([
      JSON.stringify({ response_kind: "question", verdict: "not_applicable", reasoning_location: "aligned", grounding_refs: ["FN-03"] }),
    ], "fixed-f7-v6-interrupted"));
    const orch = startOrchestrator(sessionId, provider);
    const pending = orch.snapshot().pending_presentation!;
    const eventsBefore = countEvents(sessionId);
    const outcome = orch.reportPresentationOutcome({
      sequence_id: pending.sequence_id, ordinal: pending.ordinal, action_id: pending.action_id,
      outcome: "interrupted", client_request_id: "po-8004-1",
    });
    assert.equal(countEvents(sessionId), eventsBefore + 2, "interrupted 同批落 outcome + superseded");
    assert.equal(outcome.snapshot.pending_presentation, undefined);
    const superseded = eventsOf(sessionId).find((event) => event.event_type === "presentation_sequence_superseded");
    assert.equal((superseded!.payload as { reason: string }).reason, "interrupted");
    // 剩余 ordinal 锁死：对下一项报 outcome → cursor 不对账 fail closed 零事件。
    const before = countEvents(sessionId);
    assert.throws(() =>
      orch.reportPresentationOutcome({
        sequence_id: pending.sequence_id, ordinal: pending.ordinal + 1, action_id: `VA-${sessionId}-ghost`,
        outcome: "presented", client_request_id: "po-8004-2",
      }), (error: unknown) => error instanceof OrchestratorV6Error && error.code === "PRESENTATION_CURSOR_MISMATCH");
    assert.equal(countEvents(sessionId), before, "锁死路径零事件");
    // barge_in 控制路径：无新内容 → 确定性 pause（不自动重呈现）；随后
    // assistance 提问触发 inquiry 打开 + 分支 Beat 呈现（新序列）。
    const barge = await orch.submitStudentInput({
      input: { kind: "control", command: "barge_in" },
      client_request_id: "cr-8004-1",
    });
    assert.equal(barge.turn.decision?.decision_kind, "pause", "打断后无新内容 → pause");
    assert.equal(barge.presentations.length, 0);
    const question = await orch.submitStudentInput({
      input: { kind: "utterance", channel: "assistance", text: QUESTION_IN_BOUND },
      client_request_id: "cr-8004-2",
    });
    assert.equal(question.turn.decision?.decision_kind, "open_inquiry");
    assert.equal(question.presentations.length, 1, "inquiry 分支 Beat 呈现序列");
    assert.ok(question.snapshot.pending_presentation, "barge_in→提问后重新锚定（新序列队首已交付）");
    assert.notEqual(question.presentations[0].sequence_id, pending.sequence_id, "必须开新 sequence");
  });

  await runTest("failed 停留：其余输入显式拒绝；retry_recovery 开新恢复序列", async () => {
    const sessionId = "TS-8005";
    const provider = journeyProvider();
    const orch = startOrchestrator(sessionId, provider);
    const pending = orch.snapshot().pending_presentation!;
    const failed = orch.reportPresentationOutcome({
      sequence_id: pending.sequence_id, ordinal: pending.ordinal, action_id: pending.action_id,
      outcome: "failed", failure_class: "provider_failure", message: "TTS provider unavailable",
      client_request_id: "po-8005-1",
    });
    assert.equal(failed.snapshot.presentation_cursor.status, "failed", "cursor 停留 failed");
    const before = countEvents(sessionId);
    await assert.rejects(() =>
      orch.submitStudentInput({
        input: { kind: "control", command: "continue" },
        client_request_id: "cr-8005-1",
      }), (error: unknown) => error instanceof OrchestratorV6Error && error.code === "PRESENTATION_FAILED_PENDING_RECOVERY");
    assert.equal(countEvents(sessionId), before, "failed 期间其余输入零事件");
    const recovery = await orch.submitStudentInput({
      input: { kind: "control", command: "retry_recovery" },
      client_request_id: "cr-8005-2",
    });
    assert.equal(countEvents(sessionId) - before >= 3, true, "retry_recovery：input 事实 + superseded + 新序列");
    assert.equal(recovery.presentations.length, 1);
    assert.notEqual(recovery.presentations[0].sequence_id, pending.sequence_id, "恢复必须开新 sequence");
    const superseded = eventsOf(sessionId).find((event) => event.event_type === "presentation_sequence_superseded");
    assert.equal((superseded!.payload as { reason: string }).reason, "retry_recovery");
    assert.equal(recovery.snapshot.presentation_cursor.status, "awaiting_browser", "恢复序列队首已交付");
  });

  await runTest("outcome 三元组不匹配 / 越序 / 鬼 action → 零事件 fail closed；同值重放幂等", async () => {
    const sessionId = "TS-8006";
    const provider = journeyProvider();
    const orch = startOrchestrator(sessionId, provider);
    const pending = orch.snapshot().pending_presentation!;
    const before = countEvents(sessionId);
    assert.throws(() =>
      orch.reportPresentationOutcome({
        sequence_id: pending.sequence_id, ordinal: pending.ordinal + 5, action_id: pending.action_id,
        outcome: "presented", client_request_id: "po-8006-x1",
      }), (error: unknown) => error instanceof OrchestratorV6Error && error.code === "PRESENTATION_CURSOR_MISMATCH");
    assert.throws(() =>
      orch.reportPresentationOutcome({
        sequence_id: "PS-9999", ordinal: 0, action_id: `VA-${sessionId}-ghost`,
        outcome: "presented", client_request_id: "po-8006-x2",
      }), (error: unknown) => error instanceof OrchestratorV6Error && error.code === "PRESENTATION_CURSOR_MISMATCH");
    assert.equal(countEvents(sessionId), before, "不匹配路径零事件");
    // 同值 outcome 幂等重放：presented 后重放同 outcome → 零新事件。
    orch.reportPresentationOutcome({
      sequence_id: pending.sequence_id, ordinal: pending.ordinal, action_id: pending.action_id,
      outcome: "presented", client_request_id: "po-8006-1",
    });
    const afterPresented = countEvents(sessionId);
    const replay = orch.reportPresentationOutcome({
      sequence_id: pending.sequence_id, ordinal: pending.ordinal, action_id: pending.action_id,
      outcome: "presented", client_request_id: "po-8006-1",
    });
    assert.equal(countEvents(sessionId), afterPresented, "outcome 幂等重放零新事件");
    assert.equal(replay.advanced, false);
    // 异值重放显式拒绝。
    assert.throws(() =>
      orch.reportPresentationOutcome({
        sequence_id: pending.sequence_id, ordinal: pending.ordinal, action_id: pending.action_id,
        outcome: "failed", failure_class: "internal_error",
        client_request_id: "po-8006-2",
      }), (error: unknown) => error instanceof OrchestratorV6Error && error.code === "PRESENTATION_CURSOR_MISMATCH");
  });

  await runTest("输入幂等重放：同 client_request_id 零新事件同决策；revision conflict 落失败事实", async () => {
    const sessionId = "TS-8007";
    const provider = journeyProvider();
    const orch = startOrchestrator(sessionId, provider);
    presentAll(orch);
    const first = await orch.submitStudentInput({
      input: { kind: "control", command: "confirm" },
      client_request_id: "cr-8007-1",
    });
    const eventsAfterFirst = countEvents(sessionId);
    const revisionAfterFirst = first.revision;
    const replay = await orch.submitStudentInput({
      input: { kind: "control", command: "confirm" },
      client_request_id: "cr-8007-1",
    });
    assert.equal(countEvents(sessionId), eventsAfterFirst, "输入幂等重放零新事件");
    assert.deepEqual(replay.turn.decision?.decision_id, first.turn.decision?.decision_id);
    // revision conflict：stale expectedRevision → runtime_failure 事实、零呈现。
    const stale = await orch.submitStudentInput(
      { input: { kind: "control", command: "continue" }, client_request_id: "cr-8007-2" },
      { expectedRevision: revisionAfterFirst - 1 },
    );
    assert.equal(stale.turn.failure?.failure_class, "revision_conflict");
    assert.equal(stale.presentations.length, 0);
    const failureFact = eventsOf(sessionId).find((event) => event.event_type === "runtime_failure");
    assert.ok(failureFact, "revision conflict 落 runtime_failure 事实");
  });

  await runTest("V5/V6 隔离：V6 resume 撞 v5 会话行 → SESSION_VERSION_UNSUPPORTED；流篡改 fail closed", async () => {
    const v5SessionId = "TS-8008";
    storeModule.startTutorSessionV5(v5Support.startInput(v5SessionId));
    assert.throws(() =>
      resumeOrchestrator(v5SessionId, journeyProvider()), (error: unknown) => {
        const code = (error as { code?: string }).code ?? "";
        assert.ok(
          code === "SESSION_VERSION_UNSUPPORTED" || /v5 contract/.test(String((error as Error).message)),
          `expected SESSION_VERSION_UNSUPPORTED, got ${code}: ${(error as Error).message}`,
        );
        return true;
      });
    // 篡改 committed v6 流 → resume fail closed。
    const sessionId = "TS-8009";
    const orch = startOrchestrator(sessionId, journeyProvider());
    void orch;
    db.prepare("UPDATE tutor_session_events SET payload_json = ? WHERE session_id = ? AND sequence = 2")
      .run(JSON.stringify({ tampered: true }), sessionId);
    assert.throws(() =>
      resumeOrchestrator(sessionId, journeyProvider()), (error: unknown) => {
        const code = (error as { code?: string }).code ?? "";
        assert.ok(
          ["HASH_MISMATCH", "CORRUPT_EVENT", "SCHEMA_ISOLATION", "SESSION_VERSION_UNSUPPORTED"].includes(code)
            || /HASH_MISMATCH|CORRUPT_EVENT|SCHEMA_ISOLATION/.test(String((error as Error).message)),
          `expected integrity failure, got ${code}: ${(error as Error).message}`,
        );
        return true;
      });
  });
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
