/**
 * 波次 G 任务 2（(a) 第一层）：demonstration 下发集成测试。
 *
 * 真实 bundle 场景（goldenMinhangCross2020 的 Approved ScenarioRecord）+
 * 合成两小问 v3 体验：第 1 小问推进到结论操作步被接受后，讲解回合
 * （explain）经 TutorTurnResponse.workspace 既有通道携带 demonstration
 * 形态条目（additive form 标记）——板书披露该 part 已讲内容、画布为学生
 * 安全题图、truth 键零出现；操作步回合（action_evaluation）不携带演示。
 */
import { describe, expect, it } from "vitest";

import { isExercisePlan } from "../../../../../shared/actionRuntime";
import { getTutorSession } from "../TutorSessionEventStore";
import { createTutorSessionCoordinator } from "../TutorSession";
import { publishSyntheticV3Experience, tempRoot } from "./vitestSupport";

interface DrivePlan {
  checkpoints: Array<{ checkpoint_id: string; part_id: string; expected_reasoning: string }>;
  resources: Array<{ resource_id: string; kind: string; checkpoint_id?: string; content?: string }>;
}

function templateOf(plan: DrivePlan, checkpointId: string): { actionId: string; sourceStepId: string; kind: string; expected: string } | undefined {
  const resource = plan.resources.find(
    (entry) => entry.kind === "action_template" && entry.checkpoint_id === checkpointId,
  );
  if (!resource?.content) return undefined;
  const template = JSON.parse(resource.content) as {
    actionId: string;
    sourceStepId: string;
    kind: string;
    teachingInput?: { expectedValues?: string[] };
  };
  return {
    actionId: template.actionId,
    sourceStepId: template.sourceStepId,
    kind: template.kind,
    expected: template.teachingInput?.expectedValues?.[0] ?? "1",
  };
}

describe("讲解演示下发（波次 G 任务 2 / (a) 第一层）", () => {
  it("第 1 小问完成后：explain 回合携带 demonstration 条目；操作回合不携带；truth 零出现", async () => {
    const root = tempRoot("demo-delivery");
    // taskId/scenarioId 指向真实 bundle 的 golden 记录（Approved+validation
    // .passed，scenarioBank 可解析）；plan 为合成两小问（checkpoint 粒度与
    // 场景 steps 无关——part 级披露按 steps 与 parts 等长按序对应）。
    const published = publishSyntheticV3Experience(root, {
      qtId: "QT-TST-961",
      tpId: "TP-TST-961",
      taskId: "goldenMinhangCross2020",
      scenarioId: "golden-similarity-mvp-001:QT-SMV-002",
      parts: 2,
    });
    const plan = published.planV3 as unknown as DrivePlan;
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-9610";
    coordinator.start({
      sessionId,
      studentId: "student-demo",
      tpId: "TP-TST-961",
      access: "binding",
      experience: {
        task_id: "goldenMinhangCross2020",
        scenario_id: "golden-similarity-mvp-001:QT-SMV-002",
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

    // 推进第 1 小问：逐 checkpoint 期望推理 → 结论操作步证据被接受。
    const part1 = plan.checkpoints.filter((entry) => entry.part_id === "1");
    let evidenceTurn: { workspace: Array<{ form?: string }> } | undefined;
    for (const checkpoint of part1) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const session = getTutorSession(sessionId) as unknown as { revision: number };
        const view = coordinator.getSessionView(sessionId) as unknown as { pending_workspace: unknown[] };
        const template = templateOf(plan, checkpoint.checkpoint_id);
        if (view.pending_workspace.length && template) {
          const turn = await coordinator.processTurn(sessionId, session.revision, `turn-demo-${checkpoint.checkpoint_id}`, {
            input_kind: "structured_action_evidence",
            action_evidence: {
              actionId: template.actionId,
              sourceStepId: template.sourceStepId,
              kind: template.kind as "enter-text",
              version: 1,
              value: template.expected,
            },
          });
          evidenceTurn = turn;
          break;
        }
        await coordinator.processTurn(sessionId, session.revision, `turn-say-${checkpoint.checkpoint_id}-${attempt}`, {
          input_kind: "reasoning_utterance",
          text: checkpoint.expected_reasoning,
        });
      }
    }
    // 操作步回合（action_evaluation 存在）不携带演示（互斥）。
    expect(evidenceTurn).toBeTruthy();
    expect(evidenceTurn!.workspace.every((entry) => entry.form !== "demonstration")).toBe(true);

    // 第 1 小问已完成：explain 回合（提问触发答问讲解）携带演示。
    const asked = await coordinator.processTurn(
      sessionId,
      (getTutorSession(sessionId) as unknown as { revision: number }).revision,
      "turn-demo-ask",
      { input_kind: "question_asked", text: "这一步是怎么想的？" },
    );
    expect(asked.decision?.move_type).toBe("explain");
    const demonstration = asked.workspace.filter((entry) => entry.form === "demonstration");
    expect(demonstration).toHaveLength(1);
    const demoPlan = demonstration[0]?.action_plan;
    expect(demoPlan).toBeTruthy();
    expect(demoPlan!.mode).toBe("demonstration");
    expect(isExercisePlan(demoPlan!)).toBe(true);
    // 第 1 小问板书已披露（真实记录：g2-step-1 拥有的解行走进入上下文）。
    expect(demoPlan!.solutionBoardContexts?.[0].board.expressions.length).toBeGreaterThan(0);
    // 画布=学生安全题图（真实 golden 图 ≥5 点 ≥5 线段，无 teachingMarks）。
    expect(demoPlan!.world.geometry?.points.length).toBeGreaterThanOrEqual(5);
    expect(demoPlan!.world.geometry?.segments.length).toBeGreaterThanOrEqual(5);
    expect("teachingMarks" in (demoPlan!.world.geometry ?? {})).toBe(false);
    // truth 嗅探零违规律保持（响应序列化）。
    const serialized = JSON.stringify(asked);
    expect(serialized).not.toContain("localTruth");
    expect(serialized).not.toContain("teachingInput");
    expect(serialized).not.toContain("expectedValues");
  });
});
