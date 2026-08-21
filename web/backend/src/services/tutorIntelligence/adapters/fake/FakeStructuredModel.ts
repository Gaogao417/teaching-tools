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
import { hasSentenceLevelNegation } from "../../negationGuard";

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
  mode?: string;
  assistance_ledger?: {
    hintLevelsIssued?: number[];
    promptsIssued?: number;
    incorrectSequences?: number[];
    lastHintSequence?: number;
    explainedSequences?: number[];
  };
  resource_catalog?: Array<{ resource_id: string; kind: string; checkpoint_id?: string; assistance_level?: number }>;
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
  const currentId = payload.current_checkpoint?.checkpoint_id;
  for (const deviation of payload.common_deviations ?? []) {
    scored.push({
      classification: "incorrect",
      // 与 deterministic alignReasoning 同口径：偏差事实记在当前节点
      // （题目级陷阱清单命中，不切换节点归属）。
      checkpoint_id: currentId,
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
      const targetCheckpoint = progressed ?? fact.alignment_checkpoint_id ?? currentCheckpoint;
      if (alignment === "alternate_valid") {
        return {
          move: {
            move_type: "confirm",
            purpose_code: "confirm.alternate_path",
            checkpoint_id: targetCheckpoint,
          },
          voice: { source: "model-generated", text: DYNAMIC_VOICE.confirm },
        };
      }
      // repair 模式下答对 → 完成修复退回原模式。
      if (payload.mode === "repair") {
        return {
          move: {
            move_type: "confirm",
            purpose_code: "confirm.repair_complete",
            checkpoint_id: targetCheckpoint,
            mode_change: { to_mode: "guided_solve" },
          },
          voice: { source: "model-generated", text: "这次对了。回到原步骤，继续。" },
        };
      }
      // 自我修正：偏差之后无实质协助（hint/explain）而答对。
      const ledger2 = payload.assistance_ledger ?? {};
      const lastDeviation = Math.max(-1, ...(ledger2.incorrectSequences ?? []));
      const assistedSince =
        lastDeviation >= 0 &&
        ((ledger2.lastHintSequence ?? -1) > lastDeviation ||
          (ledger2.explainedSequences ?? []).some((sequence: number) => sequence > lastDeviation));
      if (lastDeviation >= 0 && !assistedSince) {
        return {
          move: {
            move_type: "confirm",
            purpose_code: "confirm.self_correction",
            checkpoint_id: targetCheckpoint,
          },
          voice: { source: "model-generated", text: DYNAMIC_VOICE.confirm },
        };
      }
      const assisted = (ledger2.hintLevelsIssued ?? []).length > 0 || (ledger2.explainedSequences ?? []).length > 0;
      return {
        move: {
          move_type: "confirm",
          purpose_code: assisted ? "confirm.assisted_progress" : "confirm.progress",
          checkpoint_id: targetCheckpoint,
        },
        voice: { source: "model-generated", text: DYNAMIC_VOICE.confirm },
      };
    }
    case "incorrect": {
      // 与 deterministic assistAfterIncorrect 同口径：本轮 incorrect 即挣扎
      // 基线（此前 prompt 属于开场交接，不计入）；既有 incorrect 后按累计
      // prompt 升档；hint 按档位取资源；耗尽转 Repair。
      const ledger3 = payload.assistance_ledger ?? {};
      const priorIncorrect = (ledger3.incorrectSequences ?? []).length;
      const promptsIssued = priorIncorrect === 0 ? 0 : ledger3.promptsIssued ?? 0;
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
      const issued = new Set(ledger3.hintLevelsIssued ?? []);
      let level: number | null = null;
      for (let candidate = 1; candidate <= maxLevel; candidate += 1) {
        if (!issued.has(candidate)) {
          level = candidate;
          break;
        }
      }
      if (level !== null) {
        const hintCheckpoint = fact.alignment_checkpoint_id ?? currentCheckpoint;
        const hint =
          catalog.find(
            (entry) =>
              entry.kind === "hint" && entry.checkpoint_id === hintCheckpoint && entry.assistance_level === level,
          ) ?? catalog.find((entry) => entry.kind === "hint" && entry.checkpoint_id === hintCheckpoint);
        return {
          move: {
            move_type: "hint",
            purpose_code: "hint.escalate",
            checkpoint_id: hintCheckpoint,
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
    default: {
      // unclear 阶梯：澄清 → 诊断探针 → 帮助阶梯（与 deterministic 同口径）。
      const ledger4 = payload.assistance_ledger ?? {};
      const prompts = ledger4.promptsIssued ?? 0;
      if (prompts === 0) {
        return {
          move: { move_type: "prompt", purpose_code: "prompt.clarify", checkpoint_id: currentCheckpoint },
          voice: { source: "model-generated", text: DYNAMIC_VOICE.prompt },
        };
      }
      if (prompts === 1) {
        const probe = catalog.find((entry) => entry.kind === "diagnostic_probe" && entry.checkpoint_id === currentCheckpoint);
        if (probe) {
          return {
            move: {
              move_type: "prompt",
              purpose_code: "prompt.diagnostic_probe",
              checkpoint_id: currentCheckpoint,
              resource_ids: [probe.resource_id],
            },
            voice: { source: "approved-resource" },
          };
        }
      }
      // 探针后仍含糊 → 按 incorrect 阶梯（prompt 已计 2+）。
      const issuedHints = new Set(ledger4.hintLevelsIssued ?? []);
      let hintLevel: number | null = null;
      for (let candidate = 1; candidate <= maxLevel; candidate += 1) {
        if (!issuedHints.has(candidate)) {
          hintLevel = candidate;
          break;
        }
      }
      if (hintLevel !== null) {
        const hint =
          catalog.find(
            (entry) => entry.kind === "hint" && entry.checkpoint_id === currentCheckpoint && entry.assistance_level === hintLevel,
          ) ?? catalog.find((entry) => entry.kind === "hint" && entry.checkpoint_id === currentCheckpoint);
        return {
          move: {
            move_type: "hint",
            purpose_code: "hint.escalate",
            checkpoint_id: currentCheckpoint,
            assistance_level: hintLevel,
            resource_ids: hint ? [hint.resource_id] : [],
          },
          voice: { source: "approved-resource" },
        };
      }
      const repair2 = catalog.find((entry) => entry.kind === "repair");
      return {
        move: {
          move_type: "repair",
          purpose_code: "repair.ladder_exhausted",
          checkpoint_id: currentCheckpoint,
          resource_ids: repair2 ? [repair2.resource_id] : [],
          mode_change: { to_mode: "repair" },
        },
        voice: { source: "approved-resource" },
      };
    }
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
