/**
 * Canonical 只读 reader（Phase 4 / P4-02）。
 *
 * 读取 skills 仓 canonical-authoring 注册表（question-truth / teaching-approach /
 * approach-set / tutor-plan）。规则（fail closed）：
 * 1. 只读 registry current_version 指向的版本，且必须 Approved；
 * 2. 版本文件 content_hash 用同规则重算核验，漂移即拒绝（ADR-004 三元组）；
 * 3. Question/Approach 支持 v1/v2/v3 按 schema 常量分派；
 * 4. v2 skill_ids 在 Build 层只作 provisional hint（P4-02），本模块不消费。
 *
 * TutorPlan 的 content_hash 排除集在 QT/TA 共用集之上增加 runtime_projection
 * （materializer 输出，不是 plan 内容），保证 Draft→Approved 添加 approval 与
 * runtime_projection 时 content_hash 不变。
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

const CONTENT_HASH_EXCLUDED_BASE = new Set([
  "content_hash",
  "status",
  "superseded_by",
  "approval",
  "version",
  "artifact_uri",
]);

const PLAN_CONTENT_HASH_EXCLUDED = new Set([
  ...CONTENT_HASH_EXCLUDED_BASE,
  "runtime_projection",
]);

/** 与 skills 仓 canonical_export._content_hash 同规则；plans 额外排除 runtime_projection。 */
export function canonicalHash(payload: Record<string, unknown>, kind: "authoring" | "plan"): string {
  const excluded = kind === "plan" ? PLAN_CONTENT_HASH_EXCLUDED : CONTENT_HASH_EXCLUDED_BASE;
  const content: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    if (!excluded.has(key)) content[key] = payload[key];
  }
  return `sha256:${createHash("sha256").update(JSON.stringify(content), "utf8").digest("hex")}`;
}

// --------------------------------------------------------------------------- //
// 载荷类型（canonical JSON 的最小只读视图）
// --------------------------------------------------------------------------- //
export interface CanonicalAnswer {
  kind: "numeric" | "expression" | "text" | "proof" | "choice_option";
  value: string;
  acceptance?: string[];
  range_constraint?: string;
  options?: Array<{ id: string; value: string }>;
}

export interface TruthSubquestion {
  part_id: string;
  prompt: string;
  canonical_answer: CanonicalAnswer;
  reviewed_solution: string;
}

export interface TruthPayload {
  schema: string;
  artifact_id: string;
  version: string;
  status: string;
  question_type: string;
  stem: string;
  subquestions?: TruthSubquestion[];
  canonical_answer?: CanonicalAnswer;
  reviewed_solution?: string;
  content_hash: string;
  approval?: { reviewer_id: string; approved_at: string; review_note?: string };
}

export interface TeachingStepPayload {
  step_id: string;
  intent: string;
  narration: string;
  expected_student_reasoning: string;
  accepted_alternatives?: string[];
  common_errors?: string[];
  skill_ids?: string[];
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
  steps: TeachingStepPayload[];
  approval?: { reviewer_id: string; approved_at: string; review_note?: string };
  content_hash: string;
}

export interface ApproachSetPayload {
  schema: string;
  artifact_id: string;
  version: string;
  status: string;
  question_ref: { artifact_id: string; version: string; content_hash: string };
  parts: Array<{
    part_id?: string;
    approach: { artifact_id: string; version: string; content_hash: string };
    alternates?: Array<{ artifact_id: string; version: string; content_hash: string }>;
    note?: string;
  }>;
  cross_part_rhythm?: string;
  content_hash: string;
}

export interface PlanResourceV2 {
  resource_id: string;
  kind:
    | "explanation"
    | "hint"
    | "diagnostic_probe"
    | "repair"
    | "action_template"
    | "workspace"
    | "voice_seed";
  checkpoint_id?: string;
  assistance_level?: number;
  source: "authored" | "reused" | "agent_generated";
  content?: string;
  action_ref?: string;
  capability?: string;
  target_ids?: string[];
}

export interface PlanCheckpointV2 {
  checkpoint_id: string;
  part_id: string;
  expected_reasoning: string;
  accepted_alternatives?: string[];
  common_deviations?: string[];
  skippable?: boolean;
  skill_annotations?: Array<{
    skill_id: string;
    rationale: string;
    evidence_refs: string[];
  }>;
  unmapped_skill_reason?: string;
  resource_ids?: string[];
}

export interface TutorPlanV2Payload {
  schema: "ai_teaching_tutor_plan_bundle/v2";
  artifact_id: string;
  version: string;
  status: string;
  question_ref: { artifact_id: string; version: string; content_hash: string };
  approach_refs: Array<{
    artifact_id: string;
    version: string;
    content_hash: string;
    part_id: string;
  }>;
  recommended_routes: Array<{
    route_id: string;
    role: "primary" | "alternate";
    part_id?: string;
    entry_condition?: string;
    checkpoint_ids: string[];
    completion_condition: string;
  }>;
  checkpoints: PlanCheckpointV2[];
  resources: PlanResourceV2[];
  policy_constraints: {
    allowed_move_types: string[];
    allowed_capabilities: string[];
    forbidden_content_kinds: string[];
    maximum_assistance_level: number;
    assessment_enabled: false;
  };
  build_provenance: {
    provider: string;
    model_id: string;
    workflow_version: string;
    run_id: string;
    built_at: string;
    runtime_registry_version: string;
  };
  runtime_projection?: {
    materializer_version: string;
    runtime_registry_version: string;
    projection_hash: string;
    validation_status: "passed";
  };
  approval?: { reviewer_id: string; approved_at: string; review_note?: string };
  content_hash: string;
  artifact_uri: string;
}

// --------------------------------------------------------------------------- //
// 注册表读取
// --------------------------------------------------------------------------- //
export interface CanonicalRegistries {
  /** canonical-authoring 根（artifact:// 解析与各 registry 目录的父目录）。 */
  readonly canonicalRoot: string;
}

function registryDir(root: string, namespace: "question-truth" | "teaching-approach" | "approach-set" | "tutor-plan"): string {
  return path.join(root, namespace);
}

function readRegistryCurrent(registryRoot: string, artifactId: string): string | null {
  const registryPath = path.join(registryRoot, artifactId, "registry.yaml");
  if (!existsSync(registryPath)) return null;
  const match = /current_version:\s*(v\d+)/.exec(readFileSync(registryPath, "utf8"));
  return match ? match[1] : null;
}

function readVersionPayload<T extends { content_hash: string; status: string }>(
  registryRoot: string,
  artifactId: string,
  version: string,
): T | null {
  const versionPath = path.join(registryRoot, artifactId, `${version}.json`);
  if (!existsSync(versionPath)) return null;
  return JSON.parse(readFileSync(versionPath, "utf8")) as T;
}

export type LoadResult<T> = { ok: true; payload: T } | { ok: false; errors: string[] };

function loadCurrentApproved<T extends { content_hash: string; status: string; artifact_id: string }>(
  registryRoot: string,
  artifactId: string,
  hashKind: "authoring" | "plan",
): LoadResult<T> {
  const current = readRegistryCurrent(registryRoot, artifactId);
  if (!current) return { ok: false, errors: [`${artifactId}: registry/current_version 缺失`] };
  const payload = readVersionPayload<T>(registryRoot, artifactId, current);
  if (!payload) return { ok: false, errors: [`${artifactId}@${current}: 版本文件缺失`] };
  if (payload.status !== "Approved") {
    return { ok: false, errors: [`${artifactId}@${current}: status=${payload.status}，只有 Approved 可消费`] };
  }
  const recomputed = canonicalHash(payload as unknown as Record<string, unknown>, hashKind);
  if (recomputed !== payload.content_hash) {
    return { ok: false, errors: [`${artifactId}@${current}: content_hash 漂移（注册表与文件不一致）`] };
  }
  return { ok: true, payload };
}

export function loadApprovedTruth(inputs: CanonicalRegistries, qtId: string): LoadResult<TruthPayload> {
  return loadCurrentApproved<TruthPayload>(registryDir(inputs.canonicalRoot, "question-truth"), qtId, "authoring");
}

export function loadApprovedApproach(inputs: CanonicalRegistries, taId: string): LoadResult<ApproachPayload> {
  return loadCurrentApproved<ApproachPayload>(registryDir(inputs.canonicalRoot, "teaching-approach"), taId, "authoring");
}

export function loadApprovedApproachSet(inputs: CanonicalRegistries, asId: string): LoadResult<ApproachSetPayload> {
  return loadCurrentApproved<ApproachSetPayload>(registryDir(inputs.canonicalRoot, "approach-set"), asId, "authoring");
}

export function loadCurrentPlan(inputs: CanonicalRegistries, tpId: string): LoadResult<TutorPlanV2Payload> {
  return loadCurrentApproved<TutorPlanV2Payload>(registryDir(inputs.canonicalRoot, "tutor-plan"), tpId, "plan");
}

/** questions 的 part 列表；无小问的整题返回约定 part "1"。 */
export function truthPartIds(truth: TruthPayload): string[] {
  const parts = (truth.subquestions ?? []).map((entry) => entry.part_id);
  return parts.length ? parts : ["1"];
}

/** part 的 canonical_answer；无小问时回退整题顶层。 */
export function truthAnswerForPart(truth: TruthPayload, partId: string): CanonicalAnswer | undefined {
  if (truth.subquestions?.length) {
    return truth.subquestions.find((entry) => entry.part_id === partId)?.canonical_answer;
  }
  return truth.canonical_answer;
}

/** part 的 reviewed_solution；无小问时回退整题顶层。 */
export function truthSolutionForPart(truth: TruthPayload, partId: string): string | undefined {
  if (truth.subquestions?.length) {
    return truth.subquestions.find((entry) => entry.part_id === partId)?.reviewed_solution;
  }
  return truth.reviewed_solution;
}

/**
 * skills 仓 teaching_approach.approaches_for_question 的 TS 镜像：
 * 扫描 teaching-approach 注册表，返回绑定该题且 current Approved 的全部 TA。
 * 只做发现与过滤，不做 stale 改写。
 */
export function approvedApproachesForQuestion(
  inputs: CanonicalRegistries,
  qtId: string,
): ApproachPayload[] {
  const root = registryDir(inputs.canonicalRoot, "teaching-approach");
  if (!existsSync(root)) return [];
  const found: ApproachPayload[] = [];
  for (const entry of readdirSync(root)) {
    if (!/^TA-[A-Z0-9]+-\d+$/.test(entry)) continue;
    const result = loadCurrentApproved<ApproachPayload>(root, entry, "authoring");
    if (result.ok && result.payload.question_ref.artifact_id === qtId) {
      found.push(result.payload);
    }
  }
  return found.sort((a, b) => a.artifact_id.localeCompare(b.artifact_id));
}

/** 为题目定位 Approved ApproachSet（golden 6 题）；无则返回 null。 */
export function findApproachSetForQuestion(
  inputs: CanonicalRegistries,
  qtId: string,
): ApproachSetPayload | null {
  const root = registryDir(inputs.canonicalRoot, "approach-set");
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root)) {
    if (!/^AS-[A-Z0-9]+-\d+$/.test(entry)) continue;
    const result = loadCurrentApproved<ApproachSetPayload>(root, entry, "authoring");
    if (result.ok && result.payload.question_ref.artifact_id === qtId) return result.payload;
  }
  return null;
}
