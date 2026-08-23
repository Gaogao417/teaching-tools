/**
 * 波次 E（教师问「讲完第一小题怎么进第二小题」）：跨小问推进全链回归。
 *
 * 既有全部测试（benchmark 剧本 + e2e 矩阵/journey）从未跨过小问边界
 * （无任何会话进入过第二小问的 checkpoint）——本文件补齐该验证面：
 * 两小问合成 v3 体验，逐 checkpoint 答题 → 第 1 小问结论操作步被接受 →
 * 第 2 小问自动开讲 → 第 2 小问操作步 → 整题完成。断言：
 * - 小问切换由课程投影自动完成（无换会话、无 skip）；
 * - conclusion 门控（波次 E 缺陷 1 修复）跨小问成立：第 1 小问操作步
 *   未提交时 question_completed 不为真；
 * - 两个小问的操作步都真实签发且被接受后才 session_completed。
 */
import { describe, expect, it } from "vitest";

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

describe("跨小问推进（一题两问，/experience 合成 v3 体验）", () => {
  it("第 1 小问结论步被接受 → 第 2 小问自动开讲 → 两问完成才收尾", async () => {
    const root = tempRoot("cross-part");
    const published = publishSyntheticV3Experience(root, {
      qtId: "QT-TST-931",
      tpId: "TP-TST-931",
      taskId: "task-cross-931",
      scenarioId: "SC-TST-931",
      parts: 2,
    });
    const plan = published.planV3 as unknown as DrivePlan;
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-9310";
    coordinator.start({
      sessionId,
      studentId: "student-cross",
      tpId: "TP-TST-931",
      access: "binding",
      experience: {
        task_id: "task-cross-931",
        scenario_id: "SC-TST-931",
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

    const partIds = Array.from(new Set(plan.checkpoints.map((entry) => entry.part_id)));
    expect(partIds).toEqual(["1", "2"]);
    const progressionByPart = new Map<string, string[]>();
    let turns = 0;
    let submittedCheckpoints = new Set<string>();

    for (const partId of partIds) {
      progressionByPart.set(partId, []);
      const partCheckpoints = plan.checkpoints.filter((entry) => entry.part_id === partId);
      for (const checkpoint of partCheckpoints) {
        // 逐 checkpoint：先答期望推理（必要时多轮 self_check），直到该节点
        // 的结论操作步挂起或 checkpoint 完成。
        for (let attempt = 0; attempt < 6; attempt += 1) {
          turns += 1;
          expect(turns < 60, "驱动轮数异常").toBe(true);
          const session = getTutorSession(sessionId) as unknown as {
            revision: number;
            completed: boolean;
            question_completed?: boolean;
          };
          const state = coordinator.getSessionView(sessionId);
          const pending = (state as unknown as { pending_workspace: unknown[] }).pending_workspace ?? [];
          const template = templateOf(plan, checkpoint.checkpoint_id);
          if (pending.length && template && !submittedCheckpoints.has(checkpoint.checkpoint_id)) {
            // 该小问结论操作步挂起：提交正确证据（走 processTurn 智能面同构）。
            const turn = await coordinator.processTurn(sessionId, session.revision, `turn-${checkpoint.checkpoint_id}`, {
              input_kind: "structured_action_evidence",
              action_evidence: {
                actionId: template.actionId,
                sourceStepId: template.sourceStepId,
                kind: template.kind as "enter-text",
                version: 1,
                value: template.expected,
              },
            });
            submittedCheckpoints.add(checkpoint.checkpoint_id);
            expect(turn.alignment?.alignment !== "incorrect", "正确证据应被接受").toBe(true);
            break;
          }
          // 无挂起操作步：按当前 checkpoint 答期望推理。
          const turn = await coordinator.processTurn(sessionId, session.revision, `turn-say-${turns}`, {
            input_kind: "reasoning_utterance",
            text: checkpoint.expected_reasoning,
          });
          void turn;
          const view = coordinator.getSessionView(sessionId) as unknown as {
            pending_workspace: unknown[];
            question_completed: boolean;
            completed: boolean;
          };
          if (!view.pending_workspace.length && view.completed) break;
        }
        const view = coordinator.getSessionView(sessionId) as unknown as { question_completed: boolean };
        // 波次 E 缺陷 1 修复口径：任一小问的操作步未提交时，整题不得判完成。
        const isLastCheckpointOfLastPart =
          checkpoint.checkpoint_id === partCheckpoints.at(-1)!.checkpoint_id && partId === partIds.at(-1);
        if (!isLastCheckpointOfLastPart) {
          expect(view.question_completed, `${checkpoint.checkpoint_id} 后整题不应提前完成`).toBe(false);
        }
      }
    }

    const events = coordinator.getEvents(sessionId);
    const progressed = events
      .filter((event) => event.event_type === "student_progressed")
      .map((event) => (event.payload as { checkpoint_id: string }).checkpoint_id);
    for (const checkpoint of plan.checkpoints) {
      expect(progressed, `所有 checkpoint 都应推进：${progressed.join(",")}`).toContain(checkpoint.checkpoint_id);
    }
    // 两个小问的结论操作步都签发并被接受。
    const issued = events.filter((event) => event.event_type === "workspace_action_issued");
    expect(issued.length).toBeGreaterThanOrEqual(2);
    const completions = events.filter(
      (event) => event.event_type === "workspace_action_completed" && (event.payload as { outcome: string }).outcome === "completed",
    );
    expect(completions.length).toBeGreaterThanOrEqual(2);
    // 整题完成的信号是 question_completed（curriculum）；会话收尾由前端
    // 调 completeSession（/learn 页合同），协调器不自动收尾。
    const finalView = coordinator.getSessionView(sessionId) as unknown as { completed: boolean; question_completed: boolean };
    expect(finalView.question_completed, "两问结论步都被接受后整题完成").toBe(true);
    expect(finalView.completed).toBe(false);
    coordinator.completeSession(sessionId);
    const completedView = coordinator.getSessionView(sessionId) as unknown as { completed: boolean };
    expect(completedView.completed).toBe(true);
  });
});
