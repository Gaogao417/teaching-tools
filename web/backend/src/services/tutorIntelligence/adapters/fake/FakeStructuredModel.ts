/**
 * Fake 结构化模型（Phase 5 remediation / 完整收口计划 §4 CI 口径）。
 *
 * 不访问外部模型：从 userPayload 确定性推导「模型会输出的 JSON」——
 * - aligner 调用（payload.utterance）：LCS 对齐（与 ReasoningAligner 同规则），
 *   输出 classification/checkpoint_id/confidence/grounding_refs；
 * - policy/voice 调用（payload.student_fact）：按对齐结果选 move（与
 *   deterministic rules 同口径的紧凑子集）+ 受控动态文案（脚手架句，
 *   不含数学内容，不泄答案）。
 *
 * 用途：CI fake-model 门禁（72/72 trajectories + Playwright 场景）、
 * alignment dataset gate。它不是真实模型结果的替代——真实 DeepSeek exit run
 * 单独跑（§5 外部依赖处置）。
 */
import type {
  StructuredCompletionRequest,
  StructuredCompletionResult,
  StructuredModelPort,
} from "../../structuredModelPort";
import { StructuredModelError } from "../../structuredModelPort";

interface FakeCandidate {
  checkpoint_id: string;
  expected_reasoning?: string;
  accepted_alternatives?: string[];
  common_deviations?: Array<{ checkpoint_id: string; index: number; text: string }>;
}

interface FakeAlignerPayload {
  utterance?: string;
  current_checkpoint?: FakeCandidate;
  neighbor_checkpoints?: FakeCandidate[];
  common_deviations?: Array<{ checkpoint_id: string; index: number; text: string }>;
  alternate_routes?: Array<{ route_id: string; entry_condition?: string }>;
}

interface FakePolicyPayload {
  student_fact?: {
    input_kind?: string;
    text?: string;
    alignment?: string;
    alignment_checkpoint_id?: string;
  };
  current_checkpoint?: string;
  provisional?: { progressed_checkpoint_id?: string };
  assistance_ledger?: { hintLevelsIssued?: number[]; promptsIssued?: number };
  resource_catalog?: Array<{ resource_id: string; kind: string; checkpoint_id?: string }>;
  constraints?: { maximum_assistance_level?: number };
}

const DYNAMIC_VOICE: Record<string, string> = {
  confirm: "很好，这一步成立。我们继续往下走。",
  explain: "我们先把这一步的关键想法理清楚，然后你来接着推进。",
  prompt: "这一步你来试试看，说说你的想法。",
};

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\\sqrt\{([^}]*)\}/g, "√$1")
    .replace(/[，。、；：？！,.;:?!\s()（）【】\[\]$]/g, "");
}

function lcs(a: string, b: string): number {
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

/** 句级否定/拒绝/含糊标记（hard set 守卫）：命中即 unclear——
 *  绝不因引用了期望表述本身而判 expected/alternate。标记表避开偏差文本
 *  的正常用词（如「不指出」不是句级否定）。 */
const NEGATION_OR_REFUSAL_MARKERS = [
  "是错的",
  "不对",
  "不想",
  "不会",
  "不知道",
  "不确定",
  "没思路",
  "说不清",
  "说不清楚",
  "根本不",
  "根本没",
  "有问题",
];

function hasSentenceLevelNegation(text: string): boolean {
  return NEGATION_OR_REFUSAL_MARKERS.some((marker) => text.includes(marker));
}

function alignerOutput(payload: FakeAlignerPayload): Record<string, unknown> {
  const rawUtterance = payload.utterance ?? "";
  if (hasSentenceLevelNegation(rawUtterance)) {
    return { classification: "unclear", confidence: 0.2, grounding_refs: [] };
  }
  const utterance = normalize(rawUtterance);
  const candidates = [payload.current_checkpoint, ...(payload.neighbor_checkpoints ?? [])].filter(
    (entry): entry is FakeCandidate => Boolean(entry?.checkpoint_id),
  );
  const scored: Array<{
    classification: string;
    checkpoint_id?: string;
    route_id?: string;
    ref: string;
    score: number;
    priority: number;
  }> = [];
  for (const candidate of candidates) {
    if (candidate.expected_reasoning) {
      scored.push({
        classification: "expected_checkpoint",
        checkpoint_id: candidate.checkpoint_id,
        ref: `${candidate.checkpoint_id}.expected`,
        score: lcs(utterance, normalize(candidate.expected_reasoning)),
        priority: 0,
      });
    }
    (candidate.accepted_alternatives ?? []).forEach((alternative, index) => {
      scored.push({
        classification: "alternate_valid",
        checkpoint_id: candidate.checkpoint_id,
        ref: `${candidate.checkpoint_id}.alt[${index}]`,
        score: lcs(utterance, normalize(alternative)),
        priority: 1,
      });
    });
  }
  for (const deviation of payload.common_deviations ?? []) {
    scored.push({
      classification: "incorrect",
      checkpoint_id: deviation.checkpoint_id,
      ref: `${deviation.checkpoint_id}.deviation[${deviation.index}]`,
      score: lcs(utterance, normalize(deviation.text)),
      priority: 2,
    });
  }
  for (const route of payload.alternate_routes ?? []) {
    if (!route.entry_condition) continue;
    scored.push({
      classification: "alternate_valid",
      route_id: route.route_id,
      ref: `route.${route.route_id}.entry`,
      score: lcs(utterance, normalize(route.entry_condition)),
      priority: 1,
    });
  }
  const viable = scored.filter((entry) => entry.score >= 4).sort((a, b) => b.score - a.score || a.priority - b.priority);
  const best = viable[0];
  if (!best) return { classification: "unclear", confidence: 0.3, grounding_refs: [] };
  const confidence =
    best.classification === "incorrect" ? 0.86 : Math.min(0.97, 0.85 + best.score / 100);
  return {
    classification: best.classification,
    ...(best.checkpoint_id ? { checkpoint_id: best.checkpoint_id } : {}),
    ...(best.route_id ? { route_id: best.route_id } : {}),
    confidence,
    grounding_refs: [best.ref],
  };
}

function policyOutput(payload: FakePolicyPayload): Record<string, unknown> {
  const fact = payload.student_fact ?? {};
  const alignment = fact.alignment;
  const catalog = payload.resource_catalog ?? [];
  const explanation = catalog.find((entry) => entry.kind === "explanation");
  const currentCheckpoint = payload.current_checkpoint ?? "CP1";
  const ledger = payload.assistance_ledger ?? {};
  const maxLevel = payload.constraints?.maximum_assistance_level ?? 3;

  if (fact.input_kind === "question_asked") {
    return {
      move: {
        move_type: "explain",
        purpose_code: "explain.answer_question",
        checkpoint_id: currentCheckpoint,
        resource_ids: explanation ? [explanation.resource_id] : [],
      },
      voice: { source: "model-generated", text: DYNAMIC_VOICE.explain },
    };
  }
  if (fact.input_kind === "student_interrupted" || fact.input_kind === "silence_observed") {
    const consecutiveSilence = fact.input_kind === "silence_observed";
    return {
      move: {
        move_type: consecutiveSilence ? "wait" : "wait",
        purpose_code: consecutiveSilence ? "wait.silence_first" : "wait.after_interruption",
        checkpoint_id: currentCheckpoint,
      },
      voice: { source: "approved-resource" },
    };
  }
  if (fact.input_kind === "pointing_evidence") {
    return {
      move: {
        move_type: "prompt",
        purpose_code: "prompt.verbalize_pointing",
        checkpoint_id: currentCheckpoint,
      },
      voice: { source: "approved-resource" },
    };
  }
  switch (alignment) {
    case "expected_checkpoint":
    case "alternate_valid": {
      const progressed = payload.provisional?.progressed_checkpoint_id;
      return {
        move: {
          move_type: "confirm",
          purpose_code: "confirm.progress",
          checkpoint_id: progressed ?? fact.alignment_checkpoint_id ?? currentCheckpoint,
        },
        voice: { source: "model-generated", text: DYNAMIC_VOICE.confirm },
      };
    }
    case "incorrect": {
      const promptsIssued = ledger.promptsIssued ?? 0;
      if (promptsIssued === 0) {
        return {
          move: {
            move_type: "prompt",
            purpose_code: "prompt.self_check",
            checkpoint_id: fact.alignment_checkpoint_id ?? currentCheckpoint,
          },
          voice: { source: "model-generated", text: DYNAMIC_VOICE.prompt },
        };
      }
      const issued = new Set(ledger.hintLevelsIssued ?? []);
      let level: number | null = null;
      for (let candidate = 1; candidate <= maxLevel; candidate += 1) {
        if (!issued.has(candidate)) {
          level = candidate;
          break;
        }
      }
      if (level !== null) {
        const hint = catalog.find(
          (entry) => entry.kind === "hint" && entry.checkpoint_id === (fact.alignment_checkpoint_id ?? currentCheckpoint),
        );
        return {
          move: {
            move_type: "hint",
            purpose_code: "hint.escalate",
            checkpoint_id: fact.alignment_checkpoint_id ?? currentCheckpoint,
            assistance_level: level,
            resource_ids: hint ? [hint.resource_id] : [],
          },
          voice: { source: "approved-resource" },
        };
      }
      const repair = catalog.find((entry) => entry.kind === "repair");
      return {
        move: {
          move_type: "repair",
          purpose_code: "repair.ladder_exhausted",
          checkpoint_id: fact.alignment_checkpoint_id ?? currentCheckpoint,
          resource_ids: repair ? [repair.resource_id] : [],
          mode_change: { to_mode: "repair" },
        },
        voice: { source: "approved-resource" },
      };
    }
    case "no_progress":
      return {
        move: { move_type: "wait", purpose_code: "wait.silence_first", checkpoint_id: currentCheckpoint },
        voice: { source: "approved-resource" },
      };
    default:
      return {
        move: { move_type: "prompt", purpose_code: "prompt.clarify", checkpoint_id: currentCheckpoint },
        voice: { source: "model-generated", text: DYNAMIC_VOICE.prompt },
      };
  }
}

export class FakeStructuredModel implements StructuredModelPort {
  readonly provider = "fake-structured";
  readonly modelId = "fake-structured/v1";

  async complete<T>(request: StructuredCompletionRequest): Promise<StructuredCompletionResult<T>> {
    const payload = request.userPayload as FakeAlignerPayload & FakePolicyPayload;
    if (!payload || typeof payload !== "object") {
      throw new StructuredModelError("invalid-json", "fake model: userPayload 不是对象", false);
    }
    const value = "utterance" in payload ? alignerOutput(payload) : policyOutput(payload);
    return {
      value: value as T,
      modelId: this.modelId,
      promptVersion: request.promptVersion,
      usage: { inputTokens: 128, outputTokens: 64 },
      latencyMs: 1,
    };
  }
}
