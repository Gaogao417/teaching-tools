/**
 * Alignment dataset gate（Phase 5 remediation / 完整收口计划 §4.2）。
 *
 * 用 fake structured model（FakeStructuredModel——LCS 对齐同规则确定性推导）
 * 跑图的对齐路径（build_context → align_reasoning → 置信度门），对账标注：
 * - macro-F1 ≥ 0.85（五分类）；
 * - expected/alternate precision ≥ 0.95；
 * - 否定/反事实 hard set 零误判（不得判为 expected/alternate）。
 *
 * 输出：data/alignment/alignment-gate-report.json；不达标 exit 1。
 *
 * 用法：npx tsx scripts/run-alignment-gate.ts --canonical-root <abs> [--dataset data/alignment/alignment-dataset.jsonl]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";

import { createTutorPolicyGraph } from "../src/services/tutorIntelligence/policyGraph";
import { FakeStructuredModel } from "../src/services/tutorIntelligence/adapters/fake/FakeStructuredModel";
import type { AlignmentItem } from "./build-alignment-dataset";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (argv[index]?.startsWith("--")) args[argv[index].slice(2)] = argv[index + 1] ?? "";
  }
  return args;
}

type AlignmentClass = "expected_checkpoint" | "alternate_valid" | "incorrect" | "unclear" | "no_progress";
const CLASSES: AlignmentClass[] = ["expected_checkpoint", "alternate_valid", "incorrect", "unclear", "no_progress"];

export interface GateMetrics {
  total: number;
  correct: number;
  accuracy: number;
  macro_f1: number;
  precision: Record<string, number>;
  hard_set_total: number;
  hard_set_misjudged: number;
  per_class: Record<string, { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number }>;
}

export async function runAlignmentGate(
  dataset: readonly AlignmentItem[],
  options?: { canonicalRoot: string },
): Promise<{ metrics: GateMetrics; failures: Array<{ item: AlignmentItem; predicted: AlignmentClass }> }> {
  const graph = createTutorPolicyGraph({ model: new FakeStructuredModel() });
  // build_context 需要 plan；用最小 plan 形状承载 dataset 里的 checkpoint 结构
  // （对齐上下文由 plan+state 重建——这里按 plan 分组装载真实 golden plan）。
  const plansByTp = new Map<string, unknown>();
  if (options?.canonicalRoot) {
    const fsModule = require("node:fs") as typeof import("node:fs");
    for (const tpId of new Set(dataset.map((item) => item.tp_id))) {
      const dir = path.join(options.canonicalRoot, "tutor-plan", tpId);
      if (!fsModule.existsSync(dir)) continue;
      const files = fsModule.readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
      plansByTp.set(tpId, JSON.parse(fsModule.readFileSync(path.join(dir, files.at(-1)), "utf8")));
    }
  }

  const failures: Array<{ item: AlignmentItem; predicted: AlignmentClass }> = [];
  const perClass: Record<string, { tp: number; fp: number; fn: number }> = Object.fromEntries(
    CLASSES.map((cls) => [cls, { tp: 0, fp: 0, fn: 0 }]),
  );
  let hardMisjudged = 0;

  for (const item of dataset) {
    const plan = (plansByTp.get(item.tp_id) ?? plansDatasetPlan(dataset, item.tp_id)) as never;
    const state = { reasoning: { current_checkpoint_id: item.current_checkpoint }, curriculum: { parts: [] }, workspace: {}, assistance: {} };
    const outcome = await graph.proposeTurn({
      plan,
      state: state as never,
      input: item.utterance
        ? { input_kind: "reasoning_utterance", text: item.utterance }
        : { input_kind: "silence_observed" },
      facts: [],
      answerValuesByPart: new Map(),
    });
    let predicted: AlignmentClass = "unclear";
    if (outcome.ok) {
      const classification = outcome.proposal.alignment?.classification;
      if (classification === "expected_checkpoint" || classification === "alternate_valid" || classification === "incorrect" || classification === "unclear" || classification === "no_progress") {
        predicted = classification;
      }
      // alternate 还需 route 对得上（标签带 route_id 时）。
      if (predicted === "alternate_valid" && item.label.route_id && outcome.proposal.alignment?.routeId && outcome.proposal.alignment.routeId !== item.label.route_id) {
        predicted = "unclear"; // 路线不一致按误判计
      }
    }
    const actual = item.label.alignment;
    if (predicted === actual) {
      perClass[actual].tp += 1;
    } else {
      perClass[actual].fn += 1;
      perClass[predicted].fp += 1;
      failures.push({ item, predicted });
      if (item.hard_set && (predicted === "expected_checkpoint" || predicted === "alternate_valid")) {
        hardMisjudged += 1;
      }
    }
  }

  const perClassFull: GateMetrics["per_class"] = {};
  const f1s: number[] = [];
  for (const cls of CLASSES) {
    const { tp, fp, fn } = perClass[cls];
    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perClassFull[cls] = { tp, fp, fn, precision, recall, f1 };
    f1s.push(f1);
  }
  const total = dataset.length;
  const correct = total - failures.length;
  const metrics: GateMetrics = {
    total,
    correct,
    accuracy: total === 0 ? 0 : correct / total,
    macro_f1: f1s.reduce((sum, value) => sum + value, 0) / f1s.length,
    precision: {
      expected_checkpoint: perClassFull.expected_checkpoint.precision,
      alternate_valid: perClassFull.alternate_valid.precision,
    },
    hard_set_total: dataset.filter((item) => item.hard_set).length,
    hard_set_misjudged: hardMisjudged,
    per_class: perClassFull,
  };
  return { metrics, failures };
}

/** 无 canonical root 时的兜底 plan（从 dataset 条目重建 checkpoint 候选）。 */
function plansDatasetPlan(dataset: readonly AlignmentItem[], tpId: string): unknown {
  const checkpoints = new Map<string, { checkpoint_id: string; part_id: string; expected_reasoning: string; common_deviations?: string[] }>();
  const routes: Array<Record<string, unknown>> = [];
  for (const item of dataset) {
    if (item.tp_id !== tpId) continue;
    if (item.source === "verbatim" || item.source === "cross-checkpoint-near") {
      checkpoints.set(item.label.checkpoint_id ?? item.current_checkpoint, {
        checkpoint_id: item.label.checkpoint_id ?? item.current_checkpoint,
        part_id: "1",
        expected_reasoning: item.utterance,
      });
    }
    if (item.source === "deviation" && !checkpoints.has(item.current_checkpoint)) {
      checkpoints.set(item.current_checkpoint, {
        checkpoint_id: item.current_checkpoint,
        part_id: "1",
        expected_reasoning: "",
        common_deviations: [item.utterance],
      });
    } else if (item.source === "deviation") {
      checkpoints.get(item.current_checkpoint)!.common_deviations = [
        ...(checkpoints.get(item.current_checkpoint)!.common_deviations ?? []),
        item.utterance,
      ];
    }
    if (item.source === "alternate-route" && item.label.route_id) {
      routes.push({ route_id: item.label.route_id, role: "alternate", part_id: "1", entry_condition: item.utterance, checkpoint_ids: [item.current_checkpoint] });
    }
  }
  return {
    artifact_id: tpId,
    version: "v1",
    content_hash: `sha256:${"0".repeat(64)}`,
    checkpoints: [...checkpoints.values()],
    recommended_routes: [...routes, { route_id: "R1", role: "primary", part_id: "1", checkpoint_ids: [...checkpoints.keys()] }],
    resources: [],
    policy_constraints: { allowed_move_types: [], maximum_assistance_level: 3, allowed_capabilities: [] },
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const canonicalRoot = args["canonical-root"];
  const datasetPath = path.resolve(args["dataset"] ?? "data/alignment/alignment-dataset.jsonl");
  const dataset = readFileSync(datasetPath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as AlignmentItem);

  runAlignmentGate(dataset, canonicalRoot ? { canonicalRoot } : undefined).then(({ metrics, failures }) => {
    mkdirSync(path.dirname(path.resolve("data/alignment/alignment-gate-report.json")), { recursive: true });
    writeFileSync(
      "data/alignment/alignment-gate-report.json",
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          dataset: datasetPath,
          model: "fake-structured/v1（LCS 对齐，确定性）",
          thresholds: { macro_f1_min: 0.85, expected_alternate_precision_min: 0.95, hard_set_misjudged_max: 0 },
          metrics,
          failures: failures.slice(0, 50).map((failure) => ({
            id: failure.item.id,
            utterance: failure.item.utterance,
            expected: failure.item.label.alignment,
            predicted: failure.predicted,
            source: failure.item.source,
          })),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const pass =
      metrics.macro_f1 >= 0.85 &&
      metrics.precision.expected_checkpoint >= 0.95 &&
      metrics.precision.alternate_valid >= 0.95 &&
      metrics.hard_set_misjudged === 0;
    console.log(`alignment gate: macro-F1=${metrics.macro_f1.toFixed(4)} precision(expected)=${metrics.precision.expected_checkpoint.toFixed(4)} precision(alternate)=${metrics.precision.alternate_valid.toFixed(4)} hard-set=${metrics.hard_set_misjudged}/${metrics.hard_set_total} total=${metrics.total}`);
    if (!pass) {
      console.error("alignment gate FAILED");
      process.exit(1);
    }
    console.log("alignment gate PASSED");
  });
}

if (require.main === module) main();
