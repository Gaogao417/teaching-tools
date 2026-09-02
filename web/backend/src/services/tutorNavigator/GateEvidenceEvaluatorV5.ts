/**
 * GateEvidenceEvaluatorV5（F5 — Session 与 Protocol Navigator 内核；R3 简化，2026-08-31）。
 *
 * 按 Beat 的 canonical completion_evidence 评估完成门槛：
 * - 学生证据类 gate（evidence_kind ∈ student_answer / workspace_command /
 *   student_confirmation / explicit_gate_pass——F4 materializer 的
 *   STUDENT_EVIDENCE_KINDS 同集合）只能被**对应学生证据**满足；
 * - **narration 播完、计时结束或模型猜测不能替代 completion evidence**
 *   （ADR-007 约束；canonical schema 对 evidence_kind 的 description 同口径）：
 *   学生证据类 gate 收到 narration/timeout 输入时返回 unsatisfied +
 *   requires_student_evidence（Navigator 将其裁决为显式 failure）；
 * - narration_completed / tutor_observed 类 Beat 的证据就是叙述完成本身，
 *   由 voice outcome completed 满足；
 * - **R3（计划 §5 R3 工作项 2）**：student_answer 的裁决人=session pin 的模型
 *   （ModelGateAdjudicatorV5 同一次调用）；本评估器**只接收已验证的模型
 *   assessment**（verdict/matched_gate_id/evidence_sequence），不再做 LCS/
 *   否定词/数字全集等字符串最终裁决——残留字符串逻辑只允许上游用于选择相关
 *   Fact/组装上下文（见 SemanticInterpreterV5.matchFacts），不得决定 satisfied。
 *   无模型裁决（缺省）不得 pass、不得回退字符串规则（模型失败=runtime/model
 *   failure，走 unclear→澄清/安全 fallback，不是 student incorrect）。
 */
import type { NavigatorBeatView, NavigatorPlanV5 } from "./NavigatorPlanV5";
import type { GateAdjudicationVerdict } from "./ModelGateAdjudicatorV5";

/** 学生证据类 evidence kind（与 F4 materializer STUDENT_EVIDENCE_KINDS 同集合）。 */
export type StudentEvidenceKind = "student_answer" | "workspace_command" | "student_confirmation" | "explicit_gate_pass";

const STUDENT_EVIDENCE_KINDS: ReadonlySet<string> = new Set<string>([
  "student_answer",
  "workspace_command",
  "student_confirmation",
  "explicit_gate_pass",
]);

function isStudentEvidenceKind(kind: string): kind is StudentEvidenceKind {
  return STUDENT_EVIDENCE_KINDS.has(kind);
}

/** 已验证的模型裁决（服务端薄边界复核后的唯一采信形状）。 */
export interface ModelGateAssessmentInput {
  readonly verdict: GateAdjudicationVerdict;
  /** 裁决针对的 gate（模型返回、服务端复核过的 canonical ID；跨 gate 的 pass 不采信）。 */
  readonly matched_gate_id?: string;
  /** 满足时的证据来源事件 sequence（=学生输入事件，写入 gate_evaluated.evidence_sequence）。 */
  readonly evidence_sequence?: number;
}

/**
 * F7（计划 v3 因果链 2）：workspace_command gate 的已验证裁决——由单一
 * typed evaluator（WorkspaceActionAdjudication）对 pinned ActionTemplate
 * 评判产出。本评估器只消费 verified 结论、不读教学真值（与 student_answer
 * gate 消费已验证模型 assessment 同构）：completed 回执 + verified-correct
 * 才满足；completed 但未验证（直接命令数学错误）→ unsatisfied——这是合法
 * 组合：workspace 构造痕迹保留，gate 不满足、Beat 不推进（安全测试②语义）。
 */
export interface WorkspaceGateAssessmentInput {
  readonly verdict: "verified-correct" | "verified-wrong";
  /** 被评判的回执事件 sequence（须与某条 completed workspace outcome 对齐）。 */
  readonly evidence_sequence: number;
}

export interface GateEvidenceInput {
  /** 当前 Beat 门内收到的确认意图事件 sequence（按序；确定性判断）。 */
  readonly confirmation_sequences: readonly number[];
  /** 当前 Beat 门内已提交的 workspace 命令 outcome 事实（确定性判断）。 */
  readonly workspace_outcomes: ReadonlyArray<{ capability: string; outcome: string; sequence: number }>;
  /** 当前 Beat 的 voice narration 是否已 completed（outcome 事实）。 */
  readonly narration_completed: boolean;
  /** student_answer 的模型裁决（R3 唯一裁决来源；缺省不得 pass）。 */
  readonly model_assessment?: ModelGateAssessmentInput;
  /** workspace_command 的 typed evaluator 裁决（F7 唯一采信来源；缺省不得 pass）。 */
  readonly workspace_assessments?: readonly WorkspaceGateAssessmentInput[];
  /** narrative/计时输入的显式声明（评估「不可替代」负例的输入）。 */
  readonly narration_attempted_as_evidence?: boolean;
  readonly timeout_attempted_as_evidence?: boolean;
}

export interface GateEvidenceAssessment {
  readonly satisfied: boolean;
  /** 满足时的证据来源事件 sequence（写入 gate_evaluated.evidence_sequence）。 */
  readonly evidence_sequence?: number;
  /** 未满足且输入不含合法学生证据时给出拒绝原因（Navigator 裁决 failure 用）。 */
  readonly reason?:
    | "requires_student_evidence"
    | "answer_not_matching"
    | "answer_not_adjudicated"
    | "workspace_not_completed"
    | "workspace_not_verified"
    | "no_evidence";
}

/** student_answer：只消费已验证的模型 assessment（无字符串回退）。 */
function assessStudentAnswer(
  beat: NavigatorBeatView,
  input: GateEvidenceInput,
): GateEvidenceAssessment {
  const gateId = beat.completion_evidence.gate?.gate_id;
  const assessment = input.model_assessment;
  if (!assessment) {
    // 没有模型裁决就没有满足路径（模型失败/未调用 ≠ 学生答错）。
    return { satisfied: false, reason: "answer_not_adjudicated" };
  }
  if (assessment.matched_gate_id !== undefined && assessment.matched_gate_id !== gateId) {
    // 跨 gate 裁决（如未来 gate）对本 gate 不构成证据。
    return { satisfied: false, reason: "answer_not_matching" };
  }
  if (assessment.verdict === "pass") {
    return {
      satisfied: true,
      ...(assessment.evidence_sequence !== undefined ? { evidence_sequence: assessment.evidence_sequence } : {}),
    };
  }
  // fail（学生最终主张不满足）/ unclear（矛盾/歧义/模型故障降级）/ not_applicable
  //（提问/求助/复述）都不满足——等待新的学生证据。
  return { satisfied: false, reason: "answer_not_matching" };
}

/** 评估当前 Beat 的 completion gate（纯函数；同输入同结论）。 */
export function evaluateGateEvidence(
  plan: NavigatorPlanV5,
  beat: NavigatorBeatView,
  input: GateEvidenceInput,
): GateEvidenceAssessment {
  void plan; // plan 保留在签名上（beat 视图已含 gate 绑定）；R3 后 student_answer 不再读 plan 做字符串裁决
  const kind = beat.completion_evidence.evidence_kind;
  const gate = beat.completion_evidence.gate;

  if (isStudentEvidenceKind(kind)) {
    // narration/计时/模型猜测不是学生证据——显式拒绝（不静默视作 unsatisfied
    // 的普通等待，调用方以显式 failure 呈现）。
    if (input.narration_attempted_as_evidence || input.timeout_attempted_as_evidence) {
      return { satisfied: false, reason: "requires_student_evidence" };
    }
    switch (kind) {
      case "student_answer":
        return assessStudentAnswer(beat, input);
      case "workspace_command": {
        const capability = gate?.capability;
        const assessments = input.workspace_assessments ?? [];
        let sawCompleted = false;
        for (const outcome of input.workspace_outcomes) {
          if (capability && outcome.capability !== capability) continue;
          if (outcome.outcome !== "completed") continue;
          sawCompleted = true;
          // F7 因果链 2：completed 回执必须配套同一 sequence 的 verified-correct
          // assessment 才满足（单一 typed evaluator 产物；本评估器不读真值）。
          const verified = assessments.find(
            (assessment) => assessment.verdict === "verified-correct" && assessment.evidence_sequence === outcome.sequence,
          );
          if (verified) return { satisfied: true, evidence_sequence: outcome.sequence };
        }
        if (sawCompleted) return { satisfied: false, reason: "workspace_not_verified" };
        return input.workspace_outcomes.length
          ? { satisfied: false, reason: "workspace_not_completed" }
          : { satisfied: false, reason: "no_evidence" };
      }
      case "student_confirmation":
      case "explicit_gate_pass":
      default:
        return input.confirmation_sequences.length
          ? { satisfied: true, evidence_sequence: input.confirmation_sequences[input.confirmation_sequences.length - 1] }
          : { satisfied: false, reason: "no_evidence" };
    }
  }

  // narration_completed / tutor_observed：证据即叙述完成/教师观察（非学生证据门槛）。
  if (kind === "narration_completed" || kind === "tutor_observed") {
    return input.narration_completed ? { satisfied: true } : { satisfied: false, reason: "no_evidence" };
  }
  return { satisfied: false, reason: "no_evidence" };
}
