/**
 * Reasoning aligner（Phase 5 / P5-05，PRD 04 §6）。
 *
 * 输入学生 utterance（reasoning_utterance / pointing_evidence），对照当前
 * checkpoint 的 expected_reasoning、accepted_alternatives、本 part 的
 * common_deviations 与备选路线 entry_condition，输出五分类：
 *   expected_checkpoint / alternate_valid / incorrect / unclear / no_progress。
 *
 * MVP 判定是确定性的最长公共子串（LCS ≥ 4 个归一化字符）匹配：
 * - 归一化：全角→半角、去标点空白、LaTeX \sqrt→√（Phase 4 §3.5 成对归一化教训）；
 * - 候选按匹配长度取最大，平局优先 expected（存疑时先确认而不是先判错）；
 * - 无任何匹配 → unclear（PRD：unclear/no-progress 是合法结果，不强迫分类）；
 * - silence/空文本 → no_progress。
 * 结构化 action evidence 的对齐不经此模块（走 typed evaluator 的 accepted 判定）。
 */
import type { Alignment, InputKind } from "./TutorSessionEvent";
import type { TutorPlanV2Payload } from "../planBuild/canonicalInputs";
import type { TutorRuntimeState } from "./TutorRuntimeStateProjection";

export interface AlignmentOutcome {
  alignment: Alignment;
  checkpoint_id?: string;
  alternate_description?: string;
  /** 判定依据（哪条 plan 文本命中）——供 hint 台账与诊断引用，不进 canonical 事件。 */
  matched_basis?: { source: "expected" | "accepted_alternative" | "deviation" | "alternate_route"; text: string; score: number };
}

const NORMALIZE_PUNCTUATION = /[，。、；：？！,.;:?!\s()（）【】\[\]$]/g;

/** 与 Phase 4 泄漏自查同口径的文本归一化（成对修改教训：双侧必须同规则）。 */
export function normalizeForAlignment(text: string): string {
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

const MATCH_THRESHOLD = 4;

interface Candidate {
  alignment: Alignment;
  source: NonNullable<AlignmentOutcome["matched_basis"]>["source"];
  text: string;
  score: number;
  checkpoint_id?: string;
  alternate_description?: string;
}

/** 五分类主入口。state 提供 current checkpoint / part 上下文。 */
export function alignReasoning(
  plan: TutorPlanV2Payload,
  state: TutorRuntimeState,
  input: { input_kind: InputKind; text?: string },
): AlignmentOutcome {
  if (input.input_kind === "silence_observed") {
    return { alignment: "no_progress" };
  }
  const text = normalizeForAlignment(input.text ?? "");
  if (!text) {
    return { alignment: input.input_kind === "pointing_evidence" ? "unclear" : "no_progress" };
  }

  const checkpointId = state.reasoning.current_checkpoint_id;
  const checkpoint = plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId);
  const partId = checkpoint?.part_id ?? "1";
  const candidates: Candidate[] = [];

  if (checkpoint) {
    const expectedScore = longestCommonRun(text, normalizeForAlignment(checkpoint.expected_reasoning));
    candidates.push({
      alignment: "expected_checkpoint",
      source: "expected",
      text: checkpoint.expected_reasoning,
      score: expectedScore,
      checkpoint_id: checkpoint.checkpoint_id,
    });
    for (const alternative of checkpoint.accepted_alternatives ?? []) {
      candidates.push({
        alignment: "alternate_valid",
        source: "accepted_alternative",
        text: alternative,
        score: longestCommonRun(text, normalizeForAlignment(alternative)),
        checkpoint_id: checkpoint.checkpoint_id,
        alternate_description: alternative,
      });
    }
  }

  // common_deviations 是题目级陷阱清单：当前 checkpoint 优先，其余全题节点
  // 参与匹配（golden plan 的错因集中在后段 part，前段挣扎同样构成偏差证据）。
  const deviationCheckpoints = [
    ...(checkpoint?.common_deviations?.length ? [checkpoint] : []),
    ...plan.checkpoints.filter((entry) => entry.checkpoint_id !== checkpointId && (entry.common_deviations ?? []).length > 0),
  ];
  for (const entry of deviationCheckpoints) {
    for (const deviation of entry.common_deviations ?? []) {
      candidates.push({
        alignment: "incorrect",
        source: "deviation",
        text: deviation,
        score: longestCommonRun(text, normalizeForAlignment(deviation)),
        checkpoint_id: checkpointId,
      });
    }
  }

  // 备选路线：plan 批准的 alternate route（entry_condition / completion_condition）
  // 是「数学上合法的另一条路」的载体（golden plan 无 accepted_alternatives 数据）。
  for (const route of plan.recommended_routes) {
    if (route.role !== "alternate" || (route.part_id ?? "1") !== partId) continue;
    for (const routeText of [route.entry_condition, route.completion_condition]) {
      if (!routeText) continue;
      const score = longestCommonRun(text, normalizeForAlignment(routeText));
      candidates.push({
        alignment: "alternate_valid",
        source: "alternate_route",
        text: routeText,
        score,
        checkpoint_id: route.checkpoint_ids[0],
        alternate_description: routeText,
      });
    }
  }

  const viable = candidates
    .filter((candidate) => candidate.score >= MATCH_THRESHOLD)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const priority = (alignment: Alignment): number =>
        alignment === "expected_checkpoint" ? 0 : alignment === "alternate_valid" ? 1 : 2;
      return priority(left.alignment) - priority(right.alignment);
    });

  const best = viable[0];
  if (!best) return { alignment: "unclear" };
  return {
    alignment: best.alignment,
    ...(best.checkpoint_id ? { checkpoint_id: best.checkpoint_id } : {}),
    ...(best.alternate_description ? { alternate_description: best.alternate_description } : {}),
    matched_basis: { source: best.source, text: best.text, score: best.score },
  };
}
