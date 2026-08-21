/**
 * Safe fallback wrapper（Phase 5 / P5-08，PRD 04 §10）。
 *
 * 包裹任意 TutorPolicyPort，保证 session 不因模型问题卡死或越界：
 * - timeout budget（默认 1500ms）→ policy_timeout；
 * - 内层抛异常 / 返回 ok:false（INVALID_MOVE / TIMEOUT / UNSUPPORTED）→ 透传失败类别；
 * - 失败后回退到「已批准的最低风险动作」：plan 中当前 checkpoint 的 Prompt
 *   资源不存在时退到 Wait（零呈现、零泄题）；fallback 决策带 fallback:true；
 * - ASSESSMENT_FAIL_CLOSED 不回退——Assessment 不得产生任何教学 move，
 *   原样上抛（ADR-006 不变量 6 / MVP fallback 顺序第 4 步）。
 */
import type { PolicyContext, PolicyOutcome, PolicyErrorCode, TutorPolicyPort } from "../../TutorPolicyPort";
import type { TutorDecisionDraft } from "../../TutorMove";
import { DETERMINISTIC_POLICY_VERSION } from "../model/deterministicRulesPolicy";

export const FALLBACK_POLICY_VERSION = `${DETERMINISTIC_POLICY_VERSION}+safe-fallback`;

export interface SafeFallbackOptions {
  timeoutMs?: number;
}

function fallbackDecision(context: PolicyContext, failureClass: string): TutorDecisionDraft {
  // plan 资源词表没有 prompt 资源 kind（P4 只建 hint/probe/repair/explanation/
  // voice_seed/action_template），所以「已批准的最低风险 Prompt」缺位时按
  // PRD 04 §10 顺序落到 Wait：零 PresentationAction、不泄露答案。
  const checkpointId = context.state.reasoning.current_checkpoint_id;
  return {
    move_type: "wait",
    purpose_code: "wait.safe_fallback",
    checkpoint_id: checkpointId,
    fallback: true,
    ...(failureClass ? {} : {}),
  };
}

export function withSafeFallback(inner: TutorPolicyPort, options: SafeFallbackOptions = {}): TutorPolicyPort {
  const timeoutMs = options.timeoutMs ?? 1500;
  return {
    policyVersion: `${inner.policyVersion}+safe-fallback`,
    async decide(context: PolicyContext): Promise<PolicyOutcome> {
      let outcome: PolicyOutcome;
      try {
        const decidePromise = Promise.resolve(inner.decide(context));
        const timeout = new Promise<PolicyOutcome>((resolve) => {
          const timer = setTimeout(() => {
            resolve({
              ok: false,
              error_code: "TIMEOUT",
              detail: `policy decide exceeded ${timeoutMs}ms budget`,
              policy_version: inner.policyVersion,
            });
          }, timeoutMs);
          timer.unref?.();
        });
        outcome = await Promise.race([decidePromise, timeout]);
      } catch (error) {
        outcome = {
          ok: false,
          error_code: "INVALID_MOVE",
          detail: error instanceof Error ? error.message : String(error),
          policy_version: inner.policyVersion,
        };
      }

      if (outcome.ok || outcome.error_code === "ASSESSMENT_FAIL_CLOSED") {
        return outcome;
      }

      const failureClass = mapFailureClass(outcome.error_code, outcome.detail);
      const fallback = fallbackDecision(context, failureClass);
      return {
        ok: true,
        decision: fallback,
        policy_version: outcome.policy_version,
        fallback_of: { failure_class: failureClass },
      };
    },
  };
}

export type PolicyFailureClass =
  | "policy_timeout"
  | "policy_invalid_move"
  | "policy_unsupported"
  | "policy_error";

function mapFailureClass(code: PolicyErrorCode, detail: string): PolicyFailureClass {
  if (code === "TIMEOUT") return "policy_timeout";
  if (code === "INVALID_MOVE") return "policy_invalid_move";
  if (code === "UNSUPPORTED") return "policy_unsupported";
  return detail.includes("budget") ? "policy_timeout" : "policy_error";
}
