/**
 * ExternalSupportEvidenceV5（F5 — Session 与 Protocol Navigator 内核）。
 *
 * ADR-007 §5：用具体 ExternalSupportEvidence 取代 H0–H5 控制变量——记录实际
 * 发生的支持事实（定向/突出/命名策略/指定运算/给出中间结论）、由谁发起、
 * 哪些动作执行了。不存在 Hint type/level/transition（L-01/L-02/L-03 的替代）。
 *
 * fail closed：
 * - support_kinds 不得越当前 Beat `support_boundary.max_support` 阶梯
 *   （ladder：orient < reveal_target < foreground < name_strategy <
 *   specify_operation < provide_intermediate_conclusion；provide_final_conclusion
 *   不在协议边界内，新事实一律拒绝）；
 * - 新事实 initiated_by 只允许 tutor_initiated / student_requested（unknown 仅
 *   legacy 派生）；derived_partial=false 且禁带 legacy_source（canonical 镜像
 *   superRefine 同口径）。
 */
import type { NavigatorBeatView } from "./NavigatorPlanV5";

/** 支持阶梯（与 canonical support_boundary.max_support 枚举同序；末位禁用）。 */
export const SUPPORT_LADDER = [
  "orient",
  "reveal_target",
  "foreground",
  "name_strategy",
  "specify_operation",
  "provide_intermediate_conclusion",
  // provide_final_conclusion 不在协议边界（canonical schema description），
  // 不进入合法阶梯——构造层直接拒绝。
] as const;

export type SupportKind =
  | "orient"
  | "reveal_target"
  | "foreground"
  | "name_strategy"
  | "specify_operation"
  | "provide_intermediate_conclusion"
  | "provide_final_conclusion";

const LADDER_RANK = new Map<string, number>(SUPPORT_LADDER.map((kind, index) => [kind, index]));

export class ExternalSupportEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalSupportEvidenceError";
  }
}

export interface SupportEvidenceArgs {
  readonly session_id: string;
  readonly evidence_id: string;
  /** 支持发生时的 Beat（边界裁决依据）。 */
  readonly beat: NavigatorBeatView;
  readonly support_kinds: readonly SupportKind[];
  readonly initiated_by: "tutor_initiated" | "student_requested";
  /** 实际执行并产生该支持的动作 id（VA-/WSA-）。 */
  readonly action_ids: readonly string[];
}

export type ExternalSupportEvidenceResult =
  | {
      ok: true;
      /** canonical external_support_recorded / ai_teaching_external_support_evidence/v1 同构 payload。 */
      payload: {
        evidence_id: string;
        beat_id: string;
        support_kinds: SupportKind[];
        initiated_by: "tutor_initiated" | "student_requested";
        action_ids: string[];
        derived_partial: false;
      };
    }
  | { ok: false; errors: string[] };

/** 构造具体支持事实（纯函数；越界/非法输入 fail closed，不产出 payload）。 */
export function buildExternalSupportEvidence(args: SupportEvidenceArgs): ExternalSupportEvidenceResult {
  const errors: string[] = [];
  if (args.support_kinds.length === 0) {
    errors.push("support_kinds must not be empty");
  }
  const allowedRank = LADDER_RANK.get(args.beat.support_boundary.max_support);
  if (allowedRank === undefined) {
    errors.push(`beat max_support ${args.beat.support_boundary.max_support} is not on the support ladder`);
  }
  for (const kind of args.support_kinds) {
    const rank = LADDER_RANK.get(kind);
    if (rank === undefined) {
      errors.push(`support kind ${kind} is outside the approved support boundary (no final conclusion in protocol)`);
      continue;
    }
    if (allowedRank !== undefined && rank > allowedRank) {
      errors.push(
        `support kind ${kind} exceeds beat ${args.beat.beat_id} max_support ${args.beat.support_boundary.max_support}`,
      );
    }
  }
  if (args.action_ids.length === 0) {
    errors.push("action_ids must reference the actions that produced the support");
  }
  // support_boundary.may_reveal_intermediate=false 的 Beat 不允许给出中间结论级支持。
  if (
    !args.beat.support_boundary.may_reveal_intermediate &&
    args.support_kinds.includes("provide_intermediate_conclusion")
  ) {
    errors.push(`beat ${args.beat.beat_id} may not reveal intermediate conclusions`);
  }
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    payload: {
      evidence_id: args.evidence_id,
      beat_id: args.beat.beat_id,
      support_kinds: [...new Set(args.support_kinds)],
      initiated_by: args.initiated_by,
      action_ids: [...args.action_ids],
      derived_partial: false,
    },
  };
}
