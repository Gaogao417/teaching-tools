/**
 * 波次 F-2 门禁测试：用仓内 alignment 数据集跑 fake structured model gate。
 * 阈值与计划 §4.2 一致：macro-F1 ≥0.85、expected/alternate precision ≥0.95、
 * hard set 零误判。
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { runAlignmentGate } from "../../../../scripts/run-alignment-gate";
import type { AlignmentItem } from "../../../../scripts/build-alignment-dataset";

const dataset = readFileSync(path.resolve(__dirname, "../../../../data/alignment/alignment-dataset.jsonl"), "utf8")
  .split("\n")
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line) as AlignmentItem);

describe("alignment dataset gate（fake structured model）", () => {
  it("数据集规模：≥180 条且每 plan ≥30 条", () => {
    expect(dataset.length).toBeGreaterThanOrEqual(180);
    const perPlan = new Map<string, number>();
    for (const item of dataset) perPlan.set(item.tp_id, (perPlan.get(item.tp_id) ?? 0) + 1);
    expect(perPlan.size).toBe(6);
    for (const [tpId, count] of perPlan) {
      expect(count, `${tpId} 每 plan ≥30`).toBeGreaterThanOrEqual(30);
    }
  });

  it("覆盖维度齐全：同义/ASR/混合/跨节点/alternate/含糊/否定 hard set", () => {
    const sources = new Set(dataset.map((item) => item.source));
    for (const required of ["paraphrase", "asr-noise", "mixed", "cross-checkpoint-near", "cross-checkpoint-far", "alternate-route", "vague", "negation", "deviation"]) {
      expect(sources.has(required as (typeof dataset)[number]["source"]), `缺 ${required} 维度`).toBe(true);
    }
    expect(dataset.filter((item) => item.hard_set).length).toBeGreaterThanOrEqual(5);
  });

  it("gate 达标：macro-F1 ≥0.85、expected/alternate precision ≥0.95、hard set 零误判", { timeout: 120_000 }, async () => {
    const canonicalRoot =
      process.env.TUTOR_E2E_CANONICAL_ROOT ||
      "/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring";
    const { metrics } = await runAlignmentGate(dataset, { canonicalRoot });
    expect(metrics.macro_f1).toBeGreaterThanOrEqual(0.85);
    expect(metrics.precision.expected_checkpoint).toBeGreaterThanOrEqual(0.95);
    expect(metrics.precision.alternate_valid).toBeGreaterThanOrEqual(0.95);
    expect(metrics.hard_set_misjudged).toBe(0);
  });
});
