/**
 * Alignment 数据集生成器（Phase 5 remediation / 完整收口计划 §4.2）。
 *
 * 从 golden canonical plan 确定性派生教师可审的标注样本（≥30/plan，≥180 总量）：
 * verbatim / 同义改写 / ASR 错字 / 混合表述 / 跨 checkpoint / 合法 alternate /
 * 含糊输入 / 否定与反事实（hard set，含两个已知反例 + 三个补充）。
 *
 * 输出（teacher-reviewable）：
 * - data/alignment/alignment-dataset.jsonl（机器面：gate 输入）
 * - data/alignment/alignment-dataset.md（教师面：逐条表格 + 待复核清单）
 *
 * 标注者=agent 代拟（外部依赖处置：教师审核不可得时留 teacher-reviewable
 * 格式，reviewer=migration-agent，报告中明确列出待教师复核清单）。
 *
 * 用法：npx tsx scripts/build-alignment-dataset.ts --canonical-root <abs>
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (argv[index]?.startsWith("--")) args[argv[index].slice(2)] = argv[index + 1] ?? "";
  }
  return args;
}

interface CheckpointShape {
  checkpoint_id: string;
  part_id: string;
  expected_reasoning: string;
  accepted_alternatives?: string[];
  common_deviations?: string[];
}
interface RouteShape {
  route_id: string;
  role: string;
  part_id?: string;
  entry_condition?: string;
  checkpoint_ids: string[];
}
interface PlanShape {
  artifact_id: string;
  checkpoints: CheckpointShape[];
  recommended_routes: RouteShape[];
}

export interface AlignmentItem {
  id: string;
  tp_id: string;
  current_checkpoint: string;
  utterance: string;
  label: { alignment: "expected_checkpoint" | "alternate_valid" | "incorrect" | "unclear" | "no_progress"; checkpoint_id?: string; route_id?: string };
  source:
    | "verbatim"
    | "paraphrase"
    | "asr-noise"
    | "mixed"
    | "cross-checkpoint-near"
    | "cross-checkpoint-far"
    | "alternate-route"
    | "vague"
    | "deviation"
    | "negation"
    | "refusal"
    | "silence";
  hard_set: boolean;
  reviewer: "migration-agent";
  review_status: "agent-drafted";
  note: string;
}

/** 固定同义改写表（教学话术同义、不引入数学新内容）。 */
const PARAPHRASE_RULES: Array<[RegExp, string]> = [
  [/^学生能/, "我可以"],
  [/^学生看到/, "我看到"],
  [/^学生/, "我"],
  [/立刻/, "马上"],
  [/写出/, "得到"],
  [/指出/, "找到"],
  [/列出/, "写出来"],
  [/清单/, "列表"],
  [/收口/, "收尾"],
  [/并设元/, "并且设未知数"],
];

function paraphrase(text: string, variant: number): string {
  let out = text;
  // variant 0：全部规则；variant 1/2：规则子集（保持多样性且 LCS≥4）。
  const rules = variant === 0 ? PARAPHRASE_RULES : PARAPHRASE_RULES.filter((_rule, index) => (index + variant) % 2 === 0);
  for (const [pattern, replacement] of rules) {
    out = out.replace(pattern, replacement);
  }
  if (variant === 2) out = `就是说，${out}`;
  return out;
}

/** 固定 ASR 错字表（音近/形近替换，单条最多两处）。 */
const ASR_NOISE: Array<[string, string]> = [
  ["角", "脚"],
  ["对应", "对硬"],
  ["边", "变"],
  ["相等", "像等"],
  ["翻折", "反折"],
  ["相似", "相思"],
];

function asrNoise(text: string, variant: number): string {
  let out = text;
  const rules = variant === 0 ? ASR_NOISE.slice(0, 2) : ASR_NOISE.slice(2, 4);
  for (const [from, to] of rules) {
    out = out.replace(from, to);
  }
  return out;
}

const VAGUE_INPUTS = [
  "嗯……我不太确定这一步该怎么下手",
  "感觉好像是要用相似，但说不清楚",
  "这个条件和那个条件，我也不知道怎么连起来",
];

function buildItems(plan: PlanShape): AlignmentItem[] {
  const items: AlignmentItem[] = [];
  const push = (item: Omit<AlignmentItem, "id" | "tp_id" | "reviewer" | "review_status">) => {
    items.push({
      ...item,
      id: `${plan.artifact_id}-A${String(items.length + 1).padStart(3, "0")}`,
      tp_id: plan.artifact_id,
      reviewer: "migration-agent",
      review_status: "agent-drafted",
    });
  };
  const checkpoints = plan.checkpoints;
  checkpoints.forEach((checkpoint, index) => {
    const expected = checkpoint.expected_reasoning;
    push({ current_checkpoint: checkpoint.checkpoint_id, utterance: expected, label: { alignment: "expected_checkpoint", checkpoint_id: checkpoint.checkpoint_id }, source: "verbatim", hard_set: false, note: "plan 原文（教师批准）" });
    for (let variant = 0; variant < 3; variant += 1) {
      push({ current_checkpoint: checkpoint.checkpoint_id, utterance: paraphrase(expected, variant), label: { alignment: "expected_checkpoint", checkpoint_id: checkpoint.checkpoint_id }, source: "paraphrase", hard_set: false, note: `固定同义表 variant=${variant}` });
    }
    for (let variant = 0; variant < 2; variant += 1) {
      push({ current_checkpoint: checkpoint.checkpoint_id, utterance: asrNoise(expected, variant), label: { alignment: "expected_checkpoint", checkpoint_id: checkpoint.checkpoint_id }, source: "asr-noise", hard_set: false, note: `ASR 错字表 variant=${variant}` });
    }
    push({ current_checkpoint: checkpoint.checkpoint_id, utterance: `就是说那个……${expected.replace(/^学生(能|看到)?/, "")}，对吧`, label: { alignment: "expected_checkpoint", checkpoint_id: checkpoint.checkpoint_id }, source: "mixed", hard_set: false, note: "填充语 + 期望推理（混合表述）" });

    // 跨 checkpoint：候选集成员（同 part ±1，或带 common_deviations 的全题节点）
    // → expected@该节点；否则（跨 part 相邻 / 远距且无偏差）→ unclear。
    const inCandidateSet = (target: CheckpointShape): boolean =>
      target.part_id === checkpoint.part_id
        ? Math.abs(checkpoints.indexOf(target) - index) <= 1
        : false;
    const neighbor = checkpoints[index + 1];
    if (neighbor) {
      const member = inCandidateSet(neighbor) || (neighbor.common_deviations ?? []).length > 0;
      push({
        current_checkpoint: checkpoint.checkpoint_id,
        utterance: neighbor.expected_reasoning,
        label: member
          ? { alignment: "expected_checkpoint", checkpoint_id: neighbor.checkpoint_id }
          : { alignment: "unclear" },
        source: "cross-checkpoint-near",
        hard_set: false,
        note: member ? "候选集内相邻节点推理" : "跨 part 相邻（候选外 → unclear）",
      });
    }
    const distant = checkpoints[index + 2];
    if (distant) {
      const member = inCandidateSet(distant) || (distant.common_deviations ?? []).length > 0;
      push({
        current_checkpoint: checkpoint.checkpoint_id,
        utterance: distant.expected_reasoning,
        label: member
          ? { alignment: "expected_checkpoint", checkpoint_id: distant.checkpoint_id }
          : { alignment: "unclear" },
        source: "cross-checkpoint-far",
        hard_set: false,
        note: member ? "带偏差清单的远距节点（候选内）" : "远距节点（候选外 → unclear）",
      });
    }

    // 偏差（题目级陷阱）→ incorrect。
    for (const deviation of (checkpoint.common_deviations ?? []).slice(0, 2)) {
      push({ current_checkpoint: checkpoint.checkpoint_id, utterance: deviation, label: { alignment: "incorrect", checkpoint_id: checkpoint.checkpoint_id }, source: "deviation", hard_set: false, note: "plan common_deviations 原文" });
    }

    // 否定/反事实（hard set）：期望推理的否定不得判为 expected/alternate。
    const core = expected.replace(/^学生(能|看到)?/, "");
    push({ current_checkpoint: checkpoint.checkpoint_id, utterance: `「${core.replace(/。$/, "")}」这个说法是错的`, label: { alignment: "unclear" }, source: "negation", hard_set: true, note: "已知反例形态：期望推理的否定（不得判 expected/alternate）" });
    push({ current_checkpoint: checkpoint.checkpoint_id, utterance: `我不想列这些东西，直接跳过`, label: { alignment: "unclear" }, source: "refusal", hard_set: true, note: "已知反例形态：拒绝表述（无数学主张）" });
    if (index === 0) {
      push({ current_checkpoint: checkpoint.checkpoint_id, utterance: `这些结论根本不成立，题目本身有问题`, label: { alignment: "unclear" }, source: "negation", hard_set: true, note: "补充反例 1：全盘否定（无具体对齐主张）→ 非 expected/alternate" });
      push({ current_checkpoint: checkpoint.checkpoint_id, utterance: `我完全不知道从哪里开始，一点思路都没有`, label: { alignment: "unclear" }, source: "vague", hard_set: true, note: "补充反例 2：完全空白" });
      push({ current_checkpoint: checkpoint.checkpoint_id, utterance: `这道题是求长度吧？我不确定题目在问什么`, label: { alignment: "unclear" }, source: "vague", hard_set: true, note: "补充反例 3：元问题（关于题目而非推理）" });
    }
  });

  // 合法 alternate 路线：entry_condition verbatim + 改写。
  for (const route of plan.recommended_routes) {
    if (route.role !== "alternate" || !route.entry_condition) continue;
    push({ current_checkpoint: route.checkpoint_ids[0] ?? plan.checkpoints[0].checkpoint_id, utterance: route.entry_condition, label: { alignment: "alternate_valid", route_id: route.route_id }, source: "alternate-route", hard_set: false, note: "alternate entry_condition 原文" });
    push({ current_checkpoint: route.checkpoint_ids[0] ?? plan.checkpoints[0].checkpoint_id, utterance: paraphrase(route.entry_condition, 0), label: { alignment: "alternate_valid", route_id: route.route_id }, source: "alternate-route", hard_set: false, note: "alternate entry_condition 改写" });
  }

  // 含糊输入（非 hard set 的常规 unclear 覆盖）。
  VAGUE_INPUTS.forEach((text, index) => {
    push({ current_checkpoint: plan.checkpoints[0].checkpoint_id, utterance: text, label: { alignment: "unclear" }, source: "vague", hard_set: false, note: `含糊输入 ${index + 1}` });
  });
  // 空输入 → no_progress（确定性路径）。
  push({ current_checkpoint: plan.checkpoints[0].checkpoint_id, utterance: "", label: { alignment: "no_progress" }, source: "silence", hard_set: false, note: "空文本（no_progress 只来自确定性路径）" });

  return items;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const canonicalRoot = args["canonical-root"];
  if (!canonicalRoot) {
    console.error("--canonical-root is required");
    process.exit(2);
  }
  const outDir = path.resolve(args["out"] ?? "data/alignment");
  mkdirSync(outDir, { recursive: true });

  const tpIds = readdirSync(path.join(canonicalRoot, "tutor-plan")).filter((name) => /^TP-SMV-\d+$/.test(name));
  const all: AlignmentItem[] = [];
  for (const tpId of tpIds) {
    const dir = path.join(canonicalRoot, "tutor-plan", tpId);
    const version = readdirSync(dir).filter((name) => name.endsWith(".json")).sort().at(-1)!;
    const plan = JSON.parse(readFileSync(path.join(dir, version), "utf8")) as PlanShape;
    all.push(...buildItems(plan));
  }

  const perPlan = new Map<string, number>();
  for (const item of all) perPlan.set(item.tp_id, (perPlan.get(item.tp_id) ?? 0) + 1);
  const jsonl = all.map((item) => JSON.stringify(item)).join("\n") + "\n";
  writeFileSync(path.join(outDir, "alignment-dataset.jsonl"), jsonl, "utf8");

  const md: string[] = [
    "# Alignment 数据集（Phase 5 remediation，agent 代拟待教师复核）",
    "",
    `- 生成时间：${new Date().toISOString()}`,
    `- 总量：${all.length} 条（≥180 门禁）；hard set（否定/反事实，零误判要求）：${all.filter((item) => item.hard_set).length} 条`,
    `- 每 plan 分布：${[...perPlan.entries()].map(([tp, count]) => `${tp}=${count}`).join("、")}`,
    `- 标注者：migration-agent（教师审核不可得时的代理处置；review_status=agent-drafted）`,
    `- 复核口径：逐条核对 utterance→label 是否符合教学判断；hard set 条目重点确认「不得判为 expected/alternate」`,
    "",
    "| id | plan | 当前节点 | 学生话语 | 期望标签 | 来源 | hard | 备注 |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const item of all) {
    const label = item.label.checkpoint_id
      ? `${item.label.alignment}@${item.label.checkpoint_id}`
      : item.label.route_id
        ? `${item.label.alignment}@${item.label.route_id}`
        : item.label.alignment;
    md.push(`| ${item.id} | ${item.tp_id} | ${item.current_checkpoint} | ${item.utterance || "(空)"} | ${label} | ${item.source} | ${item.hard_set ? "是" : ""} | ${item.note} |`);
  }
  writeFileSync(path.join(outDir, "alignment-dataset.md"), md.join("\n") + "\n", "utf8");
  console.log(`items=${all.length}, hard=${all.filter((item) => item.hard_set).length}, plans=${perPlan.size}`);
  console.log(`wrote ${path.join(outDir, "alignment-dataset.jsonl")} and alignment-dataset.md`);
}

main();
