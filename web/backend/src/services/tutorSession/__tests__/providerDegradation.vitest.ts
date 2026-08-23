/**
 * 波次 G 任务 4：provider 降级留痕单测（波次 B 偏差 2 收口）。
 *
 * v4 会话 profile.primary=deepseek-langgraph 而学生输入回合实际走
 * deterministic 路径时（intelligence 未装配 / TUTOR_POLICY_FORCE_PROVIDER
 * 紧急回滚），事件层必须落 policy_failed 降级事实（telemetry off 也可查）。
 *
 * 口径边界（2026-08-24 排查结论）：系统回合（session_started /
 * presentation_completed → driveTutorTurn 的 deterministic 口径）不属降级
 * ——讲解内容=authored 资源原文，provider 无作用面；教师会话
 * TS-1787477632529000003 的开局三决策即此口径，非静默降级。
 */
import { afterEach, describe, expect, it } from "vitest";

import { getTutorSession } from "../TutorSessionEventStore";
import { createTutorSessionCoordinator } from "../TutorSession";
import { recentTurnTelemetry } from "../turnTelemetry";
import { publishSyntheticV3Experience, tempRoot } from "./vitestSupport";

function startV4Session(
  coordinator: ReturnType<typeof createTutorSessionCoordinator>,
  published: ReturnType<typeof publishSyntheticV3Experience>,
  sessionId: string,
): void {
  coordinator.start({
    sessionId,
    studentId: "student-degrade",
    tpId: "TP-TST-941",
    access: "binding",
    experience: {
      task_id: "task-degrade-941",
      scenario_id: "SC-TST-941",
      approach_set_ref: {
        artifact_id: (published.approachSet as { artifact_id: string }).artifact_id,
        version: (published.approachSet as { version: string }).version,
        content_hash: (published.approachSet as { content_hash: string }).content_hash,
      },
      policy_profile_snapshot: {
        profile_id: "PP-TST-001",
        version: "2026-08-22.1",
        primary_provider: "deepseek-langgraph",
        fallback_provider: "deterministic-rules",
        model_id: "deepseek-v4-flash",
        prompt_version: "policy-voice-deepseek/v1",
      },
      provider: "deepseek-langgraph",
    },
  });
}

function revisionOf(sessionId: string): number {
  return (getTutorSession(sessionId) as unknown as { revision: number }).revision;
}

function policyFailedEvents(coordinator: ReturnType<typeof createTutorSessionCoordinator>, sessionId: string) {
  return coordinator
    .getEvents(sessionId)
    .filter((event) => event.event_type === "policy_failed")
    .map((event) => event.payload as { policy_version: string; failure_class: string; fallback_used: boolean });
}

describe("provider 降级留痕（波次 G 任务 4）", () => {
  afterEach(() => {
    delete process.env.TUTOR_POLICY_FORCE_PROVIDER;
  });

  it("intelligence 未装配：学生输入回合落 policy_failed(provider_unavailable)，决策仍 deterministic", async () => {
    const root = tempRoot("degrade-1");
    const published = publishSyntheticV3Experience(root, {
      qtId: "QT-TST-941",
      tpId: "TP-TST-941",
      taskId: "task-degrade-941",
      scenarioId: "SC-TST-941",
      parts: 0,
    });
    // 不配 intelligence：进程未装配 deepseek 图（模拟 3002 起动时
    // TUTOR_POLICY_PROVIDER 未设/图装配失败的生产形态）。
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-9410";
    startV4Session(coordinator, published, sessionId);

    // 系统回合（开场）不属降级：无 policy_failed。
    await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" });
    expect(policyFailedEvents(coordinator, sessionId)).toEqual([]);

    // 学生输入回合：期望 deepseek 实际 deterministic → 降级事实可查。
    const plan = published.planV3 as { checkpoints: Array<{ expected_reasoning: string }> };
    const turn = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-degrade-1", {
      input_kind: "reasoning_utterance",
      text: plan.checkpoints[0].expected_reasoning,
    });
    expect(turn.decision?.policy_version).toContain("deterministic-rules");
    const failures = policyFailedEvents(coordinator, sessionId);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      policy_version: "tutor-policy-deepseek-langgraph/v1",
      failure_class: "provider_unavailable",
      fallback_used: true,
    });
    expect(
      recentTurnTelemetry(20).some(
        (entry) => entry.session_id === sessionId && entry.stage === "fallback" && entry.outcome === "provider_unavailable",
      ),
    ).toBe(true);
  });

  it("紧急 FORCE 回滚：failure_class=provider_forced_deterministic（决策语义不变）", async () => {
    const root = tempRoot("degrade-2");
    const published = publishSyntheticV3Experience(root, {
      qtId: "QT-TST-941",
      tpId: "TP-TST-941",
      taskId: "task-degrade-941",
      scenarioId: "SC-TST-941",
      parts: 0,
    });
    process.env.TUTOR_POLICY_FORCE_PROVIDER = "deterministic";
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-9411";
    startV4Session(coordinator, published, sessionId);
    await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" });
    const plan = published.planV3 as { checkpoints: Array<{ expected_reasoning: string }> };
    const turn = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-degrade-2", {
      input_kind: "reasoning_utterance",
      text: plan.checkpoints[0].expected_reasoning,
    });
    expect(turn.decision?.policy_version).toContain("deterministic-rules");
    const failures = policyFailedEvents(coordinator, sessionId);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      failure_class: "provider_forced_deterministic",
      fallback_used: true,
    });
  });

  it("profile.primary=deterministic-rules：deterministic 决策是预期路径，不落降级事件", async () => {
    const root = tempRoot("degrade-3");
    const published = publishSyntheticV3Experience(root, {
      qtId: "QT-TST-941",
      tpId: "TP-TST-941",
      taskId: "task-degrade-941",
      scenarioId: "SC-TST-941",
      parts: 0,
    });
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-9412";
    coordinator.start({
      sessionId,
      studentId: "student-degrade",
      tpId: "TP-TST-941",
      access: "binding",
      experience: {
        task_id: "task-degrade-941",
        scenario_id: "SC-TST-941",
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
    await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" });
    const plan = published.planV3 as { checkpoints: Array<{ expected_reasoning: string }> };
    const turn = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-degrade-3", {
      input_kind: "reasoning_utterance",
      text: plan.checkpoints[0].expected_reasoning,
    });
    expect(turn.decision?.policy_version).toContain("deterministic-rules");
    expect(policyFailedEvents(coordinator, sessionId)).toEqual([]);
  });
});
