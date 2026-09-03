/**
 * TutorPresenterV5（F6 — Presenter；f6-scope-ledger 输出 3）。
 *
 * 把 Navigator 已裁决的 TutorPolicyDecision + 所选 TeachingBeat 落实为有序
 * PresentationPlan（canonical `ai_teaching_presentation_plan/v1`，Zod 校验后
 * 返回——canonical presentation-plan 正例同口径）。纪律（计划 §5 F6）：
 * - **只消费**：TutorPolicyDecision、当前 TeachingBeat、Approved resources
 *   （pinned Plan resources）、pinned catalog/capability、committed gate ledger
 *   （只读预检，避免产出必拒动作）；
 * - **只产出**：voice_actions + workspace_actions（顺序 = 同一 Beat 内编排
 *   顺序：voice 先行（narrate），workspace 后行（reveal/呈现）——orchestrator
 *   按此顺序执行）；
 * - **不得**：修改 TeachingCursor（无写入能力）；自造 Gate/outcome（只引用
 *   decision）；读取未批准资源（资源集=pinned Plan resources，resource_ref
 *   必须在 pinned_resource_ids 内且 beat-bound）；绕过 schema/capability/
 *   target/mode/truth-leak 校验（执行侧 F3 五重校验原样生效，Presenter 输出
 *   再经 canonical Zod）；直接 reveal 未满足 Gate 的 final（final 条目只有
 *   五级绑定当前可授权——gate ledger committed satisfied + cursor 仍绑定
 *   Beat——才进入计划）；
 * - **Assessment 隔离**（f6-scope-ledger 授权边界 5）：assessment mode 下
 *   `assessmentMode: true` 输入（catalog locked 场景由 orchestrator 保证）
 *   禁用一切教学工具——不产 scaffold/explain/演示类 voice（只允许题目重述
 *   与收束指示）、不产任何 workspace reveal/构造动作（空 workspace_actions
 *   为非法 plan → 调用方以显式错误拒绝，不静默降级）。
 *
 * 确定性：同输入（decision/beat/resources/catalog/ledger）→ 同 plan（纯函数）。
 */
import type { z } from "zod";
import { presentationPlanV1Schema } from "../../../../shared/canonical";
import type { PlanResourceV4, ProtocolBeatPayload } from "../planBuild/canonicalInputs";
import type { NavigatorBeatView } from "../tutorNavigator/NavigatorPlanV5";
import type { NavigatorDecision } from "../tutorNavigator/TutorNavigatorV5";
import type { WorkspaceGateLedger } from "../tutorSession/WorkspaceRuntimeReducerV5";
import {
  boardEntryById,
  type WorkspacePresentationCatalogV5,
} from "../tutorSession/WorkspacePresentationCatalogV5";
import { constructionOutputId, resolveBeatConstructions } from "./WorkspaceActionAdjudication";

export type PresentationPlanV5 = z.infer<typeof presentationPlanV1Schema>;

export interface PresenterInput {
  readonly sessionId: string;
  /** Navigator 已提交的决策（causation 锚 + decision_id 引用）。 */
  readonly decision: NavigatorDecision;
  /** 被呈现的 Beat（execute 类决策的当前 Beat；transition 的 to_beat 由编排层先取 executeCurrentBeat）。 */
  readonly beat: NavigatorBeatView;
  /** Beat 的 presentation_intent（pinned Plan 原文；orchestrator 从 imported.protocols 透传）。 */
  readonly presentationIntent: ProtocolBeatPayload["presentation_intent"] | undefined;
  /** pinned Plan 的资源表（Approved；key=resource_id）。 */
  readonly resources: ReadonlyMap<string, PlanResourceV4>;
  readonly catalog: WorkspacePresentationCatalogV5;
  /** RG fact → Board entry 映射（golden catalog 装配产物）。 */
  readonly factEntryIds: ReadonlyMap<string, string>;
  /** committed gate ledger（只读预检：final reveal 授权、决策因果可见性）。 */
  readonly gateLedger: WorkspaceGateLedger;
  /** 当前仍可 reveal 的条目；Presenter 用它去掉跨 Beat 重复上下文，执行层仍 fail closed。 */
  readonly hiddenEntryIds: ReadonlySet<string>;
  /** Assessment 显式模式（独立 session 入口；true=禁用教学工具）。 */
  readonly assessmentMode?: boolean;
  /** 已 committed 的画布元素 id（构造呈现幂等过滤——重复呈现同一 Beat 时跳过
   *  已构造输出，防 duplicate-output 整批拒绝；F7 因果链 1）。 */
  readonly committedElementIds?: ReadonlySet<string>;
  /** 动作 id 序号（orchestrator 提供：同 Beat 内单调递增）。 */
  readonly actionSerial: number;
}

export class TutorPresenterError extends Error {
  constructor(readonly code: "PLAN_VALIDATION_FAILED" | "ASSESSMENT_TOOL_FORBIDDEN", message: string) {
    super(message);
    this.name = "TutorPresenterError";
  }
}

/**
 * final 条目五级绑定当前是否可授权（committed gate satisfied + cursor 仍绑定 Beat + 未终态）。
 * F7 Step 3 起导出：TutorPresenterV6 复用同一预检（零第二授权真相）。
 */
export function finalRevealCurrentlyAuthorized(
  catalog: WorkspacePresentationCatalogV5,
  ledger: WorkspaceGateLedger,
  entryId: string,
): boolean {
  const entry = boardEntryById(catalog, entryId);
  if (!entry || entry.revealRequirement !== "final" || !entry.revealGate) return false;
  if (ledger.completed) return false;
  if (ledger.pinnedTaskId !== undefined && ledger.pinnedTaskId !== catalog.taskId) return false;
  if (!ledger.pinnedProtocols.includes(entry.revealGate.protocolId)) return false;
  if (ledger.cursor.beatId !== entry.revealGate.beatId) return false;
  const evaluation = ledger.evaluations.get(`${entry.revealGate.gateId}@${entry.revealGate.beatId}`);
  return evaluation?.satisfied === true;
}

/**
 * realize：decision + Beat + approved resources + pinned catalog → PresentationPlan。
 * 纯函数（不触 db、不追加事件、不修改游标）。
 */
export function realizePresentationPlanV5(input: PresenterInput): PresentationPlanV5 {
  const { sessionId, decision, beat, catalog, factEntryIds, gateLedger, hiddenEntryIds, actionSerial } = input;
  // 决策因果可见性：decision 必须是已提交事实（Presenter 只呈现 Navigator 已裁决的 Beat）。
  const committedDecision = gateLedger.decisions.get(decision.decision_id);
  if (!committedDecision) {
    throw new TutorPresenterError(
      "PLAN_VALIDATION_FAILED",
      `decision ${decision.decision_id} has no committed policy_decision_made fact (presenter never invents causation)`,
    );
  }
  if (committedDecision.beatId !== beat.beat_id) {
    throw new TutorPresenterError(
      "PLAN_VALIDATION_FAILED",
      `decision ${decision.decision_id} produces beat ${committedDecision.beatId} but presenter was asked to realize ${beat.beat_id}`,
    );
  }

  const serial = String(actionSerial).padStart(4, "0");
  const voiceActions: PresentationPlanV5["voice_actions"] = [];
  const workspaceActions: PresentationPlanV5["workspace_actions"] = [];

  if (input.assessmentMode) {
    // Assessment 隔离：教学工具（scaffold/explain/演示）禁用——只允许确定性
    // 收束指示（题目已在入口呈现；无 workspace 动作）。产出仍须非空 plan
    //（canonical 两 plane 至少其一非空），voice 只留 deterministic-scaffold。
    voiceActions.push({
      action_id: `VA-${sessionId}-A${serial}`,
      decision_id: decision.decision_id,
      text: "请独立完成作答；完成后提交。",
      source: "deterministic-scaffold",
      interruptible: false,
      intent: "narrate",
    });
    return finalizePlan(input, voiceActions, workspaceActions);
  }

  // ---- voice：Beat 绑定的 approved 资源（voice_seed/explanation 优先）→ 文本 ----
  const approvedResources = [...beat.resource_ids]
    .map((resourceId) => input.resources.get(resourceId))
    .filter((resource): resource is PlanResourceV4 => resource !== undefined);
  const voiceResource = approvedResources.find((resource) => resource.kind === "voice_seed")
    ?? approvedResources.find((resource) => resource.kind === "explanation");
  // 支持边界（beat.support_boundary）：max_support=foreground 时禁 explanation 全文复述？
  // ——support_boundary 约束的是「支持（inquiry/scaffold）」的阶梯，主线 Beat 呈现
  // 不受其限；Presenter 对主线 execute 类呈现只消费 voice_seed/explanation。
  if (voiceResource?.content) {
    voiceActions.push({
      action_id: `VA-${sessionId}-${serial}`,
      decision_id: decision.decision_id,
      text: voiceResource.content,
      source: "approved-resource",
      resource_ref: voiceResource.resource_id,
      interruptible: true,
      intent: "narrate",
    });
  } else {
    voiceActions.push({
      action_id: `VA-${sessionId}-${serial}`,
      decision_id: decision.decision_id,
      text: beat.purpose,
      source: "deterministic-scaffold",
      interruptible: true,
      intent: "narrate",
    });
  }

  // ---- workspace：Beat presentation_intent 声明 solution_board 且允许 reveal intermediate ----
  const wantsBoard = input.presentationIntent?.workspace_surfaces?.includes("solution_board") === true;
  const mayRevealIntermediate = beat.support_boundary?.may_reveal_intermediate !== false;
  if (wantsBoard && mayRevealIntermediate) {
    const revealTargets: string[] = [];
    for (const factId of beat.graph_fact_refs) {
      const entryId = factEntryIds.get(factId);
      if (!entryId) continue;
      const entry = boardEntryById(catalog, entryId);
      if (!entry) continue;
      // solution_refs 是 Beat 的完整推理上下文，会合法地重复前一 Beat 已显示的
      // premises。Presenter 只计划状态增量；重复 reveal 仍由执行层严格拒绝。
      if (!hiddenEntryIds.has(entryId)) continue;
      if (entry.revealRequirement === "final") {
        // final：只有五级绑定当前可授权才进入计划（不产必拒动作——执行侧
        // F3 五重校验仍会再拒一次；Presenter 预检是「不安排注定非法的动作」）。
        if (finalRevealCurrentlyAuthorized(catalog, gateLedger, entryId)) {
          revealTargets.push(entryId);
        }
        continue;
      }
      revealTargets.push(entryId);
    }
    if (revealTargets.length > 0) {
      workspaceActions.push({
        action_id: `WSA-${sessionId}-${serial}`,
        decision_id: decision.decision_id,
        surface: "solution_board",
        capability: "board.reveal-entry",
        origin: "tutor",
        target_ids: revealTargets,
        reveal_scope: "step_narration",
      });
    }
  }

  // ---- F7 因果链 1：Beat 绑定的 approved 构造资源（kind=workspace）→
  // geometry.construct 纯构图动作（reveal_scope=none）。构造先于学生 Action
  // 挂载（seg-AO/DO/BO/OE committed 前不挂载的锚定侧）；已 committed 的输出
  // 幂等跳过（重复呈现同一 Beat 不产生 duplicate-output）。
  const constructions = resolveBeatConstructions(
    [...approvedResources],
    beat,
  );
  if (constructions) {
    let constructionIndex = 0;
    for (const command of constructions) {
      const outputId = constructionOutputId(command);
      if (outputId && input.committedElementIds?.has(outputId)) continue;
      // DomainCommand 基字段（commandId/actionId）由呈现层确定性补戳——artifact
      // 只承载几何本质（type/引用/输出 id）；重复呈现经输出幂等过滤不会重发。
      const stamped = {
        ...command,
        commandId: `cmd-${sessionId}-${serial}-K${constructionIndex}`,
        actionId: `WSA-${sessionId}-${serial}-K${constructionIndex}`,
      } as typeof command;
      workspaceActions.push({
        action_id: `WSA-${sessionId}-${serial}-K${constructionIndex}`,
        decision_id: decision.decision_id,
        surface: "geometry",
        capability: "geometry.construct",
        origin: "tutor",
        command_payload: JSON.stringify(stamped),
        reveal_scope: "none",
      });
      constructionIndex += 1;
    }
  }
  return finalizePlan(input, voiceActions, workspaceActions);
}

function finalizePlan(
  input: PresenterInput,
  voiceActions: PresentationPlanV5["voice_actions"],
  workspaceActions: PresentationPlanV5["workspace_actions"],
): PresentationPlanV5 {
  const plan: PresentationPlanV5 = {
    schema: "ai_teaching_presentation_plan/v1",
    session_id: input.sessionId,
    plan_id: `PPT-${input.sessionId}-${String(input.actionSerial).padStart(4, "0")}`,
    decision_id: input.decision.decision_id,
    protocol_id: input.beat.protocol_id,
    beat_id: input.beat.beat_id,
    voice_actions: voiceActions,
    workspace_actions: workspaceActions,
  };
  const canonical = presentationPlanV1Schema.safeParse(plan);
  if (!canonical.success) {
    throw new TutorPresenterError(
      "PLAN_VALIDATION_FAILED",
      `presentation plan fails canonical validation: ${canonical.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return plan;
}
