/**
 * TutorNavigatorV5（F5 — Session 与 Protocol Navigator 内核）。
 *
 * ADR-007 §2/§3：Navigator 是**确定性合法转移裁决者**——最高层决策是「在已
 * 批准协议中如何导航」，只在 PR beats.transitions 声明的出边内选择；Semantic
 * Interpreter 的输出（hypothesis）是可推翻假设，引用前必须自行验证（如
 * accept_alternate_path 前复核 SV 真实存在于 RG）。对应 09-target-architecture
 * 的抽象签名 `Decide: Plan * State * Input * Interpretation -> Result<Decision, Error>`。
 *
 * 纯函数决定论（G5 第一条）：decide = f(plan, state, trigger, context 计数器)，
 * 计数器由已提交事件流纯派生（deriveLocalInquirySteps /
 * deriveUnresolvedClarifications）——固定 Plan/state/interpretation 重复执行
 * 得到相同合法 decision 或相同显式 failure。
 *
 * fail closed（负例义务，全部经 decide 真实入口断言）：
 * - gate unsatisfied / 无声明出边 / to_beat 不在协议内 → no_legal_transition；
 * - 学生证据类 gate 以 narration/timeout 推进 → gate_unresolvable（narration
 *   播完、计时结束或模型猜测不能替代 completion evidence——ADR-007 约束）；
 * - inquiry 协议不在 session pin refs 内 / 分支无 return point → 拒绝；
 * - inquiry 分支 trigger 不匹配 → 不打开批准分支（fallback 链降级）。
 *
 * decision 只描述教学选择（canonical ai_teaching_tutor_policy_decision/v1 形
 * 状）：不直接修改 Workspace、不发 DomainCommand（执行属 F3/F6）。
 */
import type { TutorRuntimeStateV5 } from "../tutorSession/TutorRuntimeStateReducerV5";
import type { StoredV5Event, V5LocalInquiryProtocolPayload } from "../tutorSession/TutorSessionEventV5";
import { pinnedProtocol, protocolIsPinned, type NavigatorBeatView, type NavigatorPlanV5 } from "./NavigatorPlanV5";
import type { IntentKind, NavigatorInterpretation } from "./SemanticInterpreterV5";
import { ASSISTANCE_CONFIDENT_THRESHOLD, INTERPRETER_V5_VERSION } from "./SemanticInterpreterV5";
import { evaluateGateEvidence } from "./GateEvidenceEvaluatorV5";
import { buildLocalInquiryProtocol } from "./LocalInquiryProtocolV5";

export const NAVIGATOR_V5_VERSION = "protocol-navigator/v5-deterministic";

/** LocalInquiryProtocol 步数上限（bounded：session-local、可丢弃、不回写 Plan）。 */
export const MAX_LOCAL_INQUIRY_STEPS = 3;

export type PolicyFailureClass =
  | "no_legal_transition"
  | "gate_unresolvable"
  | "gate_binding_mismatch"
  | "interpreter_unavailable"
  | "policy_engine_error"
  | "timeout";

/**
 * 内部 failure_class → canonical v5 policy_failed 封闭枚举的映射（R3 零 schema
 * 变更约束；偏差登记见 r3-scope-ledger「授权边界」5）：gate_binding_mismatch 持久
 * 化为 policy_engine_error + message 前缀，事实不丢失、合同不动。
 */
export function canonicalPolicyFailureClass(failureClass: PolicyFailureClass): {
  failure_class: "no_legal_transition" | "gate_unresolvable" | "interpreter_unavailable" | "policy_engine_error" | "timeout";
  message_prefix?: string;
} {
  if (failureClass === "gate_binding_mismatch") {
    return { failure_class: "policy_engine_error", message_prefix: "gate_binding_mismatch:" };
  }
  return { failure_class: failureClass };
}

export type TransitionOn = "gate_satisfied" | "evidence_collected" | "student_request" | "timeout" | "tutor_discretion";

export type NavigatorTrigger =
  | { kind: "session_start" }
  | {
      kind: "student_input";
      sequence: number;
      /**
       * F7 Step 3 rework（additive 可选化）：v6 后端解释器对无法归类的输入
       * （模型 mixed_or_ambiguous/降级）不预判 intent——此时省略本字段，裁决
       * 只依赖 hypothesis（unclear → 澄清/安全 fallback）。本文件内全部读取点
       * 均为字面量比较，undefined 自然落入默认分支；v5 调用方始终携带，行为不变。
       */
      intent_kind?: IntentKind;
      text?: string;
      hypothesis: NavigatorInterpretation;
    }
  | {
      kind: "gate_evaluated";
      sequence: number;
      gate_id: string;
      beat_id: string;
      satisfied: boolean;
      evidence_sequence?: number;
    }
  | { kind: "narration_completed"; sequence: number }
  | { kind: "timeout"; sequence: number; beat_id: string }
  | { kind: "silence"; sequence: number; hypothesis: NavigatorInterpretation }
  /**
   * F6 增补（f6-scope-ledger 授权边界 3）：编排层请求对当前（inquiry-aware）
   * Beat 产出 execute_beat 呈现决策——Beat 推进（transition/return）后新 Beat
   * 的呈现锚定决策唯一来源（transition 决策 beat_id=from-Beat，不能作 F3
   * tutor workspace 动作的因果锚——assertTutorActionCausation 要求
   * decision.beatId==cursor.beatId）。教学判断仍在 decideNavigation（确定性）。
   */
  | { kind: "beat_execution"; sequence: number };

export interface NavigatorContext {
  readonly sessionId: string;
  readonly plan: NavigatorPlanV5;
  /** F2 kernel 在线 state（只读消费；decision 不改 state，持久化经 kernel.append）。 */
  readonly state: TutorRuntimeStateV5;
  /** 触发时的 session revision（decision.source_state_revision）。 */
  readonly revision: number;
  /** inquiry 打开时的当前 inquiry Beat（mainline 无 inquiry 时 undefined）。 */
  readonly inquiryBeatId?: string;
  /** LocalInquiry 已走步数（事件流派生）。 */
  readonly localInquirySteps: number;
  /** 连续未解决的 clarification 数（事件流派生）。 */
  readonly unresolvedClarifications: number;
}

/** canonical policy_decision_made payload 同构形状（canonica Zod 判定在 append 侧）。 */
export interface NavigatorDecision {
  readonly decision_id: string;
  readonly decision_kind:
    | "execute_beat"
    | "complete_beat"
    | "transition_beat"
    | "open_inquiry"
    | "open_scaffold"
    | "continue_inquiry"
    | "return_to_mainline"
    | "revisit_beat"
    | "accept_alternate_path"
    | "change_stance"
    | "request_clarification"
    | "pause"
    | "safe_fallback";
  readonly protocol_id: string;
  readonly beat_id: string;
  readonly to_beat_id?: string;
  readonly policy_version: string;
  readonly source_event_sequence: number;
  readonly source_state_revision: number;
  readonly transition_basis?: {
    basis:
      | "legal_transition"
      | "gate_satisfied"
      | "gate_unsatisfied"
      | "student_evidence"
      | "inquiry_completed"
      | "timeout"
      | "safe_fallback_policy";
    gate_id?: string;
    graph_variant_id?: string;
  };
  readonly inquiry?: { inquiry_id: string; inquiry_protocol_id?: string; return_beat_id: string };
  /**
   * session-local LocalInquiryProtocol（2026-08-31 R1 结构化补全）：只随
   * decision_kind=open_inquiry 且**无** inquiry_protocol_id 携带（六要素全量，
   * LPR-/LBT- 命名空间；canonical payload 同形状校验在 append 侧）。
   */
  readonly local_inquiry_protocol?: V5LocalInquiryProtocolPayload;
  readonly interpretation_summary?: {
    intent: string;
    reasoning_location: "aligned" | "partially_aligned" | "misaligned" | "unknown";
    confidence: number;
    interpreter_version: string;
    evidence_sequences?: number[];
  };
}

export type NavigatorOutcome =
  | { ok: true; decision: NavigatorDecision }
  | { ok: false; failure: { failure_class: PolicyFailureClass; message: string } };

/** 已提交事件流的纯派生：当前 LocalInquiry 已走步数。 */
export function deriveLocalInquirySteps(events: readonly StoredV5Event[]): number {
  let openInquiryId: string | null = null;
  let local = false;
  let steps = 0;
  for (const event of events) {
    if (event.event_type === "policy_decision_made") {
      const payload = event.payload as {
        decision_kind?: string;
        inquiry?: { inquiry_id: string; inquiry_protocol_id?: string; return_beat_id: string };
      };
      if (
        (payload.decision_kind === "open_inquiry" || payload.decision_kind === "open_scaffold") &&
        payload.inquiry
      ) {
        openInquiryId = payload.inquiry.inquiry_id;
        local = payload.inquiry.inquiry_protocol_id === undefined;
        steps = 0;
      } else if (payload.decision_kind === "continue_inquiry" && payload.inquiry?.inquiry_id === openInquiryId && local) {
        steps += 1;
      } else if (payload.decision_kind === "return_to_mainline") {
        openInquiryId = null;
        local = false;
        steps = 0;
      }
    } else if (event.event_type === "inquiry_returned") {
      const payload = event.payload as { inquiry_id: string };
      if (payload.inquiry_id === openInquiryId) {
        openInquiryId = null;
        local = false;
        steps = 0;
      }
    }
  }
  return steps;
}

/** 已提交事件流的纯派生：自上一次非 clarification 决策以来的连续 clarification 数。 */
export function deriveUnresolvedClarifications(events: readonly StoredV5Event[]): number {
  let count = 0;
  for (const event of events) {
    if (event.event_type !== "policy_decision_made") continue;
    const payload = event.payload as { decision_kind?: string };
    if (payload.decision_kind === "request_clarification") count += 1;
    else count = 0;
  }
  return count;
}

function decisionId(sessionId: string, sourceSequence: number): string {
  return `TD-${sessionId}-${String(sourceSequence).padStart(4, "0")}`;
}

function inquiryId(sessionId: string, sourceSequence: number): string {
  return `IQ-${sessionId}-${String(sourceSequence).padStart(4, "0")}`;
}

function transitionEdge(beat: NavigatorBeatView, on: TransitionOn): { to_beat: string; on: TransitionOn } | undefined {
  return beat.transitions.find((edge) => edge.on === on);
}

function mainlineBeat(ctx: NavigatorContext): NavigatorBeatView {
  const cursor = ctx.state.teaching_cursor;
  const protocol = pinnedProtocol(ctx.plan, cursor.protocol_id);
  const beat = protocol?.beats.get(cursor.beat_id);
  if (!protocol || !beat) {
    throw new Error(`state cursor ${cursor.protocol_id}/${cursor.beat_id} is not within the pinned plan`);
  }
  return beat;
}

function isLastMainlineBeat(ctx: NavigatorContext, beat: NavigatorBeatView): boolean {
  return ctx.plan.mainline.beat_order[ctx.plan.mainline.beat_order.length - 1] === beat.beat_id;
}

function interpretSummary(hypothesis: NavigatorInterpretation, sequence: number): NavigatorDecision["interpretation_summary"] {
  return {
    intent: hypothesis.intent,
    reasoning_location: hypothesis.reasoning_location,
    confidence: hypothesis.confidence,
    interpreter_version: hypothesis.interpreter_version,
    evidence_sequences: [sequence],
  };
}

/** inquiry 分支匹配：当前 Beat 的 inquiry_branch.trigger 与求助触发是否一致。 */
type InquiryTrigger = "ask_question" | "request_scaffold" | "request_rephrase" | "unclear" | "out_of_bound";

function openApprovedBranch(
  ctx: NavigatorContext,
  beat: NavigatorBeatView,
  triggerKind: InquiryTrigger,
  source: { sequence: number; hypothesis: NavigatorInterpretation },
  kind: "open_inquiry" | "open_scaffold",
): NavigatorOutcome {
  const branch = beat.inquiry_branch;
  if (!branch) return { ok: false, failure: { failure_class: "no_legal_transition", message: `beat ${beat.beat_id} has no approved inquiry branch` } };
  if (branch.trigger !== triggerKind) {
    return {
      ok: false,
      failure: {
        failure_class: "no_legal_transition",
        message: `beat ${beat.beat_id} inquiry branch trigger=${branch.trigger ?? "(any)"} does not match ${triggerKind}`,
      },
    };
  }
  // fail closed：分支协议必须在 session pin refs 内且带显式 return point。
  if (!protocolIsPinned(ctx.plan, branch.inquiry_protocol_ref.artifact_id)) {
    return {
      ok: false,
      failure: {
        failure_class: "no_legal_transition",
        message: `inquiry protocol ${branch.inquiry_protocol_ref.artifact_id} is not pinned in this session`,
      },
    };
  }
  const inquiry = {
    inquiry_id: inquiryId(ctx.sessionId, source.sequence),
    inquiry_protocol_id: branch.inquiry_protocol_ref.artifact_id,
    return_beat_id: branch.return_beat_id,
  };
  return {
    ok: true,
    decision: {
      decision_id: decisionId(ctx.sessionId, source.sequence),
      decision_kind: kind,
      protocol_id: ctx.plan.mainline.protocol_id,
      beat_id: beat.beat_id,
      policy_version: NAVIGATOR_V5_VERSION,
      source_event_sequence: source.sequence,
      source_state_revision: ctx.revision,
      transition_basis: { basis: "student_evidence" },
      inquiry,
      interpretation_summary: interpretSummary(source.hypothesis, source.sequence),
    },
  };
}

function localInquiry(
  ctx: NavigatorContext,
  beat: NavigatorBeatView,
  source: { sequence: number; hypothesis: NavigatorInterpretation },
): NavigatorOutcome {
  // bounded：超过步数上限强制返回主线（不隐式推进 TeachingCursor、不回写 Plan）。
  if (ctx.localInquirySteps >= MAX_LOCAL_INQUIRY_STEPS) {
    return forcedReturn(ctx, source);
  }
  return {
    ok: true,
    decision: {
      decision_id: decisionId(ctx.sessionId, source.sequence),
      decision_kind: "continue_inquiry",
      protocol_id: ctx.plan.mainline.protocol_id,
      beat_id: beat.beat_id,
      policy_version: NAVIGATOR_V5_VERSION,
      source_event_sequence: source.sequence,
      source_state_revision: ctx.revision,
      transition_basis: { basis: "student_evidence" },
      inquiry: {
        inquiry_id: currentInquiryId(ctx.state),
        return_beat_id: ctx.state.inquiry_cursor?.return_beat_id ?? beat.beat_id,
      },
      interpretation_summary: interpretSummary(source.hypothesis, source.sequence),
    },
  };
}

function forcedReturn(
  ctx: NavigatorContext,
  source: { sequence: number; hypothesis?: NavigatorInterpretation },
): NavigatorOutcome {
  const open = ctx.state.inquiry_cursor;
  if (!open) {
    return { ok: false, failure: { failure_class: "no_legal_transition", message: "no open inquiry to return from" } };
  }
  return {
    ok: true,
    decision: {
      decision_id: decisionId(ctx.sessionId, source.sequence),
      decision_kind: "return_to_mainline",
      protocol_id: ctx.plan.mainline.protocol_id,
      beat_id: open.return_beat_id,
      to_beat_id: open.return_beat_id,
      policy_version: NAVIGATOR_V5_VERSION,
      source_event_sequence: source.sequence,
      source_state_revision: ctx.revision,
      transition_basis: { basis: "safe_fallback_policy" },
      inquiry: {
        inquiry_id: open.inquiry_id,
        ...(open.inquiry_protocol_id ? { inquiry_protocol_id: open.inquiry_protocol_id } : {}),
        return_beat_id: open.return_beat_id,
      },
      ...(source.hypothesis ? { interpretation_summary: interpretSummary(source.hypothesis, source.sequence) } : {}),
    },
  };
}

function currentInquiryId(state: TutorRuntimeStateV5): string {
  const open = state.inquiry_cursor;
  if (!open) throw new Error("inquiry is not open");
  return open.inquiry_id;
}

/** 确定性裁决入口（纯函数）。 */
export function decideNavigation(ctx: NavigatorContext, trigger: NavigatorTrigger): NavigatorOutcome {
  // completed 守卫：会话收束后不再产生教学决策（新输入只落 fact + 显式
  // failure）——防止重复 complete_beat / session_completed 事实。
  if (ctx.state.completed) {
    return {
      ok: false,
      failure: {
        failure_class: "no_legal_transition",
        message: "session already completed; no further teaching decisions are legal",
      },
    };
  }
  switch (trigger.kind) {
    case "session_start": {
      const entry = ctx.plan.mainline.entry_beat_id;
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, 1),
          decision_kind: "execute_beat",
          protocol_id: ctx.plan.mainline.protocol_id,
          beat_id: entry,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: 1,
          source_state_revision: 1,
          transition_basis: { basis: "legal_transition" },
        },
      };
    }
    case "narration_completed": {
      const beat = mainlineBeat(ctx);
      // narration 播完不能替代需学生证据的 gate（评估器显式拒绝 → 显式 failure）。
      const assessment = evaluateGateEvidence(ctx.plan, beat, {
        confirmation_sequences: [],
        workspace_outcomes: [],
        narration_completed: true,
        narration_attempted_as_evidence: true,
      });
      if (!assessment.satisfied) {
        return {
          ok: false,
          failure: {
            failure_class: "gate_unresolvable",
            message: `beat ${beat.beat_id} gate requires student evidence; narration completion cannot satisfy it`,
          },
        };
      }
      const edge = transitionEdge(beat, "gate_satisfied") ?? transitionEdge(beat, "evidence_collected");
      if (!edge) {
        return {
          ok: false,
          failure: { failure_class: "no_legal_transition", message: `beat ${beat.beat_id} has no satisfied-gate transition edge` },
        };
      }
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, trigger.sequence),
          decision_kind: "transition_beat",
          protocol_id: ctx.plan.mainline.protocol_id,
          beat_id: beat.beat_id,
          to_beat_id: edge.to_beat,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: trigger.sequence,
          source_state_revision: ctx.revision,
          transition_basis: { basis: "gate_satisfied", gate_id: beat.completion_evidence.gate?.gate_id },
        },
      };
    }
    case "timeout": {
      const beat = mainlineBeat(ctx);
      if (beat.pacing.wait_policy !== "bounded_wait") {
        return {
          ok: false,
          failure: { failure_class: "no_legal_transition", message: `beat ${beat.beat_id} pacing is student_driven; timeout is not a legal trigger` },
        };
      }
      const edge = transitionEdge(beat, "timeout");
      if (edge) {
        return {
          ok: true,
          decision: {
            decision_id: decisionId(ctx.sessionId, trigger.sequence),
            decision_kind: "transition_beat",
            protocol_id: ctx.plan.mainline.protocol_id,
            beat_id: beat.beat_id,
            to_beat_id: edge.to_beat,
            policy_version: NAVIGATOR_V5_VERSION,
            source_event_sequence: trigger.sequence,
            source_state_revision: ctx.revision,
            transition_basis: { basis: "timeout" },
          },
        };
      }
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, trigger.sequence),
          decision_kind: "safe_fallback",
          protocol_id: ctx.plan.mainline.protocol_id,
          beat_id: beat.beat_id,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: trigger.sequence,
          source_state_revision: ctx.revision,
          transition_basis: { basis: "safe_fallback_policy" },
        },
      };
    }
    case "gate_evaluated": {
      const beat = mainlineBeat(ctx);
      // R3 工作项 5：Gate/Beat 身份校验——trigger 必须绑定当前 Beat 的 completion
      // gate（服务端从 pinned Plan 计算的绑定）。任一不符 → 显式
      // gate_binding_mismatch：零转移、零游标变化（fail closed，不静默降级）。
      const boundGateId = beat.completion_evidence.gate?.gate_id;
      if (trigger.beat_id !== beat.beat_id || trigger.gate_id !== boundGateId) {
        return {
          ok: false,
          failure: {
            failure_class: "gate_binding_mismatch",
            message: `gate_evaluated ${trigger.gate_id}@${trigger.beat_id} does not match the current beat binding ${String(
              boundGateId,
            )}@${beat.beat_id} (zero transitions, zero cursor changes)`,
          },
        };
      }
      if (!trigger.satisfied) {
        // gate unsatisfied：不转移；首次→澄清推理位置，连续未解决→批准 unclear
        // 分支（若有）或计划内安全 fallback。
        if (ctx.unresolvedClarifications >= 1) {
          const branchOutcome = openApprovedBranch(
            ctx,
            beat,
            "unclear",
            { sequence: trigger.sequence, hypothesis: unclearHypothesis() },
            "open_scaffold",
          );
          if (branchOutcome.ok) return branchOutcome;
        }
        return {
          ok: true,
          decision: {
            decision_id: decisionId(ctx.sessionId, trigger.sequence),
            decision_kind: "request_clarification",
            protocol_id: ctx.plan.mainline.protocol_id,
            beat_id: beat.beat_id,
            policy_version: NAVIGATOR_V5_VERSION,
            source_event_sequence: trigger.sequence,
            source_state_revision: ctx.revision,
            transition_basis: { basis: "gate_unsatisfied", gate_id: trigger.gate_id },
          },
        };
      }
      if (isLastMainlineBeat(ctx, beat)) {
        return {
          ok: true,
          decision: {
            decision_id: decisionId(ctx.sessionId, trigger.sequence),
            decision_kind: "complete_beat",
            protocol_id: ctx.plan.mainline.protocol_id,
            beat_id: beat.beat_id,
            policy_version: NAVIGATOR_V5_VERSION,
            source_event_sequence: trigger.sequence,
            source_state_revision: ctx.revision,
            transition_basis: { basis: "gate_satisfied", gate_id: trigger.gate_id },
          },
        };
      }
      const edge = transitionEdge(beat, "gate_satisfied") ?? transitionEdge(beat, "evidence_collected");
      if (!edge) {
        return {
          ok: false,
          failure: {
            failure_class: "no_legal_transition",
            message: `beat ${beat.beat_id} gate satisfied but no gate_satisfied/evidence_collected edge is declared`,
          },
        };
      }
      if (!ctx.plan.mainline.beats.has(edge.to_beat)) {
        return {
          ok: false,
          failure: { failure_class: "no_legal_transition", message: `transition target ${edge.to_beat} is not in the mainline protocol` },
        };
      }
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, trigger.sequence),
          decision_kind: "transition_beat",
          protocol_id: ctx.plan.mainline.protocol_id,
          beat_id: beat.beat_id,
          to_beat_id: edge.to_beat,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: trigger.sequence,
          source_state_revision: ctx.revision,
          transition_basis: { basis: "gate_satisfied", gate_id: trigger.gate_id },
        },
      };
    }
    case "silence": {
      // 无进展证据（R0 §1：silence/timeout/无新事实 → no_progress）：
      // - inquiry 打开期间 → bounded 纪律强制返回主线（不隐式推进 TeachingCursor）；
      // - 主线 → 澄清门禁（request_clarification；不得打开任何分支）。
      if (ctx.state.inquiry_cursor) {
        return forcedReturn(ctx, { sequence: trigger.sequence, hypothesis: trigger.hypothesis });
      }
      const beat = mainlineBeat(ctx);
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, trigger.sequence),
          decision_kind: "request_clarification",
          protocol_id: ctx.plan.mainline.protocol_id,
          beat_id: beat.beat_id,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: trigger.sequence,
          source_state_revision: ctx.revision,
          interpretation_summary: interpretSummary(trigger.hypothesis, trigger.sequence),
        },
      };
    }
    case "student_input":
      return decideStudentInput(ctx, trigger);
    case "beat_execution": {
      // F6：当前 Beat（协议 inquiry 打开时=inquiry Beat；LocalInquiry/主线=主线
      // 游标 Beat——与 NavigatorSession.currentBeat 同口径）的 execute_beat 呈现
      // 决策。completed 守卫已在入口生效；无转移、无游标变化——只锚定呈现。
      const inquiryProtocolId = ctx.state.inquiry_cursor?.inquiry_protocol_id;
      if (inquiryProtocolId) {
        const protocol = pinnedProtocol(ctx.plan, inquiryProtocolId);
        const beatId = ctx.inquiryBeatId ?? protocol?.entry_beat_id;
        if (!protocol || !beatId) {
          return {
            ok: false,
            failure: {
              failure_class: "no_legal_transition",
              message: `beat_execution: inquiry cursor references unknown entry beat in ${inquiryProtocolId}`,
            },
          };
        }
        return {
          ok: true,
          decision: {
            decision_id: decisionId(ctx.sessionId, trigger.sequence),
            decision_kind: "execute_beat",
            protocol_id: protocol.protocol_id,
            beat_id: beatId,
            policy_version: NAVIGATOR_V5_VERSION,
            source_event_sequence: trigger.sequence,
            source_state_revision: ctx.revision,
            transition_basis: { basis: "legal_transition" },
          },
        };
      }
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, trigger.sequence),
          decision_kind: "execute_beat",
          protocol_id: ctx.plan.mainline.protocol_id,
          beat_id: ctx.state.teaching_cursor.beat_id,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: trigger.sequence,
          source_state_revision: ctx.revision,
          transition_basis: { basis: "legal_transition" },
        },
      };
    }
  }
}

function unclearHypothesis(): NavigatorInterpretation {
  return {
    intent: "submit_answer",
    reasoning_location: "unknown",
    confidence: 0.3,
    interpreter_version: INTERPRETER_V5_VERSION,
    in_bound: true,
  };
}

function decideStudentInput(
  ctx: NavigatorContext,
  trigger: Extract<NavigatorTrigger, { kind: "student_input" }>,
): NavigatorOutcome {
  const hypothesis = trigger.hypothesis;

  // ---- inquiry 打开期间：主线游标冻结，只处理 inquiry 内推进/返回 ----
  if (ctx.state.inquiry_cursor) {
    if (trigger.intent_kind === "barge_in") {
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, trigger.sequence),
          decision_kind: "pause",
          protocol_id: ctx.plan.mainline.protocol_id,
          beat_id: ctx.state.teaching_cursor.beat_id,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: trigger.sequence,
          source_state_revision: ctx.revision,
          interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
        },
      };
    }
    if (trigger.intent_kind === "return_to_mainline") {
      return forcedReturn(ctx, trigger);
    }
    // inquiry 内完成证据：评估当前 inquiry Beat 的 gate（不发 gate_evaluated
    // 事件——f5-scope-ledger「Reducer 相位细化约定」纪律 1：分支协议与主线
    // 共享 BT-xx id 空间，入流会误置主线相位）。R3：student_answer 的裁决来自
    // 编排层同一次模型调用（hypothesis.gate_assessment，服务端已复核候选集）；
    // confirmation 等结构化证据仍确定性判定——无模型裁决不得 pass。
    const inquiryProtocolId = ctx.state.inquiry_cursor.inquiry_protocol_id;
    if (!inquiryProtocolId) {
      // LocalInquiryProtocol：bounded 推进，不带协议 gate。
      return localInquiry(ctx, mainlineBeat(ctx), trigger);
    }
    const protocol = pinnedProtocol(ctx.plan, inquiryProtocolId);
    const inquiryBeatId = ctx.inquiryBeatId ?? protocol?.entry_beat_id;
    const beat = protocol?.beats.get(inquiryBeatId ?? "");
    if (!protocol || !beat) {
      return {
        ok: false,
        failure: {
          failure_class: "no_legal_transition",
          message: `inquiry cursor references unknown beat ${inquiryProtocolId}/${String(inquiryBeatId)}`,
        },
      };
    }
    const assessment = evaluateGateEvidence(ctx.plan, beat, {
      confirmation_sequences:
        trigger.intent_kind === "confirm" || trigger.intent_kind === "continue" ? [trigger.sequence] : [],
      workspace_outcomes: [],
      narration_completed: false,
      ...(hypothesis.gate_assessment ? { model_assessment: hypothesis.gate_assessment } : {}),
    });
    if (assessment.satisfied) {
      const isLast = protocol.beat_order[protocol.beat_order.length - 1] === beat.beat_id;
      if (isLast) {
        return {
          ok: true,
          decision: {
            decision_id: decisionId(ctx.sessionId, trigger.sequence),
            decision_kind: "return_to_mainline",
            // F7 D-2：decision.protocol_id 是 reducer 的游标目的地协议——分支
            // 自然收尾返回主线时必须携带主线协议（与 forcedReturn 同口径）；
            // 误带分支协议会让 return 后游标解析到分支 Beat（participation
            // 投影错形态：scaffold BT-01 student_answer 冒充主线确认拍）。
            protocol_id: ctx.plan.mainline.protocol_id,
            beat_id: beat.beat_id,
            to_beat_id: ctx.state.inquiry_cursor.return_beat_id,
            policy_version: NAVIGATOR_V5_VERSION,
            source_event_sequence: trigger.sequence,
            source_state_revision: ctx.revision,
            transition_basis: { basis: "inquiry_completed" },
            inquiry: {
              inquiry_id: ctx.state.inquiry_cursor.inquiry_id,
              inquiry_protocol_id: protocol.protocol_id,
              return_beat_id: ctx.state.inquiry_cursor.return_beat_id,
            },
            interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
          },
        };
      }
      const edge = transitionEdge(beat, "evidence_collected") ?? transitionEdge(beat, "gate_satisfied");
      const nextBeat = edge?.to_beat ?? beat.beat_id;
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, trigger.sequence),
          decision_kind: "continue_inquiry",
          protocol_id: protocol.protocol_id,
          beat_id: nextBeat,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: trigger.sequence,
          source_state_revision: ctx.revision,
          transition_basis: { basis: "student_evidence" },
          inquiry: {
            inquiry_id: ctx.state.inquiry_cursor.inquiry_id,
            inquiry_protocol_id: protocol.protocol_id,
            return_beat_id: ctx.state.inquiry_cursor.return_beat_id,
          },
          interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
        },
      };
    }
    // inquiry 内证据未满足：继续当前 inquiry Beat（教师再问）。
    return {
      ok: true,
      decision: {
        decision_id: decisionId(ctx.sessionId, trigger.sequence),
        decision_kind: "continue_inquiry",
        protocol_id: protocol.protocol_id,
        beat_id: beat.beat_id,
        policy_version: NAVIGATOR_V5_VERSION,
        source_event_sequence: trigger.sequence,
        source_state_revision: ctx.revision,
        inquiry: {
          inquiry_id: ctx.state.inquiry_cursor.inquiry_id,
          inquiry_protocol_id: protocol.protocol_id,
          return_beat_id: ctx.state.inquiry_cursor.return_beat_id,
        },
        interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
      },
    };
  }

  // ---- 主线（无 inquiry 打开）----
  const beat = mainlineBeat(ctx);

  if (trigger.intent_kind === "barge_in") {
    // barge-in 是瞬时行为：只暂停等待，不推进教学状态（student-intent 合同）。
    return {
      ok: true,
      decision: {
        decision_id: decisionId(ctx.sessionId, trigger.sequence),
        decision_kind: "pause",
        protocol_id: ctx.plan.mainline.protocol_id,
        beat_id: beat.beat_id,
        policy_version: NAVIGATOR_V5_VERSION,
        source_event_sequence: trigger.sequence,
        source_state_revision: ctx.revision,
        interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
      },
    };
  }

  if (trigger.intent_kind === "ask_question" || trigger.intent_kind === "request_scaffold" || trigger.intent_kind === "request_rephrase") {
    // out-of-bound：不在批准图与资源边界内，LocalInquiry 不可安全回答 →
    // 澄清（首次）→ 计划内安全 fallback（连续未解决）。
    if (!hypothesis.in_bound) {
      if (ctx.unresolvedClarifications >= 1) {
        return {
          ok: true,
          decision: {
            decision_id: decisionId(ctx.sessionId, trigger.sequence),
            decision_kind: "safe_fallback",
            protocol_id: ctx.plan.mainline.protocol_id,
            beat_id: beat.beat_id,
            policy_version: NAVIGATOR_V5_VERSION,
            source_event_sequence: trigger.sequence,
            source_state_revision: ctx.revision,
            transition_basis: { basis: "safe_fallback_policy" },
            interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
          },
        };
      }
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, trigger.sequence),
          decision_kind: "request_clarification",
          protocol_id: ctx.plan.mainline.protocol_id,
          beat_id: beat.beat_id,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: trigger.sequence,
          source_state_revision: ctx.revision,
          transition_basis: { basis: "student_evidence" },
          interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
        },
      };
    }
    const triggerKind: InquiryTrigger =
      trigger.intent_kind === "ask_question" ? "ask_question" : trigger.intent_kind === "request_scaffold" ? "request_scaffold" : "request_rephrase";
    // 2026-08-31 R1 对抗负例（章程）：低置信但 in_bound → 澄清门禁（不开分支——
    // 话题在批准边界内但 interpreter 无法可靠定位，开分支会放大错误假设）。
    if (hypothesis.confidence < ASSISTANCE_CONFIDENT_THRESHOLD) {
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, trigger.sequence),
          decision_kind: "request_clarification",
          protocol_id: ctx.plan.mainline.protocol_id,
          beat_id: beat.beat_id,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: trigger.sequence,
          source_state_revision: ctx.revision,
          transition_basis: { basis: "student_evidence" },
          interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
        },
      };
    }
    const branchOutcome = openApprovedBranch(
      ctx,
      beat,
      triggerKind,
      { sequence: trigger.sequence, hypothesis },
      trigger.intent_kind === "request_scaffold" ? "open_scaffold" : "open_inquiry",
    );
    if (branchOutcome.ok) return branchOutcome;
    // 批准分支不匹配 → fallback 链（ADR-007 §3）：
    // request_scaffold/rephrase→session-local LocalInquiry（在批准边界内）；
    // ask_question 且分支存在但 trigger 不匹配 → LocalInquiry。
    if (trigger.intent_kind === "request_scaffold" || trigger.intent_kind === "request_rephrase" || beat.inquiry_branch) {
      const inquiry = {
        inquiry_id: inquiryId(ctx.sessionId, trigger.sequence),
        return_beat_id: beat.beat_id,
      };
      // 2026-08-31 R1（用户拍板 2）：LocalInquiryProtocol 结构化——六要素全量、
      // LPR-/LBT- 命名空间、Builder 在 Pinned RG/Plan 资源边界内生成、越界
      // fail closed（LocalInquiryBoundaryError）；结构随决策事件持久化一次，
      // 重放经 findLocalInquiryProtocol 反查（事件化可重建）。
      const localProtocol = buildLocalInquiryProtocol({
        plan: ctx.plan,
        anchorBeat: beat,
        sessionId: ctx.sessionId,
        sequence: trigger.sequence,
        inquiryId: inquiry.inquiry_id,
      });
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, trigger.sequence),
          decision_kind: "open_inquiry",
          protocol_id: ctx.plan.mainline.protocol_id,
          beat_id: beat.beat_id,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: trigger.sequence,
          source_state_revision: ctx.revision,
          transition_basis: { basis: "student_evidence" },
          inquiry,
          local_inquiry_protocol: localProtocol,
          interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
        },
      };
    }
    return {
      ok: true,
      decision: {
        decision_id: decisionId(ctx.sessionId, trigger.sequence),
        decision_kind: "request_clarification",
        protocol_id: ctx.plan.mainline.protocol_id,
        beat_id: beat.beat_id,
        policy_version: NAVIGATOR_V5_VERSION,
        source_event_sequence: trigger.sequence,
        source_state_revision: ctx.revision,
        interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
      },
    };
  }

  if (trigger.intent_kind === "submit_answer") {
    // 替代路线：interpreter 假设必须先经 RG 复核（可推翻假设的验证义务）。
    if (hypothesis.matched_variant_id) {
      const variant = ctx.plan.solution_variants.find((entry) => entry.variant_id === hypothesis.matched_variant_id);
      const goalFact = variant ? ctx.plan.facts.get(variant.goal_fact_id) : undefined;
      if (variant && goalFact) {
        return {
          ok: true,
          decision: {
            decision_id: decisionId(ctx.sessionId, trigger.sequence),
            decision_kind: "accept_alternate_path",
            protocol_id: ctx.plan.mainline.protocol_id,
            beat_id: beat.beat_id,
            policy_version: NAVIGATOR_V5_VERSION,
            source_event_sequence: trigger.sequence,
            source_state_revision: ctx.revision,
            transition_basis: { basis: "student_evidence", graph_variant_id: variant.variant_id },
            interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
          },
        };
      }
      // 假设被推翻：variant 不在 RG 内 → 回落到澄清（不采信假设）。
    }
    if (hypothesis.reasoning_location === "partially_aligned" || hypothesis.reasoning_location === "misaligned") {
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, trigger.sequence),
          decision_kind: "request_clarification",
          protocol_id: ctx.plan.mainline.protocol_id,
          beat_id: beat.beat_id,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: trigger.sequence,
          source_state_revision: ctx.revision,
          transition_basis: { basis: "student_evidence" },
          interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
        },
      };
    }
    if (hypothesis.reasoning_location === "unknown") {
      // unclear：优先批准 unclear 分支（BT-03 声明），否则澄清。
      const branchOutcome = openApprovedBranch(
        ctx,
        beat,
        "unclear",
        { sequence: trigger.sequence, hypothesis },
        "open_scaffold",
      );
      if (branchOutcome.ok) return branchOutcome;
      return {
        ok: true,
        decision: {
          decision_id: decisionId(ctx.sessionId, trigger.sequence),
          decision_kind: "request_clarification",
          protocol_id: ctx.plan.mainline.protocol_id,
          beat_id: beat.beat_id,
          policy_version: NAVIGATOR_V5_VERSION,
          source_event_sequence: trigger.sequence,
          source_state_revision: ctx.revision,
          interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
        },
      };
    }
    // aligned 但 gate 未由编排层判定满足（如答案命中当前 Beat fact 之外的
    // 后续 fact 也可能是 aligned+matched）：澄清推理位置。
    return {
      ok: true,
      decision: {
        decision_id: decisionId(ctx.sessionId, trigger.sequence),
        decision_kind: "request_clarification",
        protocol_id: ctx.plan.mainline.protocol_id,
        beat_id: beat.beat_id,
        policy_version: NAVIGATOR_V5_VERSION,
        source_event_sequence: trigger.sequence,
        source_state_revision: ctx.revision,
        interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
      },
    };
  }

  if (trigger.intent_kind === "confirm" || trigger.intent_kind === "continue" || trigger.intent_kind === "return_to_mainline") {
    // 主线确认/推进的完成判定经 gate 事实（编排层评估→gate_evaluated→decide），
    // 此处兜底：保持当前 Beat 执行。
    return {
      ok: true,
      decision: {
        decision_id: decisionId(ctx.sessionId, trigger.sequence),
        decision_kind: "execute_beat",
        protocol_id: ctx.plan.mainline.protocol_id,
        beat_id: beat.beat_id,
        policy_version: NAVIGATOR_V5_VERSION,
        source_event_sequence: trigger.sequence,
        source_state_revision: ctx.revision,
        interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
      },
    };
  }

  // submit_workspace_command / replay_narration / retry_recovery：证据经
  // outcome 事实判定，此处无教学决策可做——保持执行当前 Beat。
  return {
    ok: true,
    decision: {
      decision_id: decisionId(ctx.sessionId, trigger.sequence),
      decision_kind: "execute_beat",
      protocol_id: ctx.plan.mainline.protocol_id,
      beat_id: beat.beat_id,
      policy_version: NAVIGATOR_V5_VERSION,
      source_event_sequence: trigger.sequence,
      source_state_revision: ctx.revision,
      interpretation_summary: interpretSummary(hypothesis, trigger.sequence),
    },
  };
}
