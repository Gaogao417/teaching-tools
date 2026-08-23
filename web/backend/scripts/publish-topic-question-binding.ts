/**
 * publish-topic-question-binding CLI（Phase 5 UI 集成波次 E）。
 *
 * 把六个 golden 新 Topic 的正式 TopicQuestionTeachingBinding 发布进
 * canonical root（append-only，同 build-tutor-plans 版本语义）。**教师批准
 * 专用**：reviewer_id 必须显式传入教师身份（波次 E 确认点——未批准不得
 * 运行；建议清单 v2 之外的发布一律拒绝）。
 *
 * 内容：每题一个 default variant（建议清单 v2 的 default 讲法目录）；
 * question/AS/TP/PP 全链 current Approved 对账（fail closed）；scenario_id
 * 指向 tools topicScenarioBundle 的正式 ScenarioRecord。
 *
 * 用法（web/backend 下）：
 *   tsx scripts/publish-topic-question-binding.ts \
 *     --canonical-root /abs/teaching-skills-mvp/artifacts/canonical-authoring \
 *     --reviewer teacher:<id> --note "教师批准（波次 E 确认点）"
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { validateForPublication, validatePayload } from "../../shared/canonical";
import {
  canonicalHash,
  findApproachSetForQuestion,
  loadApprovedTruth,
  loadCurrentPlanV3,
} from "../src/services/planBuild/canonicalInputs";
import { GOLDEN_TASKS } from "./build-tutor-golden-root";

interface CliArgs {
  canonicalRoot: string;
  reviewer: string;
  note: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { canonicalRoot: "", reviewer: "", note: "", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--canonical-root":
        args.canonicalRoot = argv[++index];
        break;
      case "--reviewer":
        args.reviewer = argv[++index];
        break;
      case "--note":
        args.note = argv[++index];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }
  if (!args.canonicalRoot) throw new Error("--canonical-root 必填");
  if (!args.reviewer.startsWith("teacher:")) {
    throw new Error("--reviewer 必须以 teacher: 开头（教师批准专用；agent 不得代批正式 Binding）");
  }
  return args;
}

function appendTbAllocation(canonicalRoot: string, tbId: string, taskId: string): void {
  const ledgerPath = path.join(canonicalRoot, "id-allocations.yaml");
  const ledger = readFileSync(ledgerPath, "utf8");
  if (ledger.includes(`tb_id: ${tbId}`)) return;
  const marker = "tb_allocations:";
  const markerIndex = ledger.indexOf(marker);
  if (markerIndex === -1) {
    // 段不存在：一次性写段头 + 条目 + 单个 next_seq。
    const section = `tb_allocations:\n- task_id: ${taskId}\n  tb_id: ${tbId}\n  allocated_at: '${new Date().toISOString()}'\ntb_next_seq: ${Number(tbId.split("-").pop()) + 1}\n`;
    writeFileSync(ledgerPath, `${ledger.trimEnd()}\n${section}`);
    return;
  }
  // 段已存在：去掉旧 next_seq，追加条目后写单个新 next_seq（重复调用
  // 不得产生 item/next_seq 交错的非法 YAML——TB-002 起的账本损坏教训）。
  const head = ledger.slice(0, markerIndex);
  let section = ledger.slice(markerIndex);
  section = section.replace(/^tb_next_seq: \d+$/m, "");
  section = section.trimEnd();
  section += `\n- task_id: ${taskId}\n  tb_id: ${tbId}\n  allocated_at: '${new Date().toISOString()}'`;
  const ids = [...section.matchAll(/tb_id: TB-SMV-(\d+)/g)].map((m) => Number(m[1]));
  writeFileSync(ledgerPath, head + section + `\ntb_next_seq: ${Math.max(...ids) + 1}\n`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const inputs = { canonicalRoot: args.canonicalRoot };

  for (const [index, spec] of GOLDEN_TASKS.entries()) {
    const truth = loadApprovedTruth(inputs, spec.qtId);
    if (!truth.ok) throw new Error(`${spec.qtId}: ${truth.errors.join("; ")}`);
    const plan = loadCurrentPlanV3(inputs, spec.tpId);
    if (!plan.ok) throw new Error(`${spec.tpId}: ${plan.errors.join("; ")}`);
    const approachSet = findApproachSetForQuestion(inputs, spec.qtId);
    if (!approachSet) throw new Error(`${spec.qtId}: 无 Approved ApproachSet`);
    const tbId = `TB-SMV-${String(index + 1).padStart(3, "0")}`;
    const dir = path.join(args.canonicalRoot, "topic-question-binding", tbId);

    // 语义幂等：current Approved 内容一致（排除 approval）→ 不产生空版本。
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

    const binding: Record<string, unknown> = {
      schema: "ai_teaching_topic_question_binding/v1",
      artifact_id: tbId,
      version: nextVersion,
      status: "Approved",
      task_id: spec.taskId,
      scenario_id: spec.scenarioId,
      question_ref: {
        artifact_id: truth.payload.artifact_id,
        version: truth.payload.version,
        content_hash: truth.payload.content_hash,
      },
      teaching_variants: [
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
          role: "default",
        },
      ],
      approval: {
        reviewer_id: args.reviewer,
        approved_at: new Date().toISOString(),
        review_note: args.note || "教师批准 golden 新 Topic 正式 Binding（Phase 5 UI 集成波次 E 确认点）",
      },
      content_hash: "",
      artifact_uri: `artifact://topic-question-binding/${tbId}@${nextVersion}`,
    };
    binding.content_hash = canonicalHash(binding, "authoring");
    const schema = validatePayload(binding);
    if (!schema.ok) throw new Error(`${tbId}: ${schema.errors.join("; ")}`);
    const publication = validateForPublication(binding);
    if (publication.length) {
      throw new Error(`${tbId}: ${publication.map((issue) => `${issue.code}(${issue.detail})`).join("; ")}`);
    }

    const current = registry.current_version
      ? (JSON.parse(readFileSync(path.join(dir, `${registry.current_version}.json`), "utf8")) as Record<string, unknown>)
      : null;
    if (current) {
      const semantic = (payload: Record<string, unknown>): string => {
        const { approval: _a, content_hash: _h, ...rest } = payload;
        return canonicalHash(rest, "authoring");
      };
      if (semantic(current) === semantic(binding)) {
        console.log(`SKIP ${tbId}: 语义内容与 ${registry.current_version} 一致`);
        continue;
      }
    }

    if (args.dryRun) {
      console.log(`DRY-RUN APPROVE ${tbId}@${nextVersion}: ${spec.taskId} → ${spec.qtId}`);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    const versionFile = path.join(dir, `${nextVersion}.json`);
    if (existsSync(versionFile)) throw new Error(`${tbId}: ${nextVersion}.json 已存在（canonical 不可覆盖）`);
    writeFileSync(versionFile, `${JSON.stringify(binding, null, 2)}\n`);
    for (const entry of versions) {
      if (entry.status !== "Approved") continue;
      entry.status = "Superseded";
      entry.superseded_by = { artifact_id: tbId, version: nextVersion };
      const oldFile = path.join(dir, `${String(entry.version)}.json`);
      if (!existsSync(oldFile)) continue;
      const oldPayload = JSON.parse(readFileSync(oldFile, "utf8")) as Record<string, unknown>;
      oldPayload.status = "Superseded";
      oldPayload.superseded_by = { artifact_id: tbId, version: nextVersion };
      writeFileSync(oldFile, `${JSON.stringify(oldPayload, null, 2)}\n`);
    }
    versions.push({
      version: nextVersion,
      status: "Approved",
      content_hash: binding.content_hash,
      approved_at: (binding.approval as { approved_at: string }).approved_at,
    });
    writeFileSync(
      registryPath,
      stringifyYaml({ artifact_id: tbId, current_version: nextVersion, versions }),
    );
    appendTbAllocation(args.canonicalRoot, tbId, spec.taskId);
    console.log(`APPROVED ${tbId}@${nextVersion}: ${spec.taskId} → ${spec.qtId} / ${approachSet.artifact_id}@${approachSet.version} / ${spec.tpId}@${plan.payload.version}`);
  }
}

main();
