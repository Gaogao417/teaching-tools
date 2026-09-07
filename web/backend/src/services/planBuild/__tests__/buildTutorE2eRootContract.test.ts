/**
 * F7 P2 转办 3 回归：合成 e2e canonical root 过终态合同。
 *
 * A 轨实测缺陷：QT-E2E-005（select-option）truth 的 canonical_answer.options
 * 被终态 question-truth/v2（strict 封闭 canonical_answer）拒绝 → legacy e2e
 * 矩阵 12 场景受阻。修复后锁定：
 * - 全部 6 个 QT truth 过 canonical questionTruthV2Schema；choice truth 的
 *   canonical_answer 只含 kind/value（无 options）；
 * - choice 选项正文仍在 plan 的 action_template 资源（模板 input.options——
 *   前端 .topic-choice-grid 渲染源不受影响）；
 * - hash 链闭合：TP/TA/TB 的 question_ref.content_hash === 发布 truth hash。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { questionTruthV2Schema } from "../../../../../shared/canonical";

const BACKEND_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..");

function buildRoot(): string {
  const outDir = mkdtempSync(join(tmpdir(), "f7-e2e-root-test-"));
  execFileSync("npx", ["tsx", "scripts/build-tutor-e2e-root.ts", outDir], { cwd: BACKEND_ROOT, stdio: "pipe" });
  return outDir;
}

function readJson(...parts: string[]): Record<string, unknown> {
  return JSON.parse(readFileSync(join(...parts), "utf8")) as Record<string, unknown>;
}

test("synthetic e2e root passes the final canonical question-truth contract (QT-E2E-005 options stripped)", () => {
  const root = buildRoot();
  const truthIds = readdirSync(join(root, "question-truth"));
  assert.equal(truthIds.length, 6);

  const hashes = new Map<string, string>();
  for (const qtId of truthIds) {
    const truth = readJson(root, "question-truth", qtId, "v1.json");
    const parsed = questionTruthV2Schema.safeParse(truth);
    assert.ok(parsed.success, `${qtId} must pass questionTruthV2Schema: ${parsed.success ? "" : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(";")}`);
    hashes.set(qtId, truth.content_hash as string);
    if (qtId === "QT-E2E-005") {
      assert.equal((truth.canonical_answer as { kind: string }).kind, "choice_option");
      assert.deepEqual(Object.keys(truth.canonical_answer as object), ["kind", "value"], "choice canonical_answer must be the strict closed shape (no options)");
    }
  }

  // choice 选项仍在 plan 的 action_template 资源（前端 choice grid 渲染源）。
  const plan = readJson(root, "tutor-plan", "TP-E2E-005", "v2.json");
  const resources = plan.resources as Array<{ kind: string; content?: string }>;
  const choiceTemplate = resources.find((resource) => resource.kind === "action_template" && (resource.content ?? "").includes("select-option"))
    ?? resources.find((resource) => resource.kind === "action_template" && (resource.content ?? "").includes("opt-a"));
  assert.ok(choiceTemplate, "select-option plan carries the choice action template");
  const template = JSON.parse(choiceTemplate!.content!) as { input?: { options?: unknown[] } };
  assert.equal(template.input?.options?.length, 3, "template input.options keeps the three choices");

  // hash 链：TP/TA/TB 的 question_ref 锚定发布 truth。
  assert.equal((plan.question_ref as { content_hash: string }).content_hash, hashes.get("QT-E2E-005"));
  const approachFiles = readdirSync(join(root, "teaching-approach"));
  for (const taId of approachFiles) {
    const approach = readJson(root, "teaching-approach", taId, "v1.json");
    const qtId = (approach.question_ref as { artifact_id: string }).artifact_id;
    assert.equal((approach.question_ref as { content_hash: string }).content_hash, hashes.get(qtId), `${taId} question_ref must anchor the published truth hash`);
  }
  const bindingIds = readdirSync(join(root, "topic-question-binding"));
  for (const tbId of bindingIds) {
    const binding = readJson(root, "topic-question-binding", tbId, "v1.json");
    const qtId = (binding.question_ref as { artifact_id: string }).artifact_id;
    assert.equal((binding.question_ref as { content_hash: string }).content_hash, hashes.get(qtId), `${tbId} question_ref must anchor the published truth hash`);
  }
});
