/**
 * publish-tutor-policy-profile CLI（Phase 5 UI 集成波次 D）。
 *
 * 把 Tutor Policy Profile 内容对象写入 canonical root（append-only，同
 * build-tutor-plans 的版本语义）：validatePayload + validateForPublication
 * fail closed 后落 `tutor-policy-profile/<PP>/vN.json + registry.yaml`；
 * id-allocations.yaml 追加 pp 段（幂等）。
 *
 * golden v3 重建固定发布 PP-SMV-001：
 *   primary=deepseek-langgraph / fallback=deterministic-rules /
 *   model=deepseek-v4-flash / prompt=TUTOR_POLICY_PROMPT@2026-08-v3
 *   （取自真实智能链常量 DeepSeekStructuredModel.DEFAULT_MODEL 与
 *   POLICY_VOICE_PROMPT_VERSION；非 e2e 合成 root 的占位值）。
 *
 * 用法（web/backend 下）：
 *   tsx scripts/publish-tutor-policy-profile.ts \
 *     --canonical-root /abs/teaching-skills-mvp/artifacts/canonical-authoring \
 *     --profile-id PP-SMV-001 --reviewer migration-agent --note "..."
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { validateForPublication, validatePayload } from "../../shared/canonical";
import { canonicalHash, type TutorPolicyProfilePayload } from "../src/services/planBuild/canonicalInputs";

/** 与真实智能链常量同源（DeepSeekStructuredModel.DEFAULT_MODEL /
 *  prompts/policyVoicePrompt.POLICY_VOICE_PROMPT_VERSION）。 */
const GOLDEN_PROFILE_BODY = {
  primary_provider: "deepseek-langgraph",
  fallback_provider: "deterministic-rules",
  model_id: "deepseek-v4-flash",
  prompt_version: "TUTOR_POLICY_PROMPT@2026-08-v3",
} as const;

interface CliArgs {
  canonicalRoot: string;
  profileId: string;
  profileVersion: string;
  reviewer: string;
  note: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    canonicalRoot: "",
    profileId: "PP-SMV-001",
    profileVersion: "2026-08-23.1",
    reviewer: "",
    note: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--canonical-root":
        args.canonicalRoot = argv[++index];
        break;
      case "--profile-id":
        args.profileId = argv[++index];
        break;
      case "--profile-version":
        args.profileVersion = argv[++index];
        break;
      case "--reviewer":
        args.reviewer = argv[++index];
        break;
      case "--note":
        args.note = argv[++index];
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }
  if (!args.canonicalRoot) throw new Error("--canonical-root 必填");
  if (!args.reviewer) throw new Error("--reviewer 必填");
  return args;
}

function appendPpAllocation(canonicalRoot: string, ppId: string): void {
  const ledgerPath = path.join(canonicalRoot, "id-allocations.yaml");
  const ledger = readFileSync(ledgerPath, "utf8");
  if (ledger.includes(`pp_id: ${ppId}`)) return;
  const hasSection = /^pp_allocations:/m.test(ledger);
  const lines: string[] = [];
  if (!hasSection) {
    lines.push("pp_allocations:");
  }
  lines.push(`- purpose: tutor-policy-profile（Phase 5 UI 集成波次 D）`);
  lines.push(`  pp_id: ${ppId}`);
  lines.push(`  allocated_at: '${new Date().toISOString()}'`);
  lines.push(`pp_next_seq: ${Number(ppId.split("-").pop()) + 1}`);
  writeFileSync(ledgerPath, `${ledger.trimEnd()}\n${lines.join("\n")}\n`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.join(args.canonicalRoot, "tutor-policy-profile", args.profileId);
  mkdirSync(dir, { recursive: true });

  const registryPath = path.join(dir, "registry.yaml");
  const registry = existsSync(registryPath)
    ? (parseYaml(readFileSync(registryPath, "utf8")) as {
        current_version?: string;
        versions?: Array<Record<string, unknown>>;
      })
    : { versions: [] };
  const versions = registry.versions ?? [];
  const maxVersion = versions.reduce((max, entry) => {
    const match = /^v(\d+)$/.exec(String(entry.version ?? ""));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const nextVersion = `v${maxVersion + 1}`;

  const payload: TutorPolicyProfilePayload & { approval?: { reviewer_id: string; approved_at: string; review_note?: string }; artifact_uri: string } = {
    schema: "ai_teaching_tutor_policy_profile/v1",
    artifact_id: args.profileId,
    version: nextVersion,
    status: "Approved",
    profile_version: args.profileVersion,
    ...GOLDEN_PROFILE_BODY,
    approval: {
      reviewer_id: args.reviewer,
      approved_at: new Date().toISOString(),
      review_note: args.note || "golden v3 重建固定 profile（Phase 5 UI 集成波次 D），待教师复核",
    },
    content_hash: "",
    artifact_uri: `artifact://tutor-policy-profile/${args.profileId}@${nextVersion}`,
  };
  payload.content_hash = canonicalHash(payload as unknown as Record<string, unknown>, "authoring");

  const schema = validatePayload(payload as unknown as Record<string, unknown>);
  if (!schema.ok) throw new Error(`schema: ${schema.errors.join("; ")}`);
  const publication = validateForPublication(payload as unknown as Record<string, unknown>);
  if (publication.length) {
    throw new Error(`publication: ${publication.map((issue) => `${issue.code}(${issue.detail})`).join("; ")}`);
  }

  // 语义幂等：排除 approval 后内容与 current Approved 一致 → 不产生空版本。
  const current = registry.current_version
    ? (JSON.parse(
        readFileSync(path.join(dir, `${registry.current_version}.json`), "utf8"),
      ) as Record<string, unknown>)
    : null;
  if (current) {
    const semantic = (payload2: Record<string, unknown>): string => {
      const { approval: _a, content_hash: _h, ...rest } = payload2;
      return canonicalHash(rest, "authoring");
    };
    if (semantic(current) === semantic(payload as unknown as Record<string, unknown>)) {
      console.log(`SKIP ${args.profileId}: 语义内容与 ${registry.current_version} 一致，无需新版本`);
      return;
    }
  }

  const versionFile = path.join(dir, `${nextVersion}.json`);
  if (existsSync(versionFile)) throw new Error(`${args.profileId}: ${nextVersion}.json 已存在（canonical 不可覆盖）`);
  writeFileSync(versionFile, `${JSON.stringify(payload, null, 2)}\n`);
  // 旧 Approved 标 Superseded（两字段不参与 content_hash，TP/TA/QT 惯例）。
  for (const entry of versions) {
    if (entry.status !== "Approved") continue;
    entry.status = "Superseded";
    entry.superseded_by = { artifact_id: args.profileId, version: nextVersion };
    const oldFile = path.join(dir, `${String(entry.version)}.json`);
    if (!existsSync(oldFile)) continue;
    const oldPayload = JSON.parse(readFileSync(oldFile, "utf8")) as Record<string, unknown>;
    oldPayload.status = "Superseded";
    oldPayload.superseded_by = { artifact_id: args.profileId, version: nextVersion };
    writeFileSync(oldFile, `${JSON.stringify(oldPayload, null, 2)}\n`);
  }
  versions.push({
    version: nextVersion,
    status: "Approved",
    content_hash: payload.content_hash,
    approved_at: payload.approval?.approved_at ?? "",
  });
  writeFileSync(
    registryPath,
    stringifyYaml({ artifact_id: args.profileId, current_version: nextVersion, versions }),
  );
  appendPpAllocation(args.canonicalRoot, args.profileId);
  console.log(`APPROVED ${args.profileId}@${nextVersion}: profile_version ${args.profileVersion}`);
}

main();
