/**
 * F3 G3 门禁测试（node 链）：Workspace 状态转换内核。
 *
 * 覆盖 f3-scope-ledger 的 positive/negative fixtures 义务 + G3 定义（全部经
 * 真实入口——WorkspaceSessionRuntimeV5.executePresentation / executeStudentCommand
 * （内部走 F2 kernel.append 真实提交路径）与 rebuildWorkspaceRuntimeStateV5；
 * 禁止绕道内部纯函数冒充 fail-closed 证明——本波硬规则 1）：
 * 1. tutor action 全旅程 input → transition → event → rebuild → same View；
 * 2. student command 全旅程（canonical SC fixture 实际执行）同上；
 * 3. stale / duplicate / illegal target / truth leak 不污染 state（真实入口拒绝）；
 * 4. 单一 Workspace revision 与单一 projector（Geometry 与 Board 同源同 revision，
 *    TutorRuntimeState.workspace_revision ≡ WorkspaceRuntimeState.revision）；
 * 5. canonical fixtures 经真实入口消费（WSA/SC 正例执行 + state/view 负例 Zod 拒绝）；
 * 6. 重建确定性 + 流损坏 fail closed（孤儿完成 / resulting_revision 违分配语义 /
 *    stale 内嵌 / 测试侧直接 INSERT 模拟篡改）；
 * 7. issued/intent 无 outcome（mid-action crash）零完成副作用；session_completed
 *    锁定 interaction；
 * 8. legacy adapter（现有 world snapshot + immutable Board context → 统一 state）；
 * 9. accept-draft 与 Board attempt 生命周期（attempted≠confirmed）。
 *
 * 注：损坏负例以测试侧直接 INSERT/UPDATE 模拟存储篡改（生产代码对事件表只
 * INSERT/SELECT——与 F2 测试同口径）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { ensureSqlite } from "./support";
import {
  assertNoWorkspaceTruthLeak,
  at,
  constructParallelJson,
  sc,
  setSegmentLabelJson,
  wsStartInput,
  wsTestCatalog,
  wsFixtureStateCatalog,
  wsa,
} from "./workspaceKernelV5Support";

ensureSqlite("workspace-kernel-v5");

const { db } = require("../../../db/database") as typeof import("../../../db/database");
const canonical = require("../../../../../shared/canonical") as typeof import("../../../../../shared/canonical");
const runtime5 = require("../WorkspaceSessionRuntimeV5") as typeof import("../WorkspaceSessionRuntimeV5");
const rebuilder5 = require("../WorkspaceStateRebuilderV5") as typeof import("../WorkspaceStateRebuilderV5");
const projector5 = require("../WorkspaceViewProjectorV5") as typeof import("../WorkspaceViewProjectorV5");
const catalog5 = require("../WorkspacePresentationCatalogV5") as typeof import("../WorkspacePresentationCatalogV5");
const store5 = require("../TutorSessionEventStoreV5") as typeof import("../TutorSessionEventStoreV5");

const insertRawEvent = db.prepare(`
  INSERT INTO tutor_session_events
    (session_id, sequence, event_type, payload_json, occurred_at, idempotency_key, recorded_revision, recorded_at, causation_sequence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function countEvents(sessionId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id = ?").get(sessionId) as { n: number }).n;
}

// fixtures 位于 web/shared/canonical/fixtures（canonicalContracts.test.ts 同口径：
// process.cwd()=web/backend，tsx 与 dist 两种运行形态同解）。
const fixtureDir = path.resolve(process.cwd(), "../shared/canonical/fixtures");
const readFixture = (name: string): unknown => JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8"));

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function expectIntegrityError(fn: () => unknown, code: string, messageIncludes?: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, `expected integrity error, got ${String(thrown)}`);
  assert.equal((thrown as { code?: string }).code, code, String(thrown));
  if (messageIncludes) {
    assert.ok(
      (thrown as Error).message.includes(messageIncludes),
      `expected message to include ${messageIncludes}, got ${(thrown as Error).message}`,
    );
  }
}

/** 全旅程断言（G3 核心 loop）：在线 fold == 全量重建 fold，投影 View 逐字节一致。 */
function assertRoundTrip(
  runtime: import("../WorkspaceSessionRuntimeV5").WorkspaceSessionRuntimeV5,
  label: string,
): void {
  const online = runtime.workspaceState;
  const rebuiltFresh = rebuilder5.rebuildWorkspaceRuntimeStateV5(runtime.sessionId, wsTestCatalog());
  const rebuiltAgain = rebuilder5.rebuildWorkspaceRuntimeStateV5(runtime.sessionId, wsTestCatalog());
  assert.deepEqual(online, rebuiltFresh.state, `${label}: online state != rebuilt state`);
  assert.deepEqual(rebuiltFresh.state, rebuiltAgain.state, `${label}: rebuild is not deterministic`);
  assert.deepEqual(runtime.fold.context.tutorCommands, rebuiltFresh.context.tutorCommands, `${label}: tutorCommands diverge`);
  assert.deepEqual(runtime.fold.context.draftCommands, rebuiltFresh.context.draftCommands, `${label}: draftCommands diverge`);
  const parity = runtime.assertWorkspaceReplayParity();
  assert.ok(parity.equal, `${label}: parity differences ${JSON.stringify(parity.differences)}`);
  // View：在线投影 == 用重建 state 投影（同一 projector 纯函数）。
  const viewOnline = runtime.projectView();
  const viewFromRebuild = projector5.projectStudentWorkspaceViewV5(
    rebuiltFresh.state,
    wsTestCatalog(),
    projector5.deriveMainlineParticipation(runtime.tutorState),
  );
  assert.deepEqual(viewOnline, viewFromRebuild, `${label}: view differs between online and rebuilt state`);
  // canonical 合同双重校验（state/v1 + view/v1）。
  assert.ok(canonical.validatePayload(online).ok, `${label}: state fails canonical workspace-runtime-state/v1`);
  assert.ok(canonical.validatePayload(viewOnline).ok, `${label}: view fails canonical student-workspace-view/v1`);
  // 单 revision 一致性：View.revision == workspace revision == TutorRuntimeState.workspace_revision。
  assert.equal(viewOnline.revision, online.revision, `${label}: view revision != workspace revision`);
  assert.equal(runtime.tutorState.workspace_revision, online.revision, `${label}: TutorRuntimeState.workspace_revision != workspace revision`);
}

/** 在会话上追加一个决策事件（causation 锚点；经真实 kernel.append；Beat 可覆写）。 */
function appendDecision(
  runtime: import("../WorkspaceSessionRuntimeV5").WorkspaceSessionRuntimeV5,
  decisionId: string,
  causationSequence: number,
  beatId: string = "BT-01",
): number {
  const result = runtime.kernel.append(runtime.kernel.revision, [
    {
      event_type: "policy_decision_made",
      payload: {
        decision_id: decisionId,
        decision_kind: "execute_beat",
        protocol_id: "PR-SMV-002",
        beat_id: beatId,
        policy_version: "presenter/v1",
        source_event_sequence: causationSequence,
        source_state_revision: runtime.kernel.revision,
      },
      occurred_at: at(),
      causation_sequence: causationSequence,
    },
  ]);
  return result.appendedSequences[0];
}

/** 主线 Beat 推进决策（transition_beat：fromBeat → toBeat；经真实 kernel.append）。 */
function appendTransitionDecision(
  runtime: import("../WorkspaceSessionRuntimeV5").WorkspaceSessionRuntimeV5,
  decisionId: string,
  causationSequence: number,
  fromBeat: string,
  toBeat: string,
): number {
  const result = runtime.kernel.append(runtime.kernel.revision, [
    {
      event_type: "policy_decision_made",
      payload: {
        decision_id: decisionId,
        decision_kind: "transition_beat",
        protocol_id: "PR-SMV-002",
        beat_id: fromBeat,
        to_beat_id: toBeat,
        policy_version: "presenter/v1",
        source_event_sequence: causationSequence,
        source_state_revision: runtime.kernel.revision,
      },
      occurred_at: at(),
      causation_sequence: causationSequence,
    },
  ]);
  return result.appendedSequences[0];
}

/** 追加 gate 评估事实（经真实 kernel.append；gate 账本由此更新）。 */
function appendGateEvaluated(
  runtime: import("../WorkspaceSessionRuntimeV5").WorkspaceSessionRuntimeV5,
  gateId: string,
  beatId: string,
  satisfied: boolean,
  causationSequence: number,
): number {
  const result = runtime.kernel.append(runtime.kernel.revision, [
    {
      event_type: "gate_evaluated",
      payload: { gate_id: gateId, beat_id: beatId, satisfied, evidence_sequence: causationSequence },
      occurred_at: at(),
      causation_sequence: causationSequence,
    },
  ]);
  return result.appendedSequences[0];
}

/** 追加一个 submit_answer 意图事件（决策的 causation 来源）。 */
function appendIntentFact(runtime: import("../WorkspaceSessionRuntimeV5").WorkspaceSessionRuntimeV5, requestId: string): number {
  const result = runtime.kernel.append(runtime.kernel.revision, [
    {
      event_type: "student_intent_recorded",
      payload: { intent_kind: "submit_answer", text: "先看条件", client_request_id: requestId },
      occurred_at: at(),
    },
  ]);
  return result.appendedSequences[0];
}

async function main(): Promise<void> {
  // ------------------------------------------------------------------ //
  await runTest("G3 core: tutor presentation action completes input → transition → event → rebuild → same view", () => {
    const sessionId = "TS-9601";
    const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    assert.equal(runtime.workspaceState.revision, 0);
    assert.deepEqual(
      runtime.workspaceState.solution_board.entries.map((entry: { visibility: string }) => entry.visibility),
      ["hidden", "hidden", "hidden", "hidden", "hidden"],
      "initial board entries must all be hidden",
    );
    const intentSeq = appendIntentFact(runtime, "cc-tutor-1");
    let decisionSeq = appendDecision(runtime, "TD-9601-1", intentSeq);

    // ① board reveal（intermediate 类，step_narration）
    const reveal = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9601-1", decision_id: "TD-9601-1", target_ids: ["BE-01"] }),
      decisionSeq,
    );
    assert.equal(reveal.status, "completed");
    assert.equal(reveal.changed, true);
    assert.equal(reveal.resultingRevision, 1);
    assert.equal(runtime.workspaceState.revision, 1);
    assert.equal(runtime.workspaceState.solution_board.entries[0].visibility, "visible");
    const viewAfterReveal = runtime.projectView();
    assert.equal(viewAfterReveal.solution_board.groups.length, 1);
    assert.equal(viewAfterReveal.solution_board.groups[0].entries[0].entry_id, "BE-01");
    assertRoundTrip(runtime, "tutor-reveal");

    // ② board activate
    decisionSeq = appendDecision(runtime, "TD-9601-2", intentSeq);
    const activate = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9601-2", decision_id: "TD-9601-2", capability: "board.activate-entry", target_ids: ["BE-01"], reveal_scope: "target_highlight" }),
      decisionSeq,
    );
    assert.equal(activate.status, "completed");
    assert.equal(runtime.workspaceState.solution_board.entries[0].visibility, "active");
    assert.equal(runtime.workspaceState.revision, 2);
    assertRoundTrip(runtime, "tutor-activate");

    // ③ geometry construct（tutor 构图 → committed）
    decisionSeq = appendDecision(runtime, "TD-9601-3", intentSeq);
    const construct = runtime.executePresentation(
      wsa(sessionId, {
        action_id: "WSA-9601-3",
        decision_id: "TD-9601-3",
        surface: "geometry",
        capability: "geometry.construct",
        target_ids: ["segment-AD"],
        command_payload: constructParallelJson("C", "segment-AD", "line-DE-parallel"),
        reveal_scope: "none",
      }),
      decisionSeq,
    );
    assert.equal(construct.status, "completed");
    assert.deepEqual(runtime.workspaceState.geometry.committed_element_ids, ["line-DE-parallel"]);
    assert.equal(runtime.workspaceState.revision, 3);
    const viewAfterConstruct = runtime.projectView();
    assert.ok(
      viewAfterConstruct.canvas.elements.some((element: { element_id: string; kind: string }) => element.element_id === "line-DE-parallel" && element.kind === "line"),
      "committed construction must appear in canvas with kind=line",
    );
    assertRoundTrip(runtime, "tutor-construct");

    // ④ geometry annotate（tutor 标注 → committed label）
    decisionSeq = appendDecision(runtime, "TD-9601-4", intentSeq);
    const annotate = runtime.executePresentation(
      wsa(sessionId, {
        action_id: "WSA-9601-4",
        decision_id: "TD-9601-4",
        surface: "geometry",
        capability: "geometry.annotate",
        target_ids: ["segment-AD"],
        command_payload: setSegmentLabelJson("segment-AD", "label-AD-len", "6"),
        reveal_scope: "none",
      }),
      decisionSeq,
    );
    assert.equal(annotate.status, "completed");
    assert.deepEqual(runtime.workspaceState.geometry.committed_element_ids, ["line-DE-parallel", "label-AD-len"]);
    assertRoundTrip(runtime, "tutor-annotate");
  });

  // ------------------------------------------------------------------ //
  await runTest("G3 core: student command completes input → transition → event → rebuild → same view (canonical SC fixture executed)", () => {
    const sessionId = "TS-9602";
    const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const intentSeq = appendIntentFact(runtime, "cc-student-1");
    let decisionSeq = appendDecision(runtime, "TD-9602-1", intentSeq);

    // 推进 workspace revision 到 5（canonical SC fixture 的 expected_workspace_revision=5）。
    for (const [index, entry] of ["BE-01", "BE-02", "BE-03"].entries()) {
      decisionSeq = appendDecision(runtime, `TD-9602-${index + 1}`, intentSeq);
      const step = runtime.executePresentation(
        wsa(sessionId, { action_id: `WSA-9602-${index + 1}`, decision_id: `TD-9602-${index + 1}`, target_ids: [entry], reveal_scope: "step_narration" }),
        decisionSeq,
      );
      assert.equal(step.status, "completed");
    }
    decisionSeq = appendDecision(runtime, "TD-9602-4", intentSeq);
    runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9602-4", decision_id: "TD-9602-4", surface: "geometry", capability: "geometry.construct", target_ids: ["segment-BC"], command_payload: constructParallelJson("D", "segment-BC", "line-AD-parallel"), reveal_scope: "none" }),
      decisionSeq,
    );
    decisionSeq = appendDecision(runtime, "TD-9602-5", intentSeq);
    runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9602-5", decision_id: "TD-9602-5", capability: "board.activate-entry", target_ids: ["BE-02"], reveal_scope: "target_highlight" }),
      decisionSeq,
    );
    assert.equal(runtime.workspaceState.revision, 5);

    // canonical student-workspace-command.positive.json 经真实入口执行。
    const canonicalCommand = readFixture("student-workspace-command.positive.json");
    const command = { ...(canonicalCommand as Record<string, unknown>), session_id: sessionId };
    const markReceipt = runtime.executeStudentCommand(command);
    assert.equal(markReceipt.status, "completed");
    assert.equal(markReceipt.changed, true);
    assert.equal(markReceipt.resultingRevision, 6);
    assert.deepEqual(runtime.workspaceState.geometry.draft_element_ids, ["label-AD", "label-DE"]);
    const viewAfterMark = runtime.projectView();
    for (const element of viewAfterMark.canvas.elements) {
      if (element.element_id === "label-AD" || element.element_id === "label-DE") {
        assert.equal(element.student_authored, true, "student draft labels must be student_authored");
        assert.equal(element.kind, "label");
      }
    }
    assertRoundTrip(runtime, "student-mark-known");

    // board attempt 生命周期（attempted≠confirmed）。
    const attempt = runtime.executeStudentCommand(
      sc(sessionId, 6, { command_id: "SC-9602-2", capability: "board.submit-attempt", target_ids: ["BE-02"], client_command_id: "cc-9602-attempt" }),
    );
    assert.equal(attempt.status, "completed");
    assert.equal(runtime.workspaceState.solution_board.entries[1].attempt_state, "attempted");
    // 未 attempted 直接 confirm → 拒绝。
    const prematureConfirm = runtime.executeStudentCommand(
      sc(sessionId, 7, { command_id: "SC-9602-3", capability: "board.confirm-entry", target_ids: ["BE-01"], client_command_id: "cc-9602-confirm-early" }),
    );
    assert.equal(prematureConfirm.status, "rejected");
    assert.equal(runtime.workspaceState.solution_board.entries[0].attempt_state, "none");
    const confirm = runtime.executeStudentCommand(
      sc(sessionId, 7, { command_id: "SC-9602-4", capability: "board.confirm-entry", target_ids: ["BE-02"], client_command_id: "cc-9602-confirm" }),
    );
    assert.equal(confirm.status, "completed");
    assert.equal(runtime.workspaceState.solution_board.entries[1].attempt_state, "confirmed");
    assertRoundTrip(runtime, "student-board-lifecycle");

    // 学生构图草稿（geometry.draft）。
    const draft = runtime.executeStudentCommand(
      sc(sessionId, 8, {
        command_id: "SC-9602-5",
        surface: "geometry",
        capability: "geometry.draft",
        target_ids: ["segment-DE"],
        params: { command: JSON.parse(setSegmentLabelJson("segment-DE", "label-DE-len", "2")) },
        client_command_id: "cc-9602-draft",
      }),
    );
    assert.equal(draft.status, "completed");
    assert.deepEqual(runtime.workspaceState.geometry.draft_element_ids, ["label-AD", "label-DE", "label-DE-len"]);
    assertRoundTrip(runtime, "student-draft");

    // resume（进程重启语义）：fresh runtime 从 db 重建，state 与在线一致。
    const resumed = runtime5.WorkspaceSessionRuntimeV5.resume(sessionId, wsTestCatalog());
    assert.deepEqual(resumed.workspaceState, runtime.workspaceState, "resume state != online state");
  });

  // ------------------------------------------------------------------ //
  await runTest("G3 negative: stale / duplicate / illegal target / unregistered capability do not pollute state (real entry)", () => {
    const sessionId = "TS-9603";
    const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const intentSeq = appendIntentFact(runtime, "cc-neg-1");
    const decisionSeq = appendDecision(runtime, "TD-9603-1", intentSeq);
    runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9603-1", decision_id: "TD-9603-1", target_ids: ["BE-01"] }),
      decisionSeq,
    );
    const baselineState = structuredClone(runtime.workspaceState);
    const baselineView = runtime.projectView();
    const baselineCount = countEvents(sessionId);

    // stale：expected_workspace_revision=0（当前 1）→ 拒绝（intent+outcome(rejected) 事实，零状态效果）。
    const stale = runtime.executeStudentCommand(
      sc(sessionId, 0, { command_id: "SC-9603-1", capability: "board.submit-attempt", target_ids: ["BE-01"], client_command_id: "cc-9603-stale" }),
    );
    assert.equal(stale.status, "rejected");
    assert.ok(stale.reason?.includes("stale_revision"), stale.reason);
    assert.deepEqual(runtime.workspaceState, baselineState, "stale command polluted state");
    assert.equal(countEvents(sessionId), baselineCount + 2, "stale rejection must persist exactly intent+outcome facts");
    assertRoundTrip(runtime, "after-stale");

    // duplicate：同 client_command_id 重放 → 幂等零新事实。
    const staleRetry = runtime.executeStudentCommand(
      sc(sessionId, 0, { command_id: "SC-9603-1b", capability: "board.submit-attempt", target_ids: ["BE-01"], client_command_id: "cc-9603-stale" }),
    );
    assert.equal(staleRetry.status, "duplicate");
    const afterDuplicateCount = countEvents(sessionId);
    assert.equal(afterDuplicateCount, baselineCount + 2, "duplicate retry appended new facts");
    assert.deepEqual(runtime.workspaceState, baselineState);

    // 已完成命令的重复提交同样幂等。
    const attemptOk = runtime.executeStudentCommand(
      sc(sessionId, 1, { command_id: "SC-9603-2", capability: "board.submit-attempt", target_ids: ["BE-01"], client_command_id: "cc-9603-attempt" }),
    );
    assert.equal(attemptOk.status, "completed");
    const attemptRetry = runtime.executeStudentCommand(
      sc(sessionId, 2, { command_id: "SC-9603-2b", capability: "board.submit-attempt", target_ids: ["BE-02"], client_command_id: "cc-9603-attempt" }),
    );
    assert.equal(attemptRetry.status, "duplicate");
    assert.equal(countEvents(sessionId), afterDuplicateCount + 2, "completed-command duplicate retry appended facts");
    const viewAfterAttempt = runtime.projectView();

    // illegal target：tutor reveal 未知条目 → 拒绝且零事件（tutor 校验失败不产事实）。
    const illegalReveal = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9603-2", decision_id: "TD-9603-1", target_ids: ["BE-99"] }),
      decisionSeq,
    );
    assert.equal(illegalReveal.status, "rejected");
    assert.ok(illegalReveal.reason?.includes("illegal target"));
    // student：对 hidden 条目作答 → 拒绝。
    const hiddenAttempt = runtime.executeStudentCommand(
      sc(sessionId, 2, { command_id: "SC-9603-3", capability: "board.submit-attempt", target_ids: ["BE-04"], client_command_id: "cc-9603-hidden" }),
    );
    assert.equal(hiddenAttempt.status, "rejected");
    assert.ok(hiddenAttempt.reason?.includes("hidden"));
    assert.equal(runtime.workspaceState.solution_board.entries[3].attempt_state, "none");

    // 未登记 capability（tutor 用 student 能力 / 完全未登记）→ 拒绝。
    const wrongOrigin = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9603-3", decision_id: "TD-9603-1", capability: "board.submit-attempt", target_ids: ["BE-01"] }),
      decisionSeq,
    );
    assert.equal(wrongOrigin.status, "rejected");
    assert.ok(wrongOrigin.reason?.includes("capability 未登记"));
    const unknownCapability = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9603-4", decision_id: "TD-9603-1", capability: "geometry.summon-answer", surface: "geometry" }),
      decisionSeq,
    );
    assert.equal(unknownCapability.status, "rejected");
    // 重复 reveal（已 visible）→ 拒绝（幂等执行层防重复事实）。
    const reReveal = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9603-5", decision_id: "TD-9603-1", target_ids: ["BE-01"] }),
      decisionSeq,
    );
    assert.equal(reReveal.status, "rejected");

    // canonical 负例 fixture（shape 非法 → 真实入口直接拒、零事件）。
    const canonicalNegative = readFixture("student-workspace-command.negative.missing-expected-revision.json") as Record<string, unknown>;
    const canonicalNegativeCount = countEvents(sessionId);
    const missingRevision = runtime.executeStudentCommand({ ...canonicalNegative, session_id: sessionId });
    assert.equal(missingRevision.status, "rejected");
    assert.ok(missingRevision.reason?.includes("canonical"));
    assert.equal(countEvents(sessionId), canonicalNegativeCount, "canonical-invalid command must append nothing");
    const originSpoof = readFixture("workspace-surface-action.negative.student-origin.json") as Record<string, unknown>;
    const spoof = runtime.executePresentation({ ...originSpoof, session_id: sessionId }, decisionSeq);
    assert.equal(spoof.status, "rejected");
    assert.ok(spoof.reason?.includes("canonical"));

    assert.deepEqual(
      runtime.workspaceState.solution_board.entries.map((entry: { visibility: string }) => entry.visibility),
      ["visible", "hidden", "hidden", "hidden", "hidden"],
      "negatives must not change visibility",
    );
    assertRoundTrip(runtime, "after-negatives");
    assert.deepEqual(
      { ...runtime.projectView(), participation: undefined },
      { ...viewAfterAttempt, participation: undefined },
      "view changed after pure rejections (ignoring participation)",
    );
    assert.ok(baselineView.revision === 1, "baseline sanity");
  });

  // ------------------------------------------------------------------ //
  await runTest("G3 negative: truth leak fails closed (final reveal needs scope + satisfied gate; none-scope reveal illegal; view/state leak scans)", () => {
    const sessionId = "TS-9604";
    const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const intentSeq = appendIntentFact(runtime, "cc-truth-1");
    const decisionSeq = appendDecision(runtime, "TD-9604-1", intentSeq);

    // final 类条目 + intermediate scope → 拒绝。
    const wrongScope = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9604-1", decision_id: "TD-9604-1", target_ids: ["BE-04"], reveal_scope: "intermediate_result" }),
      decisionSeq,
    );
    assert.equal(wrongScope.status, "rejected");
    // final_result 但 gate 未满足 → 拒绝（truth boundary violation）。
    const gateNotSatisfied = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9604-2", decision_id: "TD-9604-1", target_ids: ["BE-04"], reveal_scope: "final_result" }),
      decisionSeq,
    );
    assert.equal(gateNotSatisfied.status, "rejected");
    assert.ok(gateNotSatisfied.reason?.includes("gate 未满足"));
    // reveal_scope=none → 拒绝（无声明呈现 hidden 内容）。
    const noneScope = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9604-3", decision_id: "TD-9604-1", target_ids: ["BE-01"], reveal_scope: "none" }),
      decisionSeq,
    );
    assert.equal(noneScope.status, "rejected");
    assert.ok(noneScope.reason?.includes("reveal_scope=none"));
    assert.equal(runtime.workspaceState.revision, 0, "truth-leak attempts must not advance revision");

    // gate 满足后 final reveal 合法（正控制组）。
    runtime.kernel.append(runtime.kernel.revision, [
      {
        event_type: "gate_evaluated",
        payload: { gate_id: "GT-01", beat_id: "BT-01", satisfied: true, evidence_sequence: intentSeq },
        occurred_at: at(),
        causation_sequence: intentSeq,
      },
    ]);
    assert.equal(runtime.tutorState.teaching_cursor.phase, "gate_satisfied");
    const finalReveal = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9604-4", decision_id: "TD-9604-1", target_ids: ["BE-04"], reveal_scope: "final_result" }),
      decisionSeq,
    );
    assert.equal(finalReveal.status, "completed");
    assert.equal(runtime.workspaceState.solution_board.entries[3].visibility, "visible");

    // View 层 leak 扫描（R2：自动推导——hidden 条目 id/content 全集从
    // catalog+state 计算，View 全树递归断言零包含；不再手工字符串黑名单）。
    const view = runtime.projectView();
    assertNoWorkspaceTruthLeak(view, wsTestCatalog(), runtime.workspaceState);
    // state 层 canonical 负例（truth-leak / slice-revision 被 Zod 拒绝）。
    assert.ok(!canonical.validatePayload(readFixture("workspace-runtime-state.negative.truth-leak.json")).ok);
    assert.ok(!canonical.validatePayload(readFixture("workspace-runtime-state.negative.slice-revision.json")).ok);
    assert.ok(!canonical.validatePayload(readFixture("student-workspace-view.negative.truth-leak.json")).ok);
    assert.ok(!canonical.validatePayload(readFixture("student-workspace-view.negative.slice-revision.json")).ok);
    assertRoundTrip(runtime, "after-truth-boundary");
  });

  // ------------------------------------------------------------------ //
  await runTest("G3: canonical WSA fixture executed through real entry (presentation-only: no state change, no revision advance)", () => {
    const sessionId = "TS-4242";
    const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const intentSeq = appendIntentFact(runtime, "cc-4242-1");
    // canonical fixture 的 WSA 携带 beat_id=BT-02：先把主线推进到 BT-02，再在
    // BT-02 内做出决策（决策因果 + Beat 对齐是 R2 tutor 动作前置校验）。
    appendTransitionDecision(runtime, "TD-20260827-0000", intentSeq, "BT-01", "BT-02");
    const decisionSeq = appendDecision(runtime, "TD-20260827-0001", intentSeq, "BT-02");
    const stateBefore = structuredClone(runtime.workspaceState);
    const viewBefore = runtime.projectView();

    const canonicalAction = readFixture("workspace-surface-action.positive.json");
    const receipt = runtime.executePresentation(canonicalAction, decisionSeq);
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.changed, false, "presentation-only action must not change canonical state");
    assert.equal(receipt.resultingRevision, 0);
    assert.deepEqual(runtime.workspaceState, stateBefore, "presentation-only action changed state");
    assert.deepEqual(runtime.projectView(), viewBefore, "presentation-only action changed view");
    assertRoundTrip(runtime, "canonical-wsa-fixture");

    // canonical workspace-runtime-state.positive.json：state 合同消费 + 纯投影。
    const canonicalState = readFixture("workspace-runtime-state.positive.json");
    assert.ok(canonical.validatePayload(canonicalState).ok);
    const projected = projector5.projectStudentWorkspaceViewV5(
      canonicalState as never,
      wsFixtureStateCatalog(),
      { kind: "workspace_input", gate_id: "GT-01", action_id: "WSA-20260827-0001" },
    );
    assert.ok(canonical.validatePayload(projected).ok);
    assert.equal(projected.revision, 6);
    assert.equal(projected.canvas.interaction_enabled, true);
    // R2 自动推导扫描：禁漏全集从 catalog+canonical state 计算（BE-05 仍 hidden），
    // View 全树递归断言零包含——废弃手工字符串黑名单（"BE-05"/"EF = 4"）。
    assertNoWorkspaceTruthLeak(projected, wsFixtureStateCatalog(), canonicalState as never);
    const boardEntryIds = projected.solution_board.groups.flatMap((group: { entries: Array<{ entry_id: string }> }) => group.entries.map((entry) => entry.entry_id));
    assert.deepEqual(boardEntryIds, ["BE-01", "BE-02"]);
    const draftElement = projected.canvas.elements.find((element: { element_id: string }) => element.element_id === "seg-DE");
    assert.ok(draftElement, "draft element missing from projection");
    assert.equal((draftElement as { student_authored?: boolean }).student_authored, true, "draft must be student_authored");
    // canonical view fixture 本身合法（F1 冻结形状往返）。
    assert.ok(canonical.validatePayload(readFixture("student-workspace-view.positive.json")).ok);
    assert.ok(canonical.validatePayload(readFixture("action-outcome.positive.json")).ok);
  });

  // ------------------------------------------------------------------ //
  await runTest("G3: single workspace revision and single projector across both surfaces", () => {
    const sessionId = "TS-9605";
    const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const intentSeq = appendIntentFact(runtime, "cc-single-1");
    let decisionSeq = appendDecision(runtime, "TD-9605-1", intentSeq);
    // 混合 tutor/student 操作后：Geometry 与 Board 共用一个 revision 计数器与一个 projector。
    runtime.executePresentation(wsa(sessionId, { action_id: "WSA-9605-1", decision_id: "TD-9605-1", target_ids: ["BE-01"] }), decisionSeq);
    decisionSeq = appendDecision(runtime, "TD-9605-2", intentSeq);
    runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9605-2", decision_id: "TD-9605-2", surface: "geometry", capability: "geometry.construct", target_ids: ["segment-AD"], command_payload: constructParallelJson("C", "segment-AD", "line-BC-parallel"), reveal_scope: "none" }),
      decisionSeq,
    );
    runtime.executeStudentCommand(sc(sessionId, 2, { command_id: "SC-9605-1", capability: "board.submit-attempt", target_ids: ["BE-01"], client_command_id: "cc-9605-1" }));
    assert.equal(runtime.workspaceState.revision, 3);
    const view = runtime.projectView();
    assert.equal(view.revision, 3);
    // 投影纯度：同一 state 两次投影逐字节一致（无隐藏随机性/时间源）。
    assert.deepEqual(view, runtime.projectView());
    // 两个 surface 的数据都来自同一 state 对象（同一 session/revision）。
    assert.equal(view.session_id, sessionId);
    assert.ok(view.canvas.elements.length > 0 && view.solution_board.groups.length > 0);
    assertRoundTrip(runtime, "single-revision");
  });

  // ------------------------------------------------------------------ //
  await runTest("G3: rebuild fails closed on tampered workspace streams (orphan outcome / revision jump / stale embed)", () => {
    const sessionId = "TS-9606";
    const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const intentSeq = appendIntentFact(runtime, "cc-tamper-1");
    const decisionSeq = appendDecision(runtime, "TD-9606-1", intentSeq);
    runtime.executePresentation(wsa(sessionId, { action_id: "WSA-9606-1", decision_id: "TD-9606-1", target_ids: ["BE-01"] }), decisionSeq);
    const healthyCount = countEvents(sessionId);
    const healthyRowRevision = Number(
      (db.prepare("SELECT revision AS r FROM tutor_sessions WHERE session_id = ?").get(sessionId) as { r: number }).r,
    );
    const nextSeq = () => countEvents(sessionId) + 1;
    /** 篡改行同时 bump 会话行（保持 F2 verify 的 revision 分配语义成立，使 workspace fold 得以执行）。 */
    const bumpRow = (): number => {
      const row = db.prepare("SELECT revision AS r FROM tutor_sessions WHERE session_id = ?").get(sessionId) as { r: number };
      const next = row.r + 1;
      db.prepare("UPDATE tutor_sessions SET revision = ? WHERE session_id = ?").run(next, sessionId);
      return next;
    };
    const restoreRow = (): void => {
      db.prepare("UPDATE tutor_sessions SET revision = ? WHERE session_id = ?").run(healthyRowRevision, sessionId);
    };

    // (a) 孤儿完成：INSERT 无 issued 的 completed outcome。
    insertRawEvent.run(
      sessionId, nextSeq(), "action_outcome_recorded",
      JSON.stringify({ action_id: "WSA-9999", action_kind: "workspace_surface", outcome: "completed", resulting_revision: 2 }),
      at(), `tamper-a-${sessionId}`, bumpRow(), new Date().toISOString(), decisionSeq,
    );
    expectIntegrityError(
      () => rebuilder5.rebuildWorkspaceRuntimeStateV5(sessionId, wsTestCatalog()),
      "CORRUPT_EVENT", "孤儿完成事实",
    );
    db.prepare("DELETE FROM tutor_session_events WHERE session_id = ? AND idempotency_key = ?").run(sessionId, `tamper-a-${sessionId}`);
    restoreRow();
    assert.equal(countEvents(sessionId), healthyCount);
    assert.equal(rebuilder5.rebuildWorkspaceRuntimeStateV5(sessionId, wsTestCatalog()).state.revision, 1, "cleanup failed");

    // (b) resulting_revision 跳跃：合法 intent + outcome 携带 revision+2。
    const intentSeq2 = nextSeq();
    const revB = bumpRow();
    insertRawEvent.run(
      sessionId, intentSeq2, "student_intent_recorded",
      JSON.stringify({
        intent_kind: "submit_workspace_command",
        client_request_id: "cc-tamper-b",
        workspace_command: {
          command_id: "SC-9606-tamper", surface: "solution_board", capability: "board.submit-attempt",
          target_ids: ["BE-01"], expected_workspace_revision: 1, client_command_id: "cc-tamper-b",
        },
      }),
      at(), `tamper-b-intent-${sessionId}`, revB, new Date().toISOString(), null,
    );
    insertRawEvent.run(
      sessionId, intentSeq2 + 1, "action_outcome_recorded",
      JSON.stringify({ action_id: "SC-9606-tamper", action_kind: "student_command", outcome: "completed", resulting_revision: 3 }),
      at(), `tamper-b-outcome-${sessionId}`, revB, new Date().toISOString(), intentSeq2,
    );
    expectIntegrityError(
      () => rebuilder5.rebuildWorkspaceRuntimeStateV5(sessionId, wsTestCatalog()),
      "CORRUPT_EVENT", "恰 +1 语义",
    );
    db.prepare("DELETE FROM tutor_session_events WHERE session_id = ? AND idempotency_key IN (?, ?)").run(sessionId, `tamper-b-intent-${sessionId}`, `tamper-b-outcome-${sessionId}`);
    restoreRow();

    // (c) stale 内嵌：completed 的命令 expected_workspace_revision 与提交时不符。
    const intentSeqC = nextSeq();
    const revC = bumpRow();
    insertRawEvent.run(
      sessionId, intentSeqC, "student_intent_recorded",
      JSON.stringify({
        intent_kind: "submit_workspace_command",
        client_request_id: "cc-tamper-c",
        workspace_command: {
          command_id: "SC-9606-stale", surface: "solution_board", capability: "board.submit-attempt",
          target_ids: ["BE-02"], expected_workspace_revision: 99, client_command_id: "cc-tamper-c",
        },
      }),
      at(), `tamper-c-intent-${sessionId}`, revC, new Date().toISOString(), null,
    );
    insertRawEvent.run(
      sessionId, intentSeqC + 1, "action_outcome_recorded",
      JSON.stringify({ action_id: "SC-9606-stale", action_kind: "student_command", outcome: "completed", resulting_revision: 2 }),
      at(), `tamper-c-outcome-${sessionId}`, revC, new Date().toISOString(), intentSeqC,
    );
    expectIntegrityError(
      () => rebuilder5.rebuildWorkspaceRuntimeStateV5(sessionId, wsTestCatalog()),
      "CORRUPT_EVENT", "stale 命令不得完成",
    );
    db.prepare("DELETE FROM tutor_session_events WHERE session_id = ? AND idempotency_key IN (?, ?)").run(sessionId, `tamper-c-intent-${sessionId}`, `tamper-c-outcome-${sessionId}`);
    restoreRow();

    // 清理后健康流可重建（fail closed 不留残余影响）。
    const healthy = rebuilder5.rebuildWorkspaceRuntimeStateV5(sessionId, wsTestCatalog());
    assert.equal(healthy.state.revision, 1);
  });

  // ------------------------------------------------------------------ //
  await runTest("G3: issued/intent without outcome (mid-action crash) produce no completion side effects; session_completed locks interaction", () => {
    const sessionId = "TS-9607";
    const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const intentSeq = appendIntentFact(runtime, "cc-crash-1");
    const decisionSeq = appendDecision(runtime, "TD-9607-1", intentSeq);
    // 直接经 kernel.append 写 issued 事实（模拟两事务之间崩溃）。
    runtime.kernel.append(runtime.kernel.revision, [
      {
        event_type: "workspace_surface_action_issued",
        payload: {
          action_id: "WSA-9607-crash", decision_id: "TD-9607-1", surface: "solution_board",
          capability: "board.reveal-entry", target_ids: ["BE-01"], reveal_scope: "step_narration",
        },
        occurred_at: at(),
        causation_sequence: decisionSeq,
      },
      {
        event_type: "student_intent_recorded",
        payload: {
          intent_kind: "submit_workspace_command",
          client_request_id: "cc-crash-cmd",
          workspace_command: {
            command_id: "SC-9607-crash", surface: "solution_board", capability: "board.submit-attempt",
            target_ids: ["BE-01"], expected_workspace_revision: 0, client_command_id: "cc-crash-cmd",
          },
        },
        occurred_at: at(),
      },
    ]);
    // resume（进程重启语义）：issued/intent 无 outcome ⇒ 零完成副作用。
    const resumed = runtime5.WorkspaceSessionRuntimeV5.resume(sessionId, wsTestCatalog());
    assert.equal(resumed.workspaceState.revision, 0, "issued/intent without outcome advanced revision");
    assert.equal(resumed.workspaceState.solution_board.entries[0].visibility, "hidden");
    assert.equal(resumed.workspaceState.solution_board.entries[0].attempt_state, "none");
    const resumedView = resumed.projectView();
    // R2 自动推导扫描：issued-without-outcome 不得泄漏任何 hidden 真值（全集推导）。
    assertNoWorkspaceTruthLeak(resumedView, wsTestCatalog(), resumed.workspaceState);

    // session_completed → interaction locked（review 模式、只读）。
    runtime.kernel.append(runtime.kernel.revision, [
      { event_type: "session_completed", payload: { final_beat_id: "BT-01" }, occurred_at: at() },
    ]);
    const completed = runtime5.WorkspaceSessionRuntimeV5.resume(sessionId, wsTestCatalog());
    assert.equal(completed.workspaceState.geometry.interaction_mode, "locked");
    const completedView = completed.projectView();
    assert.equal(completedView.canvas.interaction_enabled, false);
    assert.equal(completedView.solution_board.mode, "review");
    assert.equal(completedView.participation.kind, "read_only_completed");
  });

  // ------------------------------------------------------------------ //
  await runTest("R2 legacy disposal: unregistered adaptation path deleted; inputs lacking reveal semantics fail closed", () => {
    // ① 删除即隔离（代码级）：未登记 adapter 不再存在于 F3 产物面——
    //    v5 会话不可能经它产出 catalog（行序反推 BE-01 编号/首行 statement/
    //    末行 conclusion-final/全 PG-01 违反 adapter 纪律，2026-08-31 裁定删除）。
    assert.equal(
      (catalog5 as Record<string, unknown>).adaptLegacyWorkspaceIntoCatalogV5,
      undefined,
      "adaptLegacyWorkspaceIntoCatalogV5 must be deleted (unregistered adaptation path)",
    );

    // ② 缺 reveal 语义的 legacy 输入一律 fail closed：板书行（latexTemplate 行）
    //    不携带 kind/revealRequirement/revealGate → buildWorkspacePresentationCatalog
    //    拒绝，不产出可 reveal 的完整 catalog（也不产出 legacy_partial 后再放行）。
    const legacyBoardRows = [
      { entryId: "BE-01", content: "\\triangle ADE \\sim \\triangle ABC", presentationGroup: "PG-01" },
      { entryId: "BE-02", content: "\\frac{AD}{AB} = \\frac{DE}{BC}", presentationGroup: "PG-01" },
      { entryId: "BE-03", content: "DE = 2", presentationGroup: "PG-01" },
    ];
    assert.throws(
      () => catalog5.buildWorkspacePresentationCatalog({ schemaVersion: 1, taskId: "legacySnapshotTask", boardEntries: legacyBoardRows, canonicalPathEntryIds: [] }),
      (error: Error) => {
        assert.equal(error.name, "WorkspaceCatalogError");
        assert.ok(error.message.includes("kind"), error.message);
        assert.ok(error.message.includes("revealRequirement"), error.message);
        return true;
      },
      "legacy rows without reveal semantics must fail closed",
    );

    // ③ final 条目缺 gate 绑定 → fail closed（五级绑定的资源授权声明必带）。
    assert.throws(
      () =>
        catalog5.buildWorkspacePresentationCatalog({
          schemaVersion: 1,
          taskId: "t",
          boardEntries: [
            { entryId: "BE-01", kind: "statement", content: "a", presentationGroup: "PG-01", revealRequirement: "intermediate" },
            { entryId: "BE-02", kind: "conclusion", content: "DE = 2", presentationGroup: "PG-01", revealRequirement: "final" },
          ],
          canonicalPathEntryIds: ["BE-01", "BE-02"],
        }),
      (error: Error) => {
        assert.equal(error.name, "WorkspaceCatalogError");
        assert.ok(error.message.includes("revealGate"), error.message);
        return true;
      },
      "final entry without revealGate must fail closed",
    );

    // ④ 正控制组：显式 authored 语义（人工给出 kind/revealRequirement/revealGate）
    //    是唯一合法产路——显式声明可构建。
    const explicitlyAuthored = catalog5.buildWorkspacePresentationCatalog({
      schemaVersion: 1,
      taskId: "legacySnapshotTask",
      boardEntries: [
        { entryId: "BE-01", kind: "statement", content: "△ADE ∽ △ABC", presentationGroup: "PG-01", revealRequirement: "intermediate" },
        { entryId: "BE-02", kind: "conclusion", content: "DE = 2", presentationGroup: "PG-01", revealRequirement: "final", revealGate: { gateId: "GT-01", beatId: "BT-01", protocolId: "PR-SMV-002" } },
      ],
      canonicalPathEntryIds: ["BE-01", "BE-02"],
    });
    assert.deepEqual(explicitlyAuthored.canonicalPathEntryIds, ["BE-01", "BE-02"]);
  });

  // ------------------------------------------------------------------ //
  await runTest("R2 gate binding: five-level chain fails closed on wrong-gate / wrong-beat / stale-gate / wrong-resource / wrong-decision-causation (real entry)", () => {
    // 五类负例各自独立会话（互不污染）；全部经 executePresentation 真实入口。
    // catalog 绑定：BE-04←GT-01@BT-01、BE-05←GT-02@BT-01（wsTestCatalog）。

    // (1) wrong-gate：GT-02 满足（授权 BE-05），reveal BE-04（绑定 GT-01）→ 拒。
    {
      const sessionId = "TS-9611";
      const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
      const intentSeq = appendIntentFact(runtime, "cc-9611-1");
      const decisionSeq = appendDecision(runtime, "TD-9611-1", intentSeq);
      appendGateEvaluated(runtime, "GT-02", "BT-01", true, intentSeq);
      const wrongGate = runtime.executePresentation(
        wsa(sessionId, { action_id: "WSA-9611-1", decision_id: "TD-9611-1", target_ids: ["BE-04"], reveal_scope: "final_result" }),
        decisionSeq,
      );
      assert.equal(wrongGate.status, "rejected");
      assert.ok(wrongGate.reason?.includes("gate 未满足"), wrongGate.reason);
      assert.ok(wrongGate.reason?.includes("GT-01@BT-01"), wrongGate.reason);
      assert.equal(runtime.workspaceState.solution_board.entries[3].visibility, "hidden");
      assert.equal(countEvents(sessionId), 4, "tutor rejection appends zero facts");
    }

    // (2) wrong-beat：cursor 已在 BT-02，gate 于 BT-02 满足，但条目绑定 Beat=BT-01 → 拒
    //     （gate 必须属于条目绑定的当前 Beat——Beat 不符即非法）。
    {
      const sessionId = "TS-9612";
      const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
      const intentSeq = appendIntentFact(runtime, "cc-9612-1");
      appendTransitionDecision(runtime, "TD-9612-0", intentSeq, "BT-01", "BT-02");
      const decisionSeq = appendDecision(runtime, "TD-9612-1", intentSeq, "BT-02");
      appendGateEvaluated(runtime, "GT-01", "BT-02", true, intentSeq);
      const wrongBeat = runtime.executePresentation(
        wsa(sessionId, { action_id: "WSA-9612-1", decision_id: "TD-9612-1", target_ids: ["BE-04"], reveal_scope: "final_result" }),
        decisionSeq,
      );
      assert.equal(wrongBeat.status, "rejected");
      assert.ok(wrongBeat.reason?.includes("Beat 不符"), wrongBeat.reason);
      assert.equal(runtime.workspaceState.solution_board.entries[3].visibility, "hidden");
    }

    // (3) stale-gate：GT-01 于 BT-01 满足后主线推进到 BT-02 → 旧 gate 失效 → 拒。
    {
      const sessionId = "TS-9613";
      const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
      const intentSeq = appendIntentFact(runtime, "cc-9613-1");
      appendGateEvaluated(runtime, "GT-01", "BT-01", true, intentSeq);
      appendTransitionDecision(runtime, "TD-9613-0", intentSeq, "BT-01", "BT-02");
      const decisionSeq = appendDecision(runtime, "TD-9613-1", intentSeq, "BT-02");
      const staleGate = runtime.executePresentation(
        wsa(sessionId, { action_id: "WSA-9613-1", decision_id: "TD-9613-1", target_ids: ["BE-04"], reveal_scope: "final_result" }),
        decisionSeq,
      );
      assert.equal(staleGate.status, "rejected");
      assert.ok(staleGate.reason?.includes("stale-gate"), staleGate.reason);
      assert.equal(runtime.workspaceState.solution_board.entries[3].visibility, "hidden");
    }

    // (4) wrong-resource：GT-01 满足（授权 BE-04），reveal BE-05（绑定 GT-02 未满足）→ 拒；
    //     随后正控制组：reveal BE-04 → completed（同 gate 同 Beat 授权正确条目）。
    {
      const sessionId = "TS-9614";
      const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
      const intentSeq = appendIntentFact(runtime, "cc-9614-1");
      const decisionSeq = appendDecision(runtime, "TD-9614-1", intentSeq);
      appendGateEvaluated(runtime, "GT-01", "BT-01", true, intentSeq);
      const wrongResource = runtime.executePresentation(
        wsa(sessionId, { action_id: "WSA-9614-1", decision_id: "TD-9614-1", target_ids: ["BE-05"], reveal_scope: "final_result" }),
        decisionSeq,
      );
      assert.equal(wrongResource.status, "rejected");
      assert.ok(wrongResource.reason?.includes("gate 未满足"), wrongResource.reason);
      assert.ok(wrongResource.reason?.includes("GT-02@BT-01"), wrongResource.reason);
      assert.equal(runtime.workspaceState.solution_board.entries[4].visibility, "hidden");
      const positiveControl = runtime.executePresentation(
        wsa(sessionId, { action_id: "WSA-9614-2", decision_id: "TD-9614-1", target_ids: ["BE-04"], reveal_scope: "final_result" }),
        decisionSeq,
      );
      assert.equal(positiveControl.status, "completed");
      assert.equal(runtime.workspaceState.solution_board.entries[3].visibility, "visible");
      assertRoundTrip(runtime, "gate-binding-positive-control");
    }

    // (5) wrong-decision-causation：decision 无 committed 因果 / action.beat 与
    //     当前 Beat 不符 / 决策产出 Beat 与当前不符 → 拒（ADR-007 不变量 4）。
    {
      const sessionId = "TS-9615";
      const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
      const intentSeq = appendIntentFact(runtime, "cc-9615-1");
      const decisionSeq = appendDecision(runtime, "TD-9615-1", intentSeq);
      appendGateEvaluated(runtime, "GT-01", "BT-01", true, intentSeq);
      const noDecision = runtime.executePresentation(
        wsa(sessionId, { action_id: "WSA-9615-1", decision_id: "TD-9615-NEVER", target_ids: ["BE-04"], reveal_scope: "final_result" }),
        decisionSeq,
      );
      assert.equal(noDecision.status, "rejected");
      assert.ok(noDecision.reason?.includes("wrong-decision-causation"), noDecision.reason);
      const wrongActionBeat = runtime.executePresentation(
        wsa(sessionId, { action_id: "WSA-9615-2", decision_id: "TD-9615-1", beat_id: "BT-09", target_ids: ["BE-01"] }),
        decisionSeq,
      );
      assert.equal(wrongActionBeat.status, "rejected");
      assert.ok(wrongActionBeat.reason?.includes("wrong-beat"), wrongActionBeat.reason);
      // 决策产出 Beat 与当前不符：BT-01 决策在 cursor=BT-02 时不得授权动作。
      appendTransitionDecision(runtime, "TD-9615-0", intentSeq, "BT-01", "BT-02");
      const staleDecision = runtime.executePresentation(
        wsa(sessionId, { action_id: "WSA-9615-3", decision_id: "TD-9615-1", target_ids: ["BE-01"] }),
        decisionSeq,
      );
      assert.equal(staleDecision.status, "rejected");
      assert.ok(staleDecision.reason?.includes("wrong-beat"), staleDecision.reason);
      assert.equal(runtime.workspaceState.solution_board.entries[0].visibility, "hidden");
      assert.equal(runtime.workspaceState.revision, 0, "causation negatives must not advance revision");
    }
  });

  // ------------------------------------------------------------------ //
  await runTest("R2 mode validation: locked interaction mode fails closed for student and tutor (facts without state effects; not student incorrect)", () => {
    const sessionId = "TS-9616";
    const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const intentSeq = appendIntentFact(runtime, "cc-9616-1");
    const decisionSeq = appendDecision(runtime, "TD-9616-1", intentSeq);
    // 先揭示 BE-01 使其可作答（intermediate reveal，锁前完成）。
    runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9616-1", decision_id: "TD-9616-1", target_ids: ["BE-01"] }),
      decisionSeq,
    );
    // tutor 锁定 interaction（真实入口：workspace.lock-interaction）。
    const lock = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9616-2", decision_id: "TD-9616-1", surface: "geometry", capability: "workspace.lock-interaction", reveal_scope: "none" }),
      decisionSeq,
    );
    assert.equal(lock.status, "completed");
    assert.equal(runtime.workspaceState.geometry.interaction_mode, "locked");

    const eventsBefore = countEvents(sessionId);
    const baselineState = structuredClone(runtime.workspaceState);

    // student 命令在 locked 下 → rejected 事实（intent+outcome）+ 零状态效果；
    // ADR-007 不变量 6：mode/runtime 边界拒绝不得转成 student incorrect——
    // attempt 保持 none（不产生作答错误语义），outcome=rejected（非 failed/完成）。
    const lockedAttempt = runtime.executeStudentCommand(
      sc(sessionId, runtime.workspaceState.revision, { command_id: "SC-9616-1", capability: "board.submit-attempt", target_ids: ["BE-01"], client_command_id: "cc-9616-locked" }),
    );
    assert.equal(lockedAttempt.status, "rejected");
    assert.ok(lockedAttempt.reason?.includes("mode 不匹配"), lockedAttempt.reason);
    assert.equal(lockedAttempt.reason?.includes("locked"), true, lockedAttempt.reason);
    assert.equal(runtime.workspaceState.solution_board.entries[0].attempt_state, "none");
    assert.equal(countEvents(sessionId), eventsBefore + 2, "locked rejection persists intent+outcome facts");
    const outcomeRow = db
      .prepare("SELECT payload_json FROM tutor_session_events WHERE session_id = ? AND event_type = 'action_outcome_recorded' ORDER BY sequence DESC LIMIT 1")
      .get(sessionId) as { payload_json: string };
    const outcomePayload = JSON.parse(outcomeRow.payload_json) as { action_id: string; outcome: string; message?: string };
    assert.equal(outcomePayload.action_id, "SC-9616-1");
    assert.equal(outcomePayload.outcome, "rejected");
    assert.ok(outcomePayload.message?.includes("mode 不匹配"), String(outcomePayload.message));

    // tutor 动作在 locked 下 → 拒绝且零事件（编排方缺陷）。
    const lockedTutorReveal = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9616-3", decision_id: "TD-9616-1", target_ids: ["BE-02"] }),
      decisionSeq,
    );
    assert.equal(lockedTutorReveal.status, "rejected");
    assert.ok(lockedTutorReveal.reason?.includes("mode 不匹配"), lockedTutorReveal.reason);
    const eventsAfterTutor = countEvents(sessionId);
    const lockedStudentDraft = runtime.executeStudentCommand(
      sc(sessionId, runtime.workspaceState.revision, {
        command_id: "SC-9616-2",
        surface: "geometry",
        capability: "geometry.draft",
        target_ids: ["segment-DE"],
        params: { command: JSON.parse(setSegmentLabelJson("segment-DE", "label-9616", "2")) },
        client_command_id: "cc-9616-locked-draft",
      }),
    );
    assert.equal(lockedStudentDraft.status, "rejected");
    assert.ok(lockedStudentDraft.reason?.includes("mode 不匹配"), lockedStudentDraft.reason);
    assert.deepEqual(runtime.workspaceState, baselineState, "mode rejections changed state");
    assert.equal(countEvents(sessionId), eventsAfterTutor + 2, "student rejection facts only");
    assertRoundTrip(runtime, "after-mode-negatives");
  });

  // ------------------------------------------------------------------ //
  await runTest("R2 catalog pin: start writes workspace_catalog_pin; resume reconciles digest and fails closed (HASH_MISMATCH)", () => {
    const sessionId = "TS-9617";
    const catalog = wsTestCatalog();
    const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), catalog);
    const intentSeq = appendIntentFact(runtime, "cc-9617-1");
    const decisionSeq = appendDecision(runtime, "TD-9617-1", intentSeq);
    runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9617-1", decision_id: "TD-9617-1", target_ids: ["BE-01"] }),
      decisionSeq,
    );

    // ① start 注入 pin：session_started payload 携带服务端计算值（R0 §4 口径）。
    const started = store5.readTutorSessionEventsV5(sessionId)[0].payload as {
      workspace_catalog_pin?: { catalog_schema_version: number; content_hash: string; entry_count: number };
    };
    assert.ok(started.workspace_catalog_pin, "session_started must carry workspace_catalog_pin");
    assert.equal(started.workspace_catalog_pin!.catalog_schema_version, 1);
    assert.equal(started.workspace_catalog_pin!.entry_count, 5);
    assert.match(started.workspace_catalog_pin!.content_hash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(started.workspace_catalog_pin!.content_hash, catalog5.computeWorkspaceCatalogDigest(catalog));

    // ② 同 catalog resume → 对账通过，state 与在线一致。
    const resumed = runtime5.WorkspaceSessionRuntimeV5.resume(sessionId, wsTestCatalog());
    assert.deepEqual(resumed.workspaceState, runtime.workspaceState);

    // ③ Board 文本被改（revision 不变——catalog 无版本位）→ digest 检出 → HASH_MISMATCH。
    const tamperedText = buildWorkspacePresentationCatalogFromEntries(
      wsTestCatalog().boardEntries.map((entry) =>
        entry.entryId === "BE-03" ? { ...entry, content: "被篡改的板书文本 DE∥BC" } : entry,
      ),
    );
    expectIntegrityError(
      () => runtime5.WorkspaceSessionRuntimeV5.resume(sessionId, tamperedText),
      "HASH_MISMATCH", "content_hash",
    );

    // ④ task/Plan 不匹配（catalog.taskId ≠ session_started.task_id）→ HASH_MISMATCH。
    const wrongTask = buildWorkspacePresentationCatalogFromEntries(wsTestCatalog().boardEntries, "anotherTask");
    expectIntegrityError(
      () => runtime5.WorkspaceSessionRuntimeV5.resume(sessionId, wrongTask),
      "HASH_MISMATCH", "task/Plan 不符",
    );

    // ⑤ 条目被删（entry_count 不符 + hash 不符）→ HASH_MISMATCH。
    const droppedEntry = buildWorkspacePresentationCatalogFromEntries(wsTestCatalog().boardEntries.slice(0, 4));
    expectIntegrityError(
      () => runtime5.WorkspaceSessionRuntimeV5.resume(sessionId, droppedEntry),
      "HASH_MISMATCH",
    );

    // ⑥ gate 绑定被改（revealGate 参与 digest）→ HASH_MISMATCH。
    const tamperedGate = buildWorkspacePresentationCatalogFromEntries(
      wsTestCatalog().boardEntries.map((entry) =>
        entry.entryId === "BE-04" && entry.revealGate ? { ...entry, revealGate: { ...entry.revealGate, gateId: "GT-09" } } : entry,
      ),
    );
    expectIntegrityError(
      () => runtime5.WorkspaceSessionRuntimeV5.resume(sessionId, tamperedGate),
      "HASH_MISMATCH",
    );

    // ⑦ 无 pin 的流（对账无据）→ 拒绝（不接受未经对账的任意 catalog）。
    const pinlessSession = "TS-9618";
    const pinlessStart = wsStartInput(pinlessSession);
    delete (pinlessStart.sessionStarted as { workspace_catalog_pin?: unknown }).workspace_catalog_pin;
    store5.startTutorSessionV5(pinlessStart);
    expectIntegrityError(
      () => runtime5.WorkspaceSessionRuntimeV5.resume(pinlessSession, wsTestCatalog()),
      "HASH_MISMATCH", "workspace_catalog_pin",
    );

    // ⑧ 事件流篡改 pin 值 → 对账失败（fail closed 不回退）。
    db.prepare("UPDATE tutor_session_events SET payload_json = ? WHERE session_id = ? AND sequence = 1").run(
      JSON.stringify({ ...started, workspace_catalog_pin: { catalog_schema_version: 1, content_hash: `sha256:${"0".repeat(64)}`, entry_count: 5 } }),
      sessionId,
    );
    expectIntegrityError(
      () => runtime5.WorkspaceSessionRuntimeV5.resume(sessionId, wsTestCatalog()),
      "HASH_MISMATCH", "content_hash",
    );
  });

  // ------------------------------------------------------------------ //
  await runTest("G3: accept-draft moves student work into committed with world command promotion", () => {
    const sessionId = "TS-9609";
    const runtime = runtime5.WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const draft = runtime.executeStudentCommand(
      sc(sessionId, 0, {
        command_id: "SC-9609-1",
        surface: "geometry",
        capability: "geometry.draft",
        target_ids: ["segment-DE"],
        params: { command: JSON.parse(setSegmentLabelJson("segment-DE", "label-DE-len", "2")) },
        client_command_id: "cc-9609-draft",
      }),
    );
    assert.equal(draft.status, "completed");
    assert.deepEqual(runtime.workspaceState.geometry.draft_element_ids, ["label-DE-len"]);
    assert.equal(runtime.projectView().canvas.elements.find((element: { element_id: string }) => element.element_id === "label-DE-len")?.student_authored, true);

    const intentSeq = appendIntentFact(runtime, "cc-accept-1");
    const decisionSeq = appendDecision(runtime, "TD-9609-1", intentSeq);
    const accept = runtime.executePresentation(
      wsa(sessionId, {
        action_id: "WSA-9609-1", decision_id: "TD-9609-1", surface: "geometry",
        capability: "geometry.accept-draft", target_ids: ["label-DE-len"], reveal_scope: "none",
      }),
      decisionSeq,
    );
    assert.equal(accept.status, "completed");
    assert.deepEqual(runtime.workspaceState.geometry.draft_element_ids, []);
    assert.deepEqual(runtime.workspaceState.geometry.committed_element_ids, ["label-DE-len"]);
    // 接受后：world 命令从 draftCommands 移入 tutorCommands（重构图世界一致）。
    assert.deepEqual(runtime.fold.context.draftCommands, []);
    assert.equal(runtime.fold.context.tutorCommands.length, 1);
    // View：student_authored 标志随归属消失。
    const accepted = runtime.projectView().canvas.elements.find((element: { element_id: string }) => element.element_id === "label-DE-len");
    assert.notEqual(accepted?.student_authored, true);
    assertRoundTrip(runtime, "accept-draft");
  });
}

/** 用条目集（可篡改）重建 catalog——pin 对账负例的 tampered catalog 构造器。 */
function buildWorkspacePresentationCatalogFromEntries(
  entries: ReadonlyArray<import("../WorkspacePresentationCatalogV5").WorkspaceBoardEntrySpec>,
  taskId: string = "goldenMinhangCross2020",
): import("../WorkspacePresentationCatalogV5").WorkspacePresentationCatalogV5 {
  return catalog5.buildWorkspacePresentationCatalog({
    schemaVersion: 1,
    taskId,
    boardEntries: entries,
    canonicalPathEntryIds: entries.map((entry) => entry.entryId),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
