/**
 * DecideTutorMove 应用服务（Phase 5 / P5-06/07/08 的组合入口）。
 *
 * 组装顺序：TutorPolicyPort（deterministic-rules，可换 LLM adapter）
 *   → withSafeFallback（timeout/异常/非法输出的兜底）
 *   → validateDecisionAgainstPlan（Approved Plan constraints 的 fail-closed 校验）。
 *
 * 输出仍是决策草案 + 失败信息；decision_id / 事件落盘 / 呈现派生都在
 * TutorSessionCoordinator（决策与事实写入分层，PRD 04 §3 步骤 3–4）。
 */
import type { PolicyContext, TutorPolicyPort } from "./TutorPolicyPort";
import { validateDecisionAgainstPlan, type TutorDecisionDraft } from "./TutorMove";
import { withSafeFallback } from "./adapters/safeFallback/safeFallbackPolicy";

export interface DecideTutorMoveOutcome {
  /** null = 本轮不需要教学动作（如 confirm 后等待学生）。 */
  draft: TutorDecisionDraft | null;
  policy_version: string;
  /** 非空表示 policy 层失败（P5-14：与学生错误分离的系统失败事实）。 */
  failure?: { failure_class: string; fallback_used: boolean };
}

export function createDecideTutorMove(port: TutorPolicyPort, options?: { timeoutMs?: number }) {
  const guarded = withSafeFallback(port, { timeoutMs: options?.timeoutMs });
  return async function decideTutorMove(context: PolicyContext): Promise<DecideTutorMoveOutcome> {
    const outcome = await guarded.decide(context);
    if (!outcome.ok) {
      if (outcome.error_code === "ASSESSMENT_FAIL_CLOSED") {
        return {
          draft: null,
          policy_version: outcome.policy_version,
          failure: { failure_class: "assessment_fail_closed", fallback_used: false },
        };
      }
      return {
        draft: null,
        policy_version: outcome.policy_version,
        failure: { failure_class: "policy_error", fallback_used: false },
      };
    }
    if (!outcome.decision) {
      return { draft: null, policy_version: outcome.policy_version };
    }
    const validation = validateDecisionAgainstPlan(outcome.decision, context.plan, context.state);
    if (!validation.ok) {
      return {
        draft: {
          move_type: "wait",
          purpose_code: "wait.safe_fallback",
          checkpoint_id: context.state.reasoning.current_checkpoint_id,
          fallback: true,
        },
        policy_version: outcome.policy_version,
        failure: { failure_class: "policy_invalid_move", fallback_used: true },
      };
    }
    return {
      draft: outcome.decision,
      policy_version: outcome.policy_version,
      ...(outcome.fallback_of ? { failure: { ...outcome.fallback_of, fallback_used: true } } : {}),
    };
  };
}
