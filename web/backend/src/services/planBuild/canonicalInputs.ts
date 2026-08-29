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
 * F4 复验修复（2026-08-29，G4 证据撤回后的 P1 修复）：
 * 5. loader 层 canonical schema 校验——每个被装载的 payload 一律经
 *    web/shared/canonical 的 39-schema dispatch（按 `schema` 常量分派各代
 *    Zod schema）校验，schema 非法即拒绝（此前仅 TP/PR 在 materializer 校验，
 *    QT/AS/RG/PP 可被"schema 非法但重算 hash 自洽"的伪造 artifact 绕过）；
 * 6. registry 锚定三方对账——CanonicalRegistries.anchored=true 时（v4 供应链
 *    import/发布 CLI），registry.yaml 的 current 版本条目必须携带 content_hash
 *    且 payload.content_hash == registry 锚定 hash == 重算 hash（同版本文件被
 *    覆盖并重算自身 hash 时，registry 锚定值不再匹配即拒绝）。
 *
 * TutorPlan 的 content_hash 排除集在 QT/TA 共用集之上增加 runtime_projection
 * （materializer 输出，不是 plan 内容），保证 Draft→Approved 添加 approval 与
 * runtime_projection 时 content_hash 不变。
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";

import { validatePayload } from "../../../../shared/canonical";

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

export interface TutorPlanV3Payload extends Omit<TutorPlanV2Payload, "schema"> {
  schema: "ai_teaching_tutor_plan_bundle/v3";
  approach_set_ref: { artifact_id: string; version: string; content_hash: string };
  policy_profile_ref: { profile_id: string; version: string; content_hash: string };
}

export interface TopicQuestionTeachingBindingPayload {
  schema: "ai_teaching_topic_question_binding/v1";
  artifact_id: string;
  version: string;
  status: string;
  task_id: string;
  scenario_id: string;
  question_ref: { artifact_id: string; version: string; content_hash: string };
  teaching_variants: Array<{
    approach_set_ref: { artifact_id: string; version: string; content_hash: string };
    tutor_plan_ref: { artifact_id: string; version: string; content_hash: string };
    role: "default" | "alternate";
  }>;
  content_hash: string;
}

export interface TutorPolicyProfilePayload {
  schema: string;
  artifact_id: string;
  version: string;
  status: string;
  profile_version: string;
  primary_provider: "deepseek-langgraph" | "deterministic-rules";
  fallback_provider: "deepseek-langgraph" | "deterministic-rules";
  model_id: string;
  prompt_version: string;
  content_hash: string;
}

// --------------------------------------------------------------------------- //
// F4（2026-08-28）：planning/v4 合同载荷（RG / PR / TP v4）的最小只读视图。
// content_hash 规则：RG/PR 用 authoring 排除集；TP v4 用 plan 排除集
// （与 v2/v3 一致——额外排除 runtime_projection，为后续投影留位，v4 合同
// 本身 additionalProperties:false 不携带该字段）。
// --------------------------------------------------------------------------- //
export type GraphFactRole = "given" | "goal" | "derived" | "intermediate_value";

export interface GraphFactNode {
  fact_id: string;
  role: GraphFactRole;
  statement: string;
  part_id?: string;
  reveals_answer: boolean;
  evidence_refs?: string[];
  reviewed_solution_step?: string;
  skill_refs?: string[];
}

export interface GraphInferenceNode {
  inference_id: string;
  premises: string[];
  conclusion: string;
  derivation: string;
  evidence_refs?: string[];
  reviewed_solution_step?: string;
}

export interface SolutionVariantNode {
  variant_id: string;
  name?: string;
  goal_fact_id: string;
  inference_ids: string[];
}

export interface ReviewedSolutionGraphPayload {
  schema: "ai_teaching_reviewed_solution_graph/v1";
  graph_id: string;
  version: string;
  status: string;
  approval?: { reviewer_id: string; approved_at: string; review_note?: string };
  question_ref: { artifact_id: string; version: string; content_hash: string };
  approach_ref?: { artifact_id: string; version: string; content_hash: string };
  facts: GraphFactNode[];
  inferences: GraphInferenceNode[];
  solution_variants: SolutionVariantNode[];
  content_hash: string;
  artifact_uri: string;
}

export interface ProtocolBeatPayload {
  beat_id: string;
  part_id?: string;
  purpose: string;
  graph_fact_refs: string[];
  cognitive_activity: "attend" | "recall" | "relate" | "apply" | "verify" | "explain";
  completion_evidence: {
    evidence_kind:
      | "student_answer"
      | "workspace_command"
      | "student_confirmation"
      | "narration_completed"
      | "explicit_gate_pass"
      | "tutor_observed";
    gate?: {
      gate_id: string;
      requirement: string;
      graph_fact_id?: string;
      capability?: string;
    };
  };
  participation: "listen" | "answer" | "operate" | "confirm" | "continue";
  pacing: { wait_policy: "student_driven" | "bounded_wait"; max_wait_seconds?: number };
  presentation_intent: { voice: Array<"narrate" | "question" | "feedback">; workspace_surfaces: Array<"geometry" | "solution_board"> };
  resource_ids?: string[];
  support_boundary: {
    may_reveal_answer: false;
    may_reveal_intermediate: boolean;
    max_support: "orient" | "foreground" | "name_strategy" | "specify_operation" | "provide_intermediate_conclusion";
  };
  transitions: Array<{ to_beat: string; on: "gate_satisfied" | "evidence_collected" | "student_request" | "timeout" | "tutor_discretion" }>;
  inquiry_branch?: {
    inquiry_protocol_ref: { artifact_id: string; version: string; content_hash: string };
    return_beat_id: string;
    trigger?: "ask_question" | "request_scaffold" | "request_rephrase" | "unclear" | "out_of_bound";
  };
}

export interface TeachingProtocolPayload {
  schema: "ai_teaching_teaching_protocol/v1";
  protocol_id: string;
  version: string;
  status: string;
  approval?: { reviewer_id: string; approved_at: string; review_note?: string };
  question_ref: { artifact_id: string; version: string; content_hash: string };
  solution_graph_ref: { artifact_id: string; version: string; content_hash: string };
  protocol_kind: "mainline" | "inquiry" | "scaffold" | "verification";
  entry_beat_id: string;
  beats: ProtocolBeatPayload[];
  content_hash: string;
  artifact_uri: string;
}

export interface PlanResourceV4 {
  resource_id: string;
  kind: "explanation" | "diagnostic_probe" | "repair" | "action_template" | "workspace" | "voice_seed" | "support";
  beat_ref?: string;
  source: "authored" | "reused" | "agent_generated";
  content?: string;
  graph_fact_refs?: string[];
}

export interface TutorPlanV4Payload {
  schema: "ai_teaching_tutor_plan_bundle/v4";
  artifact_id: string;
  version: string;
  status: string;
  approval?: { reviewer_id: string; approved_at: string; review_note?: string };
  question_ref: { artifact_id: string; version: string; content_hash: string };
  approach_set_ref: { artifact_id: string; version: string; content_hash: string };
  solution_graph_ref: { artifact_id: string; version: string; content_hash: string };
  policy_profile_ref: { artifact_id: string; version: string; content_hash: string };
  chunks: Array<{
    chunk_id: string;
    part_id?: string;
    protocol_refs: Array<{ artifact_id: string; version: string; content_hash: string }>;
    resource_ids?: string[];
  }>;
  resources: PlanResourceV4[];
  build_provenance: {
    provider: string;
    model_id: string;
    workflow_version: string;
    run_id: string;
    built_at: string;
    runtime_registry_version: string;
    compiler_version: string;
    materializer_version: string;
  };
  content_hash: string;
  artifact_uri: string;
}

// --------------------------------------------------------------------------- //
// 注册表读取
// --------------------------------------------------------------------------- //
export interface CanonicalRegistries {
  /** canonical-authoring 根（artifact:// 解析与各 registry 目录的父目录）。 */
  readonly canonicalRoot: string;
  /**
   * F4 复验修复（2026-08-29）：true 时启用 registry 锚定三方对账
   * （payload.content_hash == registry current 版本条目的 content_hash ==
   * 重算 hash）。v4 供应链（ImportApprovedPlanV4 / build-approved-plan-v4 CLI）
   * 必须置 true；legacy v2/v3 消费链默认关闭（兼容既有合成 registry 的测试面）。
   */
  readonly anchored?: boolean;
}

function registryDir(root: string, namespace: "question-truth" | "teaching-approach" | "approach-set" | "tutor-plan" | "reviewed-solution-graph" | "teaching-protocol" | "tutor-policy-profile"): string {
  return path.join(root, namespace);
}

export interface RegistryCurrent {
  readonly current: string;
  /** registry.yaml 对 current 版本锚定的 content_hash；未锚定时为 null。 */
  readonly anchoredHash: string | null;
}

function readRegistryCurrent(registryRoot: string, artifactId: string): RegistryCurrent | null {
  const registryPath = path.join(registryRoot, artifactId, "registry.yaml");
  if (!existsSync(registryPath)) return null;
  const text = readFileSync(registryPath, "utf8");
  const match = /current_version:\s*(v\d+)/.exec(text);
  if (!match) return null;
  let anchoredHash: string | null = null;
  try {
    const parsed = parseYaml(text) as { versions?: Array<{ version?: string; content_hash?: string }> };
    const entry = (parsed.versions ?? []).find((item) => item?.version === match[1]);
    anchoredHash = typeof entry?.content_hash === "string" ? entry.content_hash : null;
  } catch {
    anchoredHash = null;
  }
  return { current: match[1], anchoredHash };
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

/**
 * 已登记的跨仓镜像分歧容差（F4 复验修复 2026-08-29，ledger 偏差 7）：
 * skills 仓 Python 发布器（canonical_export.py）对无批注的 QuestionTruth 写
 * `approval.review_note: null`，canonical JSON Schema 与 TS Zod 镜像要求
 * string（Pydantic 镜像 str|None 放行）。已发布 49 个 QT current 版本携带
 * null，canonical 版本不可变（ADR-004），故校验副本上将「null 批注」按「无
 * 批注」处理（仅删除该键，不改写任何文件）。处置走向（canonical 增加
 * nullable 或升版重发）须走 PRDS 合同流程，不由本仓裁决。
 */
const QT_NULL_REVIEW_NOTE_TOLERATED = new Set([
  "ai_teaching_question_truth/v1",
  "ai_teaching_question_truth/v2",
]);

function schemaValidationCopy(payload: Record<string, unknown>): Record<string, unknown> {
  if (!QT_NULL_REVIEW_NOTE_TOLERATED.has(String(payload.schema))) return payload;
  const approval = payload.approval as Record<string, unknown> | undefined;
  if (!approval || approval.review_note !== null) return payload;
  const approvalClone = { ...approval };
  delete approvalClone.review_note;
  return { ...payload, approval: approvalClone };
}

function loadCurrentApproved<T extends { content_hash: string; status: string; schema?: string }>(
  registryRoot: string,
  artifactId: string,
  hashKind: "authoring" | "plan",
  options: { anchored?: boolean } = {},
): LoadResult<T> {
  const registry = readRegistryCurrent(registryRoot, artifactId);
  if (!registry) return { ok: false, errors: [`${artifactId}: registry/current_version 缺失`] };
  const current = registry.current;
  const payload = readVersionPayload<T>(registryRoot, artifactId, current);
  if (!payload) return { ok: false, errors: [`${artifactId}@${current}: 版本文件缺失`] };
  if (payload.status !== "Approved") {
    return { ok: false, errors: [`${artifactId}@${current}: status=${payload.status}，只有 Approved 可消费`] };
  }
  // canonical schema 校验（39-schema dispatch；fail closed，含未知 schema 常量）
  const schemaCheck = validatePayload(schemaValidationCopy(payload as unknown as Record<string, unknown>));
  if (!schemaCheck.ok) {
    return {
      ok: false,
      errors: [`${artifactId}@${current}: canonical schema 校验失败（schema 非法）: ${schemaCheck.errors.join("; ")}`],
    };
  }
  const recomputed = canonicalHash(payload as unknown as Record<string, unknown>, hashKind);
  if (recomputed !== payload.content_hash) {
    return { ok: false, errors: [`${artifactId}@${current}: content_hash 漂移（注册表与文件不一致）`] };
  }
  // registry 锚定三方对账（anchored=true：v4 供应链 fail closed）
  if (options.anchored) {
    if (registry.anchoredHash === null) {
      return {
        ok: false,
        errors: [`${artifactId}@${current}: registry.yaml 未对 current 版本锚定 content_hash（v4 供应链要求 per-version 锚定）`],
      };
    }
    if (registry.anchoredHash !== payload.content_hash) {
      return {
        ok: false,
        errors: [
          `${artifactId}@${current}: registry 锚定 hash 与版本文件不一致（同版本被覆盖或 registry/文件不一致）` +
            `（registry ${registry.anchoredHash.slice(0, 19)}… / 文件 ${payload.content_hash.slice(0, 19)}…）`,
        ],
      };
    }
  }
  return { ok: true, payload };
}

export function loadApprovedTruth(inputs: CanonicalRegistries, qtId: string): LoadResult<TruthPayload> {
  return loadCurrentApproved<TruthPayload>(registryDir(inputs.canonicalRoot, "question-truth"), qtId, "authoring", { anchored: inputs.anchored });
}

export function loadApprovedApproach(inputs: CanonicalRegistries, taId: string): LoadResult<ApproachPayload> {
  return loadCurrentApproved<ApproachPayload>(registryDir(inputs.canonicalRoot, "teaching-approach"), taId, "authoring", { anchored: inputs.anchored });
}

export function loadApprovedApproachSet(inputs: CanonicalRegistries, asId: string): LoadResult<ApproachSetPayload> {
  return loadCurrentApproved<ApproachSetPayload>(registryDir(inputs.canonicalRoot, "approach-set"), asId, "authoring", { anchored: inputs.anchored });
}

export function loadCurrentPlan(inputs: CanonicalRegistries, tpId: string): LoadResult<TutorPlanV2Payload> {
  return loadCurrentApproved<TutorPlanV2Payload>(registryDir(inputs.canonicalRoot, "tutor-plan"), tpId, "plan", { anchored: inputs.anchored });
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
    const result = loadCurrentApproved<ApproachPayload>(root, entry, "authoring", { anchored: inputs.anchored });
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
    const result = loadCurrentApproved<ApproachSetPayload>(root, entry, "authoring", { anchored: inputs.anchored });
    if (result.ok && result.payload.question_ref.artifact_id === qtId) return result.payload;
  }
  return null;
}

/**
 * 装载 current Approved TutorPlan v3（Phase 5 UI 集成）。
 * 在 loadCurrentPlan 的 hash/status 规则之上增加 schema 常量校验：
 * v3 Plan 必须携带 approach_set_ref 与 policy_profile_ref（fail closed）。
 */
export function loadCurrentPlanV3(inputs: CanonicalRegistries, tpId: string): LoadResult<TutorPlanV3Payload> {
  const result = loadCurrentApproved<TutorPlanV3Payload>(
    registryDir(inputs.canonicalRoot, "tutor-plan"),
    tpId,
    "plan",
    { anchored: inputs.anchored },
  );
  if (!result.ok) return result;
  if (result.payload.schema !== "ai_teaching_tutor_plan_bundle/v3") {
    return {
      ok: false,
      errors: [`${tpId}: 期望 tutor_plan_bundle/v3（集成 UI 只开放 v3），实际 ${result.payload.schema}`],
    };
  }
  return result;
}

/** 装载 current Approved TutorPolicyProfile（Plan 级 Provider 路由）。 */
export function loadApprovedPolicyProfile(
  inputs: CanonicalRegistries,
  ppId: string,
): LoadResult<TutorPolicyProfilePayload> {
  return loadCurrentApproved<TutorPolicyProfilePayload>(
    path.join(inputs.canonicalRoot, "tutor-policy-profile"),
    ppId,
    "authoring",
    { anchored: inputs.anchored },
  );
}

/**
 * F4（2026-08-28）：装载 current Approved ReviewedSolutionGraph（planning/v4）。
 * 与 QT/TA 相同的 fail-closed 规则：registry current_version 指向的版本必须
 * Approved 且 content_hash 用同规则重算一致（ADR-004 三元组）。
 */
export function loadApprovedSolutionGraph(
  inputs: CanonicalRegistries,
  rgId: string,
): LoadResult<ReviewedSolutionGraphPayload> {
  return loadCurrentApproved<ReviewedSolutionGraphPayload>(
    registryDir(inputs.canonicalRoot, "reviewed-solution-graph"),
    rgId,
    "authoring",
    { anchored: inputs.anchored },
  );
}

/** F4：装载 current Approved TeachingProtocol（planning/v4；mainline/inquiry/scaffold/verification）。 */
export function loadApprovedTeachingProtocol(
  inputs: CanonicalRegistries,
  prId: string,
): LoadResult<TeachingProtocolPayload> {
  return loadCurrentApproved<TeachingProtocolPayload>(
    registryDir(inputs.canonicalRoot, "teaching-protocol"),
    prId,
    "authoring",
    { anchored: inputs.anchored },
  );
}

/**
 * F4：装载 current Approved TutorPlan v4（planning/v4 chunks→protocol_refs）。
 * 在通用 Approved+hash 规则之上增加 schema 常量校验（fail closed）：
 * v3 消费链（topicQuestionExperience）与 v4 供应链按 schema 常量分道，
 * 互不误读对方的 current_version。
 */
export function loadCurrentPlanV4(
  inputs: CanonicalRegistries,
  tpId: string,
): LoadResult<TutorPlanV4Payload> {
  const result = loadCurrentApproved<TutorPlanV4Payload>(
    registryDir(inputs.canonicalRoot, "tutor-plan"),
    tpId,
    "plan",
    { anchored: inputs.anchored },
  );
  if (!result.ok) return result;
  if (result.payload.schema !== "ai_teaching_tutor_plan_bundle/v4") {
    return {
      ok: false,
      errors: [`${tpId}: 期望 tutor_plan_bundle/v4（F4 供应链只开放 v4），实际 ${result.payload.schema}`],
    };
  }
  return result;
}

/**
 * 扫描 topic-question-binding 注册表，返回绑定该 taskId 且 current Approved
 * 的全部 Binding（发现与过滤；stale/hash 对账在 topicQuestionExperience 层）。
 */
export function approvedBindingsForTask(
  inputs: CanonicalRegistries,
  taskId: string,
): TopicQuestionTeachingBindingPayload[] {
  const root = path.join(inputs.canonicalRoot, "topic-question-binding");
  if (!existsSync(root)) return [];
  const found: TopicQuestionTeachingBindingPayload[] = [];
  for (const entry of readdirSync(root)) {
    if (!/^TB-[A-Z0-9]+-\d+$/.test(entry)) continue;
    const result = loadCurrentApproved<TopicQuestionTeachingBindingPayload>(root, entry, "authoring", { anchored: inputs.anchored });
    if (result.ok && result.payload.task_id === taskId) found.push(result.payload);
  }
  return found.sort((a, b) => a.artifact_id.localeCompare(b.artifact_id));
}
