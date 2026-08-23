/**
 * Tutor 讲解演示投影（波次 G 任务 2 / 待裁定 (a) 第一层，2026-08-24）。
 *
 * 分叉点在 TutorMove→工作区投影层（已裁定，UI 不分叉）：讲解回合
 * （explain/prompt/hint）投影 demonstration 形态 ExercisePlan——
 * - part 级板书渐进披露（snapshotAt 纯读原语，cutoff=会话课程进度的
 *   「已讲到」步）；
 * - authored 画布效果命令：从模板 authored input/teachingInput 确定性推导
 *   DomainCommand（构造线/标注/对应/强调），服务端剥离 truth 键后随计划
 *   下发——与板书行同类=讲解演示内容，判定真值（localTruth/teachingInput/
 *   expectedValues 键）仍不出服务端，嗅探口径不变。
 *
 * 披露规则（第一层粒度登记口径）：scenario step「已讲到」=
 * (a) step.id 命中某已完成 checkpoint（任务 6 的 checkpoint 粒度内容），或
 * (b) 该 step 所属 part 的全部 checkpoint 已完成（讲到结论步时刻演示该
 *     part 板书——现 2-step golden 内容），或
 * (c) step 属于已教完的 part（含于 (b)）。
 * step→part 映射：checkpoint id 命中；否则 steps 与 parts 等长时按序对应；
 * 再否则不映射（诚实：无披露）。
 *
 * 推进权在会话：计划只是渲染数据（只读、无 evidence 通道），每次讲解
 * 回合按当前状态重投影；不发 workspace_action_issued 事件、不进台账。
 */
import {
  ACTION_RUNTIME_PLAN_VERSION,
  type ActionContract,
  type ExercisePlan,
} from "../../../../../../shared/actionRuntime";
import type { DomainCommand } from "../../../../../../shared/actionWorld";
import type { TopicGeometryModel, TopicResolvedScenario, TopicSegmentLabel } from "../../../../../../shared/topicPractice";
import type { AuthoredActionTemplate } from "../../../../../../shared/actionRuntime";
import type { TutorPlanV2Payload } from "../../../planBuild/canonicalInputs";
import type { TutorRuntimeState } from "../../../tutorSession/TutorRuntimeStateProjection";
import { materializeActionTemplate } from "../../../actionRuntime/topicPlanProjector";
import { demonstrationBoardContext } from "../../../../repositories/questionSolutionRepository";
import type { TutorWorkspacePlanContext } from "./workspacePlanProjector";

function command(actionId: string, index: number, body: Record<string, unknown>): DomainCommand {
  return { commandId: `${actionId}:demo-${index}`, actionId, ...body } as DomainCommand;
}

function pairsOf(order: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let index = 0; index + 1 < order.length; index += 2) {
    pairs.push([order[index], order[index + 1]]);
  }
  return pairs;
}

/**
 * authored 画布效果命令推导（确定性，服务端私有→随演示计划下发）：
 * - make-parallel → construct-parallel；intersect-carriers → construct-carrier
 *   + intersect-lines（构造线的演示轨迹）；
 * - mark-segment-values → set-segment-label ×labels；pair-segments →
 *   set-correspondence-mark ×pairs；ratio-scratch → 对应刻痕 + 份数标注；
 * - convert-collinear → set-emphasis（整段/目标/已知）；enter-equation →
 *   已知边数值标注；enter-text/select-option 无画布效果（板书承担）。
 */
export function demonstrationEffectsFor(template: AuthoredActionTemplate): DomainCommand[] {
  const input = template.input as Record<string, unknown>;
  const teaching = (template.teachingInput ?? {}) as Record<string, unknown>;
  const commands: DomainCommand[] = [];
  const push = (body: Record<string, unknown>): void => {
    commands.push(command(template.actionId, commands.length, body));
  };
  switch (template.kind) {
    case "make-parallel": {
      const throughPointId = typeof teaching.throughPointId === "string" ? teaching.throughPointId : undefined;
      const referenceLineId = typeof teaching.referenceLineId === "string" ? teaching.referenceLineId : undefined;
      const outputLineId = typeof input.outputLineId === "string" ? input.outputLineId : undefined;
      if (throughPointId && referenceLineId && outputLineId) {
        push({ type: "construct-parallel", throughPointId, referenceLineId, outputLineId });
      }
      break;
    }
    case "intersect-carriers": {
      const carrierPointIds = Array.isArray(teaching.carrierPointIds)
        ? (teaching.carrierPointIds as string[])
        : undefined;
      const parallelLineId = typeof input.parallelLineId === "string" ? input.parallelLineId : undefined;
      const outputCarrierLineId = typeof input.outputCarrierLineId === "string" ? input.outputCarrierLineId : undefined;
      const outputPointId = typeof input.outputPointId === "string" ? input.outputPointId : undefined;
      if (carrierPointIds?.length === 2 && outputCarrierLineId && parallelLineId && outputPointId) {
        push({ type: "construct-carrier", fromPointId: carrierPointIds[0], toPointId: carrierPointIds[1], outputLineId: outputCarrierLineId });
        push({ type: "intersect-lines", firstLineId: parallelLineId, secondLineId: outputCarrierLineId, outputPointId });
      }
      break;
    }
    case "mark-segment-values": {
      const labels = Array.isArray(teaching.labels) ? (teaching.labels as TopicSegmentLabel[]) : [];
      for (const label of labels) {
        if (label?.segmentId && label?.valueLatex) {
          push({ type: "set-segment-label", segmentId: label.segmentId, valueLatex: label.valueLatex, labelKind: "length" });
        }
      }
      break;
    }
    case "pair-segments": {
      const order = Array.isArray(teaching.expectedOrder) ? (teaching.expectedOrder as string[]) : [];
      pairsOf(order).forEach(([first, second]) => {
        push({ type: "set-correspondence-mark", segmentIds: [first, second], tickCount: 1 });
      });
      break;
    }
    case "ratio-scratch": {
      const order = Array.isArray(teaching.expectedOrder) ? (teaching.expectedOrder as string[]) : [];
      pairsOf(order).forEach(([first, second]) => {
        push({ type: "set-correspondence-mark", segmentIds: [first, second], tickCount: 1 });
      });
      const ratio = Array.isArray(teaching.simplifiedRatio) ? (teaching.simplifiedRatio as string[]) : [];
      order.slice(0, ratio.length).forEach((segmentId, index) => {
        if (ratio[index]) {
          push({ type: "set-segment-label", segmentId, valueLatex: ratio[index], labelKind: "share" });
        }
      });
      break;
    }
    case "convert-collinear": {
      const entityIds = ["wholeSegment", "targetSegment", "knownSegment"]
        .map((key) => (typeof teaching[key] === "string" ? (teaching[key] as string) : undefined))
        .filter((id): id is string => Boolean(id));
      if (entityIds.length) {
        push({ type: "set-emphasis", entityIds });
      }
      break;
    }
    case "enter-equation": {
      const order = Array.isArray(teaching.expectedOrder) ? (teaching.expectedOrder as string[]) : [];
      const knownValueLatex = typeof teaching.knownValueLatex === "string" ? teaching.knownValueLatex : undefined;
      if (order[0] && knownValueLatex) {
        push({ type: "set-segment-label", segmentId: order[0], valueLatex: knownValueLatex, labelKind: "length" });
      }
      break;
    }
    default:
      break;
  }
  return commands;
}

function studentSafeGeometry(geometry: TopicGeometryModel | undefined): TopicGeometryModel | undefined {
  if (!geometry) return undefined;
  return { viewBox: geometry.viewBox, points: geometry.points, segments: geometry.segments };
}

/** step.id → part_id 映射（checkpoint id 命中优先；steps 与 parts 等长时
 *  按序对应；长度不等且 id 不命中则不映射——诚实无披露）。 */
function partIdOfStep(
  plan: TutorPlanV2Payload,
  partIds: string[],
  stepCount: number,
  stepId: string,
  stepIndex: number,
): string | undefined {
  const byCheckpoint = plan.checkpoints.find((entry) => entry.checkpoint_id === stepId);
  if (byCheckpoint) return byCheckpoint.part_id;
  if (stepCount === partIds.length && stepIndex < partIds.length) return partIds[stepIndex];
  return undefined;
}

export interface TutorDemonstrationResult {
  action_plan: ExercisePlan;
}

/**
 * 讲解演示计划投影（纯函数；披露空时返回 undefined——诚实不交付）。
 * 场景记录由调用方解析（Approved+validation.passed，scenarioBank 口径）。
 */
export function buildTutorDemonstrationPlan(args: {
  plan: TutorPlanV2Payload;
  scenario: TopicResolvedScenario;
  state: TutorRuntimeState;
  context: TutorWorkspacePlanContext;
}): TutorDemonstrationResult | undefined {
  const { plan, scenario, state } = args;
  const templates = scenario.actionTemplates ?? [];
  if (!templates.length || !scenario.solutionBoard) return undefined;

  const partIds = state.curriculum.parts.map((part) => part.part_id);
  const fullyTaughtParts = new Set(
    state.curriculum.parts
      .filter((part) => part.current_index >= part.checkpoint_ids.length)
      .map((part) => part.part_id),
  );
  const completedCheckpoints = new Set(
    state.curriculum.parts.flatMap((part) => part.completed_checkpoints),
  );

  const stepIds = new Set(scenario.steps.map((step) => step.id));
  const reachedTemplates: AuthoredActionTemplate[] = [];
  for (const template of templates) {
    if (!stepIds.has(template.sourceStepId)) continue;
    const stepIndex = scenario.steps.findIndex((step) => step.id === template.sourceStepId);
    const partId = partIdOfStep(plan, partIds, scenario.steps.length, template.sourceStepId, stepIndex);
    if (partId === undefined) continue;
    if (completedCheckpoints.has(template.sourceStepId) || fullyTaughtParts.has(partId)) {
      reachedTemplates.push(template);
    }
  }
  if (!reachedTemplates.length) return undefined;

  // 板书披露口径：snapshotAt 的 owner 归属索引必须按「全量 action 序」算
  //（过滤列表会让未披露行的归属回退成 -1 而泄漏）；cutoff=当前讲到的
  // action 在全量序中的位次。计划 actions 本体仍只含已披露（渲染语义）。
  const fullActions: ActionContract[] = templates.map((template) =>
    materializeActionTemplate(template, "demonstration"),
  );
  const reachedIds = new Set(reachedTemplates.map((template) => template.actionId));
  const actions = fullActions.filter((action) => reachedIds.has(action.actionId));
  const currentAction = actions[actions.length - 1];
  const completedActionIds = actions.slice(0, -1).map((action) => action.actionId);
  const boardContext = demonstrationBoardContext(scenario, fullActions, currentAction.actionId);
  const effects = reachedTemplates
    .map((template) => ({ actionId: template.actionId, commands: demonstrationEffectsFor(template) }))
    .filter((entry) => entry.commands.length);

  return {
    action_plan: {
      planVersion: ACTION_RUNTIME_PLAN_VERSION,
      exerciseId: `tutor-demo:${plan.artifact_id}`,
      revision: state.revision,
      mode: "demonstration",
      metadata: {
        taskId: args.context.taskId,
        title: args.context.title ?? "老师演示",
        promptLatex: args.context.promptLatex,
        skillTags: args.context.skillTags ?? [],
      },
      world: { revision: state.revision, ...(studentSafeGeometry(scenario.promptGeometry) ? { geometry: studentSafeGeometry(scenario.promptGeometry) } : {}) },
      ...(boardContext ? { solutionBoardContexts: [boardContext] } : {}),
      ...(effects.length ? { demonstration: { effects } } : {}),
      coach: {
        profileId: "tutor-demonstration-v1",
        displayName: "一对一老师",
        avatarId: "school",
        tone: "supportive",
      },
      actions,
      currentActionId: currentAction.actionId,
      completedActionIds,
      // 演示是只读呈现：无 evidence 通道、无本地训练/narration/实时 coach
      //（voice 与推进权都在 Tutor 会话侧；不挂播放条，仅会话侧重播）。
      runtimeCapabilities: {
        practiceValidation: "server-authoritative",
        trainingSync: "local-only",
        narrationTransport: "off",
        coachTurnTransport: "request-response",
        liveCoach: false,
      },
    },
  };
}
