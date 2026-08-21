/**
 * 句级否定/拒绝守卫（Phase 5 remediation hard set）。
 *
 * 学生话语含句级否定/拒绝/含糊标记时，即使引用了期望表述原文也不得判为
 * expected/alternate——确定性下限与 fake/真实模型共用同一词表。
 * 标记表避开偏差文本的正常用词（如「不指出」不是句级否定）。
 */
export const NEGATION_OR_REFUSAL_MARKERS: readonly string[] = [
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

export function hasSentenceLevelNegation(text: string): boolean {
  return NEGATION_OR_REFUSAL_MARKERS.some((marker) => text.includes(marker));
}
