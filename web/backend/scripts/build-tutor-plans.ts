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
 *   tutor-plan/drafts/<TP>.draft.json       Draft 工作副本（可刷新）
 *   tutor-plan/previews/<TP>@vN.md          教师预览（approve 的审核依据，按版本留存）
 *   tutor-plan/<TP>/vN.json + registry.yaml 批准后的不可变 canonical 版本
 *   id-allocations.yaml 追加 tp_next_seq/tp_allocations（幂等）
 *
 * 版本语义（ADR-004 不可变 + append-only 重批）：
 * - 已存在的 canonical 版本文件永不覆盖（--force 只影响 drafts/previews 工作副本）；
 * - 重新批准时自动递增版本号（v1 → v2 → …），registry 中旧 Approved 标
 *   Superseded（携带 superseded_by），current_version 指向新版；
 * - 幂等：新 Draft 与 current Approved 的语义内容相同（排除 build_provenance
 *   后 hash 一致）时跳过批准，不产生空版本。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  approvedApproachesForQuestion,
  canonicalHash,
  findApproachSetForQuestion,
  loadApprovedTruth,
  type CanonicalRegistries,
  type TutorPlanV2Payload,
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
  const ledger = parseYaml(ledgerText) as {
    tp_allocations?: Array<{ qt_id?: string; tp_id?: string }>;
  };
  const hit = (ledger.tp_allocations ?? []).find((entry) => entry.qt_id === qtId);
  return hit?.tp_id ?? null;
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

interface RegistryState {
  currentVersion: string | null;
  maxVersion: number;
  entries: Array<Record<string, unknown>>;
}

function readRegistryState(planDir: string): RegistryState {
  const registryPath = path.join(planDir, "registry.yaml");
  if (!existsSync(registryPath)) {
    return { currentVersion: null, maxVersion: 0, entries: [] };
  }
  const registry = parseYaml(readFileSync(registryPath, "utf8")) as {
    current_version?: string;
    versions?: Array<Record<string, unknown>>;
  };
  const versions = registry.versions ?? [];
  const maxVersion = versions.reduce((max, entry) => {
    const match = /^v(\d+)$/.exec(String(entry.version ?? ""));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return {
    currentVersion: registry.current_version ?? null,
    maxVersion,
    entries: versions,
  };
}

/** 语义内容 hash：排除 build_provenance（run_id/built_at 变化不算内容变化）。 */
function semanticHash(plan: TutorPlanV2Payload): string {
  const { build_provenance: _ignored, ...rest } = plan;
  return canonicalHash(rest as unknown as Record<string, unknown>, "plan");
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
    const planDir = path.join(tutorPlanRoot, planId);
    const registryState = readRegistryState(planDir);
    // 重新批准时的目标版本：比已存在的最大版本 +1（首次为 v1）。
    const nextVersion = `v${registryState.maxVersion + 1}`;
    const currentPayload =
      registryState.currentVersion && existsSync(path.join(planDir, `${registryState.currentVersion}.json`))
        ? (JSON.parse(
            readFileSync(path.join(planDir, `${registryState.currentVersion}.json`), "utf8"),
          ) as TutorPlanV2Payload)
        : null;
    if (!existingTp) tpSeq += 1;

    const approaches = approvedApproachesForQuestion(registries, qtId);
    const approachSet = findApproachSetForQuestion(registries, qtId);
    const build = buildTutorPlanDraft({
      planId,
      version: nextVersion,
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
      writeFileSync(
        path.join(tutorPlanRoot, "previews", `${planId}@${nextVersion}.md`),
        renderPreviewMarkdown(preview),
      );
      if (!existingTp) newAllocations.push({ qtId, tpId: planId });
    }
    console.log(
      `DRAFT ${qtId} → ${planId}@${nextVersion}: ${build.plan.checkpoints.length} checkpoints / ` +
        `${build.plan.resources.length} resources / ${build.plan.recommended_routes.length} routes` +
        `${build.sanitizedHints.length ? `（泄漏自查降级 ${build.sanitizedHints.length}）` : ""}`,
    );

    if (!args.approve.includes(qtId)) continue;

    // 幂等：语义内容与 current Approved 一致 → 不产生空版本。
    if (currentPayload && semanticHash(currentPayload) === semanticHash(build.plan)) {
      console.log(`SKIP ${planId}: 语义内容与 ${registryState.currentVersion} 一致，无需新版本`);
      continue;
    }

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
    const versionFile = path.join(planDir, `${nextVersion}.json`);
    if (existsSync(versionFile)) {
      // 不可变守卫：版本文件已存在即拒绝（--force 也不能覆盖 canonical）。
      console.error(`FAIL ${planId}: ${nextVersion}.json 已存在（canonical 版本不可覆盖）`);
      process.exitCode = 1;
      continue;
    }
    if (!args.dryRun) {
      mkdirSync(planDir, { recursive: true });
      writeFileSync(versionFile, `${JSON.stringify(finalMaterialize.plan, null, 2)}\n`);
      const entries = registryState.entries.map((entry) =>
        entry.status === "Approved"
          ? {
              ...entry,
              status: "Superseded",
              superseded_by: { artifact_id: planId, version: nextVersion },
            }
          : entry,
      );
      // 版本文件同步改写 status/superseded_by（TA/QT 惯例；两字段不参与
      // content_hash，不构成内容改写）。
      for (const entry of registryState.entries) {
        if (entry.status !== "Approved") continue;
        const oldFile = path.join(planDir, `${String(entry.version)}.json`);
        if (!existsSync(oldFile)) continue;
        const payload = JSON.parse(readFileSync(oldFile, "utf8")) as TutorPlanV2Payload;
        payload.status = "Superseded";
        (payload as { superseded_by?: unknown }).superseded_by = {
          artifact_id: planId,
          version: nextVersion,
        };
        writeFileSync(oldFile, `${JSON.stringify(payload, null, 2)}\n`);
      }
      entries.push({
        version: nextVersion,
        status: "Approved",
        content_hash: finalMaterialize.plan.content_hash,
        approved_at: finalMaterialize.plan.approval?.approved_at ?? "",
        question_ref: {
          artifact_id: finalMaterialize.plan.question_ref.artifact_id,
          version: finalMaterialize.plan.question_ref.version,
          content_hash: finalMaterialize.plan.question_ref.content_hash,
        },
      });
      writeFileSync(
        path.join(planDir, "registry.yaml"),
        stringifyYaml({
          artifact_id: planId,
          current_version: nextVersion,
          versions: entries,
        }),
      );
    }
    console.log(
      `APPROVED ${planId}@${nextVersion}: projection_hash ${projection_hash.slice(0, 19)}… ` +
        `(registry ${snapshot.runtime_registry_version}${registryState.maxVersion ? `，v1..v${registryState.maxVersion} → Superseded` : ""})`,
    );
  }

  if (!args.dryRun && newAllocations.length) appendTpAllocations(args.canonicalRoot, newAllocations);
  if (newAllocations.length) {
    console.log(`id-allocations: 新增 ${newAllocations.map(({ tpId }) => tpId).join(", ")}`);
  }
}

main();
