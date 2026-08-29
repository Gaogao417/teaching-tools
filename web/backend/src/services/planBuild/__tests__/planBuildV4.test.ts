/**
 * F4 planBuild v4 单测（G4 门禁：Approved Plan 供应链）。
 *
 * 用合成 canonical root（tmp 目录，结构与 skills 仓 canonical-authoring 一致）
 * 覆盖正向全链：RG 草稿 → Build Agent v4（alignment/chunk coarsening/Beat 草稿）
 * → 教师预览 → approve → registry 发布 → importer 解析+校验+materialize+投影；
 * 以及 G4 negative matrix：非法 graph ref / transition / gate / resource /
 * truth exposure / stale binding / 缺 primitive / 非 Approved / hash 漂移 /
 * 修改 Approved 内容（篡改已发布版本）——全部 fail closed。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const {
  canonicalHash,
  loadApprovedTruth,
  loadApprovedApproachSet,
  loadApprovedSolutionGraph,
  findApproachSetForQuestion,
  loadApprovedApproach,
  loadApprovedPolicyProfile,
} = require("../canonicalInputs") as typeof import("../canonicalInputs");
const { buildTutorPlanV4Draft } = require("../v4/BuildTeachingPlanV4") as typeof import("../v4/BuildTeachingPlanV4");
const {
  approveReviewedSolutionGraph,
  approveTeachingProtocol,
  approveTutorPlanV4,
  buildPlanV4Preview,
  renderPlanV4PreviewMarkdown,
  rejectPlanV4Artifacts,
} = require("../v4/ReviewTeachingPlanV4") as typeof import("../v4/ReviewTeachingPlanV4");
const {
  MATERIALIZER_V4_VERSION,
  materializeTutorPlanV4,
  projectApprovedPlanV4,
  validateApprovedPlanV4,
} = require("../v4/MaterializeTutorPlanV4") as typeof import("../v4/MaterializeTutorPlanV4");
const { importApprovedPlanV4 } = require("../v4/ImportApprovedPlanV4") as typeof import("../v4/ImportApprovedPlanV4");
const { publishApprovedPlanV4 } = require("../v4/PublishApprovedPlanV4") as typeof import("../v4/PublishApprovedPlanV4");
const { buildRuntimeRegistrySnapshot } = require("../RuntimeRegistrySnapshot") as typeof import("../RuntimeRegistrySnapshot");
const { validatePayload, validateForPublication } = require("../../../../../shared/canonical") as typeof import("../../../../../shared/canonical");

// --------------------------------------------------------------------------- //
// 合成 canonical 数据（single-part 题，与 skills 仓产物结构一致）
// --------------------------------------------------------------------------- //
const TRUTH_ANSWER = "$7$";

function withHash(payload: Record<string, unknown>, kind: "authoring" | "plan" = "authoring"): Record<string, unknown> {
  payload.content_hash = canonicalHash(payload, kind);
  return payload;
}

const syntheticTruth = withHash({
  schema: "ai_teaching_question_truth/v2",
  artifact_id: "QT-TST-001",
  version: "v1",
  status: "Approved",
  question_type: "fill_blank",
  stem: "如图，等腰三角形顶角已知，求底边上某线段的长。",
  canonical_answer: { kind: "expression", value: TRUTH_ANSWER },
  reviewed_solution: "由等腰与设元列式解出目标线段。",
  source_evidence_refs: [{ evidence_id: "SE-TST-001", artifact_uri: "artifact://source-evidence/SE-TST-001" }],
  approval: { reviewer_id: "tst", approved_at: "2026-08-28T00:00:00Z" },
  artifact_uri: "artifact://question-truth/QT-TST-001@v1",
}) as unknown as import("../canonicalInputs").TruthPayload;

const syntheticApproach = withHash({
  schema: "ai_teaching_teaching_approach/v2",
  artifact_id: "TA-TST-001",
  version: "v1",
  status: "Approved",
  question_ref: {
    artifact_id: "QT-TST-001",
    version: "v1",
    content_hash: syntheticTruth.content_hash,
  },
  title: "设元 → 不变量 → 收口",
  goal: "抓等腰设元，用不变量关系收口求目标线段。",
  entry_signal: "看到等腰条件能先设元。",
  steps: [
    {
      step_id: "S1",
      intent: "读题标注，等角翻译成等边并设元",
      narration: "标注等腰条件，把等角翻译成等边，设元 t。",
      expected_student_reasoning: "学生能设元并表达目标线段。",
      common_errors: ["先算长度不设元"],
      skill_ids: ["SKILL-SMV-001"],
    },
    {
      step_id: "S2",
      intent: "抓结构不变量",
      narration: "识别结构不变量，确定求解三角形。",
      expected_student_reasoning: "学生能指出求解所在的三角形。",
      skill_ids: ["SKILL-SMV-008"],
    },
    {
      step_id: "S3",
      intent: "设元列式求目标",
      narration: "代入数值完成运算并核验结论。",
      expected_student_reasoning: "学生能完成运算并核验。",
      common_errors: ["在斜三角形中硬凑勾股"],
      skill_ids: ["SKILL-SMV-007"],
    },
  ],
  // canonical v2 schema 必填：讲法溯源证据（loader 硬化后 schema 校验 fail closed）
  evidence: {
    audio: [{ artifact_uri: "artifact://audio/TA-TST-001@v1/a.wav", content_hash: "sha256:" + "0".repeat(64), recorded_at: "2026-08-28T00:00:00Z" }],
    transcripts: [{ artifact_uri: "artifact://transcript/TA-TST-001@v1/a.txt", asr_provenance: { provider: "dashscope", model_id: "qwen3-asr-flash" } }],
    polished: [],
    manual_edit_notes: ["tst"],
  },
  approval: { reviewer_id: "tst", approved_at: "2026-08-28T00:00:00Z" },
  artifact_uri: "artifact://teaching-approach/TA-TST-001@v1",
}) as unknown as import("../canonicalInputs").ApproachPayload;

const syntheticApproachSet = withHash({
  schema: "ai_teaching_approach_set/v1",
  artifact_id: "AS-TST-001",
  version: "v1",
  status: "Approved",
  question_ref: { artifact_id: "QT-TST-001", version: "v1", content_hash: syntheticTruth.content_hash },
  parts: [{ approach: { artifact_id: "TA-TST-001", version: "v1", content_hash: syntheticApproach.content_hash }, note: "整题单问" }],
  approval: { reviewer_id: "tst", approved_at: "2026-08-28T00:00:00Z" },
  artifact_uri: "artifact://approach-set/AS-TST-001@v1",
}) as unknown as import("../canonicalInputs").ApproachSetPayload;

const syntheticProfile = withHash({
  schema: "ai_teaching_tutor_policy_profile/v1",
  artifact_id: "PP-TST-001",
  version: "v1",
  status: "Approved",
  profile_version: "2026-08-28.1",
  primary_provider: "deterministic-rules",
  fallback_provider: "deepseek-langgraph",
  model_id: "tst-model",
  prompt_version: "TST@v1",
  approval: { reviewer_id: "tst", approved_at: "2026-08-28T00:00:00Z" },
  artifact_uri: "artifact://tutor-policy-profile/PP-TST-001@v1",
}) as unknown as import("../canonicalInputs").TutorPolicyProfilePayload;

const syntheticGraph = withHash({
  schema: "ai_teaching_reviewed_solution_graph/v1",
  graph_id: "RG-TST-001",
  version: "v1",
  status: "Draft",
  question_ref: { artifact_id: "QT-TST-001", version: "v1", content_hash: syntheticTruth.content_hash },
  approach_ref: { artifact_id: "TA-TST-001", version: "v1", content_hash: syntheticApproach.content_hash },
  facts: [
    {
      fact_id: "FN-01",
      role: "given",
      statement: "等腰 △ABC，AB=AC，点 D 在底边 BC 上",
      reveals_answer: false,
      evidence_refs: ["SE-TST-001"],
    },
    {
      fact_id: "FN-02",
      role: "given",
      statement: "顶角已知",
      reveals_answer: false,
      evidence_refs: ["SE-TST-001"],
    },
    {
      fact_id: "FN-03",
      role: "intermediate_value",
      statement: "AD=DC=t（等角对等边）",
      reveals_answer: false,
      skill_refs: ["SKILL-SMV-001"],
      evidence_refs: ["artifact://teaching-approach/TA-TST-001@v1"],
    },
    {
      fact_id: "FN-04",
      role: "goal",
      statement: "目标线段 = 7",
      reveals_answer: true,
      skill_refs: ["SKILL-SMV-007"],
      evidence_refs: ["artifact://teaching-approach/TA-TST-001@v1"],
    },
  ],
  inferences: [
    {
      inference_id: "IF-01",
      premises: ["FN-01", "FN-02"],
      conclusion: "FN-03",
      derivation: "等角对等边设元",
      evidence_refs: ["artifact://teaching-approach/TA-TST-001@v1"],
    },
    {
      inference_id: "IF-02",
      premises: ["FN-03"],
      conclusion: "FN-04",
      derivation: "代入收口",
      evidence_refs: ["artifact://teaching-approach/TA-TST-001@v1"],
    },
  ],
  solution_variants: [
    { variant_id: "SV-01", name: "主线", goal_fact_id: "FN-04", inference_ids: ["IF-01", "IF-02"] },
  ],
  artifact_uri: "artifact://reviewed-solution-graph/RG-TST-001@v1",
}) as unknown as import("../canonicalInputs").ReviewedSolutionGraphPayload;

const snapshot = buildRuntimeRegistrySnapshot();
const APPROVAL = { reviewer_id: "tst-reviewer", approved_at: "2026-08-28T01:00:00Z", review_note: "tst" };

/**
 * 发布一个 Approved 版本到合成 registry root（与 canonical-authoring 布局一致）。
 * F4 复验修复（2026-08-29）：registry.yaml 逐版本锚定 content_hash；planning/v4
 * 三 namespace 走真实发布器 publishApprovedPlanV4（append-only 守卫 + 锚定写
 * 入在发布路径内测试），QT/TA/AS/PP 镜像 skills 仓 promote_canonical 的锚定格式。
 */
function publish(root: string, namespace: string, payload: Record<string, unknown> & { artifact_id?: string; graph_id?: string; protocol_id?: string; version: string }): void {
  const id = payload.artifact_id ?? payload.graph_id ?? payload.protocol_id;
  assert.ok(id, "payload 缺 id");
  if (namespace === "reviewed-solution-graph" || namespace === "teaching-protocol" || namespace === "tutor-plan") {
    const result = publishApprovedPlanV4(root, namespace, payload as Parameters<typeof publishApprovedPlanV4>[2]);
    assert.ok(result.ok, result.ok ? "" : result.errors.join(";"));
    return;
  }
  const dir = path.join(root, namespace, id as string);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${payload.version}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(
    path.join(dir, "registry.yaml"),
    [
      `artifact_id: ${id}`,
      `current_version: ${payload.version}`,
      "versions:",
      `- {version: ${payload.version}, status: Approved, content_hash: ${payload.content_hash}}`,
      "",
    ].join("\n"),
  );
}

function freshBuild() {
  return buildTutorPlanV4Draft({
    planId: "TP-TST-001",
    runId: "run-tst-v4",
    builtAt: "2026-08-28T00:00:00Z",
    truth: syntheticTruth,
    approach: syntheticApproach,
    approachSet: syntheticApproachSet,
    graph: syntheticGraph,
    profile: syntheticProfile,
    snapshot,
    protocolIds: { mainline: "PR-TST-001", scaffold: "PR-TST-002" },
    capabilityPath: ["mark-segment-values", "enter-text"],
  });
}

/** 全链产物：RG/PR/TP approve 后写入合成 root。 */
function buildSyntheticRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "plan-v4-root-"));
  const graphApproved = approveReviewedSolutionGraph(syntheticGraph, APPROVAL);
  assert.ok(graphApproved.ok);
  const build = freshBuild();
  assert.ok(build.ok, build.ok ? "" : build.errors.join(";"));
  const mainline = approveTeachingProtocol(build.mainlineProtocol, APPROVAL);
  const scaffold = approveTeachingProtocol(build.scaffoldProtocol, APPROVAL);
  const plan = approveTutorPlanV4(build.plan, APPROVAL);
  assert.ok(mainline.ok && scaffold.ok && plan.ok);
  publish(root, "question-truth", syntheticTruth as unknown as Record<string, unknown> & { version: string });
  publish(root, "teaching-approach", syntheticApproach as unknown as Record<string, unknown> & { version: string });
  publish(root, "approach-set", syntheticApproachSet as unknown as Record<string, unknown> & { version: string });
  publish(root, "tutor-policy-profile", syntheticProfile as unknown as Record<string, unknown> & { version: string });
  publish(root, "reviewed-solution-graph", graphApproved.artifact as unknown as Record<string, unknown> & { version: string });
  publish(root, "teaching-protocol", mainline.artifact as unknown as Record<string, unknown> & { version: string });
  publish(root, "teaching-protocol", scaffold.artifact as unknown as Record<string, unknown> & { version: string });
  publish(root, "tutor-plan", plan.artifact as unknown as Record<string, unknown> & { version: string });
  return root;
}

/**
 * 读合成 root 的 PR JSON、按 mutate 改写、重算 hash 后写回（保持 loader 可读）。
 * F4 复验修复（2026-08-29）：默认同步 registry.yaml 的锚定 hash（模拟同时控制
 * 版本文件与 registry 的最强攻击，使既有的 schema/materializer 门禁逐一受测）；
 * keepDeclaredHash=true 保持旧 declared hash（原地篡改 → hash 自检拒绝）；
 * keepRegistryAnchor=true 只改版本文件不动 registry 锚定（同版本覆盖 → 锚定
 * 三方对账拒绝）。
 */
function mutateArtifact(
  root: string,
  namespace: string,
  artifactId: string,
  mutate: (payload: Record<string, unknown>) => void,
  options: { keepDeclaredHash?: boolean; keepRegistryAnchor?: boolean } = {},
): void {
  const dir = path.join(root, namespace, artifactId);
  const file = path.join(dir, "v1.json");
  const payload = JSON.parse(require("node:fs").readFileSync(file, "utf8")) as Record<string, unknown>;
  mutate(payload);
  if (!options.keepDeclaredHash) payload.content_hash = canonicalHash(payload, namespace === "tutor-plan" ? "plan" : "authoring");
  require("node:fs").writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  if (options.keepDeclaredHash || options.keepRegistryAnchor) return;
  // registry 锚定同步重写（与发布器写入的锚定字段同构）
  writeFileSync(
    path.join(dir, "registry.yaml"),
    [
      `artifact_id: ${artifactId}`,
      "current_version: v1",
      "versions:",
      `- {version: v1, status: Approved, content_hash: ${payload.content_hash}}`,
      "",
    ].join("\n"),
  );
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
  await runTest("build v4 draft: alignment + chunk coarsening + beat roles (G4 supply)", () => {
    const build = freshBuild();
    assert.ok(build.ok, build.ok ? "" : build.errors.join(";"));
    if (!build.ok) return;
    // skill 对齐：S1↔IF-01/FN-03、S3↔IF-02/FN-04；S2 无 inference（结构识别步）
    const s1 = build.alignment.find((entry) => entry.step_id === "S1");
    const s3 = build.alignment.find((entry) => entry.step_id === "S3");
    assert.deepEqual(s1?.inference_ids, ["IF-01"]);
    assert.deepEqual(s3?.inference_ids, ["IF-02"]);
    // Beat 装配：定向 → 操作 → 关联 → 收口（goal gate）→ 收束
    const beats = build.mainlineProtocol.beats;
    assert.equal(beats.length, 5);
    assert.equal(beats[0].cognitive_activity, "attend");
    assert.equal(beats[1].participation, "operate");
    assert.equal(beats[1].completion_evidence.gate?.capability, "similarity.mark-known-segments");
    assert.equal(beats[3].completion_evidence.evidence_kind, "student_answer");
    assert.equal(beats[3].completion_evidence.gate?.graph_fact_id, "FN-04");
    assert.deepEqual(beats[4].graph_fact_refs, ["FN-04"]);
    // chunk coarsening：单 chunk → mainline + scaffold refs
    assert.equal(build.plan.chunks.length, 1);
    assert.deepEqual(
      build.plan.chunks[0].protocol_refs.map((ref) => ref.artifact_id).sort(),
      ["PR-TST-001", "PR-TST-002"],
    );
    // v4 合同：无 hint kind / 无 assistance_level；编译器与 materializer 版本绑定
    const forbiddenKinds: string[] = ["hint"];
    assert.ok(build.plan.resources.every((resource) => !forbiddenKinds.includes(resource.kind)));
    assert.ok(build.plan.resources.every((resource) => !("assistance_level" in resource)));
    assert.ok(build.plan.build_provenance.compiler_version.length > 0);
    assert.equal(build.plan.build_provenance.materializer_version, MATERIALIZER_V4_VERSION);
    // 确定性：同输入同 hash
    const again = freshBuild();
    assert.ok(again.ok);
    if (again.ok) assert.equal(again.plan.content_hash, build.plan.content_hash);
  });

  await runTest("build fails closed on graph/approach alignment gaps", () => {
    const orphanGraph = JSON.parse(JSON.stringify(syntheticGraph)) as typeof syntheticGraph;
    orphanGraph.facts[2].skill_refs = ["SKILL-SMV-002"]; // 与任何 TA step 不匹配
    const payload = withHash(orphanGraph as unknown as Record<string, unknown>) as unknown as typeof syntheticGraph;
    const result = buildTutorPlanV4Draft({
      ...freshBuildInputsWithGraph(payload),
    });
    assert.ok(!result.ok);
    assert.ok(result.errors.some((error) => error.includes("alignment gap")));
    assert.ok(result.gaps.some((gap) => gap.kind === "alignment_gap"));
  });

  await runTest("teacher preview exposes purpose/graph refs/gate/pacing/intent/boundary/transitions", () => {
    const build = freshBuild();
    assert.ok(build.ok);
    if (!build.ok) return;
    const preview = buildPlanV4Preview(build.plan, {
      truth: syntheticTruth,
      graph: syntheticGraph,
      protocols: [build.mainlineProtocol, build.scaffoldProtocol],
    });
    const mainline = preview.protocols.find((protocol) => protocol.protocol_kind === "mainline");
    assert.ok(mainline);
    const verifyBeat = mainline?.beats.find((beat) => beat.beat_id === "BT-04");
    assert.ok(verifyBeat);
    assert.ok(verifyBeat?.purpose.length > 0);
    assert.equal(verifyBeat?.graph_fact_refs.length, 1);
    assert.equal(verifyBeat?.graph_fact_refs[0].fact_id, "FN-04");
    assert.equal(verifyBeat?.graph_fact_refs[0].reveals_answer, true);
    assert.ok(verifyBeat?.pacing.includes("bounded_wait"));
    assert.equal(verifyBeat?.completion_evidence.evidence_kind, "student_answer");
    assert.ok(verifyBeat?.completion_evidence.gate?.gate_id);
    assert.deepEqual(verifyBeat?.presentation_intent.workspace_surfaces, ["solution_board", "geometry"]);
    assert.equal(verifyBeat?.support_boundary.may_reveal_answer, false);
    assert.ok(verifyBeat?.transitions.length >= 1);
    assert.ok(verifyBeat?.inquiry_branch?.artifact_id === "PR-TST-002");
    // flags：goal gate 登记 + 支持阶梯
    assert.ok(preview.flags.answer_gate_beats.some((entry) => entry.includes("BT-04")));
    assert.equal(preview.flags.support_ladder.length, 2);
    const markdown = renderPlanV4PreviewMarkdown(preview);
    for (const keyword of ["教学目的", "解法图引用", "参与方式", "节奏", "Gate", "呈现意图", "支持边界", "合法转移", "探究分支"]) {
      assert.ok(markdown.includes(keyword), `preview markdown 缺 ${keyword}`);
    }
  });

  await runTest("approve keeps content_hash; Draft fails publication; reject → Disabled", () => {
    const build = freshBuild();
    assert.ok(build.ok);
    if (!build.ok) return;
    assert.ok(validateForPublication(build.plan).some((issue) => issue.code === "not_approved"));
    const approved = approveTutorPlanV4(build.plan, APPROVAL);
    assert.ok(approved.ok);
    if (approved.ok) {
      assert.equal(approved.artifact.content_hash, build.plan.content_hash, "approve 不改变 content_hash");
      assert.deepEqual(validateForPublication(approved.artifact), []);
    }
    const rejected = rejectPlanV4Artifacts({ plan: build.plan });
    assert.equal(rejected.plan?.status, "Disabled");
    assert.ok(validateForPublication(rejected.plan as unknown as Record<string, unknown>).some((issue) => issue.code === "not_approved"));
  });

  await runTest("importer resolves full chain from registry and materializes deterministically (G4)", () => {
    const root = buildSyntheticRoot();
    try {
      const first = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(first.ok, first.ok ? "" : first.errors.join(";"));
      if (!first.ok) return;
      assert.equal(first.imported.plan.schema, "ai_teaching_tutor_plan_bundle/v4");
      assert.equal(first.imported.graph.graph_id, "RG-TST-001");
      assert.deepEqual([...first.imported.protocols.keys()].sort(), ["PR-TST-001", "PR-TST-002"]);
      assert.ok(first.imported.projection.chunks[0].protocols.length === 2);
      assert.ok(first.imported.projection.action_contracts.length >= 1, "action_template 进入投影");
      assert.ok(first.imported.projection_hash.startsWith("sha256:"));
      // 确定性：重导入同 root 得到相同 projection_hash
      const second = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(second.ok);
      if (second.ok) assert.equal(second.imported.projection_hash, first.imported.projection_hash);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: beat referencing unknown graph fact fails closed", () => {
    const root = buildSyntheticRoot();
    try {
      mutateArtifact(root, "teaching-protocol", "PR-TST-001", (payload) => {
        (payload.beats as Array<Record<string, unknown>>)[3].graph_fact_refs = ["FN-99"];
      });
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(result.errors.some((error) => error.includes("引用不存在的 graph fact FN-99")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: transition to unknown beat fails closed (schema layer)", () => {
    const root = buildSyntheticRoot();
    try {
      mutateArtifact(root, "teaching-protocol", "PR-TST-001", (payload) => {
        const beats = payload.beats as Array<Record<string, unknown>>;
        (beats[0].transitions as Array<Record<string, unknown>>)[0].to_beat = "BT-99";
      });
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(result.errors.some((error) => error.includes("BT-99")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: gate on unknown fact / narration gating answer fact fails closed", () => {
    const root = buildSyntheticRoot();
    try {
      mutateArtifact(root, "teaching-protocol", "PR-TST-001", (payload) => {
        const beats = payload.beats as Array<Record<string, unknown>>;
        const gate = (beats[3].completion_evidence as Record<string, unknown>).gate as Record<string, unknown>;
        gate.graph_fact_id = "FN-77";
      });
      const badGate = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!badGate.ok);
      assert.ok(badGate.errors.some((error) => error.includes("gate") && error.includes("FN-77")));

      // 恢复合法 fact 引用后改证据类型：答案 fact 由 narration_completed 把关 → 拒绝
      mutateArtifact(root, "teaching-protocol", "PR-TST-001", (payload) => {
        const beats = payload.beats as Array<Record<string, unknown>>;
        const evidence = beats[3].completion_evidence as Record<string, unknown>;
        const gate = evidence.gate as Record<string, unknown>;
        gate.graph_fact_id = "FN-04";
        evidence.evidence_kind = "narration_completed";
      });
      const narrationGate = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!narrationGate.ok);
      assert.ok(narrationGate.errors.some((error) => error.includes("reveals_answer") && error.includes("学生证据")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: support/voice_seed leaking answer value fails closed (truth exposure)", () => {
    const root = buildSyntheticRoot();
    try {
      mutateArtifact(root, "tutor-plan", "TP-TST-001", (payload) => {
        const resources = payload.resources as Array<Record<string, unknown>>;
        const support = resources.find((resource) => resource.kind === "support");
        assert.ok(support);
        support.content = "直接写答案：7";
      });
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(result.errors.some((error) => error.includes("泄漏答案值")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: may_reveal_answer=true rejected by canonical schema", () => {
    const build = freshBuild();
    assert.ok(build.ok);
    if (!build.ok) return;
    const bad = JSON.parse(JSON.stringify(build.mainlineProtocol)) as Record<string, unknown>;
    const beats = bad.beats as Array<Record<string, unknown>>;
    const boundary = beats[0].support_boundary as Record<string, unknown>;
    boundary.may_reveal_answer = true;
    const validation = validatePayload(bad);
    assert.ok(!validation.ok);
    assert.ok(validation.errors.some((error) => error.includes("may_reveal_answer")));
  });

  await runTest("NEG: chunk referencing unknown resource fails closed", () => {
    const root = buildSyntheticRoot();
    try {
      mutateArtifact(root, "tutor-plan", "TP-TST-001", (payload) => {
        (payload.chunks as Array<Record<string, unknown>>)[0].resource_ids = ["RES999"];
      });
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(result.errors.some((error) => error.includes("RES999")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: beat resource outside bundle fails closed", () => {
    const root = buildSyntheticRoot();
    try {
      mutateArtifact(root, "teaching-protocol", "PR-TST-001", (payload) => {
        const beats = payload.beats as Array<Record<string, unknown>>;
        beats[0].resource_ids = ["RES1", "RES888"];
      });
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(result.errors.some((error) => error.includes("bundle 外资源 RES888")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: missing capability / unknown primitive fails closed", () => {
    const root = buildSyntheticRoot();
    try {
      mutateArtifact(root, "tutor-plan", "TP-TST-001", (payload) => {
        const resources = payload.resources as Array<Record<string, unknown>>;
        const template = resources.find((resource) => resource.kind === "action_template");
        assert.ok(template);
        const parsed = JSON.parse(template.content as string) as Record<string, unknown>;
        parsed.kind = "construct-perpendicular";
        template.content = JSON.stringify(parsed);
      });
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(result.errors.some((error) => error.includes("缺失 primitive") || error.includes("construct-perpendicular")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: stale RG upgrade fails closed (plan must be rebuilt)", () => {
    const root = buildSyntheticRoot();
    try {
      // RG 升版：v2 内容微调 → current_version 指 v2；TP 仍 pin v1
      const graphFile = path.join(root, "reviewed-solution-graph", "RG-TST-001", "v1.json");
      const graph = JSON.parse(require("node:fs").readFileSync(graphFile, "utf8")) as Record<string, unknown>;
      graph.version = "v2";
      (graph.facts as Array<Record<string, unknown>>)[0].statement = "等腰 △ABC（v2 修订），AB=AC，点 D 在底边 BC 上";
      graph.content_hash = canonicalHash(graph, "authoring");
      graph.artifact_uri = "artifact://reviewed-solution-graph/RG-TST-001@v2";
      writeFileSync(path.join(root, "reviewed-solution-graph", "RG-TST-001", "v2.json"), `${JSON.stringify(graph, null, 2)}\n`);
      const v1Hash = (JSON.parse(require("node:fs").readFileSync(graphFile, "utf8")) as { content_hash: string }).content_hash;
      writeFileSync(
        path.join(root, "reviewed-solution-graph", "RG-TST-001", "registry.yaml"),
        [
          "artifact_id: RG-TST-001",
          "current_version: v2",
          "versions:",
          `- {version: v1, status: Superseded, content_hash: ${v1Hash}}`,
          `- {version: v2, status: Approved, content_hash: ${graph.content_hash}}`,
          "",
        ].join("\n"),
      );
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(result.errors.some((error) => error.includes("stale") && error.includes("RG")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: tampering a published Approved version fails hash self-check (new version required)", () => {
    const root = buildSyntheticRoot();
    try {
      // 篡改已发布 TP 内容但不重算 hash（原地修改 → loader hash 漂移拒绝）
      mutateArtifact(
        root,
        "tutor-plan",
        "TP-TST-001",
        (payload) => {
          (payload.build_provenance as Record<string, unknown>).run_id = "tampered";
        },
        { keepDeclaredHash: true },
      );
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(result.errors.some((error) => error.includes("content_hash") && error.includes("不一致")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: Draft / non-Approved artifacts fail closed at loader", () => {
    const root = buildSyntheticRoot();
    try {
      mutateArtifact(root, "reviewed-solution-graph", "RG-TST-001", (payload) => {
        payload.status = "Draft";
        delete payload.approval;
      });
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(result.errors.some((error) => error.includes("只有 Approved 可消费")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: inquiry protocol not referenced by any chunk fails closed", () => {
    const root = buildSyntheticRoot();
    try {
      mutateArtifact(root, "tutor-plan", "TP-TST-001", (payload) => {
        const chunks = payload.chunks as Array<Record<string, unknown>>;
        (chunks[0].protocol_refs as Array<Record<string, unknown>>) = (chunks[0].protocol_refs as Array<Record<string, unknown>>)
          .filter((ref) => ref.artifact_id !== "PR-TST-002");
      });
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(
        result.errors.some((error) => error.includes("PR-TST-002")),
        `期望 scaffold 协议缺失报错，实际：${result.ok ? "" : result.errors.join("; ")}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // ------------------------------------------------------------------------- //
  // F4 复验修复（2026-08-29）新增负例：P1-1 schema 绕过 / P1-2 同版本覆盖与
  // 发布守卫 / P2 stale 全上游与 gate·capability 独立覆盖
  // ------------------------------------------------------------------------- //

  await runTest("NEG: schema-illegal but hash-consistent QT/AS/RG/PP fail closed at loader (P1-1)", () => {
    const attacks: Array<[string, string, (payload: Record<string, unknown>) => void]> = [
      ["question-truth", "QT-TST-001", (payload) => { payload.forbidden_extra_field = "schema additionalProperties:false 必须拒绝"; }],
      ["approach-set", "AS-TST-001", (payload) => { payload.forbidden_extra_field = "schema additionalProperties:false 必须拒绝"; }],
      ["reviewed-solution-graph", "RG-TST-001", (payload) => { payload.forbidden_extra_field = "schema additionalProperties:false 必须拒绝"; }],
      ["tutor-policy-profile", "PP-TST-001", (payload) => { payload.forbidden_extra_field = "schema additionalProperties:false 必须拒绝"; }],
    ];
    for (const [namespace, artifactId, mutate] of attacks) {
      const root = buildSyntheticRoot();
      try {
        // 重算 hash 且同步 registry 锚定（最强攻击：hash 三方全部自洽，
        // canonical schema 校验是唯一剩余防线）
        mutateArtifact(root, namespace, artifactId, mutate);
        const deps = { canonicalRoot: root, anchored: true };
        const result =
          namespace === "question-truth" ? loadApprovedTruth(deps, artifactId)
            : namespace === "approach-set" ? loadApprovedApproachSet(deps, artifactId)
              : namespace === "reviewed-solution-graph" ? loadApprovedSolutionGraph(deps, artifactId)
                : loadApprovedPolicyProfile(deps, artifactId);
        assert.ok(!result.ok, `${artifactId}: schema 非法+hash 自洽+锚定同步必须 fail closed`);
        assert.ok(
          result.ok ? false : result.errors.some((error) => error.includes("canonical schema 校验失败")),
          `${artifactId}: 期望 schema 校验错误，实际：${result.ok ? "ok" : result.errors.join("; ")}`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  await runTest("NEG: schema-illegal PP with full-chain reforge fails closed at importer (P1-1)", () => {
    const root = buildSyntheticRoot();
    try {
      mutateArtifact(root, "tutor-policy-profile", "PP-TST-001", (payload) => {
        payload.forbidden_extra_field = "schema additionalProperties:false 必须拒绝";
      });
      // 全链重锻：同步 TP.policy_profile_ref 的 hash 并重算 TP（stale 门通过，
      // schema 校验是唯一剩余防线）
      const pp = JSON.parse(
        require("node:fs").readFileSync(path.join(root, "tutor-policy-profile", "PP-TST-001", "v1.json"), "utf8"),
      ) as { content_hash: string };
      mutateArtifact(root, "tutor-plan", "TP-TST-001", (payload) => {
        (payload.policy_profile_ref as Record<string, unknown>).content_hash = pp.content_hash;
      });
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(
        result.ok ? false : result.errors.some((error) => error.includes("canonical schema 校验失败") && error.includes("PP-TST-001")),
        `期望 PP schema 拒绝，实际：${result.ok ? "ok" : result.errors.join("; ")}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: same-version overwrite with recomputed hash fails registry anchor check (P1-2)", () => {
    const root = buildSyntheticRoot();
    try {
      // PP 内容篡改 + 重算自身 hash（payload 自洽）但 registry 锚定不动
      mutateArtifact(
        root,
        "tutor-policy-profile",
        "PP-TST-001",
        (payload) => { payload.model_id = "tampered-model"; },
        { keepRegistryAnchor: true },
      );
      const pp = JSON.parse(
        require("node:fs").readFileSync(path.join(root, "tutor-policy-profile", "PP-TST-001", "v1.json"), "utf8"),
      ) as { content_hash: string };
      // 全链重锻（TP ref 同步 + TP 重算 + TP 锚定同步）：锚定对账是唯一剩余防线
      mutateArtifact(root, "tutor-plan", "TP-TST-001", (payload) => {
        (payload.policy_profile_ref as Record<string, unknown>).content_hash = pp.content_hash;
      });
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(
        result.ok ? false : result.errors.some((error) => error.includes("registry 锚定 hash 与版本文件不一致") && error.includes("PP-TST-001")),
        `期望 PP 锚定对账拒绝，实际：${result.ok ? "ok" : result.errors.join("; ")}`,
      );
      // loader 直查同口径：RG 同版本覆盖（schema 仍合法、hash 自洽、锚定未动）
      mutateArtifact(
        root,
        "reviewed-solution-graph",
        "RG-TST-001",
        (payload) => {
          (payload.facts as Array<Record<string, unknown>>)[3].statement = "目标线段 = 9（同版本改答案）";
        },
        { keepRegistryAnchor: true },
      );
      const graph = loadApprovedSolutionGraph({ canonicalRoot: root, anchored: true }, "RG-TST-001");
      assert.ok(!graph.ok);
      assert.ok(graph.ok ? false : graph.errors.some((error) => error.includes("registry 锚定 hash 与版本文件不一致")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("NEG: stale QT / AS / PP / PR upgrades fail closed (plan must be rebuilt)", () => {
    /** 上游升版：v1 → v2（内容微调），registry current 指 v2（锚定同步）。 */
    const upgrade = (root: string, namespace: string, artifactId: string, mutate: (payload: Record<string, unknown>) => void): void => {
      const dir = path.join(root, namespace, artifactId);
      const v1 = JSON.parse(require("node:fs").readFileSync(path.join(dir, "v1.json"), "utf8")) as Record<string, unknown>;
      const v1Hash = v1.content_hash as string;
      const v2 = JSON.parse(JSON.stringify(v1)) as Record<string, unknown>;
      mutate(v2);
      v2.version = "v2";
      v2.content_hash = canonicalHash(v2, namespace === "tutor-plan" ? "plan" : "authoring");
      const idField = Object.hasOwn(v2, "artifact_id") ? "artifact_id" : Object.hasOwn(v2, "graph_id") ? "graph_id" : "protocol_id";
      v2.artifact_uri = `artifact://${namespace}/${v2[idField]}@v2`;
      writeFileSync(path.join(dir, "v2.json"), `${JSON.stringify(v2, null, 2)}\n`);
      writeFileSync(
        path.join(dir, "registry.yaml"),
        [
          `artifact_id: ${artifactId}`,
          "current_version: v2",
          "versions:",
          `- {version: v1, status: Superseded, content_hash: ${v1Hash}}`,
          `- {version: v2, status: Approved, content_hash: ${v2.content_hash}}`,
          "",
        ].join("\n"),
      );
    };
    const upgrades: Array<[string, string, string, (payload: Record<string, unknown>) => void, (error: string) => boolean]> = [
      ["question-truth", "QT-TST-001", "stale QT", (payload) => { payload.stem = "等腰三角形顶角已知（v2 修订题面）。"; }, (error) => error.includes("stale") && error.includes("QT")],
      ["approach-set", "AS-TST-001", "stale AS", (payload) => { (payload.parts as Array<Record<string, unknown>>)[0].note = "v2 修订"; }, (error) => error.includes("stale") && error.includes("approach_set_ref")],
      ["tutor-policy-profile", "PP-TST-001", "stale PP", (payload) => { payload.prompt_version = "TST@v2"; }, (error) => error.includes("stale") && error.includes("policy_profile_ref")],
      ["teaching-protocol", "PR-TST-001", "stale PR", (payload) => {
        ((payload.beats as Array<Record<string, unknown>>)[0]).purpose = "定向（v2 修订）";
      }, (error) => error.includes("stale") && error.includes("PR-TST-001")],
    ];
    for (const [namespace, artifactId, label, mutate, match] of upgrades) {
      const root = buildSyntheticRoot();
      try {
        upgrade(root, namespace, artifactId, mutate);
        const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
        assert.ok(!result.ok, `${label}: 上游升版后 plan 必须重建（fail closed）`);
        assert.ok(
          result.ok ? false : result.errors.some(match),
          `${label}: 期望 stale 报错，实际：${result.ok ? "ok" : result.errors.join("; ")}`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  await runTest("NEG: reveals_answer fact without student-evidence gate fails closed (gate removed/retargeted)", () => {
    const root = buildSyntheticRoot();
    try {
      // 1) 删除 BT-04 的答案 gate（证据仍写 student_answer）：canonical schema 层
      //    即拒绝（evidence_kind=student_answer requires gate）
      mutateArtifact(root, "teaching-protocol", "PR-TST-001", (payload) => {
        const beats = payload.beats as Array<Record<string, unknown>>;
        delete (beats[3].completion_evidence as Record<string, unknown>).gate;
      });
      const removed = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!removed.ok);
      assert.ok(
        removed.ok ? false : removed.errors.some((error) => error.includes("requires gate")),
        `期望 schema 层 requires gate 拒绝，实际：${removed.ok ? "ok" : removed.errors.join("; ")}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    const root2 = buildSyntheticRoot();
    try {
      // 2) gate 保留但改指非答案 fact（FN-03）：schema 通过，答案 fact FN-04
      //    失去 gate 把关 → materializer 层拒绝（reveals_answer 必须被学生证据
      //    gate 把关，不能靠改 gate 指向绕过答案守门）
      mutateArtifact(root2, "teaching-protocol", "PR-TST-001", (payload) => {
        const beats = payload.beats as Array<Record<string, unknown>>;
        ((beats[3].completion_evidence as Record<string, unknown>).gate as Record<string, unknown>).graph_fact_id = "FN-03";
      });
      const retargeted = importApprovedPlanV4({ canonicalRoot: root2 }, "TP-TST-001");
      assert.ok(!retargeted.ok);
      assert.ok(
        retargeted.ok ? false : retargeted.errors.some((error) => error.includes("没有任何学生证据 gate 把关") && error.includes("FN-04")),
        `期望 reveals_answer 无 gate 把关报错，实际：${retargeted.ok ? "ok" : retargeted.errors.join("; ")}`,
      );
    } finally {
      rmSync(root2, { recursive: true, force: true });
    }
  });

  await runTest("NEG: known primitive carrying unknown capability fails closed", () => {
    const root = buildSyntheticRoot();
    try {
      mutateArtifact(root, "tutor-plan", "TP-TST-001", (payload) => {
        const resources = payload.resources as Array<Record<string, unknown>>;
        const template = resources.find((resource) => resource.kind === "action_template");
        assert.ok(template);
        const parsed = JSON.parse(template.content as string) as Record<string, unknown>;
        // primitive（kind=enter-text）在 registry 内，但携带未登记 capability
        parsed.capabilities = [...((parsed.capabilities as string[]) ?? []), "similarity.nonexistent-capability"];
        template.content = JSON.stringify(parsed);
      });
      const result = importApprovedPlanV4({ canonicalRoot: root }, "TP-TST-001");
      assert.ok(!result.ok);
      assert.ok(
        result.ok ? false : result.errors.some((error) => error.includes("非法 capability") && error.includes("similarity.nonexistent-capability")),
        `期望非法 capability 报错，实际：${result.ok ? "ok" : result.errors.join("; ")}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("publisher guard: same-version republication rejected (incl. dry-run); registry anchors each version (P1-2)", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "plan-v4-pubguard-"));
    try {
      const build = freshBuild();
      assert.ok(build.ok);
      if (!build.ok) return;
      const approved = approveTutorPlanV4(build.plan, APPROVAL);
      assert.ok(approved.ok);
      if (!approved.ok) return;

      // 首次发布成功：版本文件 + 锚定 registry 写入
      const first = publishApprovedPlanV4(root, "tutor-plan", approved.artifact as unknown as Parameters<typeof publishApprovedPlanV4>[2]);
      assert.ok(first.ok && first.wrote, first.ok ? "" : first.errors.join(";"));
      const registryText = readFileSync(path.join(root, "tutor-plan", "TP-TST-001", "registry.yaml"), "utf8");
      assert.ok(registryText.includes(`content_hash: ${approved.artifact.content_hash}`), "registry 必须锚定 content_hash");
      assert.ok(registryText.includes("current_version: v1"));

      // 同版本重发布（真实发布路径第二次调用）→ 拒绝
      const second = publishApprovedPlanV4(root, "tutor-plan", approved.artifact as unknown as Parameters<typeof publishApprovedPlanV4>[2]);
      assert.ok(!second.ok);
      assert.ok(
        second.ok ? false : second.errors.some((error) => error.includes("已存在") && error.includes("不可覆盖")),
        `期望不可覆盖守卫，实际：${second.ok ? "ok" : second.errors.join("; ")}`,
      );
      // dry-run 同样执行守卫（重发布探测必须先于任何写盘）
      const drySecond = publishApprovedPlanV4(root, "tutor-plan", approved.artifact as unknown as Parameters<typeof publishApprovedPlanV4>[2], { dryRun: true });
      assert.ok(!drySecond.ok);
      assert.ok(drySecond.errors.some((error) => error.includes("已存在")));

      // 非 Approved / hash 不自洽 → 写前校验拒绝
      const draft = JSON.parse(JSON.stringify(build.plan)) as Record<string, unknown>;
      const draftResult = publishApprovedPlanV4(root, "tutor-plan", draft as unknown as Parameters<typeof publishApprovedPlanV4>[2]);
      assert.ok(!draftResult.ok);
      assert.ok(draftResult.errors.some((error) => error.includes("Approved")));

      // 新 version（v2）允许发布：registry 合并，v1 标 Superseded，current=v2
      const v2 = JSON.parse(JSON.stringify(approved.artifact)) as Record<string, unknown> & { version: string; artifact_uri: string; content_hash: string };
      v2.version = "v2";
      v2.artifact_uri = "artifact://tutor-plan/TP-TST-001@v2";
      v2.content_hash = canonicalHash(v2, "plan");
      const upgraded = publishApprovedPlanV4(root, "tutor-plan", v2 as unknown as Parameters<typeof publishApprovedPlanV4>[2]);
      assert.ok(upgraded.ok, upgraded.ok ? "" : upgraded.errors.join(";"));
      const merged = readFileSync(path.join(root, "tutor-plan", "TP-TST-001", "registry.yaml"), "utf8");
      assert.ok(merged.includes("current_version: v2"));
      assert.ok(merged.includes("status: Superseded"));
      assert.ok(merged.includes(`content_hash: ${v2.content_hash}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("loader cross-checks: truth/AS/PP resolution against fixed refs", () => {
    const root = buildSyntheticRoot();
    try {
      assert.ok(loadApprovedTruth({ canonicalRoot: root }, "QT-TST-001").ok);
      assert.ok(findApproachSetForQuestion({ canonicalRoot: root }, "QT-TST-001"));
      assert.ok(loadApprovedApproach({ canonicalRoot: root }, "TA-TST-001").ok);
      assert.ok(loadApprovedPolicyProfile({ canonicalRoot: root }, "PP-TST-001").ok);
      const missing = loadApprovedTruth({ canonicalRoot: root }, "QT-TST-404");
      assert.ok(!missing.ok);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("projection is sensitive to plan/protocol content (registry-independent hash inputs)", () => {
    const build = freshBuild();
    assert.ok(build.ok);
    if (!build.ok) return;
    const graphApproved = approveReviewedSolutionGraph(syntheticGraph, APPROVAL);
    assert.ok(graphApproved.ok);
    const inputs = {
      truth: syntheticTruth,
      approachSet: syntheticApproachSet,
      graph: graphApproved.ok ? graphApproved.artifact : syntheticGraph,
      protocols: new Map([
        [build.mainlineProtocol.protocol_id, build.mainlineProtocol],
        [build.scaffoldProtocol.protocol_id, build.scaffoldProtocol],
      ]),
      profile: syntheticProfile,
      snapshot,
    };
    const first = projectApprovedPlanV4(build.plan, inputs);
    const tamperedProtocol = JSON.parse(JSON.stringify(build.mainlineProtocol)) as typeof build.mainlineProtocol;
    tamperedProtocol.beats[2].purpose = "被改写的教学目的";
    tamperedProtocol.content_hash = canonicalHash(tamperedProtocol as unknown as Record<string, unknown>, "authoring");
    const tamperedPlan = JSON.parse(JSON.stringify(build.plan)) as typeof build.plan;
    for (const chunk of tamperedPlan.chunks) {
      for (const ref of chunk.protocol_refs) {
        if (ref.artifact_id === tamperedProtocol.protocol_id) ref.content_hash = tamperedProtocol.content_hash;
      }
    }
    tamperedPlan.content_hash = canonicalHash(tamperedPlan as unknown as Record<string, unknown>, "plan");
    const second = projectApprovedPlanV4(tamperedPlan, {
      ...inputs,
      protocols: new Map([
        [tamperedProtocol.protocol_id, tamperedProtocol],
        [build.scaffoldProtocol.protocol_id, build.scaffoldProtocol],
      ]),
    });
    assert.notEqual(second.projection_hash, first.projection_hash, "protocol 内容变化必须改变 projection hash");
    const materialized = materializeTutorPlanV4(build.plan, inputs, { requireApproved: false });
    assert.ok(materialized.ok, materialized.ok ? "" : materialized.errors.join(";"));
  });
}

function freshBuildInputsWithGraph(graph: import("../canonicalInputs").ReviewedSolutionGraphPayload) {
  return {
    planId: "TP-TST-001",
    runId: "run-tst-v4",
    builtAt: "2026-08-28T00:00:00Z",
    truth: syntheticTruth,
    approach: syntheticApproach,
    approachSet: syntheticApproachSet,
    graph,
    profile: syntheticProfile,
    snapshot,
    protocolIds: { mainline: "PR-TST-001", scaffold: "PR-TST-002" } as const,
    capabilityPath: ["mark-segment-values", "enter-text"] as const,
  };
}

void (async () => {
  await main();
  console.log("PASS planBuildV4 (all)");
})().catch((error) => {
  console.error("FAIL planBuildV4", error);
  throw error;
});
