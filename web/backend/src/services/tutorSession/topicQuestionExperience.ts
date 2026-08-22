/**
 * Topic–Question 体验选择（Phase 5 UI 集成 / 计划 §1–§2）。
 *
 * 权威链：Topic(taskId) → Approved TopicQuestionTeachingBinding → 默认
 * ApproachSet + TutorPlan(v3) → TutorPolicyProfile。全部对账 fail closed：
 * stale、非 Approved、hash 不匹配、同题多绑定冲突都返回明确错误，
 * 不静默换题或换讲法；没有 Approved Binding 才返回 legacy（走原 LearnPage）。
 */
import { existsSync } from "node:fs";

import {
  approvedBindingsForTask,
  loadApprovedApproachSet,
  loadApprovedPolicyProfile,
  loadApprovedTruth,
  loadCurrentPlanV3,
  type ApproachSetPayload,
  type TopicQuestionTeachingBindingPayload,
  type TruthPayload,
  type TutorPlanV3Payload,
  type TutorPolicyProfilePayload,
} from "../planBuild/canonicalInputs";

export type PolicyProviderKind = "deepseek-langgraph" | "deterministic-rules";

/** 事件 v4 session_started 携带的 profile snapshot（恢复会话按它路由，不读 env）。 */
export interface PolicyProfileSnapshot {
  profile_id: string;
  version: string;
  primary_provider: string;
  fallback_provider: string;
  model_id: string;
  prompt_version: string;
}

export type TopicQuestionSelectionError =
  | "AMBIGUOUS_BINDING"
  | "BINDING_QUESTION_STALE"
  | "BINDING_APPROACH_SET_STALE"
  | "APPROACH_SET_MISMATCH"
  | "PLAN_NOT_APPROVED"
  | "PLAN_APPROACH_SET_MISMATCH"
  | "PROFILE_NOT_APPROVED"
  | "PROFILE_VERSION_MISMATCH"
  | "TRUTH_NOT_APPROVED";

export type TopicQuestionSelection =
  | {
      kind: "tutor";
      binding: TopicQuestionTeachingBindingPayload;
      variant: TopicQuestionTeachingBindingPayload["teaching_variants"][number];
      plan: TutorPlanV3Payload;
      approachSet: ApproachSetPayload;
      profile: TutorPolicyProfilePayload;
      truth: TruthPayload;
      profileSnapshot: PolicyProfileSnapshot;
    }
  | { kind: "legacy"; reason: "canonical_root_missing" | "no_approved_binding" | "no_alternate_variant" }
  | { kind: "error"; code: TopicQuestionSelectionError; message: string };

export interface TopicQuestionSelectorDeps {
  readonly canonicalRoot: string;
}

export function refEquals(
  ref: { artifact_id: string; version: string; content_hash: string },
  current: { artifact_id: string; version: string; content_hash: string },
): boolean {
  return (
    ref.artifact_id === current.artifact_id &&
    ref.version === current.version &&
    ref.content_hash === current.content_hash
  );
}

function snapshotOf(profile: TutorPolicyProfilePayload): PolicyProfileSnapshot {
  return {
    profile_id: profile.artifact_id,
    version: profile.profile_version,
    primary_provider: profile.primary_provider,
    fallback_provider: profile.fallback_provider,
    model_id: profile.model_id,
    prompt_version: profile.prompt_version,
  };
}

/**
 * Plan v3 的 approach_refs 必须与其 ApproachSet 的小问选择完全一致
 * （§1：传递依赖不可变）。逐 part 对账 artifact_id/version/hash。
 */
export function approachRefsMatchSet(plan: TutorPlanV3Payload, approachSet: ApproachSetPayload): boolean {
  const setParts = approachSet.parts.map((part) => ({
    part_id: part.part_id ?? "1",
    approach: part.approach,
  }));
  if (plan.approach_refs.length !== setParts.length) return false;
  const byPart = new Map(setParts.map((part) => [part.part_id, part.approach]));
  for (const ref of plan.approach_refs) {
    const chosen = byPart.get(ref.part_id);
    if (!chosen || !refEquals(ref, chosen)) return false;
  }
  return true;
}

/**
 * 选择 taskId 的 Tutor 体验（计划 §2 TopicQuestionSelector.Select 的同步内联版；
 * 学生维度 progression 由上层 ScenarioSelector/progression 决定，不在本模块）。
 */
export function selectTopicQuestionTeaching(
  deps: TopicQuestionSelectorDeps,
  taskId: string,
): TopicQuestionSelection {
  return selectTopicQuestionTeachingWithRole(deps, taskId, "default");
}

/** 同题换讲法（计划 §2）：按 role 解析 variant；alternate 不存在 → legacy。 */
export function selectTopicQuestionTeachingWithRole(
  deps: TopicQuestionSelectorDeps,
  taskId: string,
  role: "default" | "alternate",
): TopicQuestionSelection {
  if (!deps.canonicalRoot || !existsSync(deps.canonicalRoot)) {
    return { kind: "legacy", reason: "canonical_root_missing" };
  }
  const inputs = { canonicalRoot: deps.canonicalRoot };
  const bindings = approvedBindingsForTask(inputs, taskId);
  if (bindings.length === 0) {
    return { kind: "legacy", reason: "no_approved_binding" };
  }
  if (bindings.length > 1) {
    // 同一 Topic 多个 Approved Binding = 路由歧义；fail closed，不静默挑选。
    return {
      kind: "error",
      code: "AMBIGUOUS_BINDING",
      message: `task ${taskId} 有 ${bindings.length} 个 Approved Binding（${bindings
        .map((binding) => binding.artifact_id)
        .join(", ")}），必须先下线到恰好一个`,
    };
  }
  const binding = bindings[0];
  const variant = binding.teaching_variants.find((entry) => entry.role === role);
  if (!variant) {
    return { kind: "legacy", reason: role === "alternate" ? "no_alternate_variant" : "no_approved_binding" };
  }

  const truth = loadApprovedTruth(inputs, binding.question_ref.artifact_id);
  if (!truth.ok || !refEquals(binding.question_ref, truth.payload)) {
    return {
      kind: "error",
      code: "BINDING_QUESTION_STALE",
      message: `binding ${binding.artifact_id} 的 question_ref 与 current Approved 不一致：${
        truth.ok ? "hash/version 漂移" : truth.errors.join("; ")
      }`,
    };
  }

  const approachSet = loadApprovedApproachSet(inputs, variant.approach_set_ref.artifact_id);
  if (!approachSet.ok || !refEquals(variant.approach_set_ref, approachSet.payload)) {
    return {
      kind: "error",
      code: "BINDING_APPROACH_SET_STALE",
      message: `binding ${binding.artifact_id} 的 approach_set_ref 与 current Approved 不一致：${
        approachSet.ok ? "hash/version 漂移" : approachSet.errors.join("; ")
      }`,
    };
  }
  if (approachSet.payload.question_ref.artifact_id !== binding.question_ref.artifact_id) {
    return {
      kind: "error",
      code: "APPROACH_SET_MISMATCH",
      message: `approach set ${approachSet.payload.artifact_id} 绑定的题目与 binding ${binding.artifact_id} 不一致`,
    };
  }

  const plan = loadCurrentPlanV3(inputs, variant.tutor_plan_ref.artifact_id);
  if (!plan.ok) {
    return { kind: "error", code: "PLAN_NOT_APPROVED", message: plan.errors.join("; ") };
  }
  if (
    !refEquals(variant.tutor_plan_ref, plan.payload) ||
    plan.payload.question_ref.artifact_id !== binding.question_ref.artifact_id ||
    !refEquals(plan.payload.approach_set_ref, variant.approach_set_ref)
  ) {
    return {
      kind: "error",
      code: "PLAN_APPROACH_SET_MISMATCH",
      message: `plan ${plan.payload.artifact_id} 与 binding ${binding.artifact_id} 的 question/approach_set 引用不一致（hash 漂移或跨讲法混装）`,
    };
  }
  if (!approachRefsMatchSet(plan.payload, approachSet.payload)) {
    return {
      kind: "error",
      code: "APPROACH_SET_MISMATCH",
      message: `plan ${plan.payload.artifact_id} 的 approach_refs 与 approach set ${approachSet.payload.artifact_id} 的小问选择不一致（传递依赖漂移）`,
    };
  }

  const profile = loadApprovedPolicyProfile(inputs, plan.payload.policy_profile_ref.profile_id);
  if (!profile.ok || profile.payload.content_hash !== plan.payload.policy_profile_ref.content_hash) {
    return {
      kind: "error",
      code: "PROFILE_NOT_APPROVED",
      message: `plan ${plan.payload.artifact_id} 的 policy_profile_ref 不可用：${
        profile.ok ? "hash 漂移" : profile.errors.join("; ")
      }`,
    };
  }
  if (profile.payload.profile_version !== plan.payload.policy_profile_ref.version) {
    return {
      kind: "error",
      code: "PROFILE_VERSION_MISMATCH",
      message: `plan ${plan.payload.artifact_id} 固定 profile 语义版本 ${plan.payload.policy_profile_ref.version}，current Approved 是 ${profile.payload.profile_version}（version-pinned 漂移）`,
    };
  }

  return {
    kind: "tutor",
    binding,
    variant,
    plan: plan.payload,
    approachSet: approachSet.payload,
    profile: profile.payload,
    truth: truth.payload,
    profileSnapshot: snapshotOf(profile.payload),
  };
}

/**
 * Provider 路由（计划 §2）：profile 决定业务路由；env 只保留紧急强制回滚
 * （TUTOR_POLICY_FORCE_PROVIDER=deterministic——只改 Provider，不改
 * Plan/Question/教学状态语义）。
 */
export function resolvePolicyProvider(
  profile: TutorPolicyProfilePayload,
  env: NodeJS.ProcessEnv = process.env,
): { provider: PolicyProviderKind; forced: boolean } {
  const forced = env.TUTOR_POLICY_FORCE_PROVIDER?.trim();
  if (forced === "deterministic") {
    return { provider: "deterministic-rules", forced: true };
  }
  return { provider: profile.primary_provider, forced: false };
}
