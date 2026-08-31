/**
 * GateEvidenceEvaluatorV5（F5 — Session 与 Protocol Navigator 内核）。
 *
 * 按 Beat 的 canonical completion_evidence 评估完成门槛：
 * - 学生证据类 gate（evidence_kind ∈ student_answer / workspace_command /
 *   student_confirmation / explicit_gate_pass——F4 materializer 的
 *   STUDENT_EVIDENCE_KINDS 同集合）只能被**对应学生证据**满足：确认意图 /
 *   答案匹配 gate 的 graph fact / workspace 命令 completed outcome；
 * - **narration 播完、计时结束或模型猜测不能替代 completion evidence**
 *   （ADR-007 约束；canonical schema 对 evidence_kind 的 description 同口径）：
 *   学生证据类 gate 收到 narration/timeout 输入时返回 unsatisfied +
 *   requires_student_evidence（Navigator 将其裁决为显式 failure）；
 * - narration_completed / tutor_observed 类 Beat 的证据就是叙述完成本身，
 *   由 voice outcome completed 满足；
 * - student_answer 的确定性匹配：gate.graph_fact_id 存在时对 RG fact
 *   statement 做归一化 LCS（interpreter 同口径）；无 graph_fact_id 时对 gate
 *   requirement 文本匹配。
 */
import type { NavigatorBeatView, NavigatorPlanV5 } from "./NavigatorPlanV5";
import {
  analyzeAnswerAgainstBasis,
  factDigitUniverse,
  interpretationMatchScore,
  INTERPRETATION_MATCH_THRESHOLD,
} from "./SemanticInterpreterV5";

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

export interface GateEvidenceInput {
  /** 当前 Beat 门内收到的确认意图事件 sequence（按序）。 */
  readonly confirmation_sequences: readonly number[];
  /** 当前 Beat 门内收到的作答（文本 + 事件 sequence）。 */
  readonly submitted_answers: ReadonlyArray<{ text: string; sequence: number }>;
  /** 当前 Beat 门内已提交的 workspace 命令 outcome 事实。 */
  readonly workspace_outcomes: ReadonlyArray<{ capability: string; outcome: string; sequence: number }>;
  /** 当前 Beat 的 voice narration 是否已 completed（outcome 事实）。 */
  readonly narration_completed: boolean;
  /** narrative/计时输入的显式声明（评估「不可替代」负例的输入）。 */
  readonly narration_attempted_as_evidence?: boolean;
  readonly timeout_attempted_as_evidence?: boolean;
}

export interface GateEvidenceAssessment {
  readonly satisfied: boolean;
  /** 满足时的证据来源事件 sequence（写入 gate_evaluated.evidence_sequence）。 */
  readonly evidence_sequence?: number;
  /** 未满足且输入不含合法学生证据时给出拒绝原因（Navigator 裁决 failure 用）。 */
  readonly reason?: "requires_student_evidence" | "answer_not_matching" | "workspace_not_completed" | "no_evidence";
}

function assessStudentAnswer(
  plan: NavigatorPlanV5,
  beat: NavigatorBeatView,
  factStatement: string | undefined,
  input: GateEvidenceInput,
): GateEvidenceAssessment {
  const basis = factStatement ?? beat.completion_evidence.gate?.requirement ?? beat.purpose;
  const universeDigits = factDigitUniverse(plan);
  for (const answer of input.submitted_answers) {
    const guards = analyzeAnswerAgainstBasis(answer.text, basis, universeDigits);
    if (guards.adversarial) {
      // 2026-08-31 R1 对抗守卫（与 interpreter 同口径）：negation / 数值矛盾 /
      // stuffing 的作答不得满足 student_answer gate——关键词命中不算数。
      continue;
    }
    if (interpretationMatchScore(answer.text, basis) >= INTERPRETATION_MATCH_THRESHOLD) {
      return { satisfied: true, evidence_sequence: answer.sequence };
    }
  }
  return input.submitted_answers.length
    ? { satisfied: false, reason: "answer_not_matching" }
    : { satisfied: false, reason: "no_evidence" };
}

/** 评估当前 Beat 的 completion gate（纯函数；同输入同结论）。 */
export function evaluateGateEvidence(
  plan: NavigatorPlanV5,
  beat: NavigatorBeatView,
  input: GateEvidenceInput,
): GateEvidenceAssessment {
  const kind = beat.completion_evidence.evidence_kind;
  const gate = beat.completion_evidence.gate;

  if (isStudentEvidenceKind(kind)) {
    // narration/计时/模型猜测不是学生证据——显式拒绝（不静默视作 unsatisfied
    // 的普通等待，调用方以显式 failure 呈现）。
    if (input.narration_attempted_as_evidence || input.timeout_attempted_as_evidence) {
      return { satisfied: false, reason: "requires_student_evidence" };
    }
    switch (kind) {
      case "student_answer": {
        const fact = gate?.graph_fact_id ? plan.facts.get(gate.graph_fact_id) : undefined;
        return assessStudentAnswer(plan, beat, fact?.statement, input);
      }
      case "workspace_command": {
        const capability = gate?.capability;
        for (const outcome of input.workspace_outcomes) {
          if (capability && outcome.capability !== capability) continue;
          if (outcome.outcome === "completed") return { satisfied: true, evidence_sequence: outcome.sequence };
        }
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
