/**
 * SemanticInterpreterV5（F5 — Session 与 Protocol Navigator 内核）。
 *
 * ADR-007 §3 第一层：把学生表达映射为带置信度的 reasoning-location、意图与
 * 证据假设——**只产假设，不产决策**；Navigator 是确定性裁决者，interpreter
 * 输出可推翻（Navigator 引用前必须自行验证，如 accept_alternate_path 前复核
 * SV 真实存在于 RG）。
 *
 * MVP 为确定性 interpreter（f5-scope-ledger「明确不做」：模型驱动解释器属
 * F6+，本轮固化假设接口与可推翻语义）：归一化最长公共子串（LCS ≥ 4）匹配
 * 口径对账自 ReasoningAligner（f0-dependency-ledger §1 F5 行复用资产；以 v4
 * Beat/Gate/RG fact 为基准，不消费 v2 plan/checkpoint——不双轨）。
 *
 * ## 2026-08-31 R1 增补（R0 合同波次 §1/§2/§8.1 规格）
 *
 * - **reasoning_focus**：interpreter 识别出学生推理所在的具体局部子图（命中
 *   fact / 替代路线 goal fact）时，假设携带 `reasoning_focus`
 *   `{part_id?, graph_fact_refs}`（与 state/v1 逐字段同构）。事件入流后由
 *   F2 reducer 整体覆写 state/v1 `reasoning_focus`（主线 TeachingCursor 不动
 *   ——学生追问旧推理区域是焦点转移，不是主线推进）；无具体子区域（确认类
 *   意图、不可判读）时缺省——reducer 不改 focus（存量流行为不变）。
 * - **reasoning_alignment（09:1118 五类，逐词对齐）**：
 *   - `expected_region(fact_ids, inference_ids)`——旧 aligned / partially_
 *     aligned（引用集限定已确认对齐子区域——R0 §1 映射表）；
 *   - `alternate_valid_path(fact_ids, inference_ids)`——替代路线命中
 *     （fact_ids=[variant goal fact]，inference_ids=variant.inference_ids）；
 *   - `incorrect_reasoning(anchored_fact_ids)`——旧 misaligned + 对抗负例
 *     （negation / 关键词正确结论错误 / answer stuffing，见下）；
 *   - `unclear_reasoning`——旧 unknown（不可判读，无引用集）；
 *   - `no_progress`——silence/timeout/无新事实（编排入口 reportSilence 产生）。
 *   旧 `reasoning_location` 4 值词表保持必填、照常产出（历史流兼容，映射见
 *   R0 §1 表）；`inference_ids` 推导规则 = regionInferenceIds（NavigatorPlanV5，
 *   conclusion 在区域内或 premises 全在区域内），推导不出（空集）时按合同
 *   省略 alignment，不伪造引用。
 * - **对抗守卫（确定性，章程「对抗负例必须覆盖」）**：关键词命中后追加
 *   三道守卫——① negation（显式否定标记 + 去否定文本仍命中 ⇒ 结论与事实
 *   相反）；② value contradiction（基串数字集 ⊄ 文本数字集 ⇒ 关键词正确但
 *   结论数值错误）；③ invented values（文本携带任何 RG fact 都不存在的数字
 *   ⇒ stuffing/编造）。任一命中 ⇒ `incorrect_reasoning`，anchored_fact_ids
 *   指向被错误结论锚定的 fact；GateEvidenceEvaluatorV5 复用同一守卫，被
 *   守卫命中的作答**不得**满足 student_answer gate（Navigator 走澄清门禁）。
 *
 * 只持久化结构化假设（canonical 事件 payload 的 intent/reasoning_location/
 * confidence/interpreter_version/grounding_refs/reasoning_focus/
 * reasoning_alignment），不持久化模型私有推理（ADR-007 不变量 5）。
 */
import { regionInferenceIds, type NavigatorBeatView, type NavigatorPlanV5 } from "./NavigatorPlanV5";

export const INTERPRETER_V5_VERSION = "semantic-interpreter/v5-deterministic";

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

// --------------------------------------------------------------------------- //
// 对抗守卫（2026-08-31 R1；interpreter 与 gate evaluator 共用同一口径）
// --------------------------------------------------------------------------- //

/** 显式否定标记（归一化文本子串；「不知道/说不出」是知识缺失非事实否定，不入列）。 */
const NEGATION_MARKERS = ["并不是", "不是", "不等于", "不成立", "不对", "错了", "≠"] as const;

/** 文本数字多重集（归一化后逐字符；「8/3」→ {8,3}）。 */
function digitMultiset(normalized: string): ReadonlySet<string> {
  return new Set(normalized.replace(/[^0-9]/g, "").split("").filter(Boolean));
}

export interface AnswerGuardReport {
  /** 关键词命中（归一化匹配 ≥ 阈值——守卫只在关键词命中后才有意义）。 */
  readonly keyword_match: boolean;
  /** 否定锚定：显式否定标记存在，且去否定文本仍命中基串（结论与事实相反）。 */
  readonly negation_anchored: boolean;
  /** 数值矛盾：基串携带的数字未全部出现在文本中（关键词正确、结论数值错误）。 */
  readonly value_mismatch: boolean;
  /** 编造数值：文本携带任何批准事实都不存在的数字（stuffing/编造）。 */
  readonly invented_values: boolean;
  /** 任一对抗守卫命中。 */
  readonly adversarial: boolean;
}

/**
 * 对抗守卫统一入口（纯函数）。`universe_digits` = 全部 RG fact statement 的
 * 数字并集（stuffing 判定的批准值域）。negation 判定用「去否定文本」重算
 * 匹配，避免否定词残差影响 LCS。
 */
export function analyzeAnswerAgainstBasis(
  text: string,
  basis: string,
  universeDigits: ReadonlySet<string>,
): AnswerGuardReport {
  const normalizedText = normalizeForInterpretation(text);
  const normalizedBasis = normalizeForInterpretation(basis);
  const keywordMatch = matchScore(text, basis) >= INTERPRETATION_MATCH_THRESHOLD;
  if (!keywordMatch) {
    return { keyword_match: false, negation_anchored: false, value_mismatch: false, invented_values: false, adversarial: false };
  }
  const negated = NEGATION_MARKERS.some((marker) => normalizedText.includes(marker));
  const deNegated = negated
    ? NEGATION_MARKERS.reduce((acc, marker) => acc.replaceAll(marker, ""), normalizedText)
    : normalizedText;
  const negationAnchored = negated && matchScore(deNegated, basis) >= INTERPRETATION_MATCH_THRESHOLD;
  const basisDigits = digitMultiset(normalizedBasis);
  const textDigits = digitMultiset(normalizedText);
  const valueMismatch = [...basisDigits].some((digit) => !textDigits.has(digit));
  const inventedValues = [...textDigits].some((digit) => !universeDigits.has(digit));
  return {
    keyword_match: true,
    negation_anchored: negationAnchored,
    value_mismatch: valueMismatch,
    invented_values: inventedValues,
    adversarial: negationAnchored || valueMismatch || inventedValues,
  };
}

/** 全部 RG fact statement 的数字并集（stuffing 守卫的批准值域）。 */
export function factDigitUniverse(plan: NavigatorPlanV5): Set<string> {
  const universe = new Set<string>();
  for (const fact of plan.facts.values()) {
    for (const digit of digitMultiset(normalizeForInterpretation(fact.statement))) universe.add(digit);
  }
  return universe;
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

interface FactMatch {
  fact_id: string;
  score: number;
  in_current_beat: boolean;
}

/** 文本对 RG 全部 facts 的匹配表（当前 Beat 的 facts 与其余 facts 都参与）。 */
function matchFacts(plan: NavigatorPlanV5, text: string, beat: NavigatorBeatView): FactMatch[] {
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

/** 替代路线匹配：solution variant 的 goal fact + RG inference derivation 作基准。 */
function matchVariants(plan: NavigatorPlanV5, text: string): { variant_id: string; score: number }[] {
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
 * 确定性语义解释（纯函数）：student input + 当前 Beat 上下文 → 可推翻假设。
 * 同一输入重复执行得到相同假设（G5 确定性在决策层验证，此处是其输入）。
 */
export function interpretStudentInput(
  plan: NavigatorPlanV5,
  input: InterpretInput,
): NavigatorInterpretation {
  const beat = input.beat;
  const grounding = [...beat.graph_fact_refs];

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
      // Assistance 入口：话题边界 = 是否命中 RG fact/Beat purpose（未命中任何
      // 批准内容 → out-of-bound 假设，Navigator 走 fallback 链）。置信分层：
      // 命中 fact（结构化意图无文本时按意图本身）0.8；仅命中 Beat purpose
      // 0.45（低置信但 in_bound → Navigator 澄清门禁）；出界 0.3。
      const text = input.text ?? "";
      const factMatches = matchFacts(plan, text, beat);
      const best = factMatches[0];
      const purposeScore = matchScore(text, beat.purpose);
      const factGrounded = best !== undefined && best.score >= INTERPRETATION_MATCH_THRESHOLD;
      const purposeGrounded = !factGrounded && purposeScore >= INTERPRETATION_MATCH_THRESHOLD;
      const inBound = text === "" || factGrounded || purposeGrounded;
      const confidence = text === "" || factGrounded ? 0.8 : purposeGrounded ? 0.45 : 0.3;
      return {
        intent: inBound ? input.intent_kind : `${input.intent_kind}:out_of_bound`,
        reasoning_location: inBound ? "aligned" : "unknown",
        confidence,
        interpreter_version: INTERPRETER_V5_VERSION,
        ...(factGrounded && best ? { grounding_refs: [best.fact_id] } : {}),
        ...(factGrounded && best ? { matched_fact_id: best.fact_id } : {}),
        ...(factGrounded && best
          ? {
              reasoning_focus: focusOn(beat.part_id, [best.fact_id]),
              // 命中 fact：expected_region（推导不出区域推理步时按合同省略，不伪造）。
              ...(expectedRegionAlignment(plan, [best.fact_id])
                ? { reasoning_alignment: expectedRegionAlignment(plan, [best.fact_id]) }
                : {}),
            }
          : purposeGrounded || !inBound
            ? { reasoning_alignment: { kind: "unclear_reasoning" } }
            : {}),
        in_bound: inBound,
      };
    }
    case "submit_answer": {
      const text = input.text ?? "";
      const factMatches = matchFacts(plan, text, beat);
      const best = factMatches[0];
      const variants = matchVariants(plan, text);
      const bestVariant = variants[0];
      const universeDigits = factDigitUniverse(plan);

      // 替代路线优先判定（既有优先级保留：variant 命中须显著强于 fact 命中）。
      if (
        bestVariant &&
        bestVariant.score >= INTERPRETATION_MATCH_THRESHOLD &&
        (!best || bestVariant.score > best.score)
      ) {
        const variant = plan.solution_variants.find((entry) => entry.variant_id === bestVariant.variant_id);
        const goalFact = variant ? plan.facts.get(variant.goal_fact_id) : undefined;
        return {
          intent: "submit_answer:alternate_route",
          reasoning_location: "aligned",
          confidence: 0.75,
          interpreter_version: INTERPRETER_V5_VERSION,
          grounding_refs: [bestVariant.variant_id],
          matched_variant_id: bestVariant.variant_id,
          ...(goalFact
            ? { reasoning_focus: focusOn(beat.part_id, [goalFact.fact_id]) }
            : {}),
          reasoning_alignment: variant
            ? { kind: "alternate_valid_path", fact_ids: [variant.goal_fact_id], inference_ids: [...variant.inference_ids] }
            : undefined,
          in_bound: true,
        };
      }

      if (best && best.score >= INTERPRETATION_MATCH_THRESHOLD) {
        const statement = plan.facts.get(best.fact_id)?.statement ?? "";
        const guards = analyzeAnswerAgainstBasis(text, statement, universeDigits);
        if (guards.adversarial) {
          // negation / 数值矛盾 / stuffing：关键词命中但结论错误——
          // incorrect_reasoning，anchored_fact_ids 指向被错误结论锚定的 fact。
          return {
            intent: "submit_answer",
            reasoning_location: "misaligned",
            confidence: 0.7,
            interpreter_version: INTERPRETER_V5_VERSION,
            grounding_refs: [best.fact_id],
            matched_fact_id: best.fact_id,
            reasoning_focus: focusOn(beat.part_id, [best.fact_id]),
            reasoning_alignment: incorrectReasoningAlignment([best.fact_id]),
            in_bound: true,
          };
        }
        if (best.in_current_beat) {
          return {
            intent: "submit_answer",
            reasoning_location: "aligned",
            confidence: 0.9,
            interpreter_version: INTERPRETER_V5_VERSION,
            grounding_refs: [best.fact_id],
            matched_fact_id: best.fact_id,
            reasoning_focus: focusOn(beat.part_id, [best.fact_id]),
            reasoning_alignment: expectedRegionAlignment(plan, [best.fact_id]),
            in_bound: true,
          };
        }
        // 命中他处 fact：推理位置偏离当前 Beat（部分对齐——数学上相关但位置不同；
        // 引用集限定已确认对齐子区域 = 命中的 fact，分歧部分不进引用集）。
        return {
          intent: "submit_answer",
          reasoning_location: "partially_aligned",
          confidence: 0.6,
          interpreter_version: INTERPRETER_V5_VERSION,
          grounding_refs: [best.fact_id],
          matched_fact_id: best.fact_id,
          reasoning_focus: focusOn(beat.part_id, [best.fact_id]),
          reasoning_alignment: expectedRegionAlignment(plan, [best.fact_id]),
          in_bound: true,
        };
      }
      // 无任何匹配：unclear（不强迫分类；PRD 04 §6 口径）。
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
