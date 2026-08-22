/**
 * 统一决策不变量层（Phase 5 完整收口计划 §3）。
 *
 * 模型提案、deterministic 决策与所有 fallback 走同一出口：
 * `proposal → canonicalize resources → enforce invariants → Presenter →
 * atomic append`。不变量由 Coordinator 确定性执行（改写而非拒绝——被改写
 * 的决策仍然安全、可呈现、可落库），不再依赖模型提案校验的覆盖面：
 * 降级路径与模型路径受同一纪律约束（TS-7004/TS-7075 护栏盲区闭合）。
 *
 * 规则（与 deterministicRulesPolicy 同口径，作为结构保证）：
 * - I1 首个 incorrect 先 self-check（不得直接 hint/repair/explain）；
 * - I2 hint 档位取首个未用档（不重复、不越级），资源强制 approved hint；
 * - I3 incorrect 挣扎 + 档位耗尽 → 改写 repair.ladder_exhausted + 唯一
 *   part 级 repair 资源（不论模型提了什么，也不落 Wait）；
 * - I4 repair mode 不嵌套 repair（保底 Wait）；
 * - I5 偏差后无实质协助而改对 → confirm.self_correction；
 * - I6 repair 内答对 → confirm.repair_complete 并退出 repair mode。
 * 发生任何改写时，模型动态文案一并丢弃（改写后的 move 与模型文案不再
 * 对应，回退 Presenter 确定性呈现）。
 */
import type { TutorPlanV2Payload, PlanResourceV2 } from "../planBuild/canonicalInputs";
import type { TutorRuntimeState, AssistanceLedger } from "./TutorRuntimeStateProjection";
import type { PolicyTrigger } from "../tutorPolicy/TutorPolicyPort";
import type { TutorDecisionDraft, WorkingDiagnosisUpdate } from "../tutorPolicy/TutorMove";

export interface InvariantEnforcement {
  draft: TutorDecisionDraft;
  /** true = 调用方必须丢弃模型动态文案（改写后由 Presenter 确定性呈现）。 */
  dropDynamicVoice: boolean;
  /** 改写说明（telemetry / 审计用；空数组 = 原样通过）。 */
  rewrites: string[];
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

function hintResourceAt(plan: TutorPlanV2Payload, checkpointId: string, level: number): PlanResourceV2 | undefined {
  return plan.resources.find(
    (resource) => resource.kind === "hint" && resource.checkpoint_id === checkpointId && resource.assistance_level === level,
  );
}

function repairResourceForPart(plan: TutorPlanV2Payload, partId: string): PlanResourceV2 | undefined {
  const checkpointIds = new Set(
    plan.checkpoints.filter((checkpoint) => checkpoint.part_id === partId).map((checkpoint) => checkpoint.checkpoint_id),
  );
  return plan.resources.find(
    (resource) => resource.kind === "repair" && (!resource.checkpoint_id || checkpointIds.has(resource.checkpoint_id)),
  );
}

function firstUnusedHintLevel(plan: TutorPlanV2Payload, ledger: AssistanceLedger): number | null {
  const max = plan.policy_constraints.maximum_assistance_level;
  for (let level = 1; level <= max; level += 1) {
    if (!ledger.hintLevelsIssued.includes(level)) return level;
  }
  return null;
}

function blockerDiagnosis(
  plan: TutorPlanV2Payload,
  checkpointId: string,
  evidenceSequence: number,
): WorkingDiagnosisUpdate[] {
  const checkpoint = plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId);
  const skills = (checkpoint?.skill_annotations ?? []).map((annotation) => annotation.skill_id).slice(0, 3);
  return [
    {
      summary_code: "blocker.suspected",
      ...(skills.length ? { candidate_skill_ids: skills } : {}),
      evidence_sequences: [evidenceSequence],
    },
  ];
}

function repairLadderExhaustedDraft(
  plan: TutorPlanV2Payload,
  checkpointId: string,
  evidenceSequence: number,
): TutorDecisionDraft {
  const partId = plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId)?.part_id ?? "1";
  const repair = repairResourceForPart(plan, partId);
  return {
    move_type: "repair",
    purpose_code: "repair.ladder_exhausted",
    checkpoint_id: checkpointId,
    resource_ids: repair ? [repair.resource_id] : [],
    mode_change: { to_mode: "repair" },
    diagnosis_updates: blockerDiagnosis(plan, checkpointId, evidenceSequence),
  };
}

/** 对任意来源的决策草案确定性执行不变量（纯函数；不改写合规草案）。 */
export function enforceDecisionInvariants(args: {
  draft: TutorDecisionDraft;
  plan: TutorPlanV2Payload;
  /** 含本轮 pending 对齐/进度事实的 canonical 决策视角。 */
  candidateState: TutorRuntimeState;
  trigger: PolicyTrigger;
}): InvariantEnforcement {
  const { plan, candidateState, trigger } = args;
  let draft: TutorDecisionDraft = { ...args.draft };
  const rewrites: string[] = [];
  const checkpointId = draft.checkpoint_id ?? candidateState.reasoning.current_checkpoint_id;
  const ledger = ledgerOf(candidateState, checkpointId);
  const incorrect = ledger.incorrectSequences;
  const firstIncorrectOfStruggle = incorrect.length === 1 && incorrect[0] === trigger.event_sequence;
  const ladderExhausted = firstUnusedHintLevel(plan, ledger) === null;

  // ---- I6：repair 内答对 → confirm.repair_complete + 退出 repair mode ----
  if (
    candidateState.repair.active &&
    (trigger.alignment === "expected_checkpoint" || trigger.alignment === "alternate_valid") &&
    draft.move_type === "confirm"
  ) {
    if (draft.purpose_code !== "confirm.repair_complete" || !draft.mode_change || draft.mode_change.to_mode === "repair") {
      draft = {
        ...draft,
        purpose_code: "confirm.repair_complete",
        mode_change: { to_mode: candidateState.mode_before_repair ?? "guided_solve" },
        diagnosis_updates: [
          { summary_code: "progress.repair_recovered", evidence_sequences: [trigger.event_sequence] },
        ],
      };
      rewrites.push("repair_complete_canonicalized");
    }
  } else {
    // ---- I5：偏差后无实质协助而改对 → confirm.self_correction ----
    const pendingSelfCorrection = candidateState.reasoning.self_corrections.at(-1);
    if (
      trigger.alignment === "expected_checkpoint" &&
      !candidateState.repair.active &&
      pendingSelfCorrection !== undefined &&
      pendingSelfCorrection.sequence > trigger.event_sequence &&
      draft.move_type === "confirm" &&
      draft.purpose_code !== "confirm.self_correction"
    ) {
      draft = {
        ...draft,
        purpose_code: "confirm.self_correction",
        diagnosis_updates: [
          {
            summary_code: "progress.self_corrected",
            evidence_sequences: [pendingSelfCorrection.deviation_sequence, pendingSelfCorrection.sequence],
          },
        ],
      };
      rewrites.push("self_correction_confirm_enforced");
    }
  }

  // ---- I4：repair mode 不嵌套 repair ----
  if (candidateState.mode === "repair" && draft.move_type === "repair") {
    draft = {
      move_type: "wait",
      purpose_code: "wait.after_exhausted_repair",
      checkpoint_id: checkpointId,
    };
    rewrites.push("nested_repair_blocked");
  }
  // ---- I1：首个 incorrect 先 self-check（本对齐即挣扎起点）----
  else if (
    trigger.alignment === "incorrect" &&
    firstIncorrectOfStruggle &&
    (draft.move_type === "hint" || draft.move_type === "repair" || draft.move_type === "explain")
  ) {
    draft = {
      move_type: "prompt",
      purpose_code: "prompt.self_check",
      checkpoint_id: checkpointId,
      diagnosis_updates: blockerDiagnosis(plan, checkpointId, trigger.event_sequence),
    };
    rewrites.push("first_incorrect_self_check");
  }
  // ---- I3：incorrect 挣扎 + 档位耗尽 → 必须 repair（不论模型提了什么，
  //  也不落 Wait——计划 §3「不再让模型修复两次后落 Wait」；TS-7004）----
  else if (
    trigger.alignment === "incorrect" &&
    !firstIncorrectOfStruggle &&
    ladderExhausted &&
    candidateState.mode !== "repair" &&
    draft.move_type !== "repair"
  ) {
    draft = repairLadderExhaustedDraft(plan, checkpointId, trigger.event_sequence);
    rewrites.push("ladder_exhausted_repair_enforced");
  }
  // ---- I2：hint 档位/资源 canonical 化（耗尽 → repair / repair mode 保底 Wait）----
  else if (draft.move_type === "hint") {
    const level = firstUnusedHintLevel(plan, ledger);
    if (level === null) {
      if (candidateState.mode === "repair") {
        draft = {
          move_type: "wait",
          purpose_code: "wait.after_exhausted_repair",
          checkpoint_id: checkpointId,
        };
        rewrites.push("hint_in_repair_blocked");
      } else {
        draft = repairLadderExhaustedDraft(plan, checkpointId, trigger.event_sequence);
        rewrites.push("ladder_exhausted_repair_enforced");
      }
    } else {
      const hint = hintResourceAt(plan, checkpointId, level);
      const canonicalResourceIds = hint ? [hint.resource_id] : [];
      const originalLevel = draft.assistance_level;
      const resourcesMatch =
        draft.resource_ids !== undefined &&
        draft.resource_ids.length === canonicalResourceIds.length &&
        draft.resource_ids.every((id, index) => id === canonicalResourceIds[index]);
      if (originalLevel !== level || !resourcesMatch) {
        draft = {
          ...draft,
          checkpoint_id: checkpointId,
          assistance_level: level,
          resource_ids: canonicalResourceIds,
        };
        rewrites.push(`hint_level_canonicalized:${originalLevel ?? "none"}->${level}`);
      }
    }
  }

  return { draft, dropDynamicVoice: rewrites.length > 0, rewrites };
}
