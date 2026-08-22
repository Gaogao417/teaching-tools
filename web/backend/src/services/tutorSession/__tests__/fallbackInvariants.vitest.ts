/**
 * 降级路径 × 统一不变量层集成回归（B1 族闭合）：
 * - TS-7075（S6 家族）：图失败 → fallback 决策必须以 candidate state 为视角
 *   ——偏差后仅自查 prompt 而改对 → confirm.self_correction，且
 *   student_progressed.assisted=false（开场讲解先于偏差，不算实质协助）；
 * - TS-7004（S11 家族）：fallback 阶梯 self_check→L1→L2 耗尽 → 必进 repair，
 *   微检查证据 → confirm.repair_complete 退出 repair mode。
 * 全部用「永远失败的结构化模型」驱动 processTurn——每个学生轮都走降级，
 * 即修复前 68↔70 波动的降级路径本体。
 */
import { describe, expect, it } from "vitest";

import { publishSyntheticPlanVt, tempRoot } from "./vitestSupport";
import { createDefaultTutorSessionCoordinator, createTutorSessionCoordinator } from "../TutorSession";
import { tutorSessionRevision } from "../TutorSessionEventStore";
import { createTutorPolicyGraph } from "../../tutorIntelligence/policyGraph";
import { StructuredModelError } from "../../tutorIntelligence/structuredModelPort";
import type { StructuredCompletionRequest, StructuredModelPort } from "../../tutorIntelligence/structuredModelPort";
import { deterministicRulesPolicy } from "../../tutorPolicy/adapters/model/deterministicRulesPolicy";
import { recentTurnTelemetry } from "../turnTelemetry";

const FAILING_MODEL: StructuredModelPort = {
  provider: "test-failing",
  modelId: "failing-model",
  async complete() {
    throw new StructuredModelError("timeout", "injected failure for fallback regression", true);
  },
};

function fallbackCoordinator(root: string) {
  return createTutorSessionCoordinator({
    canonicalRoot: root,
    intelligence: createTutorPolicyGraph({ model: FAILING_MODEL, totalBudgetMs: 250, perCallTimeoutMs: 100 }),
    policy: deterministicRulesPolicy,
    policyTimeoutMs: 1_000,
  });
}

async function teachOpening(coordinator: ReturnType<typeof createTutorSessionCoordinator>, sessionId: string): Promise<void> {
  const opening = await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" });
  for (const voice of opening.presentation.voice) {
    coordinator.completeVoice(sessionId, { action_id: voice.action_id, outcome: "completed" });
  }
  const handOver = await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "presentation_completed" });
  for (const voice of handOver.presentation.voice) {
    coordinator.completeVoice(sessionId, { action_id: voice.action_id, outcome: "completed" });
  }
}

function turnOf(coordinator: ReturnType<typeof createTutorSessionCoordinator>, sessionId: string, text: string) {
  return coordinator.processTurn(
    sessionId,
    tutorSessionRevision(sessionId),
    `turn-${text.length}-${Math.random().toString(36).slice(2, 8)}`,
    { input_kind: "reasoning_utterance", text },
  );
}

function decisionsOf(coordinator: ReturnType<typeof createTutorSessionCoordinator>, sessionId: string) {
  return coordinator
    .getEvents(sessionId)
    .filter((event) => event.event_type === "tutor_move_decided")
    .map((event) => event.payload as { move_type: string; purpose_code: string; checkpoint_id?: string });
}

describe("降级路径统一不变量（B1 族回归）", () => {
  const root = tempRoot("fallback-invariants");
  const plan = publishSyntheticPlanVt(root, { qtId: "QT-SMV-001", tpId: "TP-SMV-001", parts: 0 });

  it("TS-7075（S6）：fallback 视角含 pending 自我修正 → confirm.self_correction；assisted 口径=偏差后实质协助", async () => {
    const coordinator = fallbackCoordinator(root);
    const sessionId = "TS-9601";
    coordinator.start({ sessionId, studentId: "s1", tpId: plan.artifact_id });
    await teachOpening(coordinator, sessionId);

    const deviation = plan.checkpoints.find((checkpoint) => (checkpoint.common_deviations ?? []).length > 0)
      ?.common_deviations?.[0];
    expect(deviation).toBeTruthy();
    const cp = coordinator.restore(sessionId).reasoning.current_checkpoint_id;

    const afterDeviation = await turnOf(coordinator, sessionId, deviation!);
    expect(afterDeviation.alignment?.alignment).toBe("incorrect");
    expect(afterDeviation.decision?.purpose_code).toBe("prompt.self_check");

    const afterCorrection = await turnOf(coordinator, sessionId, plan.checkpoints.find((c) => c.checkpoint_id === cp)!.expected_reasoning);
    expect(afterCorrection.alignment?.alignment).toBe("expected_checkpoint");
    // 修复前：fallback 读旧 state → self_corrections 空 + 全量台账 assisted →
    // confirm.assisted_progress。修复后：candidate state 含 pending 修正。
    expect(afterCorrection.decision?.purpose_code).toBe("confirm.self_correction");

    const events = coordinator.getEvents(sessionId);
    const progressed = events.find((event) => event.event_type === "student_progressed");
    expect((progressed?.payload as { assisted?: boolean }).assisted).toBe(false);
    const selfCorrected = events.find((event) => event.event_type === "student_self_corrected");
    expect(selfCorrected).toBeTruthy();
    const fallbackFacts = events.filter((event) => event.event_type === "policy_failed");
    expect(fallbackFacts.length).toBeGreaterThanOrEqual(2);
  });

  it("TS-7067 变体：fallback hint 后改对 → 仍是 assisted_progress（hint 即实质协助，语义不因 fallback 改变）", async () => {
    const coordinator = fallbackCoordinator(root);
    const sessionId = "TS-9602";
    coordinator.start({ sessionId, studentId: "s1", tpId: plan.artifact_id });
    await teachOpening(coordinator, sessionId);

    const deviation = plan.checkpoints.find((checkpoint) => (checkpoint.common_deviations ?? []).length > 0)
      ?.common_deviations?.[0]!;
    const cp = coordinator.restore(sessionId).reasoning.current_checkpoint_id;
    await turnOf(coordinator, sessionId, deviation); // self_check
    const afterHint = await turnOf(coordinator, sessionId, deviation); // hint L1
    expect(afterHint.decision?.move_type).toBe("hint");

    const afterCorrection = await turnOf(coordinator, sessionId, plan.checkpoints.find((c) => c.checkpoint_id === cp)!.expected_reasoning);
    expect(afterCorrection.alignment?.alignment).toBe("expected_checkpoint");
    expect(afterCorrection.decision?.purpose_code).toBe("confirm.assisted_progress");
    const progressed = coordinator
      .getEvents(sessionId)
      .find((event) => event.event_type === "student_progressed");
    expect((progressed?.payload as { assisted?: boolean }).assisted).toBe(true);
  });

  it("TS-7004（S11）：fallback 阶梯耗尽必进 repair；微检查证据 → repair_complete 退出", async () => {
    const coordinator = fallbackCoordinator(root);
    const sessionId = "TS-9603";
    coordinator.start({ sessionId, studentId: "s1", tpId: plan.artifact_id });
    await teachOpening(coordinator, sessionId);

    const struggle = (() => {
      const checkpoint = plan.checkpoints.find((entry) => (entry.common_deviations ?? []).length > 0);
      return checkpoint?.common_deviations?.[0] ?? "嗯……我不太确定这一步该怎么下手";
    })();

    let sawRepair = false;
    for (let index = 0; index < 8 && !sawRepair; index += 1) {
      const response = await turnOf(coordinator, sessionId, struggle);
      sawRepair = response.decision?.move_type === "repair";
    }
    expect(sawRepair).toBe(true);
    const decisions = decisionsOf(coordinator, sessionId);
    expect(decisions.filter((decision) => decision.move_type === "hint").length).toBeLessThanOrEqual(
      plan.policy_constraints.maximum_assistance_level,
    );

    const eventsBeforeRecovery = coordinator.getEvents(sessionId);
    const repairDelivered = eventsBeforeRecovery.find((event) => event.event_type === "repair_delivered");
    expect(repairDelivered).toBeTruthy();
    const sourceCheckpoint = (repairDelivered!.payload as { source_checkpoint_id: string }).source_checkpoint_id;

    const recovery = await turnOf(
      coordinator,
      sessionId,
      plan.checkpoints.find((checkpoint) => checkpoint.checkpoint_id === sourceCheckpoint)!.expected_reasoning,
    );
    expect(recovery.decision?.purpose_code).toBe("confirm.repair_complete");
    const modeBack = coordinator.getEvents(sessionId).find(
      (event) =>
        event.event_type === "mode_changed" &&
        (event.payload as { to_mode: string }).to_mode !== "repair" &&
        event.sequence > repairDelivered!.sequence,
    );
    expect(modeBack).toBeTruthy();
  });
});

describe("commit 层不变量改写（模型提案同受纪律约束）", () => {
  const root = tempRoot("commit-invariants");
  const plan = publishSyntheticPlanVt(root, { qtId: "QT-SMV-002", tpId: "TP-SMV-002", parts: 0 });

  /** 队列模型：policy 响应按序出队（struggle 文本命中确定性下限，不调对齐模型）。 */
  function queuedPolicyModel(responses: Array<Record<string, unknown>>): StructuredModelPort {
    const queue = [...responses];
    return {
      provider: "test-queued",
      modelId: "queued-model",
      async complete<T>(_request: StructuredCompletionRequest) {
        const next = queue.shift();
        if (!next) throw new StructuredModelError("provider-error", "queue empty", false);
        return { value: next as unknown as T, modelId: "queued-model", promptVersion: _request.promptVersion, latencyMs: 1 };
      },
    };
  }

  it("TS-7004 run1 缺陷：图内 Wait 兜底保留对齐事实 → 耗尽阶梯上的 wait 也被改写 repair", async () => {
    const deviation = plan.checkpoints.find((checkpoint) => (checkpoint.common_deviations ?? []).length > 0)
      ?.common_deviations?.[0]!;
    const cp = plan.checkpoints.find((checkpoint) => (checkpoint.common_deviations ?? []).length > 0)!.checkpoint_id;
    const hintOf = (level: number) =>
      plan.resources.find((resource) => resource.kind === "hint" && resource.checkpoint_id === cp && resource.assistance_level === level)!;
    // 阶段 1：合法提案走完 self_check→L1→L2（跳档 L2 由 commit 层规范化）；
    // 阶段 2：模型持续提重复档位 → 校验两次拒绝 → 图内 Wait 兜底（ok:true +
    // failure）——对齐事实必须保留，commit 层把 wait 改写 repair。
    const duplicateHint = {
      move: { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: cp, assistance_level: 1, resource_ids: [hintOf(1).resource_id] },
      voice: {},
    };
    const model = queuedPolicyModel([
      { move: { move_type: "prompt", purpose_code: "prompt.self_check", checkpoint_id: cp } },
      { move: { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: cp, assistance_level: 2, resource_ids: [hintOf(2).resource_id] } },
      { move: { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: cp, assistance_level: 2, resource_ids: [hintOf(2).resource_id] } },
      ...Array.from({ length: 15 }, () => duplicateHint),
    ]);
    const coordinator = createTutorSessionCoordinator({
      canonicalRoot: root,
      intelligence: createTutorPolicyGraph({ model, totalBudgetMs: 60_000, perCallTimeoutMs: 5_000 }),
      policy: deterministicRulesPolicy,
    });
    const sessionId = "TS-9702";
    coordinator.start({ sessionId, studentId: "s1", tpId: plan.artifact_id });
    const opening = await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" });
    for (const voice of opening.presentation.voice) {
      coordinator.completeVoice(sessionId, { action_id: voice.action_id, outcome: "completed" });
    }
    const handOver = await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "presentation_completed" });
    for (const voice of handOver.presentation.voice) {
      coordinator.completeVoice(sessionId, { action_id: voice.action_id, outcome: "completed" });
    }

    let sawRepair = false;
    for (let index = 0; index < 8 && !sawRepair; index += 1) {
      const response = await coordinator.processTurn(
        sessionId,
        tutorSessionRevision(sessionId),
        `turn-internal-fallback-${index}`,
        { input_kind: "reasoning_utterance", text: deviation },
      );
      sawRepair = response.decision?.move_type === "repair";
    }
    expect(sawRepair).toBe(true);
    const events = coordinator.getEvents(sessionId);
    // 每轮 struggle 的 incorrect 对齐事实都在（含图内兜底轮）。
    const incorrectAlignments = events.filter(
      (event) => event.event_type === "reasoning_aligned" && (event.payload as { alignment: string }).alignment === "incorrect",
    );
    expect(incorrectAlignments.length).toBeGreaterThanOrEqual(3);
    // 图内兜底轮的 policy_failed 与回退决策同批落库。
    const internalFallback = events.find(
      (event) =>
        event.event_type === "policy_failed" &&
        (event.payload as { fallback_used?: boolean }).fallback_used === true,
    );
    expect(internalFallback).toBeTruthy();
    expect(
      events.some((event) => event.event_type === "repair_delivered"),
    ).toBe(true);
  });

  it("模型跳档 hint L2 → commit 层改写 L1（首个未用档）+ approved 资源 + invariant telemetry", async () => {
    const deviation = plan.checkpoints.find((checkpoint) => (checkpoint.common_deviations ?? []).length > 0)
      ?.common_deviations?.[0]!;
    const cp = plan.checkpoints.find((checkpoint) => (checkpoint.common_deviations ?? []).length > 0)!.checkpoint_id;
    const l1 = plan.resources.find((resource) => resource.kind === "hint" && resource.checkpoint_id === cp && resource.assistance_level === 1)!;
    const l2 = plan.resources.find((resource) => resource.kind === "hint" && resource.checkpoint_id === cp && resource.assistance_level === 2)!;

    const model = queuedPolicyModel([
      { move: { move_type: "prompt", purpose_code: "prompt.self_check", checkpoint_id: cp } },
      {
        move: { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: cp, assistance_level: 2, resource_ids: [l2.resource_id] },
        voice: { text: "我给你一句模型生成的提示文案。", source: "model-generated" },
      },
    ]);
    const coordinator = createTutorSessionCoordinator({
      canonicalRoot: root,
      intelligence: createTutorPolicyGraph({ model, totalBudgetMs: 5_000, perCallTimeoutMs: 1_000 }),
      policy: deterministicRulesPolicy,
    });
    const sessionId = "TS-9701";
    coordinator.start({ sessionId, studentId: "s1", tpId: plan.artifact_id });
    const opening = await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "session_started" });
    for (const voice of opening.presentation.voice) {
      coordinator.completeVoice(sessionId, { action_id: voice.action_id, outcome: "completed" });
    }
    const handOver = await coordinator.driveTutorTurn(sessionId, { kind: "system", reason: "presentation_completed" });
    for (const voice of handOver.presentation.voice) {
      coordinator.completeVoice(sessionId, { action_id: voice.action_id, outcome: "completed" });
    }

    const first = await coordinator.processTurn(
      sessionId,
      tutorSessionRevision(sessionId),
      "turn-commit-1",
      { input_kind: "reasoning_utterance", text: deviation },
    );
    expect(first.decision?.purpose_code).toBe("prompt.self_check");

    const second = await coordinator.processTurn(
      sessionId,
      tutorSessionRevision(sessionId),
      "turn-commit-2",
      { input_kind: "reasoning_utterance", text: deviation },
    );
    expect(second.decision?.move_type).toBe("hint");

    const events = coordinator.getEvents(sessionId);
    const hints = events
      .filter((event) => event.event_type === "hint_issued")
      .map((event) => event.payload as { level: number; checkpoint_id: string });
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ level: 1, checkpoint_id: cp });
    const decision = events
      .filter((event) => event.event_type === "tutor_move_decided")
      .map((event) => event.payload as { move_type: string; assistance_level?: number; resource_ids?: string[]; voice_source?: string })
      .find((payload) => payload.move_type === "hint");
    expect(decision?.assistance_level).toBe(1);
    expect(decision?.resource_ids).toEqual([l1.resource_id]);
    // 改写丢弃模型文案与 voice_source provenance。
    expect(decision?.voice_source).toBeUndefined();
    const hintVoice = events
      .filter((event) => event.event_type === "voice_action_issued")
      .map((event) => event.payload as { text: string; resource_ref?: string })
      .find((payload) => payload.resource_ref === l1.resource_id);
    expect(hintVoice?.text).toBe(l1.content);
    expect(
      recentTurnTelemetry(20).some(
        (entry) => entry.session_id === sessionId && entry.stage === "invariant" && entry.outcome?.includes("hint_level_canonicalized"),
      ),
    ).toBe(true);
  });
});

describe("provider 接线（缓存 decorator 只包真实 DeepSeek）", () => {
  it("deepseek-langgraph 默认装配 cached DeepSeek；deterministic 默认无智能链", () => {
    const root = tempRoot("provider-wiring");
    const deepseek = createDefaultTutorSessionCoordinator({ canonicalRoot: root, provider: "deepseek-langgraph" });
    expect(deepseek.provider).toBe("deepseek-langgraph");
    const deterministic = createDefaultTutorSessionCoordinator({ canonicalRoot: root });
    expect(deterministic.provider).toBe("deterministic");
  });
});
