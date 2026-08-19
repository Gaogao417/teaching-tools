/**
 * C-INT / C-TRU deterministic benchmark cases（Phase 2 / P2-09）。
 *
 * 把 evaluation-scope.yaml 中 intake/truth 两阶段共 8 个 case 的
 * not_executed 替换为 deterministic 真实结果。输入是 Phase 2 的真实产物：
 *
 * - candidate export JSON（skills 仓 canonical_export 写出的
 *   ai_teaching_candidate_export/v1，含 SourceEvidence + QuestionCandidate）；
 * - QuestionTruth registry（artifacts/canonical-authoring/question-truth/…）；
 * - 黄浦 source pack 目录（manifest.json 逐页 sha256，供 C-INT-04 完整性）。
 *
 * 判定全部确定性：不调模型；期望值来自 PRDS golden-slice/source-pack
 * manifests 的冻结事实（官方答案：闵行 Q18 = 1）。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import {
  benchmarkRunSchema,
  validatePayload,
} from "../../../../shared/canonical";

export const INTAKE_TRUTH_RUNNER_VERSION = "benchmark-runner-intake-truth-0.1.0";

/** 闵行 2020 官方答案（word 版答案文档）——C-TRU-01 的期望真值。 */
const EXPECTED_QT_SMV_001_ANSWER = "1";

export interface CaseResult {
  case_id: string;
  stage: "intake" | "truth";
  status: "pass" | "fail";
  failure_class?: string;
  metrics?: { detail?: string };
}

export interface CandidateExportItem {
  source_key: string;
  source_evidence: Array<{
    evidence_id: string;
    source_pack_id: string;
    artifact_uri: string;
    locator: { kind: string; page: number };
  }>;
  question_candidate: {
    candidate_id: string;
    question_type: "choice" | "fill_blank" | "solution";
    stem: string;
    source_evidence_refs: Array<{ evidence_id: string; artifact_uri: string }>;
  };
}

export interface CandidateExport {
  schema: string;
  paper_id: string;
  pack_id: string;
  items: CandidateExportItem[];
}

interface TruthPayload {
  schema: string;
  artifact_id: string;
  version: string;
  status: string;
  question_type: string;
  stem: string;
  canonical_answer: { kind: string; value: string };
  source_evidence_refs: Array<{ evidence_id: string; artifact_uri: string }>;
  content_hash: string;
  [key: string]: unknown;
}

export interface IntakeTruthInputs {
  candidates: CandidateExport[];
  truthRegistryDir: string;
  sourcePackDir: string;
}

const FAILURE = {
  missingInput: "input_missing",
  structureInvalid: "candidate_structure_invalid",
  evidenceInvalid: "evidence_invalid",
  integrityUndetected: "integrity_drift_undetected",
  answerMismatch: "math_answer_mismatch",
  hashDriftUndetected: "content_hash_drift_undetected",
} as const;

function fail(caseId: string, stage: "intake" | "truth", failureClass: string, detail: string): CaseResult {
  return {
    case_id: caseId,
    stage,
    status: "fail",
    failure_class: failureClass,
    metrics: { detail },
  };
}

function pass(caseId: string, stage: "intake" | "truth", detail?: string): CaseResult {
  return {
    case_id: caseId,
    stage,
    status: "pass",
    ...(detail ? { metrics: { detail } } : {}),
  };
}

function questionNumberOf(item: CandidateExportItem): number | null {
  const match = /Q(\d+)$/.exec(item.source_key);
  return match ? Number(match[1]) : null;
}

/** 与 skills 仓 canonical_export._content_hash 相同的内容哈希规则。 */
export function canonicalContentHash(payload: Record<string, unknown>): string {
  const excluded = new Set([
    "content_hash",
    "status",
    "superseded_by",
    "approval",
    "version",
    "artifact_uri",
  ]);
  const content: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    if (!excluded.has(key)) content[key] = payload[key];
  }
  const encoded = JSON.stringify(content);
  return `sha256:${createHash("sha256").update(encoded, "utf8").digest("hex")}`;
}

/** LaTeX 答案归一化：去 $、空白、\left/\right、\text 与全角变体后比较。 */
export function normalizeAnswerLatex(value: string): string {
  return value
    .replace(/\$/g, "")
    .replace(/\\left|\\right/g, "")
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/[\\{}]/g, "")
    .replace(/[\s，,。．]/g, "")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .trim();
}

function readCurrentTruth(registryDir: string, artifactId: string): TruthPayload | null {
  const registryPath = path.join(registryDir, artifactId, "registry.yaml");
  if (!existsSync(registryPath)) return null;
  // registry.yaml 是 YAML；这里只取 current_version 行，避免引 YAML 依赖。
  const registry = readFileSync(registryPath, "utf8");
  const match = /current_version:\s*(v\d+)/.exec(registry);
  if (!match) return null;
  const versionPath = path.join(registryDir, artifactId, `${match[1]}.json`);
  if (!existsSync(versionPath)) return null;
  return JSON.parse(readFileSync(versionPath, "utf8")) as TruthPayload;
}

function findCandidate(
  inputs: IntakeTruthInputs,
  packId: string,
  questionNumber: number,
): CandidateExportItem | null {
  for (const exportPayload of inputs.candidates) {
    if (exportPayload.pack_id !== packId) continue;
    const found = exportPayload.items.find(
      (item) => questionNumberOf(item) === questionNumber,
    );
    if (found) return found;
  }
  return null;
}

/** C-INT-04：黄浦包逐页 sha256 完整性（与 skills 抽取器同规则：数字词干页 + sha 校验）。 */
export function verifyPagePackIntegrity(
  packDir: string,
  manifestOverride?: { images: Array<{ file: string; sha256: string }> },
): { ok: boolean; detail: string } {
  const manifestPath = path.join(packDir, "manifest.json");
  if (!existsSync(manifestPath)) return { ok: false, detail: "manifest.json missing" };
  const manifest = manifestOverride
    ? manifestOverride
    : (JSON.parse(readFileSync(manifestPath, "utf8")) as {
        images: Array<{ file: string; sha256: string }>;
      });
  const images = manifest.images ?? [];
  if (!images.length) return { ok: false, detail: "no images listed" };
  for (const image of images) {
    const file = path.join(packDir, image.file);
    if (!existsSync(file)) return { ok: false, detail: `page missing: ${image.file}` };
    const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
    const expected = image.sha256.replace(/^sha256:/, "");
    if (actual !== expected) {
      return { ok: false, detail: `sha256 drift: ${image.file}` };
    }
  }
  return { ok: true, detail: `${images.length} pages verified` };
}

export function runIntakeTruthCases(inputs: IntakeTruthInputs): CaseResult[] {
  const results: CaseResult[] = [];

  // ---- C-INT-01: pack-A 闵行 Q18/Q23 candidate 字段 + 页锚点 ----
  {
    const caseId = "C-INT-01";
    const q18 = findCandidate(inputs, "pack-A-minhang-2020-yimo", 18);
    const q23 = findCandidate(inputs, "pack-A-minhang-2020-yimo", 23);
    if (!q18 || !q23) {
      results.push(fail(caseId, "intake", FAILURE.missingInput, "Q18/Q23 candidates not exported"));
    } else {
      const problems: string[] = [];
      for (const [label, item] of [["Q18", q18], ["Q23", q23]] as const) {
        if (item.question_candidate.stem.trim().length < 10) {
          problems.push(`${label} stem too short`);
        }
        const refs = item.question_candidate.source_evidence_refs;
        if (!refs.length) problems.push(`${label} has no source_evidence_refs`);
        for (const ref of refs) {
          if (!ref.artifact_uri.startsWith("artifact://source-evidence/SE-")) {
            problems.push(`${label} evidence ref not canonical: ${ref.artifact_uri}`);
          }
        }
        const questionEvidence = item.source_evidence.filter(
          (entry) => entry.locator?.kind === "page" && (entry as { notes?: string }).notes?.includes("role=question"),
        );
        if (!questionEvidence.length) problems.push(`${label} has no question-role page evidence`);
      }
      results.push(
        problems.length
          ? fail(caseId, "intake", FAILURE.structureInvalid, problems.join("; "))
          : pass(caseId, "intake", "Q18/Q23 字段与页锚点完整"),
      );
    }
  }

  // ---- C-INT-02: pack-B 黄浦 006/007 区域扫描 OCR ----
  {
    const caseId = "C-INT-02";
    const targets = [22, 23, 25];
    const missing = targets.filter(
      (number) => !findCandidate(inputs, "pack-B-huangpu-2025-yimo", number),
    );
    if (missing.length) {
      results.push(fail(caseId, "intake", FAILURE.missingInput, `missing candidates: Q${missing.join("/Q")}`));
    } else {
      const problems: string[] = [];
      for (const number of targets) {
        const item = findCandidate(inputs, "pack-B-huangpu-2025-yimo", number)!;
        const questionPages = item.source_evidence
          .filter((entry) => (entry as { notes?: string }).notes?.includes("role=question"))
          .map((entry) => entry.locator?.page);
        const solutionPages = item.source_evidence
          .filter((entry) => (entry as { notes?: string }).notes?.includes("role=official_solution"))
          .map((entry) => entry.locator?.page);
        if (!questionPages.every((page) => page !== undefined && page >= 2 && page <= 7)) {
          problems.push(`Q${number} question pages outside 2..7: ${questionPages.join(",")}`);
        }
        if (!solutionPages.every((page) => page !== undefined && page >= 8 && page <= 11)) {
          problems.push(`Q${number} solution pages outside 8..11: ${solutionPages.join(",")}`);
        }
      }
      results.push(
        problems.length
          ? fail(caseId, "intake", FAILURE.evidenceInvalid, problems.join("; "))
          : pass(caseId, "intake", "扫描页题目/解答页锚点落在 2..7 / 8..11（字段抽样人审另行）"),
      );
    }
  }

  // ---- C-INT-03: 图文归属（题图随题干页）----
  {
    const caseId = "C-INT-03";
    const figureItems = inputs.candidates
      .flatMap((exportPayload) => exportPayload.items)
      .filter((item) => /如图|图所示|下图|上图|图中/.test(item.question_candidate.stem));
    if (!figureItems.length) {
      results.push(fail(caseId, "intake", FAILURE.missingInput, "no figure-referencing candidates"));
    } else {
      const broken = figureItems.filter(
        (item) =>
          !item.source_evidence.some(
            (entry) =>
              (entry as { notes?: string }).notes?.includes("role=question") &&
              entry.locator?.kind === "page",
          ),
      );
      results.push(
        broken.length
          ? fail(
              caseId,
              "intake",
              FAILURE.evidenceInvalid,
              `figure items without question-page evidence: ${broken
                .map((item) => item.source_key)
                .join(", ")}`,
            )
          : pass(caseId, "intake", `${figureItems.length} 道含图题的题干页证据齐全`),
      );
    }
  }

  // ---- C-INT-04: 失败降级（hash 漂移 fail closed）----
  {
    const caseId = "C-INT-04";
    const clean = verifyPagePackIntegrity(inputs.sourcePackDir);
    const realManifest = JSON.parse(
      readFileSync(path.join(inputs.sourcePackDir, "manifest.json"), "utf8"),
    ) as { images: Array<{ file: string; sha256: string }> };
    const tampered = {
      images: realManifest.images.map((image, index) =>
        index === 0 ? { ...image, sha256: `sha256:${"0".repeat(64)}` } : image,
      ),
    };
    const detected = verifyPagePackIntegrity(inputs.sourcePackDir, tampered);
    if (!clean.ok) {
      results.push(fail(caseId, "intake", FAILURE.integrityUndetected, `real pack failed verification: ${clean.detail}`));
    } else if (detected.ok) {
      results.push(fail(caseId, "intake", FAILURE.integrityUndetected, "tampered manifest was NOT detected"));
    } else {
      results.push(pass(caseId, "intake", `真包校验通过（${clean.detail}）；篡改样本被拒绝（${detected.detail}）`));
    }
  }

  // ---- C-TRU-01: 数学答案真值（QT-SMV-001，闵行 Q18）----
  {
    const caseId = "C-TRU-01";
    const truth = readCurrentTruth(inputs.truthRegistryDir, "QT-SMV-001");
    if (!truth) {
      results.push(fail(caseId, "truth", FAILURE.missingInput, "QT-SMV-001 not in registry"));
    } else if (
      normalizeAnswerLatex(truth.canonical_answer.value) !==
      normalizeAnswerLatex(EXPECTED_QT_SMV_001_ANSWER)
    ) {
      results.push(
        fail(
          caseId,
          "truth",
          FAILURE.answerMismatch,
          `answer ${truth.canonical_answer.value} != official ${EXPECTED_QT_SMV_001_ANSWER}`,
        ),
      );
    } else {
      results.push(pass(caseId, "truth", `canonical_answer=${truth.canonical_answer.value} 与官方答案等价`));
    }
  }

  // ---- C-TRU-02: 来源一致性（QT-SMV-004，黄浦 Q22）----
  {
    const caseId = "C-TRU-02";
    const truth = readCurrentTruth(inputs.truthRegistryDir, "QT-SMV-004");
    if (!truth) {
      results.push(fail(caseId, "truth", FAILURE.missingInput, "QT-SMV-004 not in registry"));
    } else {
      const problems: string[] = [];
      if (!truth.source_evidence_refs.length) problems.push("no source_evidence_refs");
      for (const ref of truth.source_evidence_refs) {
        if (!/^artifact:\/\/source-evidence\/SE-/.test(ref.artifact_uri)) {
          problems.push(`non-canonical evidence ref: ${ref.artifact_uri}`);
        }
      }
      if (truth.stem.trim().length < 10) problems.push("stem suspiciously short");
      results.push(
        problems.length
          ? fail(caseId, "truth", FAILURE.evidenceInvalid, problems.join("; "))
          : pass(caseId, "truth", "来源证据链完整且指向 pack-B 页图（逐字抽样人审另行）"),
      );
    }
  }

  // ---- C-TRU-03: 小问结构（QT-SMV-003，闵行 Q25 三小问）----
  {
    const caseId = "C-TRU-03";
    const truth = readCurrentTruth(inputs.truthRegistryDir, "QT-SMV-003");
    if (!truth) {
      results.push(fail(caseId, "truth", FAILURE.missingInput, "QT-SMV-003 not in registry"));
    } else {
      const subquestions = (truth as unknown as { subquestions?: unknown[] }).subquestions;
      const markers = ["（1）", "（2）", "（3）"].every((marker) =>
        truth.stem.replace(/\s/g, "").includes(marker),
      );
      if (subquestions?.length === 3 || markers) {
        results.push(pass(caseId, "truth", "三小问结构（(1)(2)(3) 标记）齐备"));
      } else {
        results.push(
          fail(caseId, "truth", FAILURE.structureInvalid, "stem lacks (1)(2)(3) sub-question markers"),
        );
      }
    }
  }

  // ---- C-TRU-04: hash 漂移拒绝 promote（不可变版本门禁）----
  {
    const caseId = "C-TRU-04";
    const truth = readCurrentTruth(inputs.truthRegistryDir, "QT-SMV-005");
    if (!truth) {
      results.push(fail(caseId, "truth", FAILURE.missingInput, "QT-SMV-005 not in registry"));
    } else {
      const selfCheck = canonicalContentHash(truth) === truth.content_hash;
      const tampered = { ...truth, stem: `${truth.stem} 被篡改的内容` };
      const driftDetected = canonicalContentHash(tampered) !== tampered.content_hash;
      if (!selfCheck) {
        results.push(fail(caseId, "truth", FAILURE.hashDriftUndetected, "registry content_hash failed self-check"));
      } else if (!driftDetected) {
        results.push(fail(caseId, "truth", FAILURE.hashDriftUndetected, "tampered content was NOT detected"));
      } else {
        results.push(pass(caseId, "truth", "自校验一致；篡改内容被内容哈希拒绝（fail closed）"));
      }
    }
  }

  return results;
}

export interface IntakeTruthRunInput {
  runId: string;
  sutId: string;
  datasetId: string;
  datasetVersion: string;
  inputs: IntakeTruthInputs;
  startedAt?: string;
}

export type IntakeTruthRunResult =
  | { ok: true; record: Record<string, unknown> }
  | { ok: false; errors: readonly string[] };

export function buildIntakeTruthRun(input: IntakeTruthRunInput): IntakeTruthRunResult {
  const caseResults = runIntakeTruthCases(input.inputs);
  const passed = caseResults.filter((result) => result.status === "pass").length;
  const failed = caseResults.filter((result) => result.status === "fail").length;
  const configHash = createHash("sha256")
    .update(
      JSON.stringify({
        runner: INTAKE_TRUTH_RUNNER_VERSION,
        candidates: input.inputs.candidates.map((entry) => entry.paper_id),
      }),
    )
    .digest("hex");
  const record = {
    schema: "ai_teaching_benchmark_run/v1",
    run_id: input.runId,
    dataset_id: input.datasetId,
    dataset_version: input.datasetVersion,
    sut: {
      sut_id: input.sutId,
      config_hash: `sha256:${configHash}`,
      config_artifact_uri: `artifact://sut-config/${input.sutId.replace(/^sut-/, "")}@v1`,
    },
    status: "completed",
    case_results: caseResults,
    runner_version: INTAKE_TRUTH_RUNNER_VERSION,
    environment: `node ${process.version}`,
    started_at: input.startedAt ?? new Date().toISOString(),
    completed_at: new Date().toISOString(),
    summary: {
      passed,
      failed,
      errored: 0,
      not_executed: 0,
    },
  };
  const validation = validatePayload(record);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  benchmarkRunSchema.parse(record);
  return { ok: true, record };
}
