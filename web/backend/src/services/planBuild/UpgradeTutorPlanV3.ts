/**
 * TutorPlan v2 → v3 合同升级（Phase 5 UI 集成波次 D / §1）。
 *
 * 在现行 build→approve→materialize 管线的 draft 阶段注入 v3 合同字段：
 * 单一 approach_set_ref + version-pinned policy_profile_ref；随后由既有
 * 门禁（validateApprovedPlan / approveTutorPlan / materializeTutorPlan——
 * validatePayload 按 schema 常量分派到 v3 Zod）完成发布校验与
 * projection_hash/content_hash 重算。本函数只做结构与对账，不落盘：
 *
 * - ApproachSet 必须 Approved 且绑定同一 Question（跨题混装 fail closed）；
 * - plan.approach_refs 与 ApproachSet.parts 小问选择逐 part 三元组一致
 *   （§1 传递依赖不可变；装载层 approachRefsMatchSet 的构建期前置）；
 * - profile 的 ref version 取 profile_version（语义版本 pin，非 artifact
 *   version——与 topicQuestionExperience 的 PROFILE_VERSION_MISMATCH
 *   对账口径一致）；
 * - content_hash 按排除规则重算（approach_set_ref/policy_profile_ref 是
 *   内容字段，v2 hash 必然失效）。
 */
import { canonicalHash, type ApproachSetPayload, type TutorPlanV2Payload, type TutorPlanV3Payload, type TutorPolicyProfilePayload } from "./canonicalInputs";
import { approachRefsMatchSet } from "./approachSetReconciliation";

export interface UpgradeTutorPlanV3Deps {
  readonly approachSet: ApproachSetPayload;
  readonly profile: TutorPolicyProfilePayload;
}

export type UpgradeTutorPlanV3Result =
  | { ok: true; plan: TutorPlanV3Payload }
  | { ok: false; errors: string[] };

export function upgradeTutorPlanToV3(
  plan: TutorPlanV2Payload,
  deps: UpgradeTutorPlanV3Deps,
): UpgradeTutorPlanV3Result {
  const errors: string[] = [];
  const { approachSet, profile } = deps;
  if (approachSet.status !== "Approved") {
    errors.push(`approach set ${approachSet.artifact_id} status=${approachSet.status}，只有 Approved 可投影`);
  }
  if (profile.status !== "Approved") {
    errors.push(`policy profile ${profile.artifact_id} status=${profile.status}，只有 Approved 可固定`);
  }
  if (approachSet.question_ref.artifact_id !== plan.question_ref.artifact_id) {
    errors.push(
      `approach set ${approachSet.artifact_id} 绑定题目 ${approachSet.question_ref.artifact_id}，与 plan ${plan.artifact_id} 的 ${plan.question_ref.artifact_id} 不一致`,
    );
  }
  const candidate: TutorPlanV3Payload = {
    ...(plan as unknown as Omit<TutorPlanV2Payload, "schema">),
    schema: "ai_teaching_tutor_plan_bundle/v3",
    approach_set_ref: {
      artifact_id: approachSet.artifact_id,
      version: approachSet.version,
      content_hash: approachSet.content_hash,
    },
    policy_profile_ref: {
      profile_id: profile.artifact_id,
      version: profile.profile_version,
      content_hash: profile.content_hash,
    },
  };
  if (!approachRefsMatchSet(candidate, approachSet)) {
    errors.push(
      `plan ${plan.artifact_id} 的 approach_refs 与 approach set ${approachSet.artifact_id} 的小问选择不一致（传递依赖漂移，先重冻 ApproachSet）`,
    );
  }
  if (errors.length) return { ok: false, errors };
  candidate.content_hash = canonicalHash(candidate as unknown as Record<string, unknown>, "plan");
  return { ok: true, plan: candidate };
}
