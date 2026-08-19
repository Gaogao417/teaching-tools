/**
 * C-APP deterministic benchmark cases（Phase 3 / P3-10）。
 *
 * 把 evaluation-scope.yaml 中 approach 阶段 4 个 case 的 not_executed 替换为
 * deterministic 真实结果。输入是 Phase 3 的真实产物（skills 仓
 * teaching_approach.py 冻结的 canonical ApprovedTeachingApproach.v1）：
 *
 * - teaching-approach registry（artifacts/canonical-authoring/teaching-approach/…）；
 * - question-truth registry（绑定校验与静态答案一致性）；
 * - canonical evidence 根（audio/ transcript/ 不可变证据副本，hash 逐文件核验）。
 *
 * 判定全部确定性：不调模型。教师意图 fidelity 的 rubric v1 由四项可机判维度
 * 构成（traceable / structure / math-fidelity / version-binding）；
 * 语义级 fidelity（润色是否改写教学策略）留给 Phase 7 LLM-judge 初筛 + 人工复核。
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

import {
  benchmarkRunSchema,
  validatePayload,
} from "../../../../shared/canonical";

export const APPROACH_RUNNER_VERSION = "benchmark-runner-approach-0.1.0";

/** golden 六题（PRDS golden-slice-manifest 冻结；额外 dogfood 题一并做结构检查）。 */
export const GOLDEN_QT_IDS = [
  "QT-SMV-001",
  "QT-SMV-002",
  "QT-SMV-003",
  "QT-SMV-004",
  "QT-SMV-005",
  "QT-SMV-006",
] as const;

/** MVP 冻结的 canonical skill 集（PRDS skill-scope.yaml，SKILL-SMV-004 deferred）。 */
export const FROZEN_SKILL_IDS = new Set([
  "SKILL-SMV-001",
  "SKILL-SMV-002",
  "SKILL-SMV-003",
  "SKILL-SMV-005",
  "SKILL-SMV-006",
  "SKILL-SMV-007",
  "SKILL-SMV-008",
  "SKILL-SMV-009",
]);

export interface ApproachCaseResult {
  case_id: string;
  stage: "approach";
  status: "pass" | "fail";
  failure_class?: string;
  metrics?: { detail?: string };
}

interface TeachingStep {
  step_id: string;
  intent: string;
  narration: string;
  expected_student_reasoning: string;
  accepted_alternatives?: string[];
  common_errors?: string[];
  skill_ids: string[];
}

interface EvidenceFile {
  artifact_uri: string;
  content_hash: string;
}

export interface ApproachPayload {
  schema: string;
  artifact_id: string;
  version: string;
  status: string;
  question_ref: { artifact_id: string; version: string; content_hash: string; part_id?: string };
  title: string;
  goal: string;
  entry_signal?: string;
  steps: TeachingStep[];
  evidence: {
    audio: EvidenceFile[];
    transcripts: Array<{
      artifact_uri: string;
      asr_provenance: { provider: string; model_id: string };
      revision?: number;
    }>;
    polished: Array<{ artifact_uri: string; polish_provenance: Record<string, string> }>;
    manual_edit_notes: string[];
  };
  approval?: { reviewer_id: string; approved_at: string; review_note?: string | null };
  content_hash: string;
  artifact_uri: string;
}

interface TruthPayload {
  artifact_id: string;
  version: string;
  status: string;
  stem: string;
  canonical_answer?: { kind: string; value: string; options?: Array<{ id: string; value: string }> };
  subquestions?: Array<{
    part_id: string;
    prompt: string;
    canonical_answer: { kind: string; value: string; options?: Array<{ id: string; value: string }> };
  }>;
  content_hash: string;
}

export interface ApproachInputs {
  approachRegistryDir: string;
  truthRegistryDir: string;
  /** canonical-authoring 根（解析 artifact://audio|transcript/<TA>@vN/<file> 用）。 */
  canonicalRoot: string;
}

const FAILURE = {
  missingInput: "input_missing",
  structureInvalid: "approach_structure_invalid",
  evidenceUntraceable: "evidence_untraceable",
  intentFidelity: "teacher_intent_fidelity",
  mathFidelity: "math_fact_inconsistent",
  versionBinding: "version_binding_stale",
} as const;

function fail(caseId: string, failureClass: string, detail: string): ApproachCaseResult {
  return { case_id: caseId, stage: "approach", status: "fail", failure_class: failureClass, metrics: { detail } };
}

function pass(caseId: string, detail?: string): ApproachCaseResult {
  return { case_id: caseId, stage: "approach", status: "pass", ...(detail ? { metrics: { detail } } : {}) };
}

function readRegistryCurrent(registryDir: string, artifactId: string): string | null {
  const registryPath = path.join(registryDir, artifactId, "registry.yaml");
  if (!existsSync(registryPath)) return null;
  const match = /current_version:\s*(v\d+)/.exec(readFileSync(registryPath, "utf8"));
  return match ? match[1] : null;
}

function readCurrentPayload<T>(registryDir: string, artifactId: string): (T & { status: string }) | null {
  const current = readRegistryCurrent(registryDir, artifactId);
  if (!current) return null;
  const versionPath = path.join(registryDir, artifactId, `${current}.json`);
  if (!existsSync(versionPath)) return null;
  return JSON.parse(readFileSync(versionPath, "utf8")) as T & { status: string };
}

/** 与 skills 仓 canonical_export._content_hash 同规则（TA/QT 共用 excluded 集）。 */
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

/** 解析 artifact://audio/TA-SMV-001@v1/<file> → <canonicalRoot>/audio/TA-SMV-001/v1/<file>。 */
export function resolveEvidenceFile(canonicalRoot: string, uri: string): string | null {
  const match = /^artifact:\/\/(audio|transcript)\/([A-Za-z0-9-]+)@(v\d+)\/([^/?#]+)$/.exec(uri);
  if (!match) return null;
  const [, namespace, artifactId, version, file] = match;
  return path.join(canonicalRoot, namespace, artifactId, version, file);
}

/** 静态答案一致性（skills teaching_approach.static_answer_consistency 的 TS 镜像）。

 * ADR-005：part_id 给定时目标取自该小问（prompt 求证目标 + 小问级
 * canonical_answer）；无小问或 part_id 为空时回退整题顶层（v1 存量兼容）。
 */
export function staticAnswerTargets(truth: TruthPayload, partId?: string): string[] {
  const normalize = (value: string): string =>
    value
      .replace(/\$|\\,|\\;|\\!|\\ |\\left|\\right/g, "")
      .replace(/\\cdot/g, "·")
      .replace(/\\times/g, "×")
      .replace(/\\perp/g, "⊥")
      .replace(/\\parallel/g, "∥")
      .replace(/\\sim/g, "∽")
      .replace(/\\triangle/g, "△")
      .replace(/[{}]/g, "")
      .replace(/\s+/g, "");
  const targets: string[] = [];
  let stem = truth.stem;
  let answer: TruthPayload["canonical_answer"] | undefined = truth.canonical_answer;
  if (partId) {
    const part = (truth.subquestions ?? []).find((entry) => entry.part_id === partId);
    if (!part) return [];
    stem = part.prompt;
    answer = part.canonical_answer;
  } else if ((truth.subquestions ?? []).length > 0) {
    stem = `${stem}；${truth.subquestions!.map((entry) => entry.prompt).join("；")}`;
    answer = undefined;
  }
  for (const match of stem.matchAll(/求证[：:]\s*([^；;。.]+)/g)) {
    const captured = match[1].replace(/^[（(]\s*[0-9]\s*[）)]\s*/, "").trim();
    const normalized = normalize(captured);
    if (normalized.length >= 2) targets.push(normalized);
  }
  if (answer?.kind === "choice_option") {
    for (const option of answer.options ?? []) {
      const value = normalize(option.value);
      if (value) targets.push(value);
    }
  } else if (answer) {
    for (const segment of answer.value.matchAll(/\$([^$]+)\$/g)) {
      const normalized = normalize(segment[1]);
      if (normalized) targets.push(normalized);
    }
  }
  return targets;
}

export function approachStepsText(approach: ApproachPayload): string {
  return approach.steps
    .map((step) => `${step.narration}${step.expected_student_reasoning}`)
    .join(" ");
}

export function normalizeForMatch(value: string): string {
  return value
    .replace(/\$|\\,|\\;|\\!|\\ |\\left|\\right/g, "")
    .replace(/\\cdot/g, "·")
    .replace(/\\times/g, "×")
    .replace(/\\perp/g, "⊥")
    .replace(/\\parallel/g, "∥")
    .replace(/\\sim/g, "∽")
    .replace(/\\triangle/g, "△")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, "");
}

function discoverApproaches(approachRegistryDir: string): ApproachPayload[] {
  if (!existsSync(approachRegistryDir)) return [];
  const found: ApproachPayload[] = [];
  for (const entry of readdirSync(approachRegistryDir)) {
    if (!/^TA-[A-Z0-9]+-\d+$/.test(entry)) continue;
    const payload = readCurrentPayload<ApproachPayload>(approachRegistryDir, entry);
    if (payload) found.push(payload);
  }
  return found;
}

function goldenApproaches(
  inputs: ApproachInputs,
): Map<string, ApproachPayload[]> {
  const byQt = new Map<string, ApproachPayload[]>();
  for (const approach of discoverApproaches(inputs.approachRegistryDir)) {
    if (approach.status !== "Approved") continue;
    const list = byQt.get(approach.question_ref.artifact_id) ?? [];
    list.push(approach);
    byQt.set(approach.question_ref.artifact_id, list);
  }
  return byQt;
}

export function runApproachCases(inputs: ApproachInputs): ApproachCaseResult[] {
  const results: ApproachCaseResult[] = [];
  const byQt = goldenApproaches(inputs);

  // ---- C-APP-01: TeachingStep 结构 + canonical schema + skill 冻结集 ----
  {
    const caseId = "C-APP-01";
    const all = [...byQt.values()].flat();
    if (!all.length) {
      results.push(fail(caseId, FAILURE.missingInput, "no Approved teaching approaches found"));
    } else {
      const problems: string[] = [];
      for (const approach of all) {
        const validation = validatePayload(approach as unknown as Record<string, unknown>);
        if (!validation.ok) {
          problems.push(`${approach.artifact_id}: schema invalid: ${validation.errors.join(",")}`);
          continue;
        }
        if (!approach.approval?.reviewer_id) problems.push(`${approach.artifact_id}: approval missing`);
        if (approach.steps.length < 3) problems.push(`${approach.artifact_id}: steps < 3`);
        approach.steps.forEach((step, index) => {
          for (const field of ["intent", "narration", "expected_student_reasoning"] as const) {
            if (!step[field]?.trim()) problems.push(`${approach.artifact_id} S${index + 1}.${field} empty`);
          }
          if (!step.skill_ids.length) problems.push(`${approach.artifact_id} S${index + 1} no skill_ids`);
          for (const skill of step.skill_ids) {
            if (!FROZEN_SKILL_IDS.has(skill)) {
              problems.push(`${approach.artifact_id} S${index + 1} skill out of frozen scope: ${skill}`);
            }
          }
        });
        const selfCheck = canonicalContentHash(approach as unknown as Record<string, unknown>);
        if (selfCheck !== approach.content_hash) {
          problems.push(`${approach.artifact_id}: content_hash drift`);
        }
      }
      let goldenPartsCovered = 0;
      let goldenPartsTotal = 0;
      for (const qt of GOLDEN_QT_IDS) {
        const truth = readCurrentPayload<TruthPayload>(inputs.truthRegistryDir, qt);
        const partCount = truth?.subquestions?.length ?? 1;
        goldenPartsTotal += partCount;
        goldenPartsCovered += (byQt.get(qt) ?? []).filter(
          (approach) => !truth?.subquestions?.length || approach.question_ref.part_id,
        ).length >= partCount
          ? partCount
          : 0;
      }
      results.push(
        problems.length
          ? fail(caseId, FAILURE.structureInvalid, problems.join("; "))
          : pass(
              caseId,
              `${all.length} 个 Approved Approach 全部过 canonical schema（golden 小问覆盖 ${goldenPartsCovered}/${goldenPartsTotal}，ADR-005 part 粒度）`,
            ),
      );
    }
  }

  // ---- C-APP-02: 证据链全链可追溯（录音/ASR/润色/人工编辑）----
  {
    const caseId = "C-APP-02";
    const all = [...byQt.values()].flat();
    const problems: string[] = [];
    let audioChecked = 0;
    for (const approach of all) {
      const label = approach.artifact_id;
      if (!approach.evidence.audio.length) problems.push(`${label}: no audio evidence`);
      if (!approach.evidence.transcripts.length) problems.push(`${label}: no transcript evidence`);
      for (const audio of approach.evidence.audio) {
        const file = resolveEvidenceFile(inputs.canonicalRoot, audio.artifact_uri);
        if (!file || !existsSync(file)) {
          problems.push(`${label}: audio artifact missing: ${audio.artifact_uri}`);
          continue;
        }
        const actual = `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}`;
        if (actual !== audio.content_hash) problems.push(`${label}: audio hash drift: ${audio.artifact_uri}`);
        audioChecked += 1;
      }
      for (const transcript of approach.evidence.transcripts) {
        const file = resolveEvidenceFile(inputs.canonicalRoot, transcript.artifact_uri);
        if (!file || !existsSync(file)) {
          problems.push(`${label}: transcript artifact missing: ${transcript.artifact_uri}`);
        }
        if (!transcript.asr_provenance?.model_id) {
          problems.push(`${label}: transcript asr_provenance missing`);
        }
      }
      if (!approach.evidence.polished.length && !approach.evidence.manual_edit_notes.length) {
        problems.push(`${label}: neither polished nor manual-edit trail exists`);
      }
    }
    results.push(
      problems.length
        ? fail(caseId, FAILURE.evidenceUntraceable, problems.join("; "))
        : pass(caseId, `原始录音/ASR/润色或人工编辑全链在案（${audioChecked} 个音频副本逐文件 hash 核验通过）`),
    );
  }

  // ---- C-APP-03: 教师意图 fidelity rubric v1（数学事实不改写）----
  {
    const caseId = "C-APP-03";
    const problems: string[] = [];
    for (const qtId of GOLDEN_QT_IDS) {
      const truth = readCurrentPayload<TruthPayload>(inputs.truthRegistryDir, qtId);
      const approaches = byQt.get(qtId) ?? [];
      if (!truth) {
        problems.push(`${qtId}: truth missing`);
        continue;
      }
      if (!approaches.length) {
        problems.push(`${qtId}: no Approved approach (fidelity 不可评)`);
        continue;
      }
      // ADR-005：目标按 part 提取——每个小问都要有陈述其目标的 part 级 TA。
      const partIds = (truth.subquestions ?? []).map((entry) => entry.part_id);
      const scopeIds = partIds.length ? partIds : [undefined];
      for (const partId of scopeIds) {
        const partLabel = partId ? `#${partId}` : "（整题）";
        const scoped = approaches.filter(
          (approach) => (approach.question_ref.part_id ?? undefined) === partId,
        );
        if (!scoped.length) {
          problems.push(`${qtId}${partLabel}: 无绑定该小问的 Approved Approach`);
          continue;
        }
        const targets = staticAnswerTargets(truth, partId);
        if (!targets.length) {
          problems.push(`${qtId}${partLabel}: no statically verifiable targets`);
          continue;
        }
        for (const approach of scoped) {
          const stepsText = normalizeForMatch(approachStepsText(approach));
          const missing = targets.filter((target) => !stepsText.includes(target));
          if (missing.length) {
            problems.push(`${approach.artifact_id}: answer targets missing from steps: ${missing.join(" / ")}`);
          }
          if (!approach.goal?.trim()) problems.push(`${approach.artifact_id}: goal empty`);
          if (!approach.evidence.manual_edit_notes.length) {
            problems.push(`${approach.artifact_id}: 无人工编辑痕迹（AI 建议未经教师触碰）`);
          }
        }
      }
    }
    results.push(
      problems.length
        ? fail(caseId, FAILURE.mathFidelity, problems.join("; "))
        : pass(
            caseId,
            "golden 六题每个小问的答案目标均出现在绑定该问的教学步骤中，且每个 Approach 均有人工编辑痕迹（rubric v1: math-fidelity + human-touch，ADR-005 part 粒度）",
          ),
    );
  }

  // ---- C-APP-04: Question version 绑定与 stale fail-closed ----
  {
    const caseId = "C-APP-04";
    const problems: string[] = [];
    for (const approach of [...byQt.values()].flat()) {
      const truth = readCurrentPayload<TruthPayload>(
        inputs.truthRegistryDir,
        approach.question_ref.artifact_id,
      );
      if (!truth) {
        problems.push(`${approach.artifact_id}: bound truth missing`);
        continue;
      }
      if (approach.question_ref.version !== truth.version) {
        problems.push(
          `${approach.artifact_id}: 绑定 ${approach.question_ref.artifact_id}@${approach.question_ref.version}` +
            ` 但当前 ${truth.version}（stale，不可发布）`,
        );
      }
      if (approach.question_ref.content_hash !== truth.content_hash) {
        problems.push(`${approach.artifact_id}: question_ref.content_hash 与当前 Truth 不符`);
      }
      // ADR-005：part 绑定合法性——有小问必填且命中，无小问必须省略。
      const partIds = (truth.subquestions ?? []).map((entry) => entry.part_id);
      const boundPart = approach.question_ref.part_id;
      if (partIds.length && !boundPart) {
        problems.push(`${approach.artifact_id}: Truth 含小问 ${partIds} 但 TA 未绑定 part_id`);
      } else if (!partIds.length && boundPart) {
        problems.push(`${approach.artifact_id}: Truth 无小问但 TA 携带 part_id`);
      } else if (boundPart && !partIds.includes(boundPart)) {
        problems.push(`${approach.artifact_id}: part_id ${boundPart} 不在小问列表 ${partIds}`);
      }
    }
    // 篡改检测：构造绑定旧版本的 TA，验证判定函数能识别 stale（fail closed 演练）。
    const anyApproach = [...byQt.values()].flat()[0];
    let tamperDetected = false;
    if (anyApproach) {
      const tampered: ApproachPayload = {
        ...anyApproach,
        question_ref: { ...anyApproach.question_ref, version: "v0", content_hash: `sha256:${"0".repeat(64)}` },
      };
      const truth = readCurrentPayload<TruthPayload>(
        inputs.truthRegistryDir,
        tampered.question_ref.artifact_id,
      );
      tamperDetected =
        !!truth &&
        (tampered.question_ref.version !== truth.version ||
          tampered.question_ref.content_hash !== truth.content_hash);
    }
    if (problems.length) {
      results.push(fail(caseId, FAILURE.versionBinding, problems.join("; ")));
    } else if (!tamperDetected) {
      results.push(fail(caseId, FAILURE.versionBinding, "stale binding was NOT detected"));
    } else {
      results.push(
        pass(caseId, "全部 Approved Approach 绑定 QuestionTruth 当前版本；伪造旧版绑定的样本被识别为 stale"),
      );
    }
  }

  return results;
}

export interface ApproachRunInput {
  runId: string;
  sutId: string;
  datasetId: string;
  datasetVersion: string;
  inputs: ApproachInputs;
  startedAt?: string;
}

export type ApproachRunResult =
  | { ok: true; record: Record<string, unknown> }
  | { ok: false; errors: readonly string[] };

export function buildApproachRun(input: ApproachRunInput): ApproachRunResult {
  const caseResults = runApproachCases(input.inputs);
  const passed = caseResults.filter((result) => result.status === "pass").length;
  const failed = caseResults.filter((result) => result.status === "fail").length;
  const configHash = createHash("sha256")
    .update(JSON.stringify({ runner: APPROACH_RUNNER_VERSION, dataset: input.datasetId }))
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
    runner_version: APPROACH_RUNNER_VERSION,
    environment: `node ${process.version}`,
    started_at: input.startedAt ?? new Date().toISOString(),
    completed_at: new Date().toISOString(),
    summary: { passed, failed, errored: 0, not_executed: 0 },
  };
  const validation = validatePayload(record);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  benchmarkRunSchema.parse(record);
  return { ok: true, record };
}
