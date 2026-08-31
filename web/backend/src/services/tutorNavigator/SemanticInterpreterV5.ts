/**
 * SemanticInterpreterV5（F5 — Session 与 Protocol Navigator 内核；R3 并轨，2026-08-31）。
 *
 * ADR-007 §3 第一层：把学生表达映射为带置信度的 reasoning-location、意图与
 * 证据假设——**只产假设，不产决策**；Navigator 是确定性裁决者，interpreter
 * 输出可推翻（Navigator 引用前必须自行验证，如 accept_alternate_path 前复核
 * SV 真实存在于 RG）。
 *
 * ## R3 并轨（计划 §5 R3 工作项 3）
 *
 * 自然语言输入（submit_answer / ask_question / request_scaffold /
 * request_rephrase 且携带 text）**不再独立跑字符串解释器**：同一次
 * ModelGateAdjudicatorV5 调用返回 intent（response_kind）+ reasoning location +
 * grounding + Gate verdict，经 `hypothesisFromAdjudication` 映射为结构化假设
 * （含 gate_assessment——编排层据此落 gate_evaluated 事实）。workspace command /
 * confirmation / timeout / 无文本求助仍走确定性解释（`interpretStudentInput`）。
 *
 * - **五类 reasoning_alignment 事件表达保留**（由模型结果填充）：pass→
 *   expected_region（regionInferenceIds 推导，推导不出引用即省略，不伪造）；
 *   fail→incorrect_reasoning（anchored=被错误结论锚定的 fact）；unclear→
 *   unclear_reasoning；no_progress 仅 silence（编排入口）。
 * - **confidence 为服务端确定性映射**（按 response_kind×verdict 常量表），不依赖
 *   模型自报（R3 输出形状无 confidence 字段）。
 * - **残留字符串逻辑只用于选择**：matchFacts/matchVariants（归一化 LCS）服务于
 *   裁决上下文的相关 Fact 挑选与替代路线候选提示，**不得决定 gate satisfied**
 *   （R3 工作项 2；旧 LCS/否定词/数字全集裁决路径已删除）。
 * - 不变量保留：Navigator 引用 matched_variant_id 前自行复核（可推翻假设）。
 *
 * 只持久化结构化假设（canonical 事件 payload 的 intent/reasoning_location/
 * confidence/interpreter_version/grounding_refs/reasoning_focus/
 * reasoning_alignment），不持久化模型私有推理（ADR-007 不变量 5）。
 */
import { regionInferenceIds, type NavigatorBeatView, type NavigatorPlanV5 } from "./NavigatorPlanV5";
import type { GateAdjudicationResult } from "./ModelGateAdjudicatorV5";

export const INTERPRETER_V5_VERSION = "semantic-interpreter/v5-deterministic";
/** 模型并轨路径的 interpreter_version（事件流可区分裁决人）。 */
export const MODEL_INTERPRETER_V5_VERSION = "model-gate-adjudicator/v5";

export type IntentKind =
  | "submit_answer"
  | "submit_workspace_command"
  | "confirm"
  | "continue"
  | "ask_question"
  | "request_scaffold"
  | "request_rephrase"
  | "replay_narration"
  | "barge_in"
  | "return_to_mainline"
  | "retry_recovery";

export type ReasoningLocation = "aligned" | "partially_aligned" | "misaligned" | "unknown";

/** 09:1118 五类 ReasoningAlignment（kind + 按类强制引用集，合同形状）。 */
export interface ReasoningAlignment {
  readonly kind: "expected_region" | "alternate_valid_path" | "incorrect_reasoning" | "unclear_reasoning" | "no_progress";
  readonly fact_ids?: readonly string[];
  readonly inference_ids?: readonly string[];
  readonly anchored_fact_ids?: readonly string[];
}

/** state/v1 reasoning_focus 同构形状（R0 §1：携带即覆写、缺省不动）。 */
export interface ReasoningFocusPayload {
  readonly part_id?: string;
  readonly graph_fact_refs: readonly string[];
}

/** 编排层已验证的模型 Gate 裁决（随假设流转；evaluator 消费，不直接持久化）。 */
export interface HypothesisGateAssessment {
  readonly verdict: GateAdjudicationResult["verdict"];
  readonly matched_gate_id?: string;
  readonly evidence_sequence?: number;
}

/** 结构化假设（canonical 可持久字段；canonical schema 同构子集）。 */
export interface InterpretationHypothesis {
  readonly intent: string;
  readonly reasoning_location: ReasoningLocation;
  readonly confidence: number;
  readonly interpreter_version: string;
  readonly grounding_refs?: readonly string[];
  readonly reasoning_focus?: ReasoningFocusPayload;
  readonly reasoning_alignment?: ReasoningAlignment;
}

/** interpreter 内部推导（不持久化；供 Navigator 验证后使用——可推翻假设的载体）。 */
export interface NavigatorInterpretation extends InterpretationHypothesis {
  /** 命中的 RG fact（Navigator 复核存在于 plan.facts 后才可使用）。 */
  readonly matched_fact_id?: string;
  /** 命中替代路线 variant（SV-xx；Navigator 复核 solution_variants 后才可使用）。 */
  readonly matched_variant_id?: string;
  /** 话题是否在批准题目边界内（ask_question 的 in/out-of-bound 判定依据）。 */
  readonly in_bound: boolean;
  /**
   * R3：同一次模型调用返回的 Gate verdict（服务端已复核候选集与 canonical
   * 引用）。GateEvidenceEvaluatorV5 消费；确定性路径（confirmation 等）不带。
   */
  readonly gate_assessment?: HypothesisGateAssessment;
}

const NORMALIZE_PUNCTUATION = /[，。、；：？！,.;:?!\s()（）【】\[\]$\\{}]/g;

/** 与 ReasoningAligner 同口径的文本归一化（全角→半角、LaTeX sqrt、去标点）。 */
export function normalizeForInterpretation(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\\sqrt\{([^}]*)\}/g, "√$1")
    .replace(NORMALIZE_PUNCTUATION, "");
}

function longestCommonRun(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let best = 0;
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}

export const INTERPRETATION_MATCH_THRESHOLD = 4;

/**
 * 匹配分值（确定性）：归一化 LCS 为主口径（对账 ReasoningAligner，阈值 4）；
 * 短值事实（如 goal fact "$BE=1$" 归一化后仅 3–4 字符）以「完整基串被包含」
 * 为辅口径——基串归一化长度 ≥3 且学生文本完整包含时按基串长度计分，避免
 * 结构性漏配；长度 <3 的基串不得参与包含判定（防止 "1" 之类万能命中）。
 *
 * R3 后仅用于**选择**相关 Fact/候选（上下文组装），不参与 gate satisfied。
 */
function matchScore(text: string, basis: string): number {
  const normalizedText = normalizeForInterpretation(text);
  const normalizedBasis = normalizeForInterpretation(basis);
  const lcs = longestCommonRun(normalizedText, normalizedBasis);
  if (normalizedBasis.length >= 3 && normalizedBasis.length <= 8 && normalizedText.includes(normalizedBasis)) {
    return Math.max(lcs, normalizedBasis.length);
  }
  return lcs;
}

export function interpretationMatchScore(text: string, basis: string): number {
  return matchScore(text, basis);
}

/** 自然语言意图集合（携带 text 时经模型并轨路径；R3 工作项 3）。 */
const NATURAL_LANGUAGE_INTENTS: ReadonlySet<IntentKind> = new Set([
  "submit_answer",
  "ask_question",
  "request_scaffold",
  "request_rephrase",
]);

/** 该输入是否走模型裁决路径（自然语言意图 + 非空文本）。 */
export function isNaturalLanguageInput(intentKind: IntentKind, text: string | undefined): boolean {
  return text !== undefined && text.length > 0 && NATURAL_LANGUAGE_INTENTS.has(intentKind);
}

// --------------------------------------------------------------------------- //
// alignment / focus 构造
// --------------------------------------------------------------------------- //

function expectedRegionAlignment(
  plan: NavigatorPlanV5,
  factIds: readonly string[],
): ReasoningAlignment | undefined {
  const inferenceIds = regionInferenceIds(plan, factIds);
  if (inferenceIds.length === 0) return undefined; // 推导不出推理步 ⇒ 按合同省略，不伪造
  return { kind: "expected_region", fact_ids: [...factIds], inference_ids: inferenceIds };
}

function incorrectReasoningAlignment(anchoredFactIds: readonly string[]): ReasoningAlignment {
  return { kind: "incorrect_reasoning", anchored_fact_ids: [...anchoredFactIds] };
}

function focusOn(partId: string | undefined, factIds: readonly string[]): ReasoningFocusPayload {
  return { ...(partId !== undefined ? { part_id: partId } : {}), graph_fact_refs: [...factIds] };
}

export interface FactMatch {
  fact_id: string;
  score: number;
  in_current_beat: boolean;
}

/** 文本对 RG 全部 facts 的匹配表（R3：仅用于相关 Fact 选择/上下文组装）。 */
export function matchFacts(plan: NavigatorPlanV5, text: string, beat: NavigatorBeatView): FactMatch[] {
  const beatFacts = new Set(beat.graph_fact_refs);
  const matches: FactMatch[] = [];
  for (const fact of plan.facts.values()) {
    matches.push({
      fact_id: fact.fact_id,
      score: matchScore(text, fact.statement),
      in_current_beat: beatFacts.has(fact.fact_id),
    });
  }
  return matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.in_current_beat !== right.in_current_beat) return left.in_current_beat ? -1 : 1;
    return left.fact_id < right.fact_id ? -1 : 1;
  });
}

/** 替代路线匹配：solution variant 的 goal fact + RG inference derivation 作基准（R3：仅选择用）。 */
export function matchVariants(plan: NavigatorPlanV5, text: string): { variant_id: string; score: number }[] {
  const matches: { variant_id: string; score: number }[] = [];
  for (const variant of plan.solution_variants) {
    const goal = plan.facts.get(variant.goal_fact_id);
    let score = goal ? matchScore(text, goal.statement) : 0;
    for (const inferenceId of variant.inference_ids) {
      const inference = plan.graph_inferences?.get(inferenceId);
      if (inference) score = Math.max(score, matchScore(text, inference.derivation));
    }
    matches.push({ variant_id: variant.variant_id, score });
  }
  return matches.sort((left, right) => right.score - left.score);
}

export interface InterpretInput {
  readonly intent_kind: IntentKind;
  readonly text?: string;
  /** 当前导航位置的 Beat（mainline 或 inquiry 内 Beat）。 */
  readonly beat: NavigatorBeatView;
}

/** Assistance 意图（ask_question/request_scaffold/request_rephrase）低置信阈值。 */
export const ASSISTANCE_CONFIDENT_THRESHOLD = 0.6;

/**
 * 确定性语义解释（纯函数）：**结构化/无文本输入**专用（R3 并轨后）。
 * 自然语言（NL 意图 + 非空 text）必须走 `hypothesisFromAdjudication`（同一次
 * 模型调用返回 intent+location+grounding+verdict），此处显式拒绝——防止编排
 * 层漏接模型路径后静默回退字符串解释（fail loudly，不 fail silently）。
 * 同一输入重复执行得到相同假设（G5 确定性在决策层验证，此处是其输入）。
 */
export function interpretStudentInput(
  plan: NavigatorPlanV5,
  input: InterpretInput,
): NavigatorInterpretation {
  const beat = input.beat;
  const grounding = [...beat.graph_fact_refs];
  if (isNaturalLanguageInput(input.intent_kind, input.text)) {
    throw new Error(
      `natural-language input (${input.intent_kind} with text) must be adjudicated by ModelGateAdjudicatorV5 (R3); interpretStudentInput only handles structured/no-text input`,
    );
  }

  switch (input.intent_kind) {
    case "confirm":
    case "continue":
    case "return_to_mainline": {
      // 主线确认/推进：对当前 Beat 焦点 aligned（确认类意图不携带新推理位置——
      // 无具体子区域，reasoning_focus 缺省，reducer 不改 focus）。
      const regionAlignment = expectedRegionAlignment(plan, beat.graph_fact_refs);
      return {
        intent: input.intent_kind,
        reasoning_location: "aligned",
        confidence: 0.9,
        interpreter_version: INTERPRETER_V5_VERSION,
        grounding_refs: grounding,
        ...(regionAlignment ? { reasoning_alignment: regionAlignment } : {}),
        in_bound: true,
      };
    }
    case "replay_narration":
    case "retry_recovery":
      return {
        intent: input.intent_kind,
        reasoning_location: "unknown",
        confidence: 0.5,
        interpreter_version: INTERPRETER_V5_VERSION,
        in_bound: true,
      };
    case "barge_in":
      // barge-in 是瞬时行为（student-intent 合同：不推进教学状态）；位置未知。
      return {
        intent: "barge_in",
        reasoning_location: "unknown",
        confidence: 0.4,
        interpreter_version: INTERPRETER_V5_VERSION,
        in_bound: true,
      };
    case "submit_workspace_command":
      return {
        intent: "submit_workspace_command",
        reasoning_location: "aligned",
        confidence: 0.85,
        interpreter_version: INTERPRETER_V5_VERSION,
        grounding_refs: grounding,
        in_bound: true,
      };
    case "ask_question":
    case "request_scaffold":
    case "request_rephrase": {
      // 无文本求助（结构化意图）：意图本身在批准边界内（低信息量、不定位子区域）。
      return {
        intent: input.intent_kind,
        reasoning_location: "aligned",
        confidence: 0.8,
        interpreter_version: INTERPRETER_V5_VERSION,
        in_bound: true,
      };
    }
    case "submit_answer": {
      // submit_answer 无文本：canonical 规定 submit_answer 必带 text（编排层守卫）；
      // 到达此处即输入畸形——不可判读假设（不强迫分类；PRD 04 §6 口径）。
      return {
        intent: "submit_answer",
        reasoning_location: "unknown",
        confidence: 0.3,
        interpreter_version: INTERPRETER_V5_VERSION,
        reasoning_alignment: { kind: "unclear_reasoning" },
        in_bound: true,
      };
    }
    default: {
      const exhaustive: never = input.intent_kind;
      throw new Error(`unsupported intent kind: ${String(exhaustive)}`);
    }
  }
}

// --------------------------------------------------------------------------- //
// R3 模型并轨：GateAdjudicationResult → NavigatorInterpretation（确定性映射）
// --------------------------------------------------------------------------- //

/** 服务端确定性置信常量（不依赖模型自报）。 */
const CONFIDENCE_BY_KIND: Record<GateAdjudicationResult["response_kind"], number> = {
  final_answer: 0.9,
  alternate_path: 0.75,
  question: 0.8,
  help_request: 0.8,
  restatement: 0.4,
  mixed_or_ambiguous: 0.3,
};

export interface HypothesisFromAdjudicationInput {
  readonly plan: NavigatorPlanV5;
  readonly beat: NavigatorBeatView;
  readonly intent_kind: IntentKind;
  readonly text: string;
  /** 服务端校验后的模型裁决。 */
  readonly adjudication: GateAdjudicationResult;
  /** 学生输入事件 sequence（gate satisfied 时的 evidence_sequence）。 */
  readonly evidence_sequence: number;
}

/**
 * 同一次模型调用 → 结构化假设（intent/reasoning_location/grounding/focus/
 * 五类 alignment/gate verdict）。grounding 只保留 pinned RG 内的 fact id
 * （服务端 canonical 采信）；推导不出区域推理步即按合同省略 alignment。
 */
export function hypothesisFromAdjudication(
  input: HypothesisFromAdjudicationInput,
): NavigatorInterpretation {
  const { plan, beat, adjudication } = input;
  const gateAssessment: HypothesisGateAssessment = {
    verdict: adjudication.verdict,
    ...(adjudication.matched_gate_id !== undefined ? { matched_gate_id: adjudication.matched_gate_id } : {}),
    evidence_sequence: input.evidence_sequence,
  };
  // canonical 引用过滤：focus/alignment 只消费 RG fact；SV- id 只用于 grounding_refs
  // 与 matched_variant_id（graph_fact_refs 词表要求 FN- 形状）。
  const factRefs = adjudication.grounding_refs.filter((ref) => plan.facts.has(ref));
  const primaryFact = factRefs[0];

  switch (adjudication.response_kind) {
    case "final_answer": {
      if (adjudication.verdict === "pass") {
        const region = primaryFact !== undefined ? expectedRegionAlignment(plan, [primaryFact]) : undefined;
        return {
          intent: input.intent_kind,
          reasoning_location: adjudication.reasoning_location === "partially_aligned" ? "partially_aligned" : "aligned",
          confidence: CONFIDENCE_BY_KIND.final_answer,
          interpreter_version: MODEL_INTERPRETER_V5_VERSION,
          ...(factRefs.length ? { grounding_refs: [...factRefs] } : {}),
          ...(primaryFact !== undefined
            ? {
                matched_fact_id: primaryFact,
                reasoning_focus: focusOn(beat.part_id, [primaryFact]),
                ...(region ? { reasoning_alignment: region } : {}),
              }
            : {}),
          in_bound: true,
          gate_assessment: gateAssessment,
        };
      }
      if (adjudication.verdict === "fail") {
        // 学生最终主张不满足标准：incorrect_reasoning，anchored=被错误结论锚定
        // 的 fact（无 canonical 锚点时降为 unclear——不伪造引用）。
        if (factRefs.length) {
          return {
            intent: input.intent_kind,
            reasoning_location: "misaligned",
            confidence: 0.7,
            interpreter_version: MODEL_INTERPRETER_V5_VERSION,
            grounding_refs: [...factRefs],
            matched_fact_id: primaryFact,
            reasoning_focus: focusOn(beat.part_id, [primaryFact]),
            reasoning_alignment: incorrectReasoningAlignment([primaryFact]),
            in_bound: true,
            gate_assessment: gateAssessment,
          };
        }
        return {
          intent: input.intent_kind,
          reasoning_location: "unknown",
          confidence: CONFIDENCE_BY_KIND.mixed_or_ambiguous,
          interpreter_version: MODEL_INTERPRETER_V5_VERSION,
          reasoning_alignment: { kind: "unclear_reasoning" },
          in_bound: true,
          gate_assessment: gateAssessment,
        };
      }
      // unclear / not_applicable（矛盾、多解释、证据不足、复述不构成证据）。
      return {
        intent: input.intent_kind,
        reasoning_location: "unknown",
        confidence: CONFIDENCE_BY_KIND.mixed_or_ambiguous,
        interpreter_version: MODEL_INTERPRETER_V5_VERSION,
        ...(factRefs.length ? { grounding_refs: [...factRefs] } : {}),
        reasoning_alignment: { kind: "unclear_reasoning" },
        in_bound: true,
        gate_assessment: gateAssessment,
      };
    }
    case "alternate_path": {
      // 替代路线：服务端复核 variant 真实存在于 pinned RG（canonical id 采信；
      // 优先 SV- id 自报，回退 goal fact 匹配——多 variant 共享 goal fact 时
      // 只信显式 variant id）。Navigator 引用前仍自行复核——可推翻假设。
      const variant =
        plan.solution_variants.find((entry) => adjudication.grounding_refs.includes(entry.variant_id)) ??
        plan.solution_variants.find((entry) => adjudication.grounding_refs.includes(entry.goal_fact_id));
      const goalFact = variant ? plan.facts.get(variant.goal_fact_id) : undefined;
      if (variant && goalFact) {
        return {
          intent: `${input.intent_kind}:alternate_route`,
          reasoning_location: "aligned",
          confidence: CONFIDENCE_BY_KIND.alternate_path,
          interpreter_version: MODEL_INTERPRETER_V5_VERSION,
          grounding_refs: [...new Set([variant.variant_id, variant.goal_fact_id])],
          matched_variant_id: variant.variant_id,
          reasoning_focus: focusOn(beat.part_id, [goalFact.fact_id]),
          reasoning_alignment: {
            kind: "alternate_valid_path",
            fact_ids: [variant.goal_fact_id],
            inference_ids: [...variant.inference_ids],
          },
          in_bound: true,
          // 替代路线不是当前 gate 的证据（R1 语义）：即便模型对路线自身给 pass，
          // 对当前门的 assessment 也只记 not_applicable（服务端薄边界，防误用）。
          gate_assessment: { ...gateAssessment, verdict: "not_applicable" },
        };
      }
      // 无法在 RG 内核实的替代路线假设：不可判读（不采信、不推进）。
      return {
        intent: input.intent_kind,
        reasoning_location: "unknown",
        confidence: CONFIDENCE_BY_KIND.mixed_or_ambiguous,
        interpreter_version: MODEL_INTERPRETER_V5_VERSION,
        reasoning_alignment: { kind: "unclear_reasoning" },
        in_bound: true,
        gate_assessment: { ...gateAssessment, verdict: gateAssessment.verdict === "pass" ? "unclear" : gateAssessment.verdict },
      };
    }
    case "question":
    case "help_request": {
      // 提问/求助：in_bound=是否有 canonical grounding（R3 口径：模型引用批准
      // 内容 ⇔ 话题在批准题目边界内）；无引用 → out-of-bound 假设。
      const inBound = factRefs.length > 0;
      const region = primaryFact !== undefined ? expectedRegionAlignment(plan, [primaryFact]) : undefined;
      return {
        intent: inBound ? input.intent_kind : `${input.intent_kind}:out_of_bound`,
        reasoning_location: inBound ? "aligned" : "unknown",
        confidence: inBound ? CONFIDENCE_BY_KIND[input.intent_kind === "ask_question" ? "question" : "help_request"] : 0.3,
        interpreter_version: MODEL_INTERPRETER_V5_VERSION,
        ...(factRefs.length ? { grounding_refs: [...factRefs] } : {}),
        ...(inBound && primaryFact !== undefined
          ? {
              matched_fact_id: primaryFact,
              reasoning_focus: focusOn(beat.part_id, [primaryFact]),
              ...(region ? { reasoning_alignment: region } : {}),
            }
          : { reasoning_alignment: { kind: "unclear_reasoning" } }),
        in_bound: inBound,
        gate_assessment: gateAssessment,
      };
    }
    case "restatement": {
      // 复述题目/资料：非完成证据（verdict 由模型给 not_applicable；服务端
      // response_kind_not_evidence 守卫已保证不得 pass）。
      return {
        intent: `${input.intent_kind}:restatement`,
        reasoning_location: "unknown",
        confidence: CONFIDENCE_BY_KIND.restatement,
        interpreter_version: MODEL_INTERPRETER_V5_VERSION,
        ...(factRefs.length ? { grounding_refs: [...factRefs] } : {}),
        reasoning_alignment: { kind: "unclear_reasoning" },
        in_bound: true,
        gate_assessment: gateAssessment,
      };
    }
    case "mixed_or_ambiguous":
    default: {
      // 不可判读 / 模型故障降级（degraded_reason 存在时 verdict 恒 unclear）：
      // 不强迫分类（PRD 04 §6）；gate 不满足（模型失败 ≠ student incorrect）。
      return {
        intent: input.intent_kind,
        reasoning_location: "unknown",
        confidence: CONFIDENCE_BY_KIND.mixed_or_ambiguous,
        interpreter_version: MODEL_INTERPRETER_V5_VERSION,
        ...(factRefs.length ? { grounding_refs: [...factRefs] } : {}),
        reasoning_alignment: { kind: "unclear_reasoning" },
        in_bound: true,
        gate_assessment: gateAssessment,
      };
    }
  }
}

/**
 * 无进展假设（R0 §1：no_progress 来自无进展证据——silence/timeout/无新事实）。
 * 由编排入口（NavigatorSessionV5.reportSilence）在 silence 证据出现时落
 * semantic_interpretation_recorded 事实（intent_kind 词表无 silence，intent
 * 为自由字符串，canonical 合同允许）。
 */
export function noProgressHypothesis(): NavigatorInterpretation {
  return {
    intent: "silence",
    reasoning_location: "unknown",
    confidence: 0.2,
    interpreter_version: INTERPRETER_V5_VERSION,
    reasoning_alignment: { kind: "no_progress" },
    in_bound: true,
  };
}

/** canonical semantic_interpretation_recorded payload（持久化的结构化假设子集）。 */
export function hypothesisEventPayload(hypothesis: NavigatorInterpretation): {
  intent: string;
  reasoning_location: ReasoningLocation;
  confidence: number;
  interpreter_version: string;
  grounding_refs?: string[];
  reasoning_focus?: { part_id?: string; graph_fact_refs: string[] };
  reasoning_alignment?: {
    kind: ReasoningAlignment["kind"];
    fact_ids?: string[];
    inference_ids?: string[];
    anchored_fact_ids?: string[];
  };
} {
  const focus = hypothesis.reasoning_focus;
  const alignment = hypothesis.reasoning_alignment;
  return {
    intent: hypothesis.intent,
    reasoning_location: hypothesis.reasoning_location,
    confidence: hypothesis.confidence,
    interpreter_version: hypothesis.interpreter_version,
    ...(hypothesis.grounding_refs && hypothesis.grounding_refs.length
      ? { grounding_refs: [...hypothesis.grounding_refs] }
      : {}),
    ...(focus
      ? { reasoning_focus: { ...(focus.part_id !== undefined ? { part_id: focus.part_id } : {}), graph_fact_refs: [...focus.graph_fact_refs] } }
      : {}),
    ...(alignment
      ? {
          reasoning_alignment: {
            kind: alignment.kind,
            ...(alignment.fact_ids ? { fact_ids: [...alignment.fact_ids] } : {}),
            ...(alignment.inference_ids ? { inference_ids: [...alignment.inference_ids] } : {}),
            ...(alignment.anchored_fact_ids ? { anchored_fact_ids: [...alignment.anchored_fact_ids] } : {}),
          },
        }
      : {}),
  };
}
