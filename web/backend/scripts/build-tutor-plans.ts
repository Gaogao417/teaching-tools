/**
 * build-tutor-plans CLI（Phase 4 / P4-07 发布管线入口）。
 *
 * 用法（在 web/backend 下）：
 *   tsx scripts/build-tutor-plans.ts \
 *     --canonical-root /abs/teaching-skills-mvp/artifacts/canonical-authoring \
 *     --questions golden8            # 或逗号分隔 QT id 列表
 *     --approve golden6              # 只批准 golden 6；省略则仅 build+preview
 *     --reviewer reviewer-001 --note "..." [--run-id ...] [--force] [--dry-run]
 *
 * 产物（写入 canonical root）：
 *   tutor-plan/drafts/<TP>.draft.json       Draft 工作副本
 *   tutor-plan/previews/<TP>@v1.md          教师预览（approve 的审核依据）
 *   tutor-plan/<TP>/v1.json + registry.yaml 批准后的不可变 canonical 版本
 *   id-allocations.yaml 追加 tp_next_seq/tp_allocations（幂等）
 *
 * 幂等：已存在的 canonical TP 默认跳过（--force 才重建；Approved 版本本就
 * 不可覆盖，--force 只会因 id 已占用而拒绝，防止误覆盖）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import {
  approvedApproachesForQuestion,
  findApproachSetForQuestion,
  loadApprovedApproach,
  loadApprovedTruth,
  type CanonicalRegistries,
} from "../src/services/planBuild/canonicalInputs";
import { buildTutorPlanDraft } from "../src/services/planBuild/BuildTutorPlan";
import { approveTutorPlan, buildPlanPreview, renderPreviewMarkdown } from "../src/services/planBuild/ReviewTutorPlan";
import {
  MATERIALIZER_VERSION,
  materializeTutorPlan,
  projectApprovedPlan,
  validateApprovedPlan,
} from "../src/services/planBuild/MaterializeTutorPlan";
import { buildRuntimeRegistrySnapshot } from "../src/services/planBuild/RuntimeRegistrySnapshot";

const GOLDEN_QT_IDS = [
  "QT-SMV-001",
  "QT-SMV-002",
  "QT-SMV-003",
  "QT-SMV-004",
  "QT-SMV-005",
  "QT-SMV-006",
] as const;

/** Phase 3 补充 dogfood 题（Draft-only，不批准发布）。 */
const SUPPLEMENTARY_QT_IDS = ["QT-SMV-013", "QT-SMV-048"] as const;

/** capability-skill-map.yaml question_capability_paths 的 vendored 摘要（词汇均来自代码 registry）。 */
const CAPABILITY_PATHS: Record<string, string[]> = {
  "QT-SMV-001": ["select-option", "mark-segment-values", "enter-equation", "enter-text"],
  "QT-SMV-002": ["select-option", "select-option", "convert-collinear", "enter-equation", "enter-text"],
  "QT-SMV-003": ["select-option", "convert-collinear", "enter-equation", "select-option", "enter-text"],
  "QT-SMV-004": ["mark-segment-values", "ratio-scratch", "enter-equation", "enter-text"],
  "QT-SMV-005": ["select-option", "pair-segments", "enter-text", "enter-equation"],
  "QT-SMV-006": ["select-option", "mark-segment-values", "select-option", "enter-equation", "enter-text"],
  "QT-SMV-013": ["enter-equation", "enter-text"],
  "QT-SMV-048": ["select-option", "enter-equation", "enter-text"],
};

interface CliArgs {
  canonicalRoot: string;
  questions: string[];
  approve: string[];
  reviewer: string;
  note: string;
  runId: string;
  force: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    canonicalRoot: "",
    questions: [],
    approve: [],
    reviewer: "",
    note: "",
    runId: `plan-build-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    force: false,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--canonical-root":
        args.canonicalRoot = argv[++index];
        break;
      case "--questions":
      case "--approve": {
        const value = argv[++index];
        const list =
          value === "golden8"
            ? [...GOLDEN_QT_IDS, ...SUPPLEMENTARY_QT_IDS]
            : value === "golden6"
              ? [...GOLDEN_QT_IDS]
              : value.split(",").map((item) => item.trim()).filter(Boolean);
        if (arg === "--questions") args.questions = list;
        else args.approve = list;
        break;
      }
      case "--reviewer":
        args.reviewer = argv[++index];
        break;
      case "--note":
        args.note = argv[++index];
        break;
      case "--run-id":
        args.runId = argv[++index];
        break;
      case "--force":
        args.force = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }
  if (!args.canonicalRoot) throw new Error("--canonical-root 必填");
  if (!args.questions.length) args.questions = [...GOLDEN_QT_IDS, ...SUPPLEMENTARY_QT_IDS];
  if (args.approve.length && !args.reviewer) throw new Error("--approve 需要 --reviewer");
  return args;
}

/** 从 id-allocations 读下一个可用 TP 序号；不存在 TP 段则从 1 开始。 */
function nextTpSeq(canonicalRoot: string): number {
  const ledger = readFileSync(path.join(canonicalRoot, "id-allocations.yaml"), "utf8");
  const match = /tp_next_seq:\s*(\d+)/.exec(ledger);
  return match ? Number(match[1]) : 1;
}

function allocatedTpFor(ledgerText: string, qtId: string): string | null {
  const pattern = new RegExp(`tp_id: (TP-[A-Z0-9]+-\\d+)\\s*\\n(?:[^]*?)qt_id: ${qtId}`, "m");
  const match = pattern.exec(ledgerText);
  return match ? match[1] : null;
}

function appendTpAllocations(canonicalRoot: string, allocations: Array<{ qtId: string; tpId: string }>): void {
  const ledgerPath = path.join(canonicalRoot, "id-allocations.yaml");
  const ledger = readFileSync(ledgerPath, "utf8");
  const existing = ledger.includes("tp_next_seq:");
  const nextSeq = Math.max(
    nextTpSeq(canonicalRoot),
    ...allocations.map(({ tpId }) => Number(tpId.split("-").pop()) + 1),
  );
  const lines: string[] = [];
  if (!existing) {
    lines.push(`tp_next_seq: ${nextSeq}`);
    lines.push("tp_allocations:");
  }
  const seen = new Set<string>();
  for (const { qtId, tpId } of allocations) {
    if (ledger.includes(`tp_id: ${tpId}`) || seen.has(tpId)) continue;
    seen.add(tpId);
    lines.push(`- qt_id: ${qtId}`);
    lines.push(`  tp_id: ${tpId}`);
    lines.push(`  allocated_at: '${new Date().toISOString()}'`);
  }
  if (lines.length) {
    writeFileSync(ledgerPath, `${ledger.trimEnd()}\n${lines.join("\n")}\n`);
  } else if (!existing) {
    writeFileSync(ledgerPath, ledger);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const registries: CanonicalRegistries = { canonicalRoot: args.canonicalRoot };
  const snapshot = buildRuntimeRegistrySnapshot();
  const tutorPlanRoot = path.join(args.canonicalRoot, "tutor-plan");
  if (!args.dryRun) {
    mkdirSync(path.join(tutorPlanRoot, "drafts"), { recursive: true });
    mkdirSync(path.join(tutorPlanRoot, "previews"), { recursive: true });
  }
  const ledgerText = readFileSync(path.join(args.canonicalRoot, "id-allocations.yaml"), "utf8");
  let tpSeq = nextTpSeq(args.canonicalRoot);
  const newAllocations: Array<{ qtId: string; tpId: string }> = [];

  console.log(`runtime registry: ${snapshot.runtime_registry_version}`);
  console.log(`materializer: ${MATERIALIZER_VERSION}`);

  for (const qtId of args.questions) {
    const truth = loadApprovedTruth(registries, qtId);
    if (!truth.ok) {
      console.error(`FAIL ${qtId}: ${truth.errors.join("; ")}`);
      process.exitCode = 1;
      continue;
    }
    const existingTp = allocatedTpFor(ledgerText, qtId);
    const planId = existingTp ?? `TP-SMV-${String(tpSeq).padStart(3, "0")}`;
    const canonicalVersion = path.join(tutorPlanRoot, planId, "v1.json");
    if (existingTp && existsSync(canonicalVersion) && !args.force) {
      console.log(`SKIP ${qtId}: ${planId} 已发布（v1.json 在案，Approved 不可覆盖）`);
      continue;
    }
    if (!existingTp) tpSeq += 1;

    const approaches = approvedApproachesForQuestion(registries, qtId);
    const approachSet = findApproachSetForQuestion(registries, qtId);
    const build = buildTutorPlanDraft({
      planId,
      runId: args.runId,
      builtAt: new Date().toISOString(),
      truth: truth.payload,
      approachSet,
      approaches,
      snapshot,
      capabilityPath: CAPABILITY_PATHS[qtId],
    });
    if (!build.ok) {
      console.error(`FAIL ${qtId} build: ${build.errors.join("; ")}`);
      process.exitCode = 1;
      continue;
    }

    const approachesById = new Map(approaches.map((approach) => [approach.artifact_id, approach]));
    const materializationInputs = {
      truth: truth.payload,
      approaches: approachesById,
      snapshot,
    };
    const draftCheck = validateApprovedPlan(build.plan, materializationInputs, { requireApproved: false });
    if (!draftCheck.ok) {
      console.error(`FAIL ${qtId} draft validation: ${draftCheck.errors.join("; ")}`);
      process.exitCode = 1;
      continue;
    }

    const preview = buildPlanPreview(build.plan, {
      truth: truth.payload,
      pendingCapabilityBindings: build.pendingCapabilityBindings,
      sanitizedHints: build.sanitizedHints,
    });
    if (!args.dryRun) {
      writeFileSync(
        path.join(tutorPlanRoot, "drafts", `${planId}.draft.json`),
        `${JSON.stringify(build.plan, null, 2)}\n`,
      );
      writeFileSync(path.join(tutorPlanRoot, "previews", `${planId}@v1.md`), renderPreviewMarkdown(preview));
      if (!existingTp) newAllocations.push({ qtId, tpId: planId });
    }
    console.log(
      `DRAFT ${qtId} → ${planId}: ${build.plan.checkpoints.length} checkpoints / ` +
        `${build.plan.resources.length} resources / ${build.plan.recommended_routes.length} routes` +
        `${build.sanitizedHints.length ? `（泄漏自查降级 ${build.sanitizedHints.length}）` : ""}`,
    );

    if (!args.approve.includes(qtId)) continue;

    const { projection_hash } = projectApprovedPlan(build.plan, materializationInputs);
    const approval = approveTutorPlan(build.plan, {
      reviewer_id: args.reviewer,
      approved_at: new Date().toISOString(),
      review_note: args.note || `路线/提示/Action 来源经预览审核（${preview.flags.annotation_count} 个 skill 标注）`,
      runtime_projection: {
        materializer_version: MATERIALIZER_VERSION,
        runtime_registry_version: snapshot.runtime_registry_version,
        projection_hash,
        validation_status: "passed",
      },
    });
    if (!approval.ok) {
      console.error(`FAIL ${qtId} approve: ${approval.errors.join("; ")}`);
      process.exitCode = 1;
      continue;
    }
    const finalMaterialize = materializeTutorPlan(approval.plan, materializationInputs);
    if (!finalMaterialize.ok) {
      console.error(`FAIL ${qtId} materialize: ${finalMaterialize.errors.join("; ")}`);
      process.exitCode = 1;
      continue;
    }
    if (!args.dryRun) {
      mkdirSync(path.join(tutorPlanRoot, planId), { recursive: true });
      writeFileSync(
        canonicalVersion,
        `${JSON.stringify(finalMaterialize.plan, null, 2)}\n`,
      );
      writeFileSync(
        path.join(tutorPlanRoot, planId, "registry.yaml"),
        [
          `artifact_id: ${planId}`,
          "current_version: v1",
          "versions:",
          "- version: v1",
          "  status: Approved",
          `  content_hash: ${finalMaterialize.plan.content_hash}`,
          `  approved_at: '${finalMaterialize.plan.approval?.approved_at ?? ""}'`,
          "  question_ref:",
          `    artifact_id: ${finalMaterialize.plan.question_ref.artifact_id}`,
          `    version: ${finalMaterialize.plan.question_ref.version}`,
          `    content_hash: ${finalMaterialize.plan.question_ref.content_hash}`,
          "",
        ].join("\n"),
      );
    }
    console.log(
      `APPROVED ${planId}: projection_hash ${projection_hash.slice(0, 19)}… (registry ${snapshot.runtime_registry_version})`,
    );
  }

  if (!args.dryRun && newAllocations.length) appendTpAllocations(args.canonicalRoot, newAllocations);
  if (newAllocations.length) {
    console.log(`id-allocations: 新增 ${newAllocations.map(({ tpId }) => tpId).join(", ")}`);
  }
}

main();
