/**
 * Phase 5 UI 集成波次 D：golden canonical root 构建脚本（测试环境）。
 *
 * 用六个 Golden v3 Plan（skills 仓 canonical-authoring 的 current Approved：
 * TP-SMV-001..006@v3/v4，schema ai_teaching_tutor_plan_bundle/v3）构建 e2e
 * 浏览器矩阵（/learn/:taskId 驱动）所需的 canonical root：
 *
 * - 复制 canonical root 全量（registry/hash 校验链原样可用）；
 * - 注入 6 个 **测试环境 Approved 副本** Binding（TB-GOLDEN-00N）——
 *   canonical 建议清单仍是 Draft/待教师审核（PRDS
 *   migration/manifests/golden-topic-binding-suggestions.yaml），测试 root
 *   是建议的 e2e 投影（登记选择：「Approved 副本」而非注入路径）；
 *   reviewer=e2e-golden，注记待审状态；
 * - 六题均无内容匹配的正式 Scenario（题源为一模真题卷）→ scenario_id 用
 *   SC-GOLDEN 标签；task 映射按教学结构亲和建议（同建议清单）。
 *
 * 用法：tsx scripts/build-tutor-golden-root.ts <outDir> [--source-root <canonical-authoring>] [--suggestions-out <yaml>]
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { validateForPublication, validatePayload } from "../../shared/canonical";
import {
  canonicalHash,
  findApproachSetForQuestion,
  loadApprovedTruth,
  loadCurrentPlanV3,
} from "../src/services/planBuild/canonicalInputs";

/** task → golden question 映射（与 PRDS golden-topic-binding-suggestions.yaml 同源）。 */
export const GOLDEN_TASKS: Array<{
  taskId: string;
  scenarioId: string;
  qtId: string;
  tpId: string;
  affinity: string;
}> = [
  { taskId: "parallelLineRatios", scenarioId: "SC-GOLDEN-001", qtId: "QT-SMV-001", tpId: "TP-SMV-001", affinity: "golden 清单 near-transfer 指名（平行线比例迁移结构）" },
  { taskId: "butterflySimilarity", scenarioId: "SC-GOLDEN-002", qtId: "QT-SMV-002", tpId: "TP-SMV-002", affinity: "8 字交叉结构 = 蝶形（manifest 选型依据原文）" },
  { taskId: "nestedSimilarity", scenarioId: "SC-GOLDEN-003", qtId: "QT-SMV-003", tpId: "TP-SMV-003", affinity: "母子型/共边相似（nestedSimilarity 子母型）" },
  { taskId: "reverseASimilarity", scenarioId: "SC-GOLDEN-004", qtId: "QT-SMV-004", tpId: "TP-SMV-004", affinity: "A 字型应用 ↔ 反 A 结构族" },
  { taskId: "auxiliaryTwoRatios", scenarioId: "SC-GOLDEN-005", qtId: "QT-SMV-005", tpId: "TP-SMV-005", affinity: "角平分线/共角比例转移与比例辅助线同族" },
  { taskId: "reverseAFourSimilarity", scenarioId: "SC-GOLDEN-006", qtId: "QT-SMV-006", tpId: "TP-SMV-006", affinity: "综合压轴一图多相似（教学编排同构）" },
];

interface CliArgs {
  outDir: string;
  sourceRoot: string;
  suggestionsOut: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { outDir: "", sourceRoot: "", suggestionsOut: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--source-root":
        args.sourceRoot = argv[++index];
        break;
      case "--suggestions-out":
        args.suggestionsOut = argv[++index];
        break;
      default:
        if (!args.outDir && !arg.startsWith("--")) args.outDir = arg;
        else throw new Error(`未知参数: ${arg}`);
    }
  }
  if (!args.outDir) throw new Error("usage: tsx scripts/build-tutor-golden-root.ts <outDir> [--source-root <dir>] [--suggestions-out <yaml>]");
  if (!args.sourceRoot) {
    throw new Error("--source-root 必填（skills 仓 artifacts/canonical-authoring）");
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.outDir, { recursive: true });
  cpSync(args.sourceRoot, args.outDir, { recursive: true });

  const inputs = { canonicalRoot: args.sourceRoot };
  const suggestionEntries: string[] = [];

  for (const [index, spec] of GOLDEN_TASKS.entries()) {
    const truth = loadApprovedTruth(inputs, spec.qtId);
    if (!truth.ok) throw new Error(`${spec.qtId}: ${truth.errors.join("; ")}`);
    const plan = loadCurrentPlanV3(inputs, spec.tpId);
    if (!plan.ok) throw new Error(`${spec.tpId}: ${plan.errors.join("; ")}`);
    const approachSet = findApproachSetForQuestion(inputs, spec.qtId);
    if (!approachSet) throw new Error(`${spec.qtId}: 无 Approved ApproachSet`);

    const variants = [
      {
        approach_set_ref: {
          artifact_id: approachSet.artifact_id,
          version: approachSet.version,
          content_hash: approachSet.content_hash,
        },
        tutor_plan_ref: {
          artifact_id: plan.payload.artifact_id,
          version: plan.payload.version,
          content_hash: plan.payload.content_hash,
        },
        role: "default" as const,
      },
    ];
    const bindingId = `TB-GOLDEN-${String(index + 1).padStart(3, "0")}`;
    const binding: Record<string, unknown> = {
      schema: "ai_teaching_topic_question_binding/v1",
      artifact_id: bindingId,
      version: "v1",
      status: "Approved",
      task_id: spec.taskId,
      scenario_id: spec.scenarioId,
      question_ref: {
        artifact_id: truth.payload.artifact_id,
        version: truth.payload.version,
        content_hash: truth.payload.content_hash,
      },
      teaching_variants: variants,
      approval: {
        reviewer_id: "e2e-golden",
        approved_at: "2026-08-23T00:00:00Z",
        review_note: "测试环境 Approved 副本（Phase 5 UI 集成波次 D golden root）：canonical 建议仍为 Draft/待教师审核，未审核不开放学生流量",
      },
      content_hash: "",
      artifact_uri: `artifact://topic-question-binding/${bindingId}@v1`,
    };
    binding.content_hash = canonicalHash(binding, "authoring");
    const schema = validatePayload(binding);
    if (!schema.ok) throw new Error(`${bindingId}: ${schema.errors.join("; ")}`);
    const publication = validateForPublication(binding);
    if (publication.length) {
      throw new Error(`${bindingId}: ${publication.map((issue) => `${issue.code}(${issue.detail})`).join("; ")}`);
    }
    const dir = path.join(args.outDir, "topic-question-binding", bindingId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "v1.json"), `${JSON.stringify(binding, null, 2)}\n`);
    writeFileSync(
      path.join(dir, "registry.yaml"),
      [
        "artifact_id: " + bindingId,
        "current_version: v1",
        "versions:",
        "- {version: v1, status: Approved}",
        "",
      ].join("\n"),
    );
    console.log(`BINDING ${bindingId}: ${spec.taskId} → ${spec.qtId} / ${approachSet.artifact_id}@${approachSet.version} / ${spec.tpId}@${plan.payload.version}`);

    suggestionEntries.push(
      [
        `  - question_ref: {artifact_id: ${truth.payload.artifact_id}, version: ${truth.payload.version}, content_hash: ${truth.payload.content_hash}}`,
        `    propose_task: ${spec.taskId}`,
        `    structure_affinity: ${spec.affinity}`,
        `    scenario_gap: 缺正式 Scenario 记录（题源为一模真题卷，产品题库为合成教学场景）——正式绑定须先走原题库导入流程创建记录，不得强行绑定内容不同的旧 Scenario`,
        `    default_variant:`,
        `      approach_set_ref: {artifact_id: ${approachSet.artifact_id}, version: ${approachSet.version}, content_hash: ${approachSet.content_hash}}`,
        `      tutor_plan_ref: {artifact_id: ${plan.payload.artifact_id}, version: ${plan.payload.version}, content_hash: ${plan.payload.content_hash}}`,
        `      policy_profile_ref: {profile_id: ${plan.payload.policy_profile_ref.profile_id}, version: ${plan.payload.policy_profile_ref.version}, content_hash: ${plan.payload.policy_profile_ref.content_hash}}`,
        `    alternate_variants: []   # 缺口：六题均无第二套 Approved ApproachSet；是否增补属教师裁定`,
      ].join("\n"),
    );
  }

  if (args.suggestionsOut) {
    const doc = [
      "# Phase 5 UI 集成波次 D：Golden TopicQuestionTeachingBinding 建议清单（Draft / 待教师审核）",
      "#",
      "# 状态：建议（Draft）——未教师批准不开放学生流量（/experience 只读 Approved Binding，",
      "# fail-closed 已有测试覆盖）。本清单由 backend/scripts/build-tutor-golden-root.ts 生成",
      "# （hash 与 canonical current Approved 对账）；测试环境 Approved 副本（TB-GOLDEN-*）",
      "# 仅存在于 e2e golden root，不属正式发布。",
      "schema: ai_teaching_topic_question_binding_suggestions/v1",
      "generated_at: '2026-08-23'",
      "review_status: Draft（待教师审核）",
      "bindings:",
      suggestionEntries.join("\n"),
      "",
    ].join("\n");
    writeFileSync(args.suggestionsOut, doc);
    console.log(`SUGGESTIONS → ${args.suggestionsOut}`);
  }
  process.stdout.write(`${args.outDir}\n`);
}

main();
