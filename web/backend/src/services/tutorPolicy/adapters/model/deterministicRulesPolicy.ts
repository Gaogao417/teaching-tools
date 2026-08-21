/**
 * 确定性规则 TutorPolicy（Phase 5 / P5-07 adapter）。
 *
 * 与 Phase 4 Build Agent 同口径的实现选择：MVP 先落确定性规则版
 * （provider=deterministic-rules），LLM adapter 留在同一 Port 后面可替换；
 * provenance 通过 policy_version 进入每个 tutor_move_decided 事件。
 *
 * 规则依据 PRD 04 §3–§5：
 * - GuidedSolve：先收 reasoning；expected→Confirm、alternate→Confirm 并记
 *   alternate path、incorrect→先诱导自我修正（Prompt）再按台账升档 Hint、
 *   unclear→Prompt（有 diagnostic_probe 时用 probe）、no-progress→Wait→Prompt→阶梯；
 * - Teach：开场 Explain（voice_seed + 首节点讲解）；被问题打断→Explain 回答，
 *   回答后按 state 决定 verify / 交接 GuidedSolve；
 * - Repair：局部教学状态——repair 资源示范后请学生复述；学生在源 checkpoint
 *   给出 expected 证据即完成（Confirm + 退出 repair，回到原 checkpoint）；
 * - 阶梯不机械升级：无新学生证据不重复给 hint；档位从 1 起取首个未用档，
 *   超过 plan maximum_assistance_level 转 Repair（guided 内）。
 */
import type { Alignment } from "../../../tutorSession/TutorSessionEvent";
import type { TutorPlanV2Payload, PlanResourceV2 } from "../../../planBuild/canonicalInputs";
import type { TutorRuntimeState, AssistanceLedger } from "../../../tutorSession/TutorRuntimeStateProjection";
import { normalizeForAlignment } from "../../../tutorSession/ReasoningAligner";
import type { PolicyContext, PolicyOutcome, PolicyTrigger, TutorPolicyPort } from "../../TutorPolicyPort";
import type { TutorDecisionDraft, WorkingDiagnosisUpdate } from "../../TutorMove";

export const DETERMINISTIC_POLICY_VERSION = "tutor-policy-deterministic-rules/v1";

function explanationResource(plan: TutorPlanV2Payload, checkpointId: string): PlanResourceV2 | undefined {
  return plan.resources.find(
    (resource) => resource.kind === "explanation" && resource.checkpoint_id === checkpointId,
  );
}

function voiceSeedResource(plan: TutorPlanV2Payload, partId: string): PlanResourceV2 | undefined {
  const checkpointIds = new Set(
    plan.checkpoints.filter((checkpoint) => checkpoint.part_id === partId).map((c) => c.checkpoint_id),
  );
  return plan.resources.find(
    (resource) => resource.kind === "voice_seed" && resource.checkpoint_id && checkpointIds.has(resource.checkpoint_id),
  );
}

function hintResourceAt(plan: TutorPlanV2Payload, checkpointId: string, level: number): PlanResourceV2 | undefined {
  return plan.resources.find(
    (resource) => resource.kind === "hint" && resource.checkpoint_id === checkpointId && resource.assistance_level === level,
  );
}

function repairResourceForPart(plan: TutorPlanV2Payload, partId: string): PlanResourceV2 | undefined {
  const checkpointIds = new Set(
    plan.checkpoints.filter((checkpoint) => checkpoint.part_id === partId).map((c) => c.checkpoint_id),
  );
  return plan.resources.find(
    (resource) => resource.kind === "repair" && (!resource.checkpoint_id || checkpointIds.has(resource.checkpoint_id)),
  );
}

function probeResource(plan: TutorPlanV2Payload, checkpointId: string): PlanResourceV2 | undefined {
  return plan.resources.find(
    (resource) => resource.kind === "diagnostic_probe" && resource.checkpoint_id === checkpointId,
  );
}

function longestCommonRunLength(a: string, b: string): number {
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

/** 缺陷修复（Phase 5 remediation）：question 文本不再被忽略——回答学生提问时，
 *  在本 part 的 explanation 资源里选与问题文本最相关的一篇（LCS ≥4 归一化
 *  字符），无命中才退回当前 checkpoint 的默认讲解。 */
function explanationForQuestion(
  plan: TutorPlanV2Payload,
  partId: string,
  questionText: string | undefined,
  fallbackCheckpointId: string,
): PlanResourceV2 | undefined {
  const fallback = explanationResource(plan, fallbackCheckpointId);
  if (!questionText?.trim()) return fallback;
  const question = normalizeForAlignment(questionText);
  if (!question) return fallback;
  const partCheckpointIds = new Set(
    plan.checkpoints.filter((entry) => entry.part_id === partId).map((entry) => entry.checkpoint_id),
  );
  let best: { resource: PlanResourceV2; score: number } | undefined;
  for (const resource of plan.resources) {
    if (resource.kind !== "explanation" || !resource.content) continue;
    if (resource.checkpoint_id && !partCheckpointIds.has(resource.checkpoint_id)) continue;
    const score = longestCommonRunLength(question, normalizeForAlignment(resource.content));
    if (score >= 4 && (!best || score > best.score)) {
      best = { resource, score };
    }
  }
  return best?.resource ?? fallback;
}

function ledgerOf(state: TutorRuntimeState, checkpointId: string): AssistanceLedger {
  return (
    state.assistance[checkpointId] ?? {
      hintLevelsIssued: [],
      incorrectSequences: [],
      failedActionSequences: [],
      promptsIssued: 0,
      promptSequences: [],
      explainedSequences: [],
    }
  );
}

function nextHintLevel(plan: TutorPlanV2Payload, ledger: AssistanceLedger): number | null {
  const max = plan.policy_constraints.maximum_assistance_level;
  for (let level = 1; level <= max; level += 1) {
    if (!ledger.hintLevelsIssued.includes(level)) return level;
  }
  return null;
}

function candidateSkills(plan: TutorPlanV2Payload, checkpointId: string): string[] | undefined {
  const checkpoint = plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId);
  const skills = (checkpoint?.skill_annotations ?? []).map((annotation) => annotation.skill_id).slice(0, 3);
  return skills.length ? skills : undefined;
}

/** incorrect 证据驱动的帮助阶梯：Prompt 自查 → Hint 升档 → Repair（guided 内）。 */
function assistAfterIncorrect(
  context: PolicyContext,
  checkpointId: string,
): TutorDecisionDraft {
  const { plan, state } = context;
  const ledger = ledgerOf(state, checkpointId);
  const lastIncorrect = ledger.incorrectSequences.at(-1);
  // 诊断更新只在对齐事实存在时携带（空 evidence 不是合法 working diagnosis）。
  const diagnosis: WorkingDiagnosisUpdate[] = lastIncorrect
    ? [
        {
          summary_code: "blocker.suspected",
          ...(candidateSkills(plan, checkpointId)
            ? { candidate_skill_ids: candidateSkills(plan, checkpointId) }
            : {}),
          evidence_sequences: [lastIncorrect],
        },
      ]
    : [];

  // 自查 prompt 每个 checkpoint 的挣扎只给一次：以本节点首个偏差为基线，
  // 之后的新错误证据直接升档（PRD 04 §5：失败历史保留、不假装从零开始）。
  const firstIncorrect = ledger.incorrectSequences[0];
  const promptsSinceStruggle =
    firstIncorrect !== undefined
      ? ledger.promptSequences.filter((sequence) => sequence > firstIncorrect).length
      : ledger.promptSequences.length;
  if (promptsSinceStruggle === 0) {
    return {
      move_type: "prompt",
      purpose_code: "prompt.self_check",
      checkpoint_id: checkpointId,
      ...(diagnosis.length ? { diagnosis_updates: diagnosis } : {}),
    };
  }
  const level = nextHintLevel(plan, ledger);
  if (level !== null) {
    const hint = hintResourceAt(plan, checkpointId, level);
    return {
      move_type: "hint",
      purpose_code: "hint.escalate",
      checkpoint_id: checkpointId,
      assistance_level: level,
      resource_ids: hint ? [hint.resource_id] : [],
      ...(diagnosis.length ? { diagnosis_updates: diagnosis } : {}),
    };
  }
  if (state.mode === "repair") {
    // repair 内不再嵌套 repair：保底 Wait + 诊断留痕，等待学生新证据。
    return {
      move_type: "wait",
      purpose_code: "wait.after_exhausted_repair",
      checkpoint_id: checkpointId,
      ...(diagnosis.length ? { diagnosis_updates: diagnosis } : {}),
    };
  }
  const partId = plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)?.part_id ?? "1";
  const repair = repairResourceForPart(plan, partId);
  return {
    move_type: "repair",
    purpose_code: "repair.ladder_exhausted",
    checkpoint_id: checkpointId,
    resource_ids: repair ? [repair.resource_id] : [],
    mode_change: { to_mode: "repair" },
    ...(diagnosis.length ? { diagnosis_updates: diagnosis } : {}),
  };
}

function decideForAlignment(context: PolicyContext): TutorDecisionDraft | null {
  const { plan, state, trigger } = context;
  const alignment = trigger.alignment as Alignment;
  // 对齐分支锚定「学生刚对齐的 checkpoint」：progression 已把 current 前移，
  // confirm/hint/ledger 必须指向学生刚过的节点（PRD 04 §5 同 checkpoint 关联）。
  const checkpointId = trigger.alignment_checkpoint_id ?? state.reasoning.current_checkpoint_id;
  const ledger = ledgerOf(state, checkpointId);
  const assisted = ledger.hintLevelsIssued.length > 0 || ledger.explainedSequences.length > 0;

  switch (alignment) {
    case "expected_checkpoint": {
      if (state.repair.active) {
        return {
          move_type: "confirm",
          purpose_code: "confirm.repair_complete",
          checkpoint_id: checkpointId,
          mode_change: { to_mode: state.mode_before_repair ?? "guided_solve" },
          diagnosis_updates: [
            { summary_code: "progress.repair_recovered", evidence_sequences: [trigger.event_sequence] },
          ],
        };
      }
      const lastSelfCorrection = state.reasoning.self_corrections.at(-1);
      if (lastSelfCorrection && lastSelfCorrection.sequence > trigger.event_sequence) {
        return {
          move_type: "confirm",
          purpose_code: "confirm.self_correction",
          checkpoint_id: checkpointId,
          diagnosis_updates: [
            {
              summary_code: "progress.self_corrected",
              evidence_sequences: [lastSelfCorrection.deviation_sequence, lastSelfCorrection.sequence],
            },
          ],
        };
      }
      const lastHint = ledger.lastHintSequence;
      return {
        move_type: "confirm",
        purpose_code: assisted ? "confirm.assisted_progress" : "confirm.progress",
        checkpoint_id: checkpointId,
        diagnosis_updates: assisted
          ? [
              {
                summary_code: "progress.with_assistance",
                evidence_sequences: [...(lastHint ? [lastHint] : []), trigger.event_sequence],
              },
            ]
          : [],
      };
    }
    case "alternate_valid": {
      return {
        move_type: "confirm",
        purpose_code: "confirm.alternate_path",
        checkpoint_id: checkpointId,
        diagnosis_updates: [
          { summary_code: "path.alternate_valid", evidence_sequences: [trigger.event_sequence] },
        ],
      };
    }
    case "incorrect":
      return assistAfterIncorrect(context, checkpointId);
    case "unclear": {
      // 澄清一次、诊断探针一次，之后不再循环追问——进入帮助阶梯。
      if (ledger.promptsIssued === 0) {
        return { move_type: "prompt", purpose_code: "prompt.clarify", checkpoint_id: checkpointId };
      }
      if (ledger.promptsIssued === 1) {
        const probe = probeResource(plan, checkpointId);
        if (probe) {
          return {
            move_type: "prompt",
            purpose_code: "prompt.diagnostic_probe",
            checkpoint_id: checkpointId,
            resource_ids: [probe.resource_id],
          };
        }
      }
      return assistAfterIncorrect(context, checkpointId);
    }
    case "no_progress":
    default: {
      const consecutive = state.reasoning.consecutive_no_progress;
      if (consecutive <= 1) {
        return { move_type: "wait", purpose_code: "wait.silence_first", checkpoint_id: checkpointId };
      }
      if (consecutive === 2) {
        return { move_type: "prompt", purpose_code: "prompt.reengage", checkpoint_id: checkpointId };
      }
      return assistAfterIncorrect(context, checkpointId);
    }
  }
}

function decideSystem(context: PolicyContext): TutorDecisionDraft | null {
  const { plan, state, trigger } = context;
  const checkpointId = state.reasoning.current_checkpoint_id;
  const ledger = ledgerOf(state, checkpointId);

  if (trigger.system_reason === "session_started") {
    const partId = plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)?.part_id ?? "1";
    const seed = voiceSeedResource(plan, partId);
    const explanation = explanationResource(plan, checkpointId);
    return {
      move_type: "explain",
      purpose_code: "explain.open",
      checkpoint_id: checkpointId,
      resource_ids: [seed?.resource_id, explanation?.resource_id].filter((id): id is string => Boolean(id)),
    };
  }

  if (trigger.system_reason === "presentation_completed") {
    if (trigger.last_move_type === "explain") {
      const hasDeviationEvidence = ledger.incorrectSequences.length > 0;
      if (hasDeviationEvidence) {
        return { move_type: "prompt", purpose_code: "prompt.verify_after_question", checkpoint_id: checkpointId };
      }
      if (state.mode === "teach") {
        // Teach 开场/答问完成且无偏差证据：交接驾驶位（PRD 04 §4.1「根据 state 决定继续」）。
        return {
          move_type: "prompt",
          purpose_code: "prompt.hand_over",
          checkpoint_id: checkpointId,
          mode_change: { to_mode: "guided_solve" },
        };
      }
      return { move_type: "prompt", purpose_code: "prompt.resume_checkpoint", checkpoint_id: checkpointId };
    }
    if (trigger.last_move_type === "confirm") {
      // 推进后来到带 action_template 的节点：把结论交互步交给学生操作。
      const hasActionTemplate = plan.resources.some(
        (resource) => resource.kind === "action_template" && resource.checkpoint_id === checkpointId,
      );
      const alreadyCompleted = state.curriculum.parts
        .flatMap((part) => part.completed_checkpoints)
        .includes(checkpointId);
      if (hasActionTemplate && !alreadyCompleted && !state.workspace.active_action_id) {
        return { move_type: "prompt", purpose_code: "prompt.action_step", checkpoint_id: checkpointId };
      }
      return null;
    }
    // prompt/hint/repair/wait 播完不自动续招：等学生新证据（PRD 04 §5 不机械升级）。
    return null;
  }

  return null;
}

function decideStudentInput(context: PolicyContext): TutorDecisionDraft | null {
  const { plan, state, trigger } = context;
  const checkpointId = state.reasoning.current_checkpoint_id;

  switch (trigger.input_kind) {
    case "question_asked": {
      const partId = plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)?.part_id ?? "1";
      const matched = explanationForQuestion(
        plan,
        partId,
        state.dialogue.open_question?.text,
        checkpointId,
      );
      // 问题文本命中其他 checkpoint 的讲解时，答问 move 锚定到该 checkpoint
      // （讲的是学生问的内容；不推进课程，只是讲解定位）。
      const anchoredCheckpointId =
        matched?.checkpoint_id && matched.checkpoint_id !== checkpointId ? matched.checkpoint_id : checkpointId;
      return {
        move_type: "explain",
        purpose_code: "explain.answer_question",
        checkpoint_id: anchoredCheckpointId,
        resource_ids: [matched?.resource_id].filter((id): id is string => Boolean(id)),
      };
    }
    case "student_interrupted":
      return { move_type: "wait", purpose_code: "wait.after_interruption", checkpoint_id: checkpointId };
    case "silence_observed": {
      const consecutive = state.reasoning.consecutive_no_progress;
      if (consecutive <= 1) {
        return { move_type: "wait", purpose_code: "wait.silence_first", checkpoint_id: checkpointId };
      }
      if (consecutive === 2) {
        return { move_type: "prompt", purpose_code: "prompt.reengage", checkpoint_id: checkpointId };
      }
      return assistAfterIncorrect(context, checkpointId);
    }
    case "pointing_evidence":
      return {
        move_type: "prompt",
        purpose_code: "prompt.verbalize_pointing",
        checkpoint_id: checkpointId,
        diagnosis_updates: [{ summary_code: "evidence.pointing_unverbalized", evidence_sequences: [trigger.event_sequence] }],
      };
    default:
      if (trigger.alignment) return decideForAlignment(context);
      return { move_type: "wait", purpose_code: "wait.await_reasoning", checkpoint_id: checkpointId };
  }
}

export function decideWithDeterministicRules(context: PolicyContext): PolicyOutcome {
  if (context.session_kind === "assessment") {
    return {
      ok: false,
      error_code: "ASSESSMENT_FAIL_CLOSED",
      detail: "Assessment 会话禁止生成式教学 Move（ADR-006 不变量 6）",
      policy_version: DETERMINISTIC_POLICY_VERSION,
    };
  }
  if (context.state.completed) {
    return { ok: true, decision: null, policy_version: DETERMINISTIC_POLICY_VERSION };
  }
  const trigger: PolicyTrigger = context.trigger;
  const decision =
    trigger.kind === "system"
      ? decideSystem(context)
      : decideStudentInput(context);
  if (!decision) {
    return { ok: true, decision: null, policy_version: DETERMINISTIC_POLICY_VERSION };
  }
  return { ok: true, decision, policy_version: DETERMINISTIC_POLICY_VERSION };
}

export const deterministicRulesPolicy: TutorPolicyPort = {
  policyVersion: DETERMINISTIC_POLICY_VERSION,
  decide: decideWithDeterministicRules,
};
