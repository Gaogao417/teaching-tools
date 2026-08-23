/**
 * 波次 G 任务 5：单回合多 checkpoint 压缩推进（反馈 (c)）。
 *
 * 学生一段 utterance 常覆盖整段推理（实证：TS-1787477632529000003 一段话
 * 覆盖 CP1–CP3 全部内容，alignment 仅命中 CP1、单步推进）。对齐命中
 * expected_checkpoint 后，沿本 part 路线序逐个比对后续 checkpoint 的
 * expected_reasoning（同一归一化 LCS 口径），连续命中即多步推进：
 * - 结论操作步（挂 action_template 的 checkpoint）前必须停——不得被语音
 *   跳过，结论仍走结构化证据；
 * - part 边界不跨（跨小问由结论证据链推进，crossPartProgression 口径）；
 * - 决策锚定（I8）：压缩发生后 confirm 重锚到本回合最后完成步。
 */
import { describe, expect, it } from "vitest";

import { getTutorSession } from "../TutorSessionEventStore";
import { createTutorSessionCoordinator } from "../TutorSession";
import { publishSyntheticV3Experience, tempRoot } from "./vitestSupport";

interface DrivePlan {
  checkpoints: Array<{ checkpoint_id: string; part_id: string; expected_reasoning: string }>;
  resources: Array<{ resource_id: string; kind: string; checkpoint_id?: string }>;
  recommended_routes: Array<{ route_id: string; role: string; part_id?: string; checkpoint_ids: string[] }>;
}

function setup(sessionId: string): { coordinator: ReturnType<typeof createTutorSessionCoordinator>; plan: DrivePlan } {
  const root = tempRoot("compress");
  const published = publishSyntheticV3Experience(root, {
    qtId: "QT-TST-951",
    tpId: "TP-TST-951",
    taskId: "task-compress-951",
    scenarioId: "SC-TST-951",
    parts: 2,
  });
  const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
  coordinator.start({
    sessionId,
    studentId: "student-compress",
    tpId: "TP-TST-951",
    access: "binding",
    experience: {
      task_id: "task-compress-951",
      scenario_id: "SC-TST-951",
      approach_set_ref: {
        artifact_id: (published.approachSet as { artifact_id: string }).artifact_id,
        version: (published.approachSet as { version: string }).version,
        content_hash: (published.approachSet as { content_hash: string }).content_hash,
      },
      policy_profile_snapshot: {
        profile_id: "PP-TST-001",
        version: "2026-08-22.1",
        primary_provider: "deterministic-rules",
        fallback_provider: "deepseek-langgraph",
        model_id: "deepseek-v4-flash",
        prompt_version: "policy-voice-deepseek/v1",
      },
      provider: "deterministic-rules",
    },
  });
  return { coordinator, plan: published.planV3 as unknown as DrivePlan };
}

function revisionOf(sessionId: string): number {
  return (getTutorSession(sessionId) as unknown as { revision: number }).revision;
}

function progressedEvents(coordinator: ReturnType<typeof createTutorSessionCoordinator>, sessionId: string) {
  return coordinator
    .getEvents(sessionId)
    .filter((event) => event.event_type === "student_progressed")
    .map((event) => event.payload as { checkpoint_id: string; via_compression?: boolean });
}

describe("单回合多 checkpoint 压缩推进（波次 G 任务 5 / 反馈 (c)）", () => {
  it("一段 utterance 覆盖 CP1+CP2 → 两步 student_progressed（第二步 via_compression）+ confirm 重锚", async () => {
    const { coordinator, plan } = setup("TS-9510");
    const part1 = plan.checkpoints.filter((entry) => entry.part_id === "1");
    expect(part1.length).toBeGreaterThanOrEqual(3);
    // 结论模板挂在 part 1 最后一个 checkpoint 上（BuildTutorPlan 口径）。
    const templateCheckpoints = new Set(
      plan.resources.filter((entry) => entry.kind === "action_template").map((entry) => entry.checkpoint_id),
    );
    expect(templateCheckpoints.has(part1[part1.length - 1].checkpoint_id)).toBe(true);
    expect(templateCheckpoints.has(part1[0].checkpoint_id)).toBe(false);

    const utterance = `${part1[0].expected_reasoning}。${part1[1].expected_reasoning}。`;
    const turn = await coordinator.processTurn("TS-9510", revisionOf("TS-9510"), "turn-compress-1", {
      input_kind: "reasoning_utterance",
      text: utterance,
    });
    expect(turn.alignment?.alignment).toBe("expected_checkpoint");
    expect(turn.alignment?.checkpoint_id).toBe(part1[0].checkpoint_id);

    const progressed = progressedEvents(coordinator, "TS-9510");
    expect(progressed.map((entry) => entry.checkpoint_id)).toEqual([
      part1[0].checkpoint_id,
      part1[1].checkpoint_id,
    ]);
    expect(progressed[0].via_compression).toBeUndefined();
    expect(progressed[1].via_compression).toBe(true);

    // I8：confirm 锚定本回合最后完成步（不是对齐点 CP1）。
    const decisionEvent = coordinator
      .getEvents("TS-9510")
      .find((event) => event.event_type === "tutor_move_decided");
    expect((decisionEvent?.payload as { checkpoint_id?: string }).checkpoint_id).toBe(part1[1].checkpoint_id);
    // 课程停在第 3 步（结论操作步，等结构化证据）。
    expect(turn.current_checkpoint.checkpoint_id).toBe(part1[2].checkpoint_id);
    // 接地叙事按压缩后进度说话（已过 2/3）。
    expect(turn.voice[0].text).toContain("2/3");
  });

  it("utterance 连结论步推理也覆盖 → 结论 checkpoint 不被语音推进（仍停在其前）", async () => {
    const { coordinator, plan } = setup("TS-9511");
    const part1 = plan.checkpoints.filter((entry) => entry.part_id === "1");
    const utterance = part1.map((entry) => `${entry.expected_reasoning}。`).join("");
    const turn = await coordinator.processTurn("TS-9511", revisionOf("TS-9511"), "turn-compress-2", {
      input_kind: "reasoning_utterance",
      text: utterance,
    });

    const progressed = progressedEvents(coordinator, "TS-9511").map((entry) => entry.checkpoint_id);
    // 结论 checkpoint（挂模板的 part1 末步）绝不在语音推进清单里。
    expect(progressed).toEqual(part1.slice(0, -1).map((entry) => entry.checkpoint_id));
    expect(turn.current_checkpoint.checkpoint_id).toBe(part1[part1.length - 1].checkpoint_id);

    // 结论步本身仍可被直接对齐推进（学生明确说出该步推理），随后操作步签发。
    const conclusionTurn = await coordinator.processTurn("TS-9511", revisionOf("TS-9511"), "turn-compress-2b", {
      input_kind: "reasoning_utterance",
      text: part1[part1.length - 1].expected_reasoning,
    });
    expect(progressedEvents(coordinator, "TS-9511").map((entry) => entry.checkpoint_id)).toContain(
      part1[part1.length - 1].checkpoint_id,
    );
    // part 1 推理全通 → 结论操作步被强制派发（波次 E 口径 + 压缩兼容）。
    expect(conclusionTurn.workspace.length).toBeGreaterThan(0);
  });
});
