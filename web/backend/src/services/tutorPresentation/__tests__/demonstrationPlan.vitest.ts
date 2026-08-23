/**
 * 波次 G 任务 2（(a) 第一层）：demonstration 投影单测。
 *
 * - 披露序：无进度不交付；part 全 reasoning 完成（讲到结论步时刻）披露该
 *   part 板书；checkpoint 粒度内容（step.id=CP id）按已完成 checkpoint 逐
 *   步披露；step→part 无法映射时不披露（诚实）。
 * - 剥 truth：demonstration 形态 ActionContract 无 localTruth/teachingInput
 *   键、validationPolicy=server-authoritative；isExercisePlan 守卫通过
 *  （demonstration 分支）。
 * - 画布效果命令：从 authored input/teachingInput 确定性推导（标注/构造/
 *   对应），enter-text 无命令。
 * - 结论操作步不受影响：operation 通道（form 缺省）与演示通道（form
 *   标记）互斥——操作回合不携带演示。
 */
import { describe, expect, it } from "vitest";

import { isExercisePlan } from "../../../../../shared/actionRuntime";
import type { TopicResolvedScenario } from "../../../../../shared/topicPractice";
import type { TutorPlanV2Payload } from "../../planBuild/canonicalInputs";
import type { TutorRuntimeState } from "../../tutorSession/TutorRuntimeStateProjection";
import {
  buildTutorDemonstrationPlan,
  demonstrationEffectsFor,
} from "../adapters/legacyActionRuntime/demonstrationPlanProjector";

const PLAN = {
  artifact_id: "TP-DEMO-1",
  version: "v3",
  content_hash: "sha256:" + "0".repeat(64),
  checkpoints: [
    { checkpoint_id: "CP1", part_id: "1", expected_reasoning: "改比例式。" },
    { checkpoint_id: "CP2", part_id: "1", expected_reasoning: "找直角三角形。" },
    { checkpoint_id: "CP3", part_id: "1", expected_reasoning: "导角收尾。" },
    { checkpoint_id: "CP4", part_id: "2", expected_reasoning: "改写目标。" },
  ],
  recommended_routes: [
    { route_id: "R1", role: "primary", part_id: "1", checkpoint_ids: ["CP1", "CP2", "CP3"] },
    { route_id: "R3", role: "primary", part_id: "2", checkpoint_ids: ["CP4"] },
  ],
  resources: [],
  policy_constraints: { allowed_move_types: [], maximum_assistance_level: 2, allowed_capabilities: [] },
} as unknown as TutorPlanV2Payload;

function scenarioFixture(stepIds: string[]): TopicResolvedScenario {
  return {
    id: "SC-DEMO-1",
    taskId: "goldenMinhangCross2020",
    contentId: "topic-practice.demo.v1",
    version: 1,
    title: "演示题",
    promptLatex: "题干",
    steps: stepIds.map((stepId) => ({
      id: stepId,
      title: stepId,
      primitive: "input",
      target: "topic-answer",
      promptLatex: "写出这一步。",
      acceptedAnswers: ["对"],
      expectedLatex: "对",
    })) as TopicResolvedScenario["steps"],
    promptGeometry: {
      viewBox: { width: 9, height: 6 },
      points: [
        { id: "A", x: 0, y: 6 },
        { id: "B", x: -4, y: 0 },
      ],
      segments: [{ id: "AB", from: "A", to: "B" }],
    },
    actionTemplates: stepIds.map((stepId) => ({
      actionId: stepId,
      sourceStepId: stepId,
      kind: "enter-text",
      version: 1,
      title: stepId,
      instruction: "写出结论",
      input: { placeholder: "结论" },
      teachingInput: { expectedValues: ["CE⊥AB"] },
      capabilities: ["agent:select-object", "agent:set-answer"],
      answerSlots: [],
      submitOnComplete: true,
    })),
    solutionBoard: {
      schemaVersion: 1,
      documentId: "SC-DEMO-1/solution",
      headingLatex: "解：",
      // 第一个 step 拥有 2 行（对齐真实 golden Cross2020 的 part1 板书形态），
      // 其余 step 各 1 行。
      expressions: stepIds.flatMap((stepId, stepIndex) =>
        (stepIndex === 0 ? [1, 2] : [1]).map((row, rowNumber) => ({
          expressionId: `${stepId}/solution-${stepIndex === 0 ? rowNumber : 1}`,
          sourceStepId: stepId,
          ownerActionIds: [stepId],
          latexTemplate: `${stepId} 第 ${rowNumber} 行板书`,
          modes: ["learn", "guided-practice"],
        })),
      ),
    },
  } as unknown as TopicResolvedScenario;
}

function stateFixture(completed: Record<string, string[]>): TutorRuntimeState {
  const parts = [
    { part_id: "1", route_id: "R1", checkpoint_ids: ["CP1", "CP2", "CP3"], completed_checkpoints: completed["1"] ?? [], current_index: (completed["1"] ?? []).length },
    { part_id: "2", route_id: "R3", checkpoint_ids: ["CP4"], completed_checkpoints: completed["2"] ?? [], current_index: (completed["2"] ?? []).length },
  ];
  const currentPartIndex = parts.findIndex((part) => part.completed_checkpoints.length < part.checkpoint_ids.length);
  const current = parts[currentPartIndex === -1 ? parts.length - 1 : currentPartIndex];
  return {
    session_id: "TS-DEMO",
    plan_ref: { artifact_id: "TP-DEMO-1", version: "v3", content_hash: "sha256:0" },
    initial_mode: "guided_solve",
    mode: "guided_solve",
    revision: 7,
    last_sequence: 12,
    curriculum: { parts, current_part_index: Math.max(currentPartIndex, 0), completed: false },
    dialogue: {},
    reasoning: { current_checkpoint_id: current.checkpoint_ids[Math.min(current.completed_checkpoints.length, current.checkpoint_ids.length - 1)], self_corrections: [], interruptions: [], consecutive_no_progress: 0, consecutive_unclear: 0 },
    workspace: { action_history: [] },
    assistance: {},
    working_diagnosis: [],
    repair: { active: false },
    failures: { policy_failures: [], runtime_failures: [] },
    completed: false,
  } as unknown as TutorRuntimeState;
}

const CONTEXT = { taskId: "goldenMinhangCross2020", promptLatex: "题干" };

describe("demonstration 投影（波次 G 任务 2 / (a) 第一层）", () => {
  it("无进度不交付（开场讲解披露为空）", () => {
    const result = buildTutorDemonstrationPlan({
      plan: PLAN,
      scenario: scenarioFixture(["g2-step-1", "g2-step-2"]),
      state: stateFixture({}),
      context: CONTEXT,
    });
    expect(result).toBeUndefined();
  });

  it("part 级披露：第 1 小问全部 reasoning 完成 → 演示该 part 板书（2 行）", () => {
    const result = buildTutorDemonstrationPlan({
      plan: PLAN,
      scenario: scenarioFixture(["g2-step-1", "g2-step-2"]),
      state: stateFixture({ "1": ["CP1", "CP2", "CP3"] }),
      context: CONTEXT,
    });
    expect(result).toBeTruthy();
    const plan = result!.action_plan;
    expect(isExercisePlan(plan)).toBe(true);
    expect(plan.mode).toBe("demonstration");
    expect(plan.actions.map((action) => action.actionId)).toEqual(["g2-step-1"]);
    expect(plan.currentActionId).toBe("g2-step-1");
    expect(plan.solutionBoardContexts?.[0].board.expressions).toHaveLength(2);
    // 学生安全题图（无 derivedLines/teachingMarks）。
    expect(plan.world.geometry?.points.map((point) => point.id)).toEqual(["A", "B"]);
    expect("teachingMarks" in (plan.world.geometry ?? {})).toBe(false);
    // truth 嗅探零违规律保持。
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain("localTruth");
    expect(serialized).not.toContain("teachingInput");
    expect(serialized).not.toContain("expectedValues");
    // demonstration 形态 contract：server-authoritative、无 agent: capability。
    expect(plan.actions.every((action) => action.validationPolicy === "server-authoritative")).toBe(true);
    expect(plan.actions.every((action) => action.capabilities.every((capability) => !capability.startsWith("agent:")))).toBe(true);
  });

  it("checkpoint 粒度披露（任务 6 内容形态）：step.id 命中已完成 checkpoint 才披露", () => {
    // 6 步场景 CP1..CP6（第 2 步映射 part1 的 CP2），仅 CP1 完成。
    const result = buildTutorDemonstrationPlan({
      plan: PLAN,
      scenario: scenarioFixture(["CP1", "CP2", "CP3", "CP4"]),
      state: stateFixture({ "1": ["CP1"] }),
      context: CONTEXT,
    });
    expect(result).toBeTruthy();
    expect(result!.action_plan.actions.map((action) => action.actionId)).toEqual(["CP1"]);
    expect(result!.action_plan.solutionBoardContexts?.[0].board.expressions).toHaveLength(2);
  });

  it("step→part 无法映射（steps 与 parts 不等长且 id 不命中）不披露", () => {
    const result = buildTutorDemonstrationPlan({
      plan: PLAN,
      scenario: scenarioFixture(["x-step-1", "x-step-2", "x-step-3"]),
      state: stateFixture({ "1": ["CP1", "CP2", "CP3"] }),
      context: CONTEXT,
    });
    expect(result).toBeUndefined();
  });

  it("画布效果命令：authored 模板确定性推导；enter-text 无命令", () => {
    const labels = demonstrationEffectsFor({
      actionId: "s1", sourceStepId: "s1", kind: "mark-segment-values", version: 1, title: "t", instruction: "i",
      input: { labels: [], availableSegmentIds: ["AB", "AC"] },
      teachingInput: { labels: [{ segmentId: "AB", displayName: "AB", valueLatex: "3" }] },
      capabilities: [], answerSlots: [], submitOnComplete: true,
    });
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ type: "set-segment-label", segmentId: "AB", valueLatex: "3" });

    const parallel = demonstrationEffectsFor({
      actionId: "s2", sourceStepId: "s2", kind: "make-parallel", version: 1, title: "t", instruction: "i",
      input: { outputLineId: "action:s2:parallel", availablePointIds: ["A"], availableLineIds: ["AB"] },
      teachingInput: { throughPointId: "A", referenceLineId: "AB" },
      capabilities: [], answerSlots: [], submitOnComplete: false,
    });
    expect(parallel).toHaveLength(1);
    expect(parallel[0]).toMatchObject({ type: "construct-parallel", throughPointId: "A", outputLineId: "action:s2:parallel" });

    const text = demonstrationEffectsFor({
      actionId: "s3", sourceStepId: "s3", kind: "enter-text", version: 1, title: "t", instruction: "i",
      input: { placeholder: "p" }, teachingInput: { expectedValues: ["x"] },
      capabilities: [], answerSlots: [], submitOnComplete: true,
    });
    expect(text).toEqual([]);
  });
});
