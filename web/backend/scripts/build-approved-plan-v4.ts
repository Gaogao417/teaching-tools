/**
 * build-approved-plan-v4 CLI（F4 / 2026-08-28，Approved Plan 供应链发布入口）。
 *
 * 用法（在 web/backend 下）：
 *   tsx scripts/build-approved-plan-v4.ts \
 *     --canonical-root /abs/teaching-skills-mvp/artifacts/canonical-authoring \
 *     --question QT-SMV-001 \
 *     --rg RG-SMV-001 --mainline-pr PR-SMV-001 --scaffold-pr PR-SMV-002 --tp TP-SMV-009 \
 *     --policy-profile PP-SMV-001 \
 *     --reviewer f4-plan-supply --note "..." [--run-id ...] [--dry-run]
 *
 * 产物（写入 canonical root）：
 *   reviewed-solution-graph/drafts/<RG>.draft.json        RG authored 草稿（教研输入，编译时消费）
 *   reviewed-solution-graph/<RG>/v1.json + registry.yaml  Approved RG（解法结构权威）
 *   teaching-protocol/previews/<PR>@v1.md                 教师预览（approve 的审核依据）
 *   teaching-protocol/<PR>/v1.json + registry.yaml        Approved TeachingProtocol（mainline + scaffold）
 *   tutor-plan/previews/<TP>@v1.md                        教师预览
 *   tutor-plan/<TP>/v1.json + registry.yaml               Approved TutorPlanBundle v4（chunks→protocol_refs）
 *   id-allocations.yaml 追加 rg_allocations/pr_allocations/tp_allocations（幂等）
 *
 * 版本语义（ADR-004）：canonical 版本文件永不覆盖（已存在即 fail）；重新
 * 批准产生新 version（本 CLI v1 只做首发，重批走人工升版流程）。
 * RG 是教研 authored 输入（drafts/ 下人工维护），CLI 只做校验、approve、
 * 发布；PR/TP 由 Build Agent v4 确定性编译，教师预览后批准。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

import { validateForPublication, validatePayload } from "../../shared/canonical";
import {
  type ReviewedSolutionGraphPayload,
  canonicalHash,
  findApproachSetForQuestion,
  loadApprovedApproach,
  loadApprovedPolicyProfile,
  loadApprovedTruth,
} from "../src/services/planBuild/canonicalInputs";
import { publishApprovedPlanV4 } from "../src/services/planBuild/v4/PublishApprovedPlanV4";
import {
  BUILD_AGENT_V4_PROVIDER,
  BUILD_AGENT_V4_MODEL_ID,
  BUILD_AGENT_V4_WORKFLOW_VERSION,
  PLAN_COMPILER_V4_VERSION,
  buildTutorPlanV4Draft,
} from "../src/services/planBuild/v4/BuildTeachingPlanV4";
import {
  MATERIALIZER_V4_VERSION,
  validateApprovedPlanV4,
} from "../src/services/planBuild/v4/MaterializeTutorPlanV4";
import {
  approveReviewedSolutionGraph,
  approveTeachingProtocol,
  approveTutorPlanV4,
  buildPlanV4Preview,
  renderPlanV4PreviewMarkdown,
} from "../src/services/planBuild/v4/ReviewTeachingPlanV4";
import { importApprovedPlanV4 } from "../src/services/planBuild/v4/ImportApprovedPlanV4";
import { buildRuntimeRegistrySnapshot } from "../src/services/planBuild/RuntimeRegistrySnapshot";
import { GOLDEN_GEOMETRY, verifyGoldenGeometry } from "./golden-question-geometry";

/** capability-skill-map question_capability_paths 的 vendored 摘要（与 build-tutor-plans.ts 同源）。 */
const CAPABILITY_PATHS: Record<string, string[]> = {
  "QT-SMV-001": ["select-option", "mark-segment-values", "enter-equation", "enter-text"],
};

interface CliArgs {
  canonicalRoot: string;
  question: string;
  rgId: string;
  mainlinePrId: string;
  scaffoldPrId: string;
  tpId: string;
  policyProfile: string;
  reviewer: string;
  note: string;
  runId: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    canonicalRoot: "",
    question: "QT-SMV-001",
    rgId: "RG-SMV-001",
    mainlinePrId: "PR-SMV-001",
    scaffoldPrId: "PR-SMV-002",
    tpId: "TP-SMV-009",
    policyProfile: "PP-SMV-001",
    reviewer: "",
    note: "",
    runId: `plan-build-v4-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--canonical-root": args.canonicalRoot = argv[++index]; break;
      case "--question": args.question = argv[++index]; break;
      case "--rg": args.rgId = argv[++index]; break;
      case "--mainline-pr": args.mainlinePrId = argv[++index]; break;
      case "--scaffold-pr": args.scaffoldPrId = argv[++index]; break;
      case "--tp": args.tpId = argv[++index]; break;
      case "--policy-profile": args.policyProfile = argv[++index]; break;
      case "--reviewer": args.reviewer = argv[++index]; break;
      case "--note": args.note = argv[++index]; break;
      case "--run-id": args.runId = argv[++index]; break;
      case "--dry-run": args.dryRun = true; break;
      default: throw new Error(`未知参数: ${arg}`);
    }
  }
  if (!args.canonicalRoot) throw new Error("--canonical-root 必填");
  if (!args.reviewer) throw new Error("--reviewer 必填（F4 产线批准身份；教研复核签字另行走教师流程）");
  return args;
}

interface VersionLedger {
  rg_allocations?: Array<{ qt_id?: string; rg_id?: string }>;
  rg_next_seq?: number;
  pr_allocations?: Array<{ qt_id?: string; role?: string; pr_id?: string }>;
  pr_next_seq?: number;
  tp_allocations?: Array<{ qt_id?: string; tp_id?: string; contract?: string }>;
  tp_next_seq?: number;
}

function appendAllocations(canonicalRoot: string, lines: string[]): void {
  const ledgerPath = path.join(canonicalRoot, "id-allocations.yaml");
  if (lines.length) writeFileSync(ledgerPath, `${readFileSync(ledgerPath, "utf8").trimEnd()}\n${lines.join("\n")}\n`);
}

function nextSeq(ledger: VersionLedger, key: "rg_next_seq" | "pr_next_seq" | "tp_next_seq", ids: string[]): number {
  const declared = ledger[key];
  const maxAllocated = ids.reduce((max, id) => {
    const match = /-(\d+)$/.exec(id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return Math.max(declared ?? 1, maxAllocated + 1);
}

function publishVersion(
  canonicalRoot: string,
  namespace: "reviewed-solution-graph" | "teaching-protocol" | "tutor-plan",
  payload: Parameters<typeof publishApprovedPlanV4>[2],
  dryRun: boolean,
): void {
  const result = publishApprovedPlanV4(canonicalRoot, namespace, payload, { dryRun });
  if (!result.ok) throw new Error(`FAIL ${namespace}: ${result.errors.join("; ")}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  // F4 复验修复（2026-08-29）：上游装载启用 anchored 模式（canonical schema 校验 +
  // registry 锚定三方对账）；发布走 planBuild 服务内的 publishApprovedPlanV4
  // （append-only 守卫 + per-version content_hash 锚定，planBuildV4.test.ts 直接测试）。
  const registries = { canonicalRoot: args.canonicalRoot, anchored: true };
  const snapshot = buildRuntimeRegistrySnapshot();
  const approvedAt = new Date().toISOString();
  const defaultNote =
    "F4 产线批准：RG 派生自教师已批 QT/TA（解法结构 1:1 转录）；PR/TP 由 Build Agent v4 确定性编译。Beat 粒度/支持边界/节奏待教研复核签字（F4 ledger 待人工裁定项）。";

  console.log(`runtime registry: ${snapshot.runtime_registry_version}`);
  console.log(`compiler: ${PLAN_COMPILER_V4_VERSION} / materializer: ${MATERIALIZER_V4_VERSION} / build: ${BUILD_AGENT_V4_PROVIDER} ${BUILD_AGENT_V4_MODEL_ID} (${BUILD_AGENT_V4_WORKFLOW_VERSION})`);

  // ---- 上游 Approved 输入（hash-verified）
  const truth = loadApprovedTruth(registries, args.question);
  if (!truth.ok) throw new Error(`FAIL ${args.question}: ${truth.errors.join("; ")}`);
  const approachSet = findApproachSetForQuestion(registries, args.question);
  if (!approachSet) throw new Error(`FAIL ${args.question}: 无 Approved ApproachSet`);
  const defaultPart = approachSet.parts[0];
  if (!defaultPart) throw new Error(`FAIL ${approachSet.artifact_id}: parts 为空`);
  const approach = loadApprovedApproach(registries, defaultPart.approach.artifact_id);
  if (!approach.ok) throw new Error(`FAIL TA ${defaultPart.approach.artifact_id}: ${approach.errors.join("; ")}`);
  const profile = loadApprovedPolicyProfile(registries, args.policyProfile);
  if (!profile.ok) throw new Error(`FAIL PP ${args.policyProfile}: ${profile.errors.join("; ")}`);

  // ---- RG authored 草稿 → 校验 → approve
  const rgDraftPath = path.join(args.canonicalRoot, "reviewed-solution-graph", "drafts", `${args.rgId}.draft.json`);
  const rgDraft = JSON.parse(readFileSync(rgDraftPath, "utf8")) as ReviewedSolutionGraphPayload;
  rgDraft.content_hash = canonicalHash(rgDraft as unknown as Record<string, unknown>, "authoring");
  const rgSchema = validatePayload(rgDraft);
  if (!rgSchema.ok) throw new Error(`FAIL ${args.rgId} draft schema: ${rgSchema.errors.join("; ")}`);
  const rgApproved = approveReviewedSolutionGraph(rgDraft, {
    reviewer_id: args.reviewer,
    approved_at: approvedAt,
    review_note: args.note || defaultNote,
  });
  if (!rgApproved.ok) throw new Error(`FAIL ${args.rgId} approve: ${rgApproved.errors.join("; ")}`);
  const rgPublication = validateForPublication(rgApproved.artifact);
  if (rgPublication.length) {
    throw new Error(`FAIL ${args.rgId} publication: ${rgPublication.map((issue) => `${issue.code}(${issue.detail})`).join("; ")}`);
  }

  // ---- Build Agent v4：PR（mainline + scaffold）+ TP v4 草稿
  const geometryErrors = verifyGoldenGeometry();
  if (geometryErrors.length) throw new Error(`FAIL golden geometry: ${geometryErrors.join("; ")}`);
  const build = buildTutorPlanV4Draft({
    planId: args.tpId,
    runId: args.runId,
    builtAt: approvedAt,
    truth: truth.payload,
    approach: approach.payload,
    approachSet,
    graph: rgApproved.artifact,
    profile: profile.payload,
    snapshot,
    protocolIds: { mainline: args.mainlinePrId, scaffold: args.scaffoldPrId },
    capabilityPath: CAPABILITY_PATHS[args.question],
    geometry: GOLDEN_GEOMETRY[args.question],
  });
  if (!build.ok) throw new Error(`FAIL ${args.question} v4 build:\n  ${build.errors.join("\n  ")}`);
  const protocolsDraft = new Map([
    [build.mainlineProtocol.protocol_id, build.mainlineProtocol],
    [build.scaffoldProtocol.protocol_id, build.scaffoldProtocol],
  ]);
  const draftInputs = {
    truth: truth.payload,
    approachSet,
    graph: rgApproved.artifact,
    protocols: protocolsDraft,
    profile: profile.payload,
    snapshot,
  };
  const draftCheck = validateApprovedPlanV4(build.plan, draftInputs, { requireApproved: false });
  if (!draftCheck.ok) throw new Error(`FAIL ${args.question} v4 draft validation:\n  ${draftCheck.errors.join("\n  ")}`);

  console.log(
    `DRAFT ${args.tpId}@v1: mainline ${build.mainlineProtocol.beats.length} beats / scaffold ${build.scaffoldProtocol.beats.length} beats / ` +
      `${build.plan.chunks.length} chunks / ${build.plan.resources.length} resources（泄漏自查降级 ${build.sanitizedSupports.length}；alignment ${build.alignment.length} steps）` +
      `${build.pendingCapabilityBindings.length ? `；待几何绑定 ${build.pendingCapabilityBindings.join(",")}` : ""}`,
  );

  // ---- 教师预览（approve 的审核依据）
  if (!args.dryRun) {
    mkdirSync(path.join(args.canonicalRoot, "teaching-protocol", "previews"), { recursive: true });
    mkdirSync(path.join(args.canonicalRoot, "tutor-plan", "previews"), { recursive: true });
    for (const protocol of [build.mainlineProtocol, build.scaffoldProtocol]) {
      const preview = buildPlanV4Preview(build.plan, {
        truth: truth.payload,
        graph: rgApproved.artifact,
        protocols: [build.mainlineProtocol, build.scaffoldProtocol],
        pendingCapabilityBindings: build.pendingCapabilityBindings,
        sanitizedSupports: build.sanitizedSupports,
      });
      writeFileSync(
        path.join(args.canonicalRoot, "teaching-protocol", "previews", `${protocol.protocol_id}@${protocol.version}.md`),
        renderPlanV4PreviewMarkdown(preview),
      );
    }
    const planPreview = buildPlanV4Preview(build.plan, {
      truth: truth.payload,
      graph: rgApproved.artifact,
      protocols: [build.mainlineProtocol, build.scaffoldProtocol],
      pendingCapabilityBindings: build.pendingCapabilityBindings,
      sanitizedSupports: build.sanitizedSupports,
    });
    writeFileSync(
      path.join(args.canonicalRoot, "tutor-plan", "previews", `${args.tpId}@v1.md`),
      renderPlanV4PreviewMarkdown(planPreview),
    );
  }

  // ---- Approve（approval 在 content_hash 排除集，hash 不变）→ 发布前 materialize
  const mainlineApproved = approveTeachingProtocol(build.mainlineProtocol, {
    reviewer_id: args.reviewer,
    approved_at: approvedAt,
    review_note: args.note || defaultNote,
  });
  const scaffoldApproved = approveTeachingProtocol(build.scaffoldProtocol, {
    reviewer_id: args.reviewer,
    approved_at: approvedAt,
    review_note: args.note || defaultNote,
  });
  const planApproved = approveTutorPlanV4(build.plan, {
    reviewer_id: args.reviewer,
    approved_at: approvedAt,
    review_note: args.note || defaultNote,
  });
  if (!mainlineApproved.ok || !scaffoldApproved.ok || !planApproved.ok) {
    throw new Error("FAIL approve: protocol/plan 批准失败");
  }
  const approvedProtocols = new Map([
    [mainlineApproved.artifact.protocol_id, mainlineApproved.artifact],
    [scaffoldApproved.artifact.protocol_id, scaffoldApproved.artifact],
  ]);
  const approvedInputs = { ...draftInputs, protocols: approvedProtocols };
  const finalCheck = validateApprovedPlanV4(planApproved.artifact, approvedInputs);
  if (!finalCheck.ok) throw new Error(`FAIL ${args.tpId} 发布门禁:\n  ${finalCheck.errors.join("\n  ")}`);

  // ---- 发布（append-only；版本文件存在即拒绝）
  publishVersion(args.canonicalRoot, "reviewed-solution-graph", rgApproved.artifact, args.dryRun);
  publishVersion(args.canonicalRoot, "teaching-protocol", mainlineApproved.artifact, args.dryRun);
  publishVersion(args.canonicalRoot, "teaching-protocol", scaffoldApproved.artifact, args.dryRun);
  publishVersion(args.canonicalRoot, "tutor-plan", planApproved.artifact, args.dryRun);

  // ---- id-allocations 登记（幂等）
  const ledgerText = readFileSync(path.join(args.canonicalRoot, "id-allocations.yaml"), "utf8");
  const ledger = parseYaml(ledgerText) as VersionLedger;
  const allocationLines: string[] = [];
  if (!ledger.rg_allocations) {
    allocationLines.push(`rg_next_seq: ${nextSeq(ledger, "rg_next_seq", [args.rgId])}`, "rg_allocations:");
  }
  if (!ledgerText.includes(`rg_id: ${args.rgId}`)) {
    allocationLines.push(`- qt_id: ${args.question}`, `  rg_id: ${args.rgId}`, `  allocated_at: '${approvedAt}'`);
  }
  if (!ledger.pr_allocations) {
    allocationLines.push(
      `pr_next_seq: ${nextSeq(ledger, "pr_next_seq", [args.mainlinePrId, args.scaffoldPrId])}`,
      "pr_allocations:",
    );
  }
  if (!ledgerText.includes(`pr_id: ${args.mainlinePrId}`)) {
    allocationLines.push(`- qt_id: ${args.question}`, `  role: mainline`, `  pr_id: ${args.mainlinePrId}`, `  allocated_at: '${approvedAt}'`);
  }
  if (!ledgerText.includes(`pr_id: ${args.scaffoldPrId}`)) {
    allocationLines.push(`- qt_id: ${args.question}`, `  role: scaffold`, `  pr_id: ${args.scaffoldPrId}`, `  allocated_at: '${approvedAt}'`);
  }
  // tp：v4 合同 bundle 用独立段登记（不改动既有 tp_allocations 的 v2/v3 语义）
  if (!ledgerText.includes(`tp_id: ${args.tpId}`)) {
    if (!ledgerText.includes("tp_v4_allocations:")) allocationLines.push("tp_v4_allocations:");
    allocationLines.push(`- qt_id: ${args.question}`, `  tp_id: ${args.tpId}`, `  contract: planning/v4`, `  allocated_at: '${approvedAt}'`);
  }
  if (!args.dryRun) appendAllocations(args.canonicalRoot, allocationLines);

  console.log(
    `APPROVED ${args.rgId}@v1 (${rgApproved.artifact.content_hash.slice(0, 19)}…) / ` +
      `${args.mainlinePrId}@v1 (${mainlineApproved.artifact.content_hash.slice(0, 19)}…) / ` +
      `${args.scaffoldPrId}@v1 (${scaffoldApproved.artifact.content_hash.slice(0, 19)}…) / ` +
      `${args.tpId}@v1 (${planApproved.artifact.content_hash.slice(0, 19)}…)`,
  );

  // ---- 发布后自证：registry 解析 + 确定性 materialize + 导入（fail closed）
  if (!args.dryRun) {
    const imported = importApprovedPlanV4(registries, args.tpId);
    if (!imported.ok) throw new Error(`FAIL 复导入 ${args.tpId}:\n  ${imported.errors.join("\n  ")}`);
    console.log(
      `IMPORT OK ${args.tpId}@${imported.imported.plan.version}: projection_hash ${imported.imported.projection_hash.slice(0, 19)}… ` +
        `（protocols ${[...imported.imported.protocols.keys()].join(",")}；graph ${imported.imported.graph.graph_id}）`,
    );
  }
}

main();
