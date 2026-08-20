/**
 * Phase 4 planBuild 单测（P4-01..09 门禁）。
 *
 * 用合成 canonical 数据（不依赖 skills 仓真实产物）覆盖：
 * - registry snapshot 内容寻址与查询；
 * - reader 的 hash 漂移 / 非 Approved fail-closed；
 * - build 的 part 覆盖失败与确定性 Draft；
 * - materializer 的 8 类 fail-closed 门禁（stale / 非法 capability / 缺 primitive /
 *   truth leak / hint ladder / annotation 越界 / registry 漂移 / 禁止键）；
 * - 投影确定性（同输入同 hash；registry 变化必改 hash）；
 * - action_template 的 render smoke + typed evaluator smoke（正确证据 accepted、
 *   错误证据 rejected、assessment 投影无 truth）。
 */
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, rmSync } from "node:fs";

const sqlitePath = path.resolve(process.cwd(), ".plan-build.test.sqlite");
if (existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
process.env.SQLITE_PATH = sqlitePath;

const {
  buildRuntimeRegistrySnapshot,
  isKnownActionKind,
  isKnownCapability,
  unknownCapabilities,
} = require("../RuntimeRegistrySnapshot") as typeof import("../RuntimeRegistrySnapshot");
const { canonicalHash } = require("../canonicalInputs") as typeof import("../canonicalInputs");
const { buildTutorPlanDraft } = require("../BuildTutorPlan") as typeof import("../BuildTutorPlan");
const { buildPlanPreview, renderPreviewMarkdown, approveTutorPlan } = require("../ReviewTutorPlan") as typeof import("../ReviewTutorPlan");
const {
  MATERIALIZER_VERSION,
  materializeTutorPlan,
  projectApprovedPlan,
  validateApprovedPlan,
} = require("../MaterializeTutorPlan") as typeof import("../MaterializeTutorPlan");
const {
  evaluatorSmoke,
  smokeActionTemplate,
} = require("../adapters/actionRuntimeV5/adapter") as typeof import("../adapters/actionRuntimeV5/adapter");
const { validateForPublication } = require("../../../../../shared/canonical") as typeof import("../../../../../shared/canonical");

// --------------------------------------------------------------------------- //
// 合成 canonical 数据（结构与 skills 仓 canonical-authoring 产物一致）
// --------------------------------------------------------------------------- //
const SHA = (seed: string): string =>
  `sha256:${seed.padEnd(64, "0").slice(0, 64)}`.replace(/[^sha256:0-9a-f]/g, (c) =>
    "0123456789abcdef"[c.charCodeAt(0) % 16],
  );

const syntheticTruth = {
  schema: "ai_teaching_question_truth/v2",
  artifact_id: "QT-TST-001",
  version: "v1",
  status: "Approved",
  question_type: "solution",
  stem: "如图，$AB \\parallel CD$，$AD$ 与 $BC$ 交于点 $O$。求证：$\\triangle AOB \\sim \\triangle DOC$；并求 $AD$ 的长为 $2\\sqrt{3}$。",
  subquestions: [
    {
      part_id: "1",
      prompt: "(1) 求证：$\\triangle AOB \\sim \\triangle DOC$；",
      canonical_answer: { kind: "proof", value: "$\\triangle AOB \\sim \\triangle DOC$" },
      reviewed_solution: "由 $AB \\parallel CD$ 得角相等，AA 判定得相似。",
    },
    {
      part_id: "2",
      prompt: "(2) 求 $AD$ 的长。",
      canonical_answer: { kind: "expression", value: "$2\\sqrt{3}$" },
      reviewed_solution: "由相似比例得 $AD = 2\\sqrt{3}$。",
    },
  ],
  source_evidence_refs: [
    { evidence_id: "SE-TST-001", artifact_uri: "artifact://source-evidence/SE-TST-001" },
  ],
  approval: { reviewer_id: "tst", approved_at: "2026-08-21T00:00:00Z" },
  content_hash: "",
  artifact_uri: "artifact://question-truth/QT-TST-001@v1",
} as unknown as Record<string, unknown>;
syntheticTruth.content_hash = canonicalHash(syntheticTruth, "authoring");

const syntheticApproach = (taId: string, partId: string | undefined) => {
  const payload = {
    schema: "ai_teaching_teaching_approach/v2",
    artifact_id: taId,
    version: "v1",
    status: "Approved",
    question_ref: {
      artifact_id: "QT-TST-001",
      version: "v1",
      content_hash: syntheticTruth.content_hash,
      ...(partId ? { part_id: partId } : {}),
    },
    title: `${taId} 标题`,
    goal: "建立从平行条件到相似的推理链",
    entry_signal: "指出两个目标三角形",
    steps: [
      {
        step_id: "S1",
        intent: "识别目标三角形",
        narration: "先看 AOB 与 DOC。",
        expected_student_reasoning: "指出要比较的两个三角形",
        common_errors: ["只看数值不看结构"],
        skill_ids: ["SKILL-SMV-008"],
      },
      {
        step_id: "S2",
        intent: "转换平行条件为角关系",
        narration: "平行给出内错角相等。",
        expected_student_reasoning: "说出内错角相等",
        skill_ids: ["SKILL-SMV-005"],
      },
      {
        step_id: "S3",
        intent: "用 AA 判定收尾",
        narration: "两组角相等，AA 判定。",
        expected_student_reasoning: "写出 AA 判定结论",
        skill_ids: ["SKILL-SMV-009"],
      },
    ],
    evidence: {
      audio: [
        {
          artifact_uri: `artifact://audio/${taId}@v1/a.wav`,
          content_hash: SHA("a"),
          recorded_at: "2026-08-21T00:00:00Z",
        },
      ],
      transcripts: [
        {
          artifact_uri: `artifact://transcript/${taId}@v1/a.txt`,
          asr_provenance: { provider: "dashscope", model_id: "qwen3-asr-flash" },
        },
      ],
      polished: [],
      manual_edit_notes: ["tst edit"],
    },
    approval: { reviewer_id: "tst", approved_at: "2026-08-21T00:00:00Z" },
    content_hash: "",
    artifact_uri: `artifact://teaching-approach/${taId}@v1`,
  } as unknown as Record<string, unknown>;
  payload.content_hash = canonicalHash(payload, "authoring");
  return payload;
};

const truth = syntheticTruth as unknown as import("../canonicalInputs").TruthPayload;
const approach1 = syntheticApproach("TA-TST-001", "1") as unknown as import("../canonicalInputs").ApproachPayload;
const approach2 = syntheticApproach("TA-TST-002", "2") as unknown as import("../canonicalInputs").ApproachPayload;

const snapshot = buildRuntimeRegistrySnapshot();
const materializationInputs = {
  truth,
  approaches: new Map([
    [approach1.artifact_id, approach1],
    [approach2.artifact_id, approach2],
  ]),
  snapshot,
};

const buildInputs = {
  planId: "TP-TST-001",
  runId: "run-tst",
  builtAt: "2026-08-21T00:00:00Z",
  truth,
  approachSet: null,
  approaches: [approach1, approach2],
  snapshot,
  capabilityPath: ["select-option", "enter-text"],
};

function freshDraft() {
  const result = buildTutorPlanDraft(buildInputs);
  assert.ok(result.ok, result.ok ? "" : result.errors.join(";"));
  return result.plan;
}

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main(): Promise<void> {
  await runTest("registry snapshot is content-addressed and queryable (P4-01)", () => {
    assert.ok(snapshot.runtime_registry_version.startsWith("action-runtime-registry/v5@"));
    assert.equal(snapshot.runtime_registry_version, buildRuntimeRegistrySnapshot().runtime_registry_version, "同一代码基线必须得到同一 registry 版本");
    assert.ok(isKnownActionKind(snapshot, "enter-text"));
    assert.ok(!isKnownActionKind(snapshot, "construct-perpendicular"));
    assert.ok(isKnownCapability(snapshot, "similarity.plan-similarity-proof"));
    assert.ok(isKnownCapability(snapshot, "agent:set-answer"));
    assert.deepEqual(unknownCapabilities(snapshot, ["similarity.mark-known-segments", "workspace.focus-objects"]), [
      "workspace.focus-objects",
    ]);
    assert.ok(snapshot.domain_commands.includes("set-emphasis"));
  });

  await runTest("build derives deterministic draft with routes/checkpoints/resources (P4-03..05)", () => {
    const plan = freshDraft();
    assert.equal(plan.status, "Draft");
    assert.equal(plan.checkpoints.length, 6, "两个 part × 3 步");
    assert.deepEqual(
      plan.approach_refs.map((ref) => `${ref.artifact_id}:${ref.part_id}`).sort(),
      ["TA-TST-001:1", "TA-TST-002:2"],
    );
    assert.ok(plan.recommended_routes.some((route) => route.role === "primary" && route.part_id === "1"));
    assert.ok(plan.recommended_routes.some((route) => route.role === "alternate"));
    const again = freshDraft();
    assert.equal(again.content_hash, plan.content_hash, "确定性构建：同输入同 content_hash");
    // hint ladder：每个 checkpoint 恰好 L1/L2 两档
    for (const checkpoint of plan.checkpoints) {
      const hints = plan.resources.filter(
        (resource) => resource.kind === "hint" && resource.checkpoint_id === checkpoint.checkpoint_id,
      );
      assert.equal(hints.length, 2, checkpoint.checkpoint_id);
      assert.deepEqual(hints.map((hint) => hint.assistance_level).sort(), [1, 2]);
    }
  });

  await runTest("build annotates ≤2 skills with rationale/evidence and leaves unmapped reason (P4-06)", () => {
    const plan = freshDraft();
    const annotated = plan.checkpoints.filter((checkpoint) => checkpoint.skill_annotations?.length);
    assert.ok(annotated.length >= 2, "至少锚定 part 首节点的 coarse + fine 节点");
    for (const checkpoint of annotated) {
      assert.ok((checkpoint.skill_annotations ?? []).length <= 2);
      for (const annotation of checkpoint.skill_annotations ?? []) {
        assert.ok(annotation.rationale.length > 10);
        assert.ok(annotation.evidence_refs[0].match(/^TA-TST-00\d@v1#S\d$/));
      }
    }
    const unmapped = plan.checkpoints.filter((checkpoint) => checkpoint.unmapped_skill_reason);
    assert.ok(unmapped.length >= 1);
    // 细粒度 skill 全 plan 只锚一次（provisional hint 去重）
    const allAnnotated = plan.checkpoints.flatMap((checkpoint) => checkpoint.skill_annotations ?? []);
    const skillIds = allAnnotated.map((annotation) => annotation.skill_id);
    assert.equal(new Set(skillIds).size, skillIds.length);
  });

  await runTest("build fails closed when a part lacks an Approved approach", () => {
    const result = buildTutorPlanDraft({ ...buildInputs, approaches: [approach1] });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.includes("part 2 uncovered")));
    assert.ok(result.gaps.some((gap) => gap.kind === "part_uncovered"));
  });

  await runTest("build sanitizes hint/probe content that would leak the answer value", () => {
    const leaking = JSON.parse(JSON.stringify(approach2)) as typeof approach2;
    leaking.steps[0].intent = `关键一步：写出答案 2√3`;
    (leaking as unknown as Record<string, unknown>).content_hash = canonicalHash(
      leaking as unknown as Record<string, unknown>,
      "authoring",
    );
    const result = buildTutorPlanDraft({
      ...buildInputs,
      approaches: [approach1, leaking],
    });
    assert.ok(result.ok);
    if (result.ok) {
      const guided = result.plan.resources
        .filter((resource) => ["hint", "diagnostic_probe", "voice_seed"].includes(resource.kind))
        .map((resource) => resource.content ?? "");
      assert.ok(guided.length > 0);
      for (const content of guided) {
        assert.ok(!content.includes("2√3"), "泄漏自查必须把答案值从 hint/probe/voice_seed 中降级");
      }
      assert.ok(result.sanitizedHints.length > 0);
    }
  });

  await runTest("draft passes content gates and materializes with stable projection hash (P4-08/09)", () => {
    const draft = freshDraft();
    const draftCheck = validateApprovedPlan(draft, materializationInputs, { requireApproved: false });
    assert.ok(draftCheck.ok, draftCheck.ok ? "" : draftCheck.errors.join(";"));
    const first = projectApprovedPlan(draft, materializationInputs);
    const second = projectApprovedPlan(JSON.parse(JSON.stringify(draft)), materializationInputs);
    assert.equal(first.projection_hash, second.projection_hash, "同 Plan + 同 materializer/registry ⇒ 同 projection hash");
    assert.ok(first.projection_hash.startsWith("sha256:"));

    const approved = approveTutorPlan(draft, {
      reviewer_id: "reviewer-tst",
      approved_at: "2026-08-21T01:00:00Z",
      review_note: "tst",
      runtime_projection: {
        materializer_version: MATERIALIZER_VERSION,
        runtime_registry_version: snapshot.runtime_registry_version,
        projection_hash: first.projection_hash,
        validation_status: "passed",
      },
    });
    assert.ok(approved.ok);
    const materialized = materializeTutorPlan(approved.plan, materializationInputs);
    assert.ok(materialized.ok, materialized.ok ? "" : materialized.errors.join(";"));
    assert.equal(materialized.ok && materialized.plan.content_hash, draft.content_hash, "approve 不改变 content_hash");
    // registry 版本变化必须改变 hash（投影敏感性）
    const driftedSnapshot = {
      ...snapshot,
      runtime_registry_version: "action-runtime-registry/v5@drift0000000",
      capabilities: [...snapshot.capabilities, "similarity.extra-capability"],
    };
    const drifted = projectApprovedPlan(draft, { ...materializationInputs, snapshot: driftedSnapshot });
    assert.notEqual(drifted.projection_hash, first.projection_hash);
  });

  await runTest("publication fails closed for Draft and passes for Approved", () => {
    const draft = freshDraft();
    assert.ok(validateForPublication(draft).some((issue) => issue.code === "not_approved"));
    const { projection_hash } = projectApprovedPlan(draft, materializationInputs);
    const approved = approveTutorPlan(draft, {
      reviewer_id: "r",
      approved_at: "2026-08-21T01:00:00Z",
      review_note: "",
      runtime_projection: {
        materializer_version: MATERIALIZER_VERSION,
        runtime_registry_version: snapshot.runtime_registry_version,
        projection_hash,
        validation_status: "passed",
      },
    });
    assert.ok(approved.ok);
    assert.deepEqual(validateForPublication(approved.ok ? approved.plan : draft), []);
  });

  await runTest("stale question binding fails closed", () => {
    const draft = freshDraft();
    const stale = {
      ...draft,
      question_ref: { ...draft.question_ref, version: "v0" },
    } as typeof draft;
    const result = validateApprovedPlan(stale, materializationInputs, { requireApproved: false });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.includes("stale")));
  });

  await runTest("tampered approach content_hash fails closed", () => {
    const draft = freshDraft();
    const tampered = {
      ...draft,
      approach_refs: draft.approach_refs.map((ref, index) =>
        index === 0 ? { ...ref, content_hash: SHA("tamper") } : ref,
      ),
    } as typeof draft;
    const result = validateApprovedPlan(tampered, materializationInputs, { requireApproved: false });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.includes("TA-TST-001")));
  });

  await runTest("unknown capability fails closed", () => {
    const draft = freshDraft();
    const bad = {
      ...draft,
      policy_constraints: { ...draft.policy_constraints, allowed_capabilities: ["workspace.focus-objects"] },
      content_hash: "",
    } as typeof draft;
    bad.content_hash = canonicalHash(bad as unknown as Record<string, unknown>, "plan");
    const result = validateApprovedPlan(bad, materializationInputs, { requireApproved: false });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.includes("非法 capability")));
  });

  await runTest("missing primitive fails closed (construct-perpendicular)", () => {
    const draft = freshDraft();
    const template = {
      actionId: "tp:bad:construct",
      sourceStepId: "S1",
      kind: "construct-perpendicular",
      version: 1,
      title: "作垂线",
      instruction: "作垂线",
      input: {},
      capabilities: ["similarity.plan-similarity-proof"],
      answerSlots: [],
      submitOnComplete: true,
    };
    const bad = {
      ...draft,
      resources: [
        ...draft.resources,
        {
          resource_id: "RES999",
          kind: "action_template",
          checkpoint_id: draft.checkpoints[0].checkpoint_id,
          source: "agent_generated",
          action_ref: template.actionId,
          capability: "similarity.plan-similarity-proof",
          content: JSON.stringify(template),
        },
      ],
      checkpoints: draft.checkpoints.map((checkpoint, index) =>
        index === 0 ? { ...checkpoint, resource_ids: [...(checkpoint.resource_ids ?? []), "RES999"] } : checkpoint,
      ),
      content_hash: "",
    } as typeof draft;
    bad.content_hash = canonicalHash(bad as unknown as Record<string, unknown>, "plan");
    const result = validateApprovedPlan(bad, materializationInputs, { requireApproved: false });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.includes("缺失 primitive")));
  });

  await runTest("hint leaking the answer value fails closed", () => {
    const draft = freshDraft();
    const bad = {
      ...draft,
      resources: draft.resources.map((resource) =>
        resource.kind === "hint" && resource.assistance_level === 2
          ? { ...resource, content: "直接写答案：2√3" }
          : resource,
      ),
      content_hash: "",
    } as typeof draft;
    bad.content_hash = canonicalHash(bad as unknown as Record<string, unknown>, "plan");
    const result = validateApprovedPlan(bad, materializationInputs, { requireApproved: false });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.includes("泄漏答案值")));
  });

  await runTest("hint ladder with a single rung fails closed (P4-05)", () => {
    const draft = freshDraft();
    const firstHintIds = new Set(
      draft.resources.filter((resource) => resource.kind === "hint" && resource.assistance_level === 2).map((r) => r.resource_id),
    );
    const bad = {
      ...draft,
      resources: draft.resources.filter((resource) => !firstHintIds.has(resource.resource_id)),
      checkpoints: draft.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        resource_ids: (checkpoint.resource_ids ?? []).filter((id) => !firstHintIds.has(id)),
      })),
      content_hash: "",
    } as typeof draft;
    bad.content_hash = canonicalHash(bad as unknown as Record<string, unknown>, "plan");
    const result = validateApprovedPlan(bad, materializationInputs, { requireApproved: false });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.includes("hint 阶梯不满足 P4-05")));
  });

  await runTest("skill annotation out of frozen scope / bogus evidence ref fails closed", () => {
    const draft = freshDraft();
    const withBad = (annotation: unknown) => {
      const mutated = {
        ...draft,
        checkpoints: draft.checkpoints.map((checkpoint, index) =>
          index === 0 ? { ...checkpoint, skill_annotations: [annotation] } : checkpoint,
        ),
        content_hash: "",
      } as typeof draft;
      mutated.content_hash = canonicalHash(mutated as unknown as Record<string, unknown>, "plan");
      return validateApprovedPlan(mutated, materializationInputs, { requireApproved: false });
    };
    const outOfScope = withBad({
      skill_id: "SKILL-SMV-004",
      rationale: "越界 skill",
      evidence_refs: ["TA-TST-001@v1#S1"],
    });
    assert.ok(!outOfScope.ok && outOfScope.errors.some((e) => e.includes("冻结 skill 集")));
    const bogusRef = withBad({
      skill_id: "SKILL-SMV-008",
      rationale: "证据不存在",
      evidence_refs: ["TA-TST-001@v1#S9"],
    });
    assert.ok(!bogusRef.ok && bogusRef.errors.some((e) => e.includes("S9")));
  });

  await runTest("runtime registry drift fails closed (plan must be rebuilt)", () => {
    const draft = freshDraft();
    const drifted = {
      ...materializationInputs,
      snapshot: { ...snapshot, runtime_registry_version: "action-runtime-registry/v5@drift0000000" },
    };
    const result = validateApprovedPlan(draft, drifted, { requireApproved: false });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.includes("runtime registry 漂移")));
  });

  await runTest("resource carrying canonical_answer key fails closed", () => {
    const draft = freshDraft();
    const bad = {
      ...draft,
      resources: draft.resources.map((resource, index) =>
        index === 0 ? { ...resource, canonical_answer: { kind: "expression", value: "2√3" } } : resource,
      ),
      content_hash: "",
    } as typeof draft;
    bad.content_hash = canonicalHash(bad as unknown as Record<string, unknown>, "plan");
    const result = validateApprovedPlan(bad, materializationInputs, { requireApproved: false });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.includes("禁止键 canonical_answer")));
  });

  await runTest("action templates pass render smoke with assessment truth isolation", () => {
    const draft = freshDraft();
    const templates = draft.resources
      .filter((resource) => resource.kind === "action_template")
      .map((resource) => JSON.parse(resource.content as string));
    assert.ok(templates.length >= 2, "两个 part 各一个结论模板");
    for (const template of templates) {
      const smoke = smokeActionTemplate(template);
      assert.ok(smoke.ok, smoke.errors.join(";"));
      assert.ok(smoke.assessment);
      const assessmentInput = JSON.stringify(smoke.assessment?.input);
      for (const truthKey of ["expectedValues", "expectedValue", "expectedResult"]) {
        assert.ok(!assessmentInput.includes(`"${truthKey}"`), "assessment 投影不得携带 truth 键");
      }
      assert.ok(smoke.assessment?.localTruth === undefined);
      const evaluator = evaluatorSmoke(template);
      assert.ok(evaluator.ok, evaluator.errors.join(";"));
      assert.equal(evaluator.acceptedCorrect, true);
      assert.equal(evaluator.rejectedWrong, true);
    }
  });

  await runTest("preview flags answer-bearing explanation and renders markdown (P4-07)", () => {
    const draft = freshDraft();
    const leaking = JSON.parse(JSON.stringify(draft)) as typeof draft;
    for (const resource of leaking.resources) {
      if (resource.kind === "explanation" && resource.checkpoint_id?.endsWith("6")) {
        resource.content = "最后得到 AD = 2√3。";
      }
    }
    leaking.content_hash = canonicalHash(leaking as unknown as Record<string, unknown>, "plan");
    const preview = buildPlanPreview(leaking, { truth });
    assert.ok(preview.flags.answer_value_resource_hits.length >= 1, "讲解资源含答案值 → 预览标注");
    assert.ok(preview.parts.length === 2);
    assert.ok(preview.parts.every((part) => part.checkpoints.length === 3));
    const markdown = renderPreviewMarkdown(preview);
    assert.ok(markdown.includes("# TutorPlan 预览"));
    assert.ok(markdown.includes("提示 L1"));
    assert.ok(markdown.includes("Skill 标注"));
  });

  await runTest("reject transitions draft to Disabled", () => {
    const draft = freshDraft();
    const rejected = (require("../ReviewTutorPlan") as typeof import("../ReviewTutorPlan")).rejectTutorPlan(draft);
    assert.equal(rejected.plan.status, "Disabled");
    assert.ok(validateForPublication(rejected.plan).some((issue) => issue.code === "not_approved"));
  });
}

void (async () => {
  await main();
  const { db } = require("../../../db/database") as typeof import("../../../db/database");
  db.close();
  if (existsSync(sqlitePath)) rmSync(sqlitePath, { force: true });
  console.log("PASS planBuild (all)");
})().catch((error) => {
  console.error("FAIL planBuild", error);
  throw error;
});
