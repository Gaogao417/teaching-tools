/**
 * P5-01..14：TutorSessionCoordinator 闭环集成测试（合成 canonical root 全管线：
 * truth/TA→build→approve→materialize→publish→session closed loop→replay）。
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { ensureSqlite, publishSyntheticPlan, tempRoot } from "./support";

const sqlitePath = ensureSqlite("tutor-session-coordinator");

const { createTutorSessionCoordinator } = require("../TutorSession") as typeof import("../TutorSession");
const { loadCurrentPlan } = require("../../planBuild/canonicalInputs") as typeof import("../../planBuild/canonicalInputs");

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main(): Promise<void> {
  const root = tempRoot("tutor-session");
  const plan = publishSyntheticPlan(root, { qtId: "QT-SMV-001", tpId: "TP-SMV-001", parts: 0 });
  const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
  const loadedPlan = loadCurrentPlan({ canonicalRoot: root }, "TP-SMV-001");
  assert.ok(loadedPlan.ok);

  await runTest("start fail-closed: assessment / feature flag / non-approved plan", () => {
    assert.throws(
      () => coordinator.start({ sessionId: "TS-9601", studentId: "s", tpId: "TP-SMV-001", sessionKind: "assessment" }),
      (error: unknown) => error instanceof Error && error.message.includes("Assessment"),
    );
    assert.throws(
      () => coordinator.start({ sessionId: "TS-9602", studentId: "s", tpId: "TP-SMV-999" }),
      (error: unknown) => error instanceof Error && (error.message.includes("feature flag") || error.message.includes("PLAN_NOT_APPROVED")),
    );
  });

  await runTest("closed loop: teach open → hand over → guided confirm → action evidence → complete", async () => {
    const sid = "TS-9610";
    coordinator.start({ sessionId: sid, studentId: "student-a", tpId: "TP-SMV-001" });

    // Teach 开场：explain(voice_seed+explanation) → hand over
    const opening = await coordinator.driveTutorTurn(sid);
    assert.equal(opening.decision?.move_type, "explain");
    assert.equal(opening.decision?.purpose_code, "explain.open");
    assert.ok(opening.presentation.voice.length >= 1);
    for (const voice of opening.presentation.voice) {
      coordinator.completeVoice(sid, { action_id: voice.action_id, outcome: "completed" });
    }
    const handOver = await coordinator.driveTutorTurn(sid);
    assert.equal(handOver.decision?.purpose_code, "prompt.hand_over");
    assert.equal(handOver.decision?.mode_change?.to_mode, "guided_solve");
    for (const voice of handOver.presentation.voice) {
      coordinator.completeVoice(sid, { action_id: voice.action_id, outcome: "completed" });
    }
    const afterHandOver = coordinator.restore(sid);
    assert.equal(afterHandOver.mode, "guided_solve");

    // Guided：CP1/CP2 复述预期 → confirm + 推进
    const checkpoints = plan.checkpoints.map((entry) => entry.checkpoint_id);
    const actionResource = plan.resources.find((resource) => resource.kind === "action_template");
    const actionCheckpoint = actionResource?.checkpoint_id ?? checkpoints.at(-1)!;
    for (const checkpointId of checkpoints) {
      if (checkpointId === actionCheckpoint) break;
      const record = coordinator.recordStudentInput(sid, {
        input_kind: "reasoning_utterance",
        text: plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)!.expected_reasoning,
      });
      assert.equal(record.alignment?.alignment, "expected_checkpoint");
      assert.equal(record.progressed, true);
      const confirmTurn = await coordinator.driveTutorTurn(sid);
      assert.equal(confirmTurn.decision?.move_type, "confirm");
      for (const voice of confirmTurn.presentation.voice) {
        coordinator.completeVoice(sid, { action_id: voice.action_id, outcome: "completed" });
      }
      // presentation_completed → 到 action 节点则交接操作步，否则无动作
      await coordinator.driveTutorTurn(sid);
    }

    // Action 节点：prompt.action_step 派发 workspace action，学生正确操作被接受
    const state = coordinator.restore(sid);
    assert.ok(state.workspace.active_action_id, "action 节点应已派发 workspace action");
    // 裁定 §6/§8-9：学生面 presentation 只含已验证 Workspace 呈现——
    // 无 learn_contract/localTruth/teachingInput/expectedValues。
    const allEvents = coordinator.getEvents(sid);
    const issuedWorkspace = allEvents.filter((event) => event.event_type === "workspace_action_issued");
    for (const issued of issuedWorkspace) {
      const serialized = JSON.stringify(issued.payload);
      assert.ok(!serialized.includes("localTruth"), "issued payload 不得含 localTruth");
      assert.ok(!serialized.includes("teachingInput"), "issued payload 不得含 teachingInput");
      assert.ok(!serialized.includes("expectedValues"), "issued payload 不得含 expectedValues");
    }
    assert.ok(issuedWorkspace.length > 0, "closed loop 应至少签发一个 workspace action");
    const template = JSON.parse(actionResource!.content!);
    const evidence = {
      actionId: template.actionId,
      sourceStepId: template.sourceStepId,
      kind: template.kind,
      version: 1 as const,
      value: template.teachingInput.expectedValues[0],
    };
    const wrongEvidence = { ...evidence, value: "完全无关的错答" };
    const rejectedFirst = coordinator.submitActionEvidence(sid, wrongEvidence);
    assert.equal(rejectedFirst.accepted, false, "错误操作证据应被真实 typed evaluator 拒绝");
    const accepted = coordinator.submitActionEvidence(sid, evidence);
    assert.equal(accepted.accepted, true);

    const final = coordinator.restore(sid);
    assert.equal(final.curriculum.completed, true, "全 checkpoint 完成后 curriculum 完成");
    coordinator.completeSession(sid, "finished");
    const completedState = coordinator.restore(sid);
    assert.equal(completedState.completed, true);
  });

  await runTest("event replay rebuilds identical state (gate 2) and decisions carry causality", async () => {
    const sid = "TS-9611";
    coordinator.start({ sessionId: sid, studentId: "student-b", tpId: "TP-SMV-001" });
    await coordinator.driveTutorTurn(sid);
    coordinator.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: plan.checkpoints[0].expected_reasoning });
    await coordinator.driveTutorTurn(sid);

    const first = coordinator.restore(sid);
    const second = coordinator.restore(sid);
    assert.deepEqual(first, second, "同一事件流两次投影必须一致（无快照纯 replay）");

    const events = coordinator.getEvents(sid);
    const decisions = events.filter((event) => event.event_type === "tutor_move_decided");
    for (const decision of decisions) {
      const payload = decision.payload as {
        source_event_sequence: number;
        source_state_revision: number;
        policy_version: string;
      };
      assert.ok(events.some((event) => event.sequence === payload.source_event_sequence), "source event 必须存在");
      assert.ok(payload.source_state_revision >= 0);
      assert.ok(payload.policy_version.includes("tutor-policy"));
      assert.ok(decision.causation_sequence !== undefined, "决策必须携带 causation");
    }
    // 每条 voice/workspace issued 都能反查 decision（FR-6）
    for (const event of events) {
      if (event.event_type === "voice_action_issued" || event.event_type === "workspace_action_issued") {
        const decisionId = (event.payload as { decision_id: string }).decision_id;
        assert.ok(
          decisions.some((entry) => (entry.payload as { decision_id: string }).decision_id === decisionId),
          `issued 动作必须关联 source TutorDecision（${decisionId}）`,
        );
      }
    }
  });

  await runTest("multi-part plan keeps state across parts (same session modes)", async () => {
    publishSyntheticPlan(root, { qtId: "QT-SMV-002", tpId: "TP-SMV-002", parts: 2 });
    const multi = createTutorSessionCoordinator({ canonicalRoot: root });
    const sid = "TS-9612";
    multi.start({ sessionId: sid, studentId: "student-c", tpId: "TP-SMV-002" });
    const planB = loadCurrentPlan({ canonicalRoot: root }, "TP-SMV-002");
    assert.ok(planB.ok);
    // Teach 开场 → 交接（与首测同流程）
    const opening = await multi.driveTutorTurn(sid);
    for (const voice of opening.presentation.voice) {
      multi.completeVoice(sid, { action_id: voice.action_id, outcome: "completed" });
    }
    const handOver = await multi.driveTutorTurn(sid);
    assert.equal(handOver.decision?.mode_change?.to_mode, "guided_solve");
    for (const voice of handOver.presentation.voice) {
      multi.completeVoice(sid, { action_id: voice.action_id, outcome: "completed" });
    }
    const part1Checkpoints = planB.payload.checkpoints.filter((entry) => entry.part_id === "1").map((entry) => entry.checkpoint_id);
    const actionResource = planB.payload.resources.find((resource) => resource.kind === "action_template" && resource.checkpoint_id && part1Checkpoints.includes(resource.checkpoint_id));
    const actionCheckpoint = actionResource?.checkpoint_id ?? part1Checkpoints.at(-1)!;
    for (const checkpointId of part1Checkpoints) {
      if (checkpointId === actionCheckpoint) break;
      multi.recordStudentInput(sid, {
        input_kind: "reasoning_utterance",
        text: planB.payload.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)!.expected_reasoning,
      });
      const turn = await multi.driveTutorTurn(sid);
      for (const voice of turn.presentation.voice) {
        multi.completeVoice(sid, { action_id: voice.action_id, outcome: "completed" });
      }
      await multi.driveTutorTurn(sid);
    }
    const template = JSON.parse(actionResource!.content!);
    multi.submitActionEvidence(sid, {
      actionId: template.actionId,
      sourceStepId: template.sourceStepId,
      kind: template.kind,
      version: 1 as const,
      value: template.teachingInput.expectedValues[0],
    });
    const state = multi.restore(sid);
    assert.equal(state.curriculum.current_part_index, 1, "part1 完成后进入 part2（同 session 不丢 state）");
    assert.equal(state.mode, "guided_solve");
  });

  rmSync(root, { recursive: true, force: true });
  console.log("PASS tutorSession (closed loop, replay, causality, multi-part)");
  const { db } = require("../../../db/database") as typeof import("../../../db/database");
  db.close();
  if (existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
}

void main().catch((error) => {
  console.error("FAIL tutorSession", error);
  throw error;
});
