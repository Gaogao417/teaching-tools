/**
 * TutorMove 合同（Phase 5 / P5-06，PRD 04 §2.3 / ADR-006 §3）。
 *
 * MVP 冻结六类教学决定：explain / prompt / hint / confirm / wait / repair。
 * TutorMove 表示教学意图，不是工具命令；具体呈现（Voice/Workspace）由
 * Presenter 派生（一 Move → 零到多个 PresentationAction）。
 *
 * validateDecisionAgainstPlan 是 Policy 输出的第一道 fail-closed 门：
 * 只消费 Approved Plan 的资源与 constraints（P5-07），任何越界（未允许的
 * move、超最高帮助档、悬空资源、repair 无资源、hint 缺 checkpoint/level）
 * 都拒绝——拒绝路径走 safe fallback（P5-08），不直接进入呈现。
 */
import type { MoveType, SessionMode } from "../tutorSession/TutorSessionEvent";
import type { TutorPlanV2Payload, PlanResourceV2 } from "../planBuild/canonicalInputs";
import type { TutorRuntimeState } from "../tutorSession/TutorRuntimeStateProjection";

export const MOVE_TYPES: readonly MoveType[] = ["explain", "prompt", "hint", "confirm", "wait", "repair"];

/** working diagnosis 更新草案（由决策携带，coordinator 落成事件并校验 evidence 引用）。 */
export interface WorkingDiagnosisUpdate {
  summary_code: string;
  candidate_skill_ids?: string[];
  evidence_sequences: number[];
}

/** 决策草案：Policy 产出；decision_id 由 coordinator 按事件流序派生。 */
export interface TutorDecisionDraft {
  move_type: MoveType;
  purpose_code: string;
  checkpoint_id?: string;
  assistance_level?: number;
  resource_ids?: string[];
  fallback?: boolean;
  mode_change?: { to_mode: SessionMode };
  diagnosis_updates?: WorkingDiagnosisUpdate[];
}

export interface TutorDecision extends TutorDecisionDraft {
  decision_id: string;
  policy_version: string;
  source_event_sequence: number;
  source_state_revision: number;
}

export interface DecisionValidation {
  ok: boolean;
  errors: string[];
}

function resourceOf(plan: TutorPlanV2Payload, resourceId: string): PlanResourceV2 | undefined {
  return plan.resources.find((resource) => resource.resource_id === resourceId);
}

/**
 * 校验决策只使用 Approved Plan 提供的内容/资源/约束（ADR-006 不变量 1/2）。
 * 注意：这里不校验文本内容（资源内容已在 materializer 泄漏门禁过审），
 * 也不派生呈现——那是 Presenter 的职责。
 */
export function validateDecisionAgainstPlan(
  draft: TutorDecisionDraft,
  plan: TutorPlanV2Payload,
  state: TutorRuntimeState,
): DecisionValidation {
  const errors: string[] = [];
  const constraints = plan.policy_constraints;

  if (!MOVE_TYPES.includes(draft.move_type)) {
    errors.push(`unknown move_type: ${draft.move_type}`);
  }
  if (!constraints.allowed_move_types.includes(draft.move_type)) {
    errors.push(`move_type=${draft.move_type} 不在 plan allowed_move_types 内`);
  }
  if (typeof draft.purpose_code !== "string" || !/^[a-z][a-z0-9._-]*$/.test(draft.purpose_code)) {
    errors.push(`invalid purpose_code: ${draft.purpose_code}`);
  }

  const checkpointId = draft.checkpoint_id ?? state.reasoning.current_checkpoint_id;
  const checkpoint = plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId);
  if (!checkpoint) {
    errors.push(`checkpoint ${checkpointId} 不在 plan checkpoints 内`);
  }

  if (draft.move_type === "hint") {
    if (draft.checkpoint_id === undefined || draft.assistance_level === undefined) {
      errors.push("hint move 需要 checkpoint_id 与 assistance_level");
    } else if (draft.assistance_level > constraints.maximum_assistance_level) {
      errors.push(
        `assistance_level=${draft.assistance_level} 超过 plan maximum_assistance_level=${constraints.maximum_assistance_level}`,
      );
    }
  }

  if (draft.resource_ids) {
    for (const resourceId of draft.resource_ids) {
      const resource = resourceOf(plan, resourceId);
      if (!resource) {
        errors.push(`resource ${resourceId} 不在 plan resources 内`);
        continue;
      }
      if (draft.checkpoint_id && resource.checkpoint_id && resource.checkpoint_id !== draft.checkpoint_id) {
        // repair 资源是 part 级兜底（锚在 part 末节点），同 part 内任意
        // checkpoint 的修复决策都可使用；其余 kind 要求节点一致。
        const decisionPart = plan.checkpoints.find((entry) => entry.checkpoint_id === draft.checkpoint_id)?.part_id;
        const resourcePart = plan.checkpoints.find((entry) => entry.checkpoint_id === resource.checkpoint_id)?.part_id;
        if (!(resource.kind === "repair" && decisionPart === resourcePart)) {
          errors.push(`resource ${resourceId} 属于 ${resource.checkpoint_id}，与决策 checkpoint ${draft.checkpoint_id} 不符`);
        }
      }
      if (draft.move_type === "hint" && resource.kind !== "hint") {
        errors.push(`hint move 引用了 ${resource.kind} 资源 ${resourceId}`);
      }
      if (draft.move_type === "repair" && resource.kind !== "repair") {
        errors.push(`repair move 引用了 ${resource.kind} 资源 ${resourceId}`);
      }
    }
  }

  if (draft.move_type === "repair" && (!draft.resource_ids || draft.resource_ids.length === 0)) {
    errors.push("repair move 需要至少一个 repair 资源");
  }
  if (draft.move_type === "explain" && (!draft.resource_ids || draft.resource_ids.length === 0)) {
    errors.push("explain move 需要至少一个讲解资源（Policy 只使用 plan 批准的内容）");
  }

  if (draft.mode_change && !["teach", "guided_solve", "repair"].includes(draft.mode_change.to_mode)) {
    errors.push(`invalid mode_change.to_mode: ${draft.mode_change.to_mode}`);
  }

  for (const update of draft.diagnosis_updates ?? []) {
    if (!Array.isArray(update.evidence_sequences) || update.evidence_sequences.length === 0) {
      errors.push(`diagnosis update ${update.summary_code} 缺 evidence_sequences`);
    }
    if ((update.candidate_skill_ids?.length ?? 0) > 3) {
      errors.push(`diagnosis update ${update.summary_code} candidate_skill_ids 超过 3 条`);
    }
  }

  return { ok: errors.length === 0, errors };
}
