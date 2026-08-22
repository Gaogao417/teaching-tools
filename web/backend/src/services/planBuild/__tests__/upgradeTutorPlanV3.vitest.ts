/**
 * Phase 5 UI 集成波次 D：TutorPlan v2 → v3 升级服务单测。
 *
 * 纯函数口径（不依赖 canonical 落盘；发布链门禁由 planBuild.test 的
 * approve/materialize 面覆盖）：refs 注入三元组、content_hash 重算、
 * AS 题目漂移 / approach_refs 传递依赖漂移 / 非 Approved 对象 fail closed。
 */
import { describe, expect, it } from "vitest";

import type { ApproachSetPayload, TutorPlanV2Payload, TutorPolicyProfilePayload } from "../canonicalInputs";
import { canonicalHash } from "../canonicalInputs";
import { upgradeTutorPlanToV3 } from "../UpgradeTutorPlanV3";

const SHA = (seed: string): string =>
  `sha256:${seed}`.padEnd(71, "0").replace(/[^sha256:0-9a-f]/g, (c) => "0123456789abcdef"[c.charCodeAt(0) % 16]);

const TA_REF = { artifact_id: "TA-TST-001", version: "v1", content_hash: SHA("ta1") };

function makePlan(): TutorPlanV2Payload {
  return {
    schema: "ai_teaching_tutor_plan_bundle/v2",
    artifact_id: "TP-TST-001",
    version: "v2",
    status: "Draft",
    question_ref: { artifact_id: "QT-TST-001", version: "v1", content_hash: SHA("qt1") },
    approach_refs: [{ ...TA_REF, part_id: "1" }],
    recommended_routes: [
      { route_id: "R1", role: "primary", part_id: "1", checkpoint_ids: ["CP1"], completion_condition: "完成" },
    ],
    checkpoints: [
      { checkpoint_id: "CP1", part_id: "1", expected_reasoning: "能设元", resource_ids: [] },
    ],
    resources: [],
    policy_constraints: { allowed_capabilities: [] },
    content_hash: SHA("plan-v2"),
  } as unknown as TutorPlanV2Payload;
}

function makeApproachSet(questionId = "QT-TST-001"): ApproachSetPayload {
  return {
    schema: "ai_teaching_approach_set/v1",
    artifact_id: "AS-TST-001",
    version: "v1",
    status: "Approved",
    question_ref: { artifact_id: questionId, version: "v1", content_hash: SHA("qt1") },
    parts: [{ part_id: "1", approach: TA_REF }],
    content_hash: SHA("as1"),
  } as unknown as ApproachSetPayload;
}

function makeProfile(): TutorPolicyProfilePayload {
  return {
    schema: "ai_teaching_tutor_policy_profile/v1",
    artifact_id: "PP-TST-001",
    version: "v1",
    status: "Approved",
    profile_version: "2026-08-23.1",
    primary_provider: "deepseek-langgraph",
    fallback_provider: "deterministic-rules",
    model_id: "deepseek-v4-flash",
    prompt_version: "TUTOR_POLICY_PROMPT@2026-08-v3",
    content_hash: SHA("pp1"),
  } as unknown as TutorPolicyProfilePayload;
}

describe("upgradeTutorPlanToV3", () => {
  it("注入 approach_set_ref 与 version-pinned policy_profile_ref，并重算 content_hash", () => {
    const result = upgradeTutorPlanToV3(makePlan(), { approachSet: makeApproachSet(), profile: makeProfile() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.schema).toBe("ai_teaching_tutor_plan_bundle/v3");
    expect(result.plan.approach_set_ref).toEqual({
      artifact_id: "AS-TST-001",
      version: "v1",
      content_hash: SHA("as1"),
    });
    // profile ref 的 version 是语义版本 pin（profile_version），非 artifact version。
    expect(result.plan.policy_profile_ref).toEqual({
      profile_id: "PP-TST-001",
      version: "2026-08-23.1",
      content_hash: SHA("pp1"),
    });
    expect(result.plan.content_hash).not.toBe(SHA("plan-v2"));
    expect(result.plan.content_hash).toBe(
      canonicalHash(result.plan as unknown as Record<string, unknown>, "plan"),
    );
    // v3 refs 是内容字段：排除法重算后 hash 随之改变（v2 hash 必然失效）。
    const withoutRefs = { ...result.plan } as Record<string, unknown>;
    delete withoutRefs.approach_set_ref;
    delete withoutRefs.policy_profile_ref;
    expect(result.plan.content_hash).not.toBe(canonicalHash(withoutRefs, "plan"));
  });

  it("ApproachSet 绑定另一道题 → fail closed（跨题混装）", () => {
    const result = upgradeTutorPlanToV3(makePlan(), {
      approachSet: makeApproachSet("QT-TST-OTHER"),
      profile: makeProfile(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toContain("不一致");
  });

  it("approach_refs 与 ApproachSet 小问选择漂移 → fail closed（先重冻 AS）", () => {
    const plan = makePlan();
    const driftedSet = makeApproachSet();
    driftedSet.parts = [{ part_id: "1", approach: { ...TA_REF, version: "v2", content_hash: SHA("ta2") } }];
    const result = upgradeTutorPlanToV3(plan, { approachSet: driftedSet, profile: makeProfile() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toContain("传递依赖漂移");
  });

  it("非 Approved ApproachSet / profile → fail closed", () => {
    const staleSet = makeApproachSet();
    staleSet.status = "Stale";
    const draftProfile = makeProfile();
    draftProfile.status = "Draft";
    const result = upgradeTutorPlanToV3(makePlan(), { approachSet: staleSet, profile: draftProfile });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toContain("AS-TST-001");
    expect(result.errors.join("; ")).toContain("PP-TST-001");
  });
});
