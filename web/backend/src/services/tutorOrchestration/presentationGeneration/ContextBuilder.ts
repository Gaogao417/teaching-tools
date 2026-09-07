/**
 * PresentationContextBuilder（F7 RT2 — 上下文构建；上下文展开执行规格）。
 *
 * expand 是**上下文操作**：为当前教学任务补充相关批准图依据，不改变
 * Navigator/Beat/Gate/Inquiry/验证目标或教学 cursor（本模块无任何写入能力，
 * 纯只读计算）。
 *
 * 输出 = canonical state/v4 GenerationContextRef（plan_ref/graph_ref/selected
 * ids/resource_ids/event_cutoff/workspace_revision）+ 来源 digest + 可渲染依据
 * 条目（RT3 Presenter prompt 消费）。同请求重试消费同一冻结快照（digest 不变）；
 * 策略升级只影响新任务。
 *
 * 失败语义（规格 Interfaces；内部错误不自行映射 HTTP）：
 * - CONTEXT_UNAVAILABLE：无有效依据（beat 零 refs 且无扩充来源）；
 * - CONTEXT_BUDGET_EXCEEDED：当前任务必需的最小依据组超出预算（明确失败，
 *   不截断半组）；
 * - CONTEXT_LOOKUP_FAILED：引用在 pinned 图内不存在（流/资产损坏防御）；
 * - STALE_CONTEXT：cutoff/workspace 快照与权威状态不一致；
 * - CONTEXT_FORBIDDEN：越权引用（私有答案在无授权时请求进入上下文）。
 *
 * 预算纪律（规格 Invariants）：按**完整依据组**截断——每条 inference 连同其全部
 * premises 构成一个组；可选组整组省略并登记 context_truncated，核心组（当前
 * Beat 自身 refs 及其前提闭包）不可省略；核心组超预算 ⇒ CONTEXT_BUDGET_EXCEEDED。
 * 权限纪律：reveals_answer=true 的 fact 仅当其已属于当前 Beat 计划内容
 * （beat.graph_fact_refs）才可进入上下文——更多模型上下文不扩大答案揭示权限。
 */
import { createHash } from "node:crypto";

import { generationContextRefSchema } from "../../../../../shared/canonical";
import type { GraphFactNode, GraphInferenceNode } from "../../planBuild/canonicalInputs";

/** 构建器版本（presenter_generation_pin.context_builder_version 引用）。 */
export const CONTEXT_BUILDER_VERSION = "presentation-context-builder/v1";

/** 版本化选取策略（可配置迭代；不是教学状态机规则）。 */
export interface ContextSelectionPolicy {
  readonly policy_version: string;
  /** 不同 fact 数量预算。 */
  readonly max_facts: number;
  /** 不同 inference 数量预算。 */
  readonly max_inferences: number;
  /** 依据文本近似字符预算（防 prompt 失控；不截断单个公式/事实）。 */
  readonly max_total_chars: number;
  /** 是否对选中 inference 做前提闭包（缺前提的结论组不可选）。 */
  readonly include_prerequisites: boolean;
  /** 是否携带 Beat 绑定的 voice_seed/support 资源内容。 */
  readonly include_support_resources: boolean;
  /** 学生输入引用窗口（最近 N 条；首段讲解允许 0）。 */
  readonly recent_input_count: number;
}

export const DEFAULT_CONTEXT_POLICY: ContextSelectionPolicy = {
  policy_version: "context-policy/v1",
  max_facts: 14,
  max_inferences: 8,
  max_total_chars: 4_000,
  include_prerequisites: true,
  include_support_resources: true,
  recent_input_count: 3,
};

export type ContextBuildFailureKind =
  | "CONTEXT_UNAVAILABLE"
  | "CONTEXT_BUDGET_EXCEEDED"
  | "CONTEXT_LOOKUP_FAILED"
  | "STALE_CONTEXT"
  | "CONTEXT_FORBIDDEN";

export class PresentationContextError extends Error {
  constructor(readonly kind: ContextBuildFailureKind, message: string) {
    super(message);
    this.name = "PresentationContextError";
  }
}

export interface ContextArtifactRef {
  readonly artifact_id: string;
  readonly version: string;
  readonly content_hash: string;
}

export interface ContextBeatRef {
  readonly protocol_id: string;
  readonly beat_id: string;
  /** 当前 Beat 计划内容引用（核心组）。 */
  readonly graph_fact_refs: readonly string[];
  readonly inference_refs: readonly string[];
  /** Beat 绑定资源（voice_seed/support/explanation 进入引用表）。 */
  readonly resource_ids: readonly string[];
}

export interface ContextGraphIndex {
  readonly facts: ReadonlyMap<string, GraphFactNode>;
  readonly inferences: ReadonlyMap<string, GraphInferenceNode>;
}

/** 学生输入引用（事件序列号 + 通道 + 可选文本；ASR/键盘同型）。 */
export interface ContextRecentInput {
  readonly sequence: number;
  readonly channel: "mainline" | "assistance";
  readonly text?: string;
}

export interface ContextBuildInput {
  readonly planRef: ContextArtifactRef;
  readonly graphRef: ContextArtifactRef;
  readonly graph: ContextGraphIndex;
  readonly beat: ContextBeatRef;
  /** 当前 chunk 可展开 region 的 fine refs（追问时的扩充候选；缺省=无扩充）。 */
  readonly regionFineRefs?: { readonly fact_ids: readonly string[]; readonly inference_ids: readonly string[] };
  /** 最近语义聚焦（推理卡点定位的种子）。 */
  readonly reasoningFocusFactIds?: readonly string[];
  /** 学生输入引用（空=首段讲解合法）。 */
  readonly recentInputs: readonly ContextRecentInput[];
  /** 冻结时已提交事件数（GenerationContextRef.event_cutoff）。 */
  readonly eventCutoff: number;
  /** 冻结时 workspace revision。 */
  readonly workspaceRevision: number;
  /** 权威状态当前 revision（一致性校验用）。 */
  readonly currentRevision: number;
  readonly policy: ContextSelectionPolicy;
  /** 资源内容解析器（voice_seed/support 文本；缺省=无资源文本进入 prompt）。 */
  readonly resourceContent?: (resourceId: string) => string | undefined;
  /** 会话模式（assessment 无教学生成——防御性拒绝）。 */
  readonly sessionMode: "teaching" | "assessment";
}

/** prompt 可渲染依据条目（来源审计与摘要的最小结构）。 */
export interface ContextBasisItem {
  readonly ref: string;
  readonly kind: "fact" | "inference" | "resource";
  readonly rank: "core" | "focus" | "region";
  readonly text: string;
}

export interface BuiltPresentationContext {
  readonly context: {
    plan_ref: ContextArtifactRef;
    graph_ref: ContextArtifactRef;
    selected_fact_ids: readonly string[];
    selected_inference_ids: readonly string[];
    resource_ids: readonly string[];
    event_cutoff: number;
    workspace_revision: number;
  };
  /** 同请求重试固定的来源 digest（sha256:…；canonical JSON 排序键）。 */
  readonly digest: string;
  readonly basis: readonly ContextBasisItem[];
  /** 整组省略的可选 inference 组（context_truncated=true 的依据）。 */
  readonly truncated_inference_ids: readonly string[];
  readonly budget: { readonly facts: number; readonly inferences: number; readonly approx_chars: number };
}

function sha256Digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function approxChars(items: readonly ContextBasisItem[]): number {
  return items.reduce((total, item) => total + item.text.length, 0);
}

/**
 * 构建当前教学任务的生成上下文（纯函数；零 DB/导航写入）。
 * 顺序：核心组（Beat refs + 前提闭包）→ focus 组（reasoning focus）→
 * region 组（可展开 fine refs）；预算按组裁剪，核心组不可裁。
 */
export function buildPresentationContext(input: ContextBuildInput): BuiltPresentationContext {
  if (input.sessionMode === "assessment") {
    throw new PresentationContextError(
      "CONTEXT_FORBIDDEN",
      "assessment sessions have no teaching presentation context (fail closed)",
    );
  }
  if (input.eventCutoff > input.currentRevision) {
    throw new PresentationContextError(
      "STALE_CONTEXT",
      `event cutoff ${input.eventCutoff} is ahead of the authoritative revision ${input.currentRevision} (re-read authoritative state; never reuse a stale request context)`,
    );
  }
  const { facts, inferences } = input.graph;
  if (facts.size === 0 && inferences.size === 0) {
    throw new PresentationContextError("CONTEXT_UNAVAILABLE", "pinned solution graph index is empty (no approved basis)");
  }

  // ---- 权限过滤：reveals_answer fact 只在已属当前 Beat 计划内容时可见。 ----
  const factVisible = (factId: string): boolean => {
    const fact = facts.get(factId);
    if (!fact) return false;
    if (!fact.reveals_answer) return true;
    return input.beat.graph_fact_refs.includes(factId);
  };

  // ---- 核心组：Beat 自身 refs +（可选）前提闭包。 ----
  const coreFactIds = new Set<string>();
  const coreInferenceIds = new Set<string>();
  for (const factId of input.beat.graph_fact_refs) {
    if (!facts.has(factId)) {
      throw new PresentationContextError(
        "CONTEXT_LOOKUP_FAILED",
        `beat ${input.beat.beat_id} references fact ${factId} which is not in the pinned graph (corrupt import; fail closed)`,
      );
    }
    if (factVisible(factId)) coreFactIds.add(factId);
    else {
      throw new PresentationContextError(
        "CONTEXT_FORBIDDEN",
        `beat ${input.beat.beat_id} planning refs include answer-revealing fact ${factId} outside its authorized reveal set (private answer must not enter model context)`,
      );
    }
  }
  const addInferenceWithPremises = (inferenceId: string, targetFacts: Set<string>, targetInferences: Set<string>): void => {
    const inference = inferences.get(inferenceId);
    if (!inference) {
      throw new PresentationContextError(
        "CONTEXT_LOOKUP_FAILED",
        `inference ${inferenceId} referenced for beat ${input.beat.beat_id} is not in the pinned graph (corrupt import; fail closed)`,
      );
    }
    targetInferences.add(inferenceId);
    if (!input.policy.include_prerequisites) return;
    for (const premise of inference.premises) {
      if (!facts.has(premise)) {
        throw new PresentationContextError(
          "CONTEXT_LOOKUP_FAILED",
          `inference ${inferenceId} premise ${premise} is not in the pinned graph (incomplete approval chain; fail closed)`,
        );
      }
      if (!factVisible(premise)) {
        throw new PresentationContextError(
          "CONTEXT_FORBIDDEN",
          `inference ${inferenceId} depends on answer-revealing premise ${premise} that the current task is not authorized to reveal (keep the complete basis or drop the whole group)`,
        );
      }
      targetFacts.add(premise);
    }
  };
  for (const inferenceId of input.beat.inference_refs) {
    addInferenceWithPremises(inferenceId, coreFactIds, coreInferenceIds);
  }

  // 核心组预算：不可裁剪——超限即明确失败（规格 Invariants）。
  if (coreFactIds.size > input.policy.max_facts || coreInferenceIds.size > input.policy.max_inferences) {
    throw new PresentationContextError(
      "CONTEXT_BUDGET_EXCEEDED",
      `core basis group for beat ${input.beat.beat_id} (${coreFactIds.size} facts / ${coreInferenceIds.size} inferences) exceeds the frozen budget (${input.policy.max_facts}/${input.policy.max_inferences}); the minimal required group cannot be truncated`,
    );
  }

  // ---- 可选组：focus（语义聚焦）→ region（细图 fine refs，expand 语义）。 ----
  interface OptionalGroup {
    readonly inferenceId: string;
    readonly facts: readonly string[];
  }
  const optionalGroups: OptionalGroup[] = [];
  const seenOptional = new Set<string>();
  const pushOptional = (inferenceId: string): void => {
    if (coreInferenceIds.has(inferenceId) || seenOptional.has(inferenceId)) return;
    const inference = inferences.get(inferenceId);
    if (!inference) {
      throw new PresentationContextError(
        "CONTEXT_LOOKUP_FAILED",
        `expansion references inference ${inferenceId} which is not in the pinned graph (fail closed)`,
      );
    }
    const groupFacts = new Set<string>();
    if (input.policy.include_prerequisites) {
      for (const premise of inference.premises) {
        if (!facts.has(premise)) {
          throw new PresentationContextError(
            "CONTEXT_LOOKUP_FAILED",
            `expansion inference ${inferenceId} premise ${premise} is missing from the pinned graph (fail closed)`,
          );
        }
        if (!factVisible(premise)) return; // 整组放弃：私有前提不可进入上下文（不截半组）。
        groupFacts.add(premise);
      }
    }
    // 结论为最终答案（reveals_answer）且不在当前 Beat 授权内的 inference：整组
    // 放弃——derivation 文本本身即答案揭示路径（RT1：IF-18/19 类只在既有披露
    // 许可下进入上下文；FN-23 不因 expand 自动揭示）。
    if (facts.has(inference.conclusion) && !factVisible(inference.conclusion)) return;
    seenOptional.add(inferenceId);
    optionalGroups.push({ inferenceId, facts: [...groupFacts] });
  };
  for (const factId of input.reasoningFocusFactIds ?? []) {
    if (!facts.has(factId)) {
      throw new PresentationContextError("CONTEXT_LOOKUP_FAILED", `reasoning focus fact ${factId} is not in the pinned graph (fail closed)`);
    }
    for (const inference of inferences.values()) {
      if (inference.premises.includes(factId) || inference.conclusion === factId) {
        pushOptional(inference.inference_id);
      }
    }
  }
  for (const inferenceId of input.regionFineRefs?.inference_ids ?? []) {
    pushOptional(inferenceId);
  }

  // ---- 按组纳入直到预算；整组省略登记 truncated。 ----
  const selectedFacts = new Set(coreFactIds);
  const selectedInferences = new Set(coreInferenceIds);
  const truncated: string[] = [];
  for (const group of optionalGroups) {
    const newFacts = group.facts.filter((factId) => !selectedFacts.has(factId));
    if (
      selectedFacts.size + newFacts.length > input.policy.max_facts
      || selectedInferences.size + 1 > input.policy.max_inferences
    ) {
      truncated.push(group.inferenceId);
      continue;
    }
    // 字符预算按整组评估（fact 文本 + inference derivation）。
    const projectedChars =
      approxChars(basisItems(input, selectedFacts, selectedInferences, coreFactIds, coreInferenceIds))
      + newFacts.reduce((total, factId) => total + (facts.get(factId)?.statement.length ?? 0), 0)
      + (inferences.get(group.inferenceId)?.derivation.length ?? 0);
    if (projectedChars > input.policy.max_total_chars) {
      truncated.push(group.inferenceId);
      continue;
    }
    for (const factId of newFacts) selectedFacts.add(factId);
    selectedInferences.add(group.inferenceId);
  }

  // ---- region fine facts（不带 inference 的直接扩充，如 FN-01/02 已授权前提）。 ----
  for (const factId of input.regionFineRefs?.fact_ids ?? []) {
    if (selectedFacts.has(factId) || coreFactIds.has(factId)) continue;
    if (!facts.has(factId)) {
      throw new PresentationContextError("CONTEXT_LOOKUP_FAILED", `region fact ${factId} is not in the pinned graph (fail closed)`);
    }
    // 可选候选的权限过滤 = 静默不进入（RT1：IF-18/19 与 FN-23 类内容只在既有
    // 披露许可下进入上下文；expand 从不扩大答案揭示权限）。核心组冲突才硬失败。
    if (!factVisible(factId)) continue;
    if (selectedFacts.size + 1 > input.policy.max_facts) {
      continue; // 单独 fact 视作独立组省略；不截断已有内容。
    }
    selectedFacts.add(factId);
  }

  if (selectedFacts.size === 0 && selectedInferences.size === 0) {
    throw new PresentationContextError(
      "CONTEXT_UNAVAILABLE",
      `beat ${input.beat.beat_id} resolves to an empty context (no core refs and no expansion candidates)`,
    );
  }

  const basis = basisItems(input, selectedFacts, selectedInferences, coreFactIds, coreInferenceIds);
  const resourceIds = [...input.beat.resource_ids];

  const context = {
    plan_ref: input.planRef,
    graph_ref: input.graphRef,
    selected_fact_ids: [...selectedFacts].sort(),
    selected_inference_ids: [...selectedInferences].sort(),
    resource_ids: resourceIds,
    event_cutoff: input.eventCutoff,
    workspace_revision: input.workspaceRevision,
  };
  const canonical = generationContextRefSchema.safeParse(context);
  if (!canonical.success) {
    throw new PresentationContextError(
      "CONTEXT_LOOKUP_FAILED",
      `built context fails canonical GenerationContextRef validation: ${canonical.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return {
    context,
    digest: sha256Digest({ context, policy_version: input.policy.policy_version, builder: CONTEXT_BUILDER_VERSION }),
    basis,
    truncated_inference_ids: truncated,
    budget: { facts: selectedFacts.size, inferences: selectedInferences.size, approx_chars: approxChars(basis) },
  };
}

function basisItems(
  input: ContextBuildInput,
  factIds: ReadonlySet<string>,
  inferenceIds: ReadonlySet<string>,
  coreFactIds: ReadonlySet<string>,
  coreInferenceIds: ReadonlySet<string>,
): ContextBasisItem[] {
  const items: ContextBasisItem[] = [];
  for (const factId of factIds) {
    const fact = input.graph.facts.get(factId);
    if (fact) {
      items.push({ ref: factId, kind: "fact", rank: coreFactIds.has(factId) ? "core" : "region", text: fact.statement });
    }
  }
  for (const inferenceId of inferenceIds) {
    const inference = input.graph.inferences.get(inferenceId);
    if (inference) {
      items.push({
        ref: inferenceId,
        kind: "inference",
        rank: coreInferenceIds.has(inferenceId) ? "core" : "region",
        text: `${inference.derivation}（前提：${inference.premises.join("、")} → 结论：${inference.conclusion}）`,
      });
    }
  }
  if (input.policy.include_support_resources) {
    for (const resourceId of input.beat.resource_ids) {
      const content = input.resourceContent?.(resourceId);
      if (content) items.push({ ref: resourceId, kind: "resource", rank: "core", text: content });
    }
  }
  return items;
}
