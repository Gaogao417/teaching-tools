/**
 * TutorPresenterV6（F7 Step 3 — 有序 Presenter；PLAN.md §3 Step 3）。
 *
 * 把 Navigator 已裁决的 TutorPolicyDecision + 所选 TeachingBeat 落实为 canonical
 * `ai_teaching_presentation_plan/v2`（单一有序判别联合 actions[]，Zod 校验后
 * 返回——本 presenter 是该合同的第一个真实生产者）。与 V5 的差异只有**顺序
 * 合同**：不再输出 voice_actions[] + workspace_actions[] 双列表，而是单一
 * actions[]，F7 golden 的确定性顺序冻结为（ADR-011 / PLAN.md §3 Step 3）：
 *
 *   1. Geometry 构造/高亮（approved workspace 资源 → geometry.construct×N）
 *   2. Voice 讲解（approved voice_seed/explanation → 1 条）
 *   3. Solution Board reveal（gate ledger 授权预检 → 1 条）
 *
 * 没有某类 action 时跳过，剩余 ordinal==数组下标保持连续（canonical
 * checkPresentationOrdinals 镜像强制）。资源纪律与 V5 逐条相同：
 * - **只消费**：TutorPolicyDecision、当前 TeachingBeat、Approved resources
 *   （pinned Plan resources）、pinned catalog/capability、committed gate ledger
 *   （只读预检，避免产出必拒动作）；
 * - **只产出**：有序 PresentationAction（voice | workspace 判别联合）；
 * - **不得**：修改 TeachingCursor（无写入能力）；自造 Gate/outcome；读取未批准
 *   资源（resource_ref 必须在 pinned 资源内且 beat-bound）；直接 reveal 未满足
 *   Gate 的 final（五级绑定预检同 V5——finalRevealCurrentlyAuthorized 复用，
 *   零第二授权真相）；允许模型直接生成 DomainCommand 或前端参数（构造命令
 *   只来自 approved workspace 资源，呈现层仅确定性补戳 commandId/actionId）。
 *
 * `sequence_id`（PS- 注册于 id-registry，runtime/v6 波）由调用方传入会话内
 * 单调序号（已 committed 的 presentation_sequence_planned 计数 +1）；三元组
 * sequence_id+ordinal+action_id 的全部引用在 session 内闭合。
 *
 * 确定性：同输入（decision/beat/resources/catalog/ledger/serial）→ 同 plan（纯函数）。
 */
import type { z } from "zod";
import { presentationPlanV2Schema } from "../../../../shared/canonical";
import type { PlanResourceV4, ProtocolBeatPayload } from "../planBuild/canonicalInputs";
import type { NavigatorBeatView } from "../tutorNavigator/NavigatorPlanV5";
import type { NavigatorDecision } from "../tutorNavigator/TutorNavigatorV5";
import type { WorkspaceGateLedger } from "../tutorSession/WorkspaceRuntimeReducerV5";
import {
  boardEntryById,
  type WorkspacePresentationCatalogV5,
} from "../tutorSession/WorkspacePresentationCatalogV5";
import { constructionOutputId, resolveBeatConstructions } from "./WorkspaceActionAdjudication";
import { finalRevealCurrentlyAuthorized } from "./TutorPresenterV5";

export type PresentationPlanV6 = z.infer<typeof presentationPlanV2Schema>;

export interface PresenterV6Input {
  readonly sessionId: string;
  /** 会话内 presentation sequence 单调序号（committed planned 计数 +1）。 */
  readonly sequenceSerial: number;
  /** Navigator 已提交的决策（causation 锚 + decision_id 引用）。 */
  readonly decision: NavigatorDecision;
  /** 被呈现的 Beat（execute 类决策的当前 Beat；inquiry-aware）。 */
  readonly beat: NavigatorBeatView;
  /** Beat 的 presentation_intent（pinned Plan 原文；orchestrator 从 imported.protocols 透传）。 */
  readonly presentationIntent: ProtocolBeatPayload["presentation_intent"] | undefined;
  readonly resources: ReadonlyMap<string, PlanResourceV4>;
  readonly catalog: WorkspacePresentationCatalogV5;
  /** RG fact → Board entry 映射（golden catalog 装配产物）。 */
  readonly factEntryIds: ReadonlyMap<string, string>;
  /** committed gate ledger（只读预检：final reveal 授权、决策因果可见性）。 */
  readonly gateLedger: WorkspaceGateLedger;
  /** 当前仍可 reveal 的条目（跨 Beat 重复上下文过滤；执行层仍 fail closed）。 */
  readonly hiddenEntryIds: ReadonlySet<string>;
  /** Assessment 显式模式（true=禁用教学工具：仅确定性收束指示、零 workspace 动作）。 */
  readonly assessmentMode?: boolean;
  /** 已 committed 的画布元素 id（构造呈现幂等过滤——重复呈现跳过已构造输出）。 */
  readonly committedElementIds?: ReadonlySet<string>;
  /**
   * F7 Step 3 rework：需重呈现的目标（构造 output id / Board entry id）——
   * 服务端已 applied 但浏览器未 presented（failed/interrupted/崩溃窗口）的
   * 动作目标。这些目标以 presentation_only=true 重新入列（零服务端效果、
   * 浏览器重新呈现），不被 committed/hidden 过滤跳过（spec §2.5：retry 必须
   * 重新呈现失败 action）。
   */
  readonly representTargets?: ReadonlySet<string>;
}

export class TutorPresenterV6Error extends Error {
  constructor(readonly code: "PLAN_VALIDATION_FAILED" | "ASSESSMENT_TOOL_FORBIDDEN", message: string) {
    super(message);
    this.name = "TutorPresenterV6Error";
  }
}

/**
 * realize：decision + Beat + approved resources + pinned catalog → 有序 plan/v2。
 * 纯函数（不触 db、不追加事件、不修改游标）。
 */
export function realizePresentationPlanV6(input: PresenterV6Input): PresentationPlanV6 {
  const { sessionId, decision, beat, catalog, factEntryIds, gateLedger, hiddenEntryIds } = input;
  // 决策因果可见性：decision 必须是已提交事实（Presenter 只呈现 Navigator 已裁决的 Beat）。
  const committedDecision = gateLedger.decisions.get(decision.decision_id);
  if (!committedDecision) {
    throw new TutorPresenterV6Error(
      "PLAN_VALIDATION_FAILED",
      `decision ${decision.decision_id} has no committed policy_decision_made fact (presenter never invents causation)`,
    );
  }
  if (committedDecision.beatId !== beat.beat_id) {
    throw new TutorPresenterV6Error(
      "PLAN_VALIDATION_FAILED",
      `decision ${decision.decision_id} produces beat ${committedDecision.beatId} but presenter was asked to realize ${beat.beat_id}`,
    );
  }

  const serial = String(input.sequenceSerial).padStart(4, "0");
  const actions: PresentationPlanV6["actions"] = [];
  type OrderedAction = PresentationPlanV6["actions"][number];
  type ActionDraft =
    | { kind: "voice"; voice_action: NonNullable<OrderedAction["voice_action"]> }
    | { kind: "workspace"; workspace_action: NonNullable<OrderedAction["workspace_action"]> };
  const push = (action: ActionDraft): void => {
    actions.push({ ...action, ordinal: actions.length } as OrderedAction);
  };

  if (input.assessmentMode) {
    // Assessment 隔离：教学工具（scaffold/explain/演示）禁用——只允许确定性
    // 收束指示（题目已在入口呈现）；零 workspace 动作（构造/reveal 均属教学演示）。
    push({
      kind: "voice",
      voice_action: {
        action_id: `VA-${sessionId}-A${serial}`,
        decision_id: decision.decision_id,
        text: "请独立完成作答；完成后提交。",
        source: "deterministic-scaffold",
        interruptible: false,
        intent: "narrate",
      },
    });
    return finalizePlan(input, actions);
  }

  const approvedResources = [...beat.resource_ids]
    .map((resourceId) => input.resources.get(resourceId))
    .filter((resource): resource is PlanResourceV4 => resource !== undefined);

  // ---- 1. Geometry 构造/高亮（approved workspace 资源 → geometry.construct×N，
  // reveal_scope=none；已 presented 的输出幂等跳过——重复呈现/恢复序列不重发；
  // applied-未-presented（represent）的目标以 presentation_only 重呈现）。----
  const constructions = resolveBeatConstructions([...approvedResources], beat);
  if (constructions) {
    let constructionIndex = 0;
    for (const command of constructions) {
      const outputId = constructionOutputId(command);
      const represent = outputId !== undefined && (input.representTargets?.has(outputId) ?? false);
      if (outputId && !represent && input.committedElementIds?.has(outputId)) continue;
      // DomainCommand 基字段（commandId/actionId）由呈现层确定性补戳——artifact
      // 只承载几何本质（type/引用/输出 id）；幂等过滤保证不重复构造。
      const stamped = {
        ...command,
        commandId: `cmd-${sessionId}-${serial}-K${constructionIndex}`,
        actionId: `WSA-${sessionId}-${serial}-K${constructionIndex}`,
      } as typeof command;
      push({
        kind: "workspace",
        workspace_action: {
          action_id: `WSA-${sessionId}-${serial}-K${constructionIndex}`,
          decision_id: decision.decision_id,
          surface: "geometry",
          capability: "geometry.construct",
          origin: "tutor",
          command_payload: JSON.stringify(stamped),
          reveal_scope: "none",
          ...(represent ? { presentation_only: true } : {}),
        },
      });
      constructionIndex += 1;
    }
  }

  // ---- 2. Voice 讲解（Beat 绑定 approved 资源：voice_seed/explanation 优先；
  // 缺省回退 deterministic-scaffold=beat.purpose——不发明反馈文案）。
  const voiceResource = approvedResources.find((resource) => resource.kind === "voice_seed")
    ?? approvedResources.find((resource) => resource.kind === "explanation");
  if (voiceResource?.content) {
    push({
      kind: "voice",
      voice_action: {
        action_id: `VA-${sessionId}-${serial}`,
        decision_id: decision.decision_id,
        text: voiceResource.content,
        source: "approved-resource",
        resource_ref: voiceResource.resource_id,
        interruptible: true,
        intent: "narrate",
      },
    });
  } else {
    push({
      kind: "voice",
      voice_action: {
        action_id: `VA-${sessionId}-${serial}`,
        decision_id: decision.decision_id,
        text: beat.purpose,
        source: "deterministic-scaffold",
        interruptible: true,
        intent: "narrate",
      },
    });
  }

  // ---- 3. Solution Board reveal（presentation_intent 声明 solution_board 且允许
  // reveal intermediate；final 条目五级绑定当前可授权才进入计划）。
  const wantsBoard = input.presentationIntent?.workspace_surfaces?.includes("solution_board") === true;
  const mayRevealIntermediate = beat.support_boundary?.may_reveal_intermediate !== false;
  if (wantsBoard && mayRevealIntermediate) {
    const representTargets: string[] = [];
    const revealTargets: string[] = [];
    for (const factId of beat.graph_fact_refs) {
      const entryId = factEntryIds.get(factId);
      if (!entryId) continue;
      const entry = boardEntryById(catalog, entryId);
      if (!entry) continue;
      // applied-未-presented（represent）：重新入列（presentation_only）——
      // 服务端 reveal 已落定，浏览器重新呈现；与新 reveal 拆列（效果语义不同）。
      if (input.representTargets?.has(entryId)) {
        representTargets.push(entryId);
        continue;
      }
      // solution_refs 会合法地重复前一 Beat 已显示的 premises；Presenter 只计划
      // 状态增量，已 presented 的 reveal（条目已 visible）由 hidden 过滤跳过。
      if (!hiddenEntryIds.has(entryId)) continue;
      if (entry.revealRequirement === "final") {
        if (finalRevealCurrentlyAuthorized(catalog, gateLedger, entryId)) {
          revealTargets.push(entryId);
        }
        continue;
      }
      revealTargets.push(entryId);
    }
    if (representTargets.length > 0) {
      push({
        kind: "workspace",
        workspace_action: {
          action_id: `WSA-${sessionId}-${serial}-R`,
          decision_id: decision.decision_id,
          surface: "solution_board",
          capability: "board.reveal-entry",
          origin: "tutor",
          target_ids: representTargets,
          reveal_scope: "step_narration",
          presentation_only: true,
        },
      });
    }
    if (revealTargets.length > 0) {
      push({
        kind: "workspace",
        workspace_action: {
          action_id: `WSA-${sessionId}-${serial}`,
          decision_id: decision.decision_id,
          surface: "solution_board",
          capability: "board.reveal-entry",
          origin: "tutor",
          target_ids: revealTargets,
          reveal_scope: "step_narration",
        },
      });
    }
  }

  return finalizePlan(input, actions);
}

function finalizePlan(input: PresenterV6Input, actions: PresentationPlanV6["actions"]): PresentationPlanV6 {
  if (actions.length === 0) {
    throw new TutorPresenterV6Error(
      "PLAN_VALIDATION_FAILED",
      `presentation plan for beat ${input.beat.beat_id} realizes to zero actions (canonical requires at least the voice narration)`,
    );
  }
  const plan: PresentationPlanV6 = {
    schema: "ai_teaching_presentation_plan/v2",
    session_id: input.sessionId,
    sequence_id: `PS-${String(input.sequenceSerial).padStart(4, "0")}`,
    decision_id: input.decision.decision_id,
    protocol_id: input.beat.protocol_id,
    beat_id: input.beat.beat_id,
    actions,
  };
  const canonical = presentationPlanV2Schema.safeParse(plan);
  if (!canonical.success) {
    throw new TutorPresenterV6Error(
      "PLAN_VALIDATION_FAILED",
      `presentation plan fails canonical validation: ${canonical.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return plan;
}
