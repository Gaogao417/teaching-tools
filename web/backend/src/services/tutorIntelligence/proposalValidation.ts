/**
 * validate_proposal 节点的纯校验逻辑（Phase 5 remediation）。
 *
 * 在 tutorPolicy/TutorMove.validateDecisionAgainstPlan（plan constraints
 * fail-closed）之上追加智能链特有校验：
 * - voice 文案来源规则：hint/repair/wait 不允许动态文案（忽略模型改写，
 *   强制资源原文/零呈现）；explain/prompt/confirm 的生成文案 ≤3 句短句；
 * - 动态文案泄题自查：不得包含所在 part 的答案值（与 materializer 泄漏
 *   门禁同口径 normalizeForMatch）；
 * - hint 档位不得重复已发档位（帮助阶梯纪律）；
 * - diagnosis_updates 的 evidence 只能引用学生事实事件、candidate skills
 *   只能取 plan checkpoint 冻结标注集。
 */
import type { TutorPlanV2Payload } from "../planBuild/canonicalInputs";
import type { TutorRuntimeState } from "../tutorSession/TutorRuntimeStateProjection";
import { normalizeForMatch } from "../benchmark/approachCases";
import { validateDecisionAgainstPlan, type TutorDecisionDraft } from "../tutorPolicy/TutorMove";
import type { RecentEventFact, TutorTurnProposal, VoiceSource } from "./proposal";

export interface ProposalValidation {
  ok: boolean;
  errors: string[];
  /** 规则修正后的提案（hint/repair/wait 的模型文案被剥离；其余原样）。 */
  proposal: TutorTurnProposal;
}

const MAX_SENTENCES = 3;
const MAX_SENTENCE_LENGTH = 80;
const MAX_TOTAL_LENGTH = 240;

function sentencesOf(text: string): string[] {
  return text
    .split(/[。！？!?\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function validateVoiceText(
  text: string,
  answerValues: readonly string[],
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const sentences = sentencesOf(text);
  if (sentences.length > MAX_SENTENCES) {
    errors.push(`动态文案超过 ${MAX_SENTENCES} 句（当前 ${sentences.length}）`);
  }
  if (text.length > MAX_TOTAL_LENGTH) {
    errors.push(`动态文案超过 ${MAX_TOTAL_LENGTH} 字（当前 ${text.length}）`);
  }
  for (const sentence of sentences) {
    if (sentence.length > MAX_SENTENCE_LENGTH) {
      errors.push(`单句超过 ${MAX_SENTENCE_LENGTH} 字（${sentence.length}）`);
      break;
    }
  }
  const normalized = normalizeForMatch(text);
  for (const value of answerValues) {
    if (value && normalized.includes(normalizeForMatch(value))) {
      errors.push(`动态文案泄漏答案值「${value}」（fail closed）`);
      break;
    }
  }
  return { ok: errors.length === 0, errors };
}

function frozenSkillIds(plan: TutorPlanV2Payload): Set<string> {
  const ids = new Set<string>();
  for (const checkpoint of plan.checkpoints) {
    for (const annotation of checkpoint.skill_annotations ?? []) {
      ids.add(annotation.skill_id);
    }
  }
  return ids;
}

export function validateProposal(
  proposal: TutorTurnProposal,
  plan: TutorPlanV2Payload,
  state: TutorRuntimeState,
  facts: readonly RecentEventFact[],
  answerValuesByPart: ReadonlyMap<string, readonly string[]>,
): ProposalValidation {
  const errors: string[] = [];
  const move: TutorDecisionDraft = proposal.move;
  const planCheck = validateDecisionAgainstPlan(move, plan, state);
  errors.push(...planCheck.errors);

  // ---- 裁定 §5：workspace 资源只允许出现在 prompt（邀请学生操作）----
  // action_template/workspace 由 Presenter 解析为 WorkspaceAction；explain/
  // hint/repair 的资源必须是文本 kind（否则 JSON 会被当 Voice 文本——禁止）。
  const workspaceResourceIds = (move.resource_ids ?? []).filter((resourceId) => {
    const resource = plan.resources.find((entry) => entry.resource_id === resourceId);
    return resource?.kind === "action_template" || resource?.kind === "workspace";
  });
  if (workspaceResourceIds.length && move.move_type !== "prompt") {
    errors.push(
      `${move.move_type} move 引用 workspace 资源 ${workspaceResourceIds.join(",")}（只允许 prompt）`,
    );
  }

  // ---- voice 来源规则（裁定 §4/§5）----
  let voiceText = proposal.voiceText;
  let voiceSource: VoiceSource = proposal.voiceSource;
  if (move.move_type === "hint" || move.move_type === "repair" || move.move_type === "wait") {
    // Hint/Repair 逐字使用教师批准资源；Wait 零呈现——模型文案一律忽略。
    voiceText = undefined;
    if (voiceSource === "model-generated") voiceSource = "approved-resource";
  }
  if (voiceText !== undefined && voiceSource === "model-generated") {
    if (!voiceText.trim()) {
      errors.push("voice.source=model-generated 但文案为空");
    } else {
      const checkpointId = move.checkpoint_id ?? state.reasoning.current_checkpoint_id;
      const partId =
        plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)?.part_id ?? "1";
      const voiceCheck = validateVoiceText(voiceText, answerValuesByPart.get(partId) ?? []);
      errors.push(...voiceCheck.errors);
    }
  }

  // ---- hint 阶梯纪律 ----
  if (move.move_type === "hint" && move.checkpoint_id !== undefined && move.assistance_level !== undefined) {
    const ledger = state.assistance[move.checkpoint_id];
    if (ledger?.hintLevelsIssued.includes(move.assistance_level)) {
      errors.push(
        `hint level=${move.assistance_level} 已发过（${move.checkpoint_id} 台账 ${ledger.hintLevelsIssued.join(",")}），不得重复`,
      );
    }
  }

  // ---- diagnosis evidence / skills ----
  const studentSequences = new Set(facts.filter((fact) => fact.student_fact).map((fact) => fact.sequence));
  const frozen = frozenSkillIds(plan);
  for (const update of move.diagnosis_updates ?? []) {
    if (!update.evidence_sequences.length || update.evidence_sequences.some((seq) => !studentSequences.has(seq))) {
      errors.push(`diagnosis update ${update.summary_code} 的 evidence_sequences 含非学生事实事件`);
    }
    for (const skillId of update.candidate_skill_ids ?? []) {
      if (!frozen.has(skillId)) {
        errors.push(`diagnosis update ${update.summary_code} candidate ${skillId} 不在 plan 冻结 skill 集`);
      }
    }
  }

  const normalized: TutorTurnProposal = {
    ...proposal,
    move,
    ...(voiceText !== undefined ? { voiceText } : {}),
    voiceSource,
  };
  if ("voiceText" in normalized && voiceText === undefined) delete normalized.voiceText;
  return { ok: errors.length === 0, errors, proposal: normalized };
}

/** Wait 兜底提案（预算耗尽/校验两次失败/超时；零呈现，零泄题）。 */
export function waitFallbackProposal(
  state: TutorRuntimeState,
  provenance: Pick<TutorTurnProposal, "workflowVersion" | "modelId" | "promptVersions">,
): TutorTurnProposal {
  return {
    move: {
      move_type: "wait",
      purpose_code: "wait.safe_fallback",
      checkpoint_id: state.reasoning.current_checkpoint_id,
      fallback: true,
    },
    voiceSource: "approved-resource",
    ...provenance,
  };
}
